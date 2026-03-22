/**
 * orchestrator.js — Agente Orquestrador
 *
 * Controla e coordena o fluxo completo entre todos os agentes.
 * Garante que nenhuma etapa seja pulada e que os dados fluam corretamente
 * do crawl → extração → enriquecimento → captura de sinais.
 *
 * Fluxo garantido:
 *
 *  [A1] Recrawl Propmark (artigos sem content)
 *    └→ [A2a] Extração artigos (agency_history + marketing_leaders)
 *
 *  [A3] Crawl Mídia de Negócios (Exame + Valor, filtrado por marcas)
 *    └→ [A2a] Extração artigos de mídia
 *
 *  [A2b] Extração edições M&M Website
 *    └→ (alimenta agency_history + marketing_leaders)
 *
 *  [A4] Enriquecimento de Executivos (PeopleDataLabs)
 *    └→ (atualiza marketing_leaders)
 *
 *  [A6] Captura de Sinais
 *    └→ (consome tudo acima → gera signal_events)
 *
 * O orquestrador verifica o estado de cada etapa antes de iniciar a próxima,
 * garante que não haja execuções sobrepostas e reporta gaps encontrados.
 */

const supabase = require('../lib/supabase')

// ─── Verificações de estado ───────────────────────────────────────────────────

async function checkPropmarkBacklog() {
  const { count } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .eq('source_name', 'propmark')
    .or('content.is.null,content.eq.')
    .not('extraction_status', 'eq', 'crawl_failed')
  return count || 0
}

async function checkArticlesPending() {
  const { count } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .or('extraction_status.is.null,extraction_status.eq.pending')
    .not('content', 'is', null)
    .neq('content', '')
  return count || 0
}

async function checkEditionsPending() {
  const { count } = await supabase
    .from('editions')
    .select('*', { count: 'exact', head: true })
    .not('text_content', 'is', null)
    .not('signals', 'cs', '{"extracted":true}')
  return count || 0
}

async function checkSignalEventsFresh() {
  // Eventos de sinal capturados nas últimas 6h
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('signal_events')
    .select('*', { count: 'exact', head: true })
    .gte('captured_at', since)
  return count || 0
}

async function checkLastMediaCrawl() {
  // Último artigo salvo de mídia (Exame/Valor)
  const { data } = await supabase
    .from('articles')
    .select('crawled_at')
    .in('source_name', ['exame', 'valor'])
    .order('crawled_at', { ascending: false })
    .limit(1)
  if (!data?.length) return null
  return new Date(data[0].crawled_at)
}

// ─── Estado completo do pipeline ─────────────────────────────────────────────

async function getPipelineState() {
  const [
    propmarkBacklog,
    articlesPending,
    editionsPending,
    signalsFresh,
    lastMediaCrawl,
    { count: totalAgencyHistory },
    { count: totalLeaders },
    { count: totalSignalEvents },
    { count: totalArticles },
    { count: totalEditions },
  ] = await Promise.all([
    checkPropmarkBacklog(),
    checkArticlesPending(),
    checkEditionsPending(),
    checkSignalEventsFresh(),
    checkLastMediaCrawl(),
    supabase.from('agency_history').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),
    supabase.from('signal_events').select('*', { count: 'exact', head: true }),
    supabase.from('articles').select('*', { count: 'exact', head: true }),
    supabase.from('editions').select('*', { count: 'exact', head: true }),
  ])

  const mediaCrawlAgeHours = lastMediaCrawl
    ? (Date.now() - lastMediaCrawl.getTime()) / (1000 * 60 * 60)
    : Infinity

  return {
    propmark_backlog:    propmarkBacklog,
    articles_pending:    articlesPending,
    editions_pending:    editionsPending,
    signal_events_fresh: signalsFresh,
    media_crawl_age_h:   Math.round(mediaCrawlAgeHours * 10) / 10,
    totals: {
      articles:       totalArticles       || 0,
      editions:       totalEditions       || 0,
      agency_history: totalAgencyHistory  || 0,
      leaders:        totalLeaders        || 0,
      signal_events:  totalSignalEvents   || 0,
    },
  }
}

// ─── Decide quais agentes precisam rodar ────────────────────────────────────

