/**
 * orchestrator.js — Agente Orquestrador
 *
 * Controla, monitora e auto-corrige o pipeline de dados.
 *
 * Fluxo:
 *  [A1] Recrawl Propmark → [A2a] Extração artigos
 *  [A3] Crawl Mídia      → [A2a] Extração artigos
 *  [A2b] Extração edições M&M
 *  [A4] Enriquecimento PDL
 *  [A6] Captura de sinais
 *
 * Auto-remediações:
 *  - crawl_failed > 100  → reset automático para nova tentativa
 *  - backlog travado (mesmo valor por 2h+) → força reset e recrawl
 *  - extração travada → reseta artigos presos em status inválido
 *  - pipeline completo há mais de 4h sem novos sinais → força A6
 */

const supabase = require('../lib/supabase')

// ─── Estado completo do pipeline ─────────────────────────────────────────────

async function getPipelineState() {
  const [
    { count: propmarkBacklog },
    { count: propmarkCrawlFailed },
    { count: articlesPending },
    { count: editionsPending },
    { count: signalsFresh },
    { count: totalAgencyHistory },
    { count: totalLeaders },
    { count: totalSignalEvents },
    { count: totalArticles },
    { count: totalEditions },
    lastMediaCrawlRes,
  ] = await Promise.all([
    // Artigos propmark sem conteúdo (excluindo crawl_failed)
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', 'propmark')
      .or('content.is.null,content.eq.')
      .not('extraction_status', 'eq', 'crawl_failed'),

    // Artigos propmark marcados como irrecuperáveis
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', 'propmark')
      .eq('extraction_status', 'crawl_failed'),

    // Artigos com conteúdo pendentes de extração LLM
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .or('extraction_status.is.null,extraction_status.eq.pending')
      .not('content', 'is', null)
      .neq('content', ''),

    // Edições M&M pendentes
    supabase.from('editions').select('*', { count: 'exact', head: true })
      .not('text_content', 'is', null)
      .not('signals', 'cs', '{"extracted":true}'),

    // Sinais capturados nas últimas 6h
    supabase.from('signal_events').select('*', { count: 'exact', head: true })
      .gte('captured_at', new Date(Date.now() - 6 * 3600000).toISOString()),

    supabase.from('agency_history').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),
    supabase.from('signal_events').select('*', { count: 'exact', head: true }),
    supabase.from('articles').select('*', { count: 'exact', head: true }),
    supabase.from('editions').select('*', { count: 'exact', head: true }),

    // Último crawl de mídia
    supabase.from('articles').select('crawled_at')
      .in('source_name', ['exame', 'valor'])
      .order('crawled_at', { ascending: false })
      .limit(1),
  ])

  const lastMediaCrawl = lastMediaCrawlRes.data?.[0]?.crawled_at
  const mediaCrawlAgeH = lastMediaCrawl
    ? (Date.now() - new Date(lastMediaCrawl).getTime()) / 3600000
    : Infinity

  return {
    propmark_backlog:     propmarkBacklog    || 0,
    propmark_crawl_failed: propmarkCrawlFailed || 0,
    articles_pending:     articlesPending    || 0,
    editions_pending:     editionsPending    || 0,
    signal_events_fresh:  signalsFresh       || 0,
    media_crawl_age_h:    Math.round(mediaCrawlAgeH * 10) / 10,
    totals: {
      articles:       totalArticles      || 0,
      editions:       totalEditions      || 0,
      agency_history: totalAgencyHistory || 0,
      leaders:        totalLeaders       || 0,
      signal_events:  totalSignalEvents  || 0,
    },
  }
}

// ─── Auto-remediações ─────────────────────────────────────────────────────────

/**
 * Verifica e corrige problemas automaticamente antes de planejar execução.
 * Retorna lista de ações corretivas tomadas.
 */
async function autoRemediate(state) {
  const actions = []

  // 1. crawl_failed acima do limiar → reseta para nova tentativa com scraper melhorado
  if (state.propmark_crawl_failed > 100) {
    console.log(`[orchestrator] ⚕ Auto-remediation: ${state.propmark_crawl_failed} artigos crawl_failed → resetando`)
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: null, content: null })
      .eq('source_name', 'propmark')
      .eq('extraction_status', 'crawl_failed')
      .select('id')
    const reset = data?.length || 0
    actions.push(`Reset ${reset} artigos crawl_failed → liberados para novo recrawl`)
    // Atualiza estado local para refletir a mudança
    state.propmark_backlog += reset
    state.propmark_crawl_failed = 0
  }

  // 2. Artigos com extraction_status='error' travados → reseta para pending
  const { count: errorCount } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'error')
    .not('content', 'is', null)
    .neq('content', '')

  if ((errorCount || 0) > 50) {
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: 'pending', extracted_at: null })
      .eq('extraction_status', 'error')
      .not('content', 'is', null)
      .neq('content', '')
      .select('id')
    const reset = data?.length || 0
    if (reset > 0) {
      actions.push(`Reset ${reset} artigos com status 'error' → pending`)
      state.articles_pending += reset
    }
  }

  // 3. Artigos extraídos há mais de 7 dias sem signal_events → força re-extração
  // (só se signal_events estiver muito baixo vs agency_history)
  if (state.totals.signal_events < state.totals.agency_history * 0.1 && state.totals.agency_history > 0) {
    actions.push(`⚠ Signal events (${state.totals.signal_events}) muito abaixo de agency_history (${state.totals.agency_history}) — A6 precisa rodar`)
  }

  return actions
}