function buildRunPlan(state) {
  const tasks = []
  const gaps  = []

  // A1: Propmark recrawl
  if (state.propmark_backlog > 0) {
    tasks.push({
      agent: 'recrawl_propmark',
      label: `Recrawl Propmark (${state.propmark_backlog} artigos sem content)`,
      priority: 1,
    })
  }

  // A3: Mídia de negócios (se > 4h desde último crawl)
  if (state.media_crawl_age_h > 4) {
    tasks.push({
      agent: 'crawl_media',
      label: `Crawl Exame + Valor (última execução: ${state.media_crawl_age_h === Infinity ? 'nunca' : state.media_crawl_age_h + 'h atrás'})`,
      priority: 2,
    })
  }

  // A2a: Extração de artigos
  if (state.articles_pending > 0) {
    tasks.push({
      agent: 'extract_articles',
      label: `Extração de ${state.articles_pending} artigos pendentes`,
      priority: 3,
      depends_on: ['recrawl_propmark', 'crawl_media'],
    })
  }

  // A2b: Extração de edições M&M
  if (state.editions_pending > 0) {
    tasks.push({
      agent: 'extract_editions',
      label: `Extração de ${state.editions_pending} edições M&M pendentes`,
      priority: 3,
    })
  }

  // A4: PDL — sempre roda se PDL_API_KEY configurada (uma vez por dia via cron)
  // O orquestrador não força PDL para não gastar créditos desnecessariamente
  // Apenas reporta o estado

  // A6: Captura de sinais — sempre roda após extração
  const needsSignalCapture = state.articles_pending > 0 ||
    state.editions_pending > 0 ||
    state.signal_events_fresh === 0

  if (needsSignalCapture) {
    tasks.push({
      agent: 'capture_signals',
      label: `Captura de sinais (${state.signal_events_fresh} eventos nas últimas 6h)`,
      priority: 4,
      depends_on: ['extract_articles', 'extract_editions'],
    })
  }

  // Gaps identificados
  if (state.totals.agency_history === 0) {
    gaps.push('agency_history está vazio — extração de artigos/edições não gerou relações ainda')
  }
  if (state.totals.leaders < 10) {
    gaps.push(`marketing_leaders com poucos registros (${state.totals.leaders}) — Agente 4 (PDL) precisa rodar`)
  }
  if (state.totals.signal_events === 0) {
    gaps.push('signal_events vazio — Agente 6 ainda não capturou nenhum evento')
  }
  if (state.propmark_backlog > 1000) {
    gaps.push(`${state.propmark_backlog} artigos Propmark sem content — recrawl longo necessário`)
  }
  if (state.editions_pending > 10000) {
    gaps.push(`${state.editions_pending} edições M&M pendentes — extração pode levar horas`)
  }

  return { tasks, gaps }
}

// ─── Executa o pipeline sequencialmente ─────────────────────────────────────

async function runPipelineStep(agent, opts = {}) {
  const { runExtraction, runEditionExtraction } = require('./articleExtractor')
  const { runMediaSearch }    = require('./mediaSearchAgent')
  const { runSignalCapture }  = require('./signalCaptureAgent')
  const supabaseLib           = require('../lib/supabase')

  switch (agent) {
    case 'recrawl_propmark': {
      const { scrapeArticlePage } = require('../crawlers/propmark')
      const { data: articles } = await supabaseLib
        .from('articles')
        .select('id, url')
        .or('content.is.null,content.eq.')
        .not('extraction_status', 'eq', 'crawl_failed')
        .eq('source_name', 'propmark')
        .limit(opts.batch || 200)

      let ok = 0, errors = 0
      for (const art of (articles || [])) {
        try {
          const scraped = await scrapeArticlePage(art.url)
          if (scraped.content?.length > 50) {
            await supabaseLib.from('articles').update({
              content: scraped.content, excerpt: scraped.excerpt || null,
              author: scraped.author || null, published_at: scraped.published_at || null,
              tags: scraped.tags || [], extraction_status: 'pending', extracted_at: null,
            }).eq('id', art.id)
            ok++
          } else {
            await supabaseLib.from('articles').update({ extraction_status: 'crawl_failed', content: '' }).eq('id', art.id)
            errors++
          }
        } catch { errors++ }
        opts.onProgress?.(ok + errors, articles.length)
        await new Promise(r => setTimeout(r, 1000))
      }
      return { ok, errors, total: articles?.length || 0 }
    }

    case 'crawl_media':
      return await runMediaSearch({ extract: false, onProgress: opts.onProgress })

    case 'extract_articles':
      return await runExtraction({ limit: opts.limit || 300, onProgress: opts.onProgress })

    case 'extract_editions':
      return await runEditionExtraction({ limit: opts.limit || 500 })

    case 'capture_signals':
      return await runSignalCapture({ limit: opts.limit || 150, onProgress: opts.onProgress })

    default:
      throw new Error(`Agente desconhecido: ${agent}`)
  }
}

// ─── Orquestrador principal ──────────────────────────────────────────────────

/**
 * Executa o pipeline completo de forma controlada.
 *
 * @param {Object} opts
 * @param {boolean} opts.dry_run     - só reporta o que faria, não executa (default: false)
 * @param {boolean} opts.full        - força todos os agentes mesmo sem backlog (default: false)
 * @param {Function} opts.onProgress - callback(fase, detalhes)
 */
async function runOrchestrator({ dry_run = false, full = false, onProgress } = {}) {
  console.log('[orchestrator] Iniciando verificação do pipeline...')
  onProgress?.('checking', {})

  // 1. Estado atual
  const state = await getPipelineState()
  console.log('[orchestrator] Estado:', JSON.stringify(state))

  // 2. Plano de execução
  const { tasks, gaps } = buildRunPlan(state)

  if (full) {
    // Força todos os agentes independente do estado
    for (const agent of ['crawl_media', 'extract_articles', 'extract_editions', 'capture_signals']) {
      if (!tasks.find(t => t.agent === agent)) {
        tasks.push({ agent, label: `${agent} (forçado)`, priority: 5 })
      }
    }
  }

  tasks.sort((a, b) => a.priority - b.priority)

  const report = {
    checked_at:  new Date().toISOString(),
    state,
    gaps,
    plan:        tasks.map(t => t.label),
    executed:    [],
    results:     {},
    errors:      [],
    dry_run,
  }

  if (gaps.length) {
    console.log('[orchestrator] Gaps identificados:')
    gaps.forEach(g => console.log('  ⚠', g))
  }

  if (dry_run) {
    console.log('[orchestrator] DRY RUN — nada executado')
    return report
  }

  if (tasks.length === 0) {
    console.log('[orchestrator] Nada a fazer — pipeline em dia')
    return report
  }

  // 3. Executa sequencialmente respeitando dependências
  const done = new Set()

  for (const task of tasks) {
    // Verifica dependências
    const deps = task.depends_on || []
    const depsOk = deps.every(d => done.has(d))
    if (!depsOk) {
      console.log(`[orchestrator] Pulando ${task.agent} — dependências não concluídas (${deps.join(', ')})`)
      continue
    }

    console.log(`[orchestrator] Executando: ${task.label}`)
    onProgress?.('running', { agent: task.agent, label: task.label })

    try {
      const result = await runPipelineStep(task.agent, {
        batch: 200, limit: 300,
        onProgress: (p, t) => onProgress?.('step_progress', { agent: task.agent, progress: p, total: t }),
      })
      report.executed.push(task.agent)
      report.results[task.agent] = result
      done.add(task.agent)
      console.log(`[orchestrator] ✓ ${task.agent}:`, JSON.stringify(result))
    } catch (e) {
      report.errors.push({ agent: task.agent, error: e.message })
      console.error(`[orchestrator] ✗ ${task.agent}: ${e.message}`)
      // Não para — continua com próximos agentes independentes
    }
  }

  // 4. Re-verifica o estado após execução
  const stateAfter = await getPipelineState()
  report.state_after = stateAfter

  const remaining = (stateAfter.propmark_backlog || 0) +
    (stateAfter.articles_pending || 0) +
    (stateAfter.editions_pending || 0)

  report.pipeline_complete = remaining === 0
  report.remaining_items   = remaining

  console.log(`[orchestrator] Concluído. Itens restantes: ${remaining}. Pipeline completo: ${report.pipeline_complete}`)
  return report
}

module.exports = { runOrchestrator, getPipelineState, buildRunPlan }