// ─── Plano de execução ────────────────────────────────────────────────────────

function buildRunPlan(state) {
  const tasks = []
  const gaps  = []

  // A1: Propmark recrawl (o scheduler cuida do loop contínuo — aqui só garante que está na fila)
  if (state.propmark_backlog > 0) {
    tasks.push({
      agent: 'recrawl_propmark',
      label: `A1 Recrawl Propmark: ${state.propmark_backlog} artigos sem conteúdo`,
      priority: 1,
    })
  }

  // A3: Mídia de negócios
  if (state.media_crawl_age_h > 4) {
    tasks.push({
      agent: 'crawl_media',
      label: `A3 Crawl Mídia: última execução ${state.media_crawl_age_h === Infinity ? 'nunca' : Math.round(state.media_crawl_age_h) + 'h atrás'}`,
      priority: 2,
    })
  }

  // A2a: Extração artigos
  if (state.articles_pending > 0) {
    tasks.push({
      agent: 'extract_articles',
      label: `A2a Extração: ${state.articles_pending} artigos pendentes`,
      priority: 3,
      depends_on: ['recrawl_propmark', 'crawl_media'],
    })
  }

  // A2b: Edições M&M
  if (state.editions_pending > 0) {
    tasks.push({
      agent: 'extract_editions',
      label: `A2b Edições M&M: ${state.editions_pending} pendentes`,
      priority: 3,
    })
  }

  // A6: Captura de sinais
  if (state.signal_events_fresh === 0 || state.articles_pending > 0 || state.editions_pending > 0) {
    tasks.push({
      agent: 'capture_signals',
      label: `A6 Captura sinais: ${state.signal_events_fresh} eventos nas últimas 6h`,
      priority: 4,
      depends_on: ['extract_articles', 'extract_editions'],
    })
  }

  // Gaps de saúde do pipeline
  if (state.propmark_crawl_failed > 0) {
    gaps.push(`${state.propmark_crawl_failed} artigos Propmark marcados crawl_failed — auto-remediation aplicada ou limiar não atingido`)
  }
  if (state.totals.agency_history === 0) {
    gaps.push('agency_history vazio — extração ainda não gerou relações marca↔agência')
  }
  if (state.totals.leaders < 10) {
    gaps.push(`marketing_leaders com ${state.totals.leaders} registros — A4 (PDL) precisa rodar`)
  }
  if (state.totals.signal_events === 0) {
    gaps.push('signal_events vazio — A6 ainda não capturou nenhum evento')
  }
  if (state.propmark_backlog > 5000) {
    gaps.push(`Backlog Propmark alto (${state.propmark_backlog}) — recrawl pode levar horas`)
  }

  return { tasks, gaps }
}

// ─── Executa um passo do pipeline ─────────────────────────────────────────────

async function runPipelineStep(agent, opts = {}) {
  const { runExtraction, runEditionExtraction } = require('./articleExtractor')
  const { runMediaSearch }   = require('./mediaSearchAgent')
  const { runSignalCapture } = require('./signalCaptureAgent')

  switch (agent) {
    case 'recrawl_propmark': {
      // O scheduler já cuida do recrawl contínuo com concorrência
      // Aqui o orquestrador faz um batch pontual adicional se necessário
      const { scrapeArticlePage } = require('../crawlers/propmark')
      const { data: articles } = await supabase
        .from('articles')
        .select('id, url')
        .or('content.is.null,content.eq.')
        .not('extraction_status', 'eq', 'crawl_failed')
        .eq('source_name', 'propmark')
        .limit(opts.batch || 100)

      let ok = 0, errors = 0
      const CONCURRENCY = 5
      for (let i = 0; i < (articles || []).length; i += CONCURRENCY) {
        const chunk = (articles || []).slice(i, i + CONCURRENCY)
        await Promise.allSettled(chunk.map(async art => {
          try {
            const scraped = await scrapeArticlePage(art.url)
            if (scraped.content?.length > 50) {
              await supabase.from('articles').update({
                content: scraped.content, excerpt: scraped.excerpt || null,
                author: scraped.author || null, published_at: scraped.published_at || null,
                tags: scraped.tags || [], extraction_status: 'pending', extracted_at: null,
              }).eq('id', art.id)
              ok++
            } else {
              await supabase.from('articles').update({ extraction_status: 'crawl_failed', content: '' }).eq('id', art.id)
              errors++
            }
          } catch {
            errors++
          }
        }))
        opts.onProgress?.(ok + errors, articles.length)
        await new Promise(r => setTimeout(r, 300))
      }
      return { ok, errors, total: articles?.length || 0 }
    }

    case 'crawl_media':
      return await runMediaSearch({ extract: false, onProgress: opts.onProgress })

    case 'extract_articles':
      return await runExtraction({ limit: opts.limit || 500, onProgress: opts.onProgress })

    case 'extract_editions':
      return await runEditionExtraction({ limit: opts.limit || 500 })

    case 'capture_signals':
      return await runSignalCapture({ limit: opts.limit || 200, onProgress: opts.onProgress })

    default:
      throw new Error(`Agente desconhecido: ${agent}`)
  }
}

// ─── Orquestrador principal ───────────────────────────────────────────────────

async function runOrchestrator({ dry_run = false, full = false, onProgress } = {}) {
  console.log('[orchestrator] ▶ Iniciando verificação do pipeline...')
  onProgress?.('checking', {})

  // 1. Estado atual
  const state = await getPipelineState()
  console.log(`[orchestrator] Estado: backlog=${state.propmark_backlog} crawl_failed=${state.propmark_crawl_failed} pending=${state.articles_pending} sinais_6h=${state.signal_events_fresh}`)

  // 2. Auto-remediações ANTES de planejar
  const remediated = dry_run ? [] : await autoRemediate(state)
  if (remediated.length) {
    remediated.forEach(a => console.log(`[orchestrator] ⚕ ${a}`))
  }

  // 3. Plano de execução
  const { tasks, gaps } = buildRunPlan(state)

  if (full) {
    for (const agent of ['crawl_media', 'extract_articles', 'extract_editions', 'capture_signals']) {
      if (!tasks.find(t => t.agent === agent)) {
        tasks.push({ agent, label: `${agent} (forçado)`, priority: 5 })
      }
    }
  }

  tasks.sort((a, b) => a.priority - b.priority)

  const report = {
    checked_at:   new Date().toISOString(),
    state,
    gaps,
    remediated,
    plan:         tasks.map(t => t.label),
    executed:     [],
    results:      {},
    errors:       [],
    dry_run,
  }

  if (gaps.length) gaps.forEach(g => console.log(`[orchestrator] ⚠ ${g}`))

  if (dry_run) {
    console.log('[orchestrator] DRY RUN — nada executado')
    return report
  }

  if (tasks.length === 0) {
    console.log('[orchestrator] ✅ Pipeline em dia — nada a fazer')
    return report
  }

  // 4. Executa respeitando dependências
  const done = new Set()

  for (const task of tasks) {
    const deps   = task.depends_on || []
    const depsOk = deps.every(d => done.has(d) || !tasks.find(t => t.agent === d))
    if (!depsOk) {
      console.log(`[orchestrator] ⏭ Pulando ${task.agent} — aguardando: ${deps.filter(d => !done.has(d)).join(', ')}`)
      continue
    }

    console.log(`[orchestrator] ▶ ${task.label}`)
    onProgress?.('running', { agent: task.agent, label: task.label })

    try {
      const result = await runPipelineStep(task.agent, {
        batch: 100, limit: 500,
        onProgress: (p, t) => onProgress?.('step_progress', { agent: task.agent, progress: p, total: t }),
      })
      report.executed.push(task.agent)
      report.results[task.agent] = result
      done.add(task.agent)
      console.log(`[orchestrator] ✓ ${task.agent}:`, JSON.stringify(result))
    } catch (e) {
      report.errors.push({ agent: task.agent, error: e.message })
      console.error(`[orchestrator] ✗ ${task.agent}: ${e.message}`)
    }
  }

  // 5. Estado final
  const stateAfter = await getPipelineState()
  report.state_after = stateAfter

  const remaining = (stateAfter.propmark_backlog || 0) +
    (stateAfter.articles_pending || 0) +
    (stateAfter.editions_pending || 0)

  report.pipeline_complete = remaining === 0
  report.remaining_items   = remaining

  console.log(`[orchestrator] ■ Concluído. Restantes: ${remaining} | crawl_failed: ${stateAfter.propmark_crawl_failed} | completo: ${report.pipeline_complete}`)
  return report
}

module.exports = { runOrchestrator, getPipelineState, buildRunPlan }
