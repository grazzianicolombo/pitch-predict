/**
 * orchestrator.js — Agente Orquestrador
 *
 * Garante que o pipeline completo esteja sempre saudável, cobrindo os 4 objetivos:
 *
 *  [OBJ 1] FONTES ATUALIZADAS
 *    → A1:  Propmark RSS (novos artigos) + recrawl de artigos sem conteúdo
 *    → A3:  Mídia de Negócios (Exame + Valor + M&M + Adnews)
 *    → A8:  Busca Corporativa search-first (marcas/agências/executivos)
 *    → A2b: Edições M&M Website
 *
 *  [OBJ 2] EXTRAÇÃO E RELACIONAMENTO
 *    → A2a: Artigos → agency_history + marketing_leaders + pitches
 *    → A4:  Enriquecimento PDL de executivos
 *    → Validação: brand_id linkado, sem relações órfãs
 *
 *  [OBJ 3] DADOS NO MENU DE MARCAS
 *    → Verifica se brands têm agency_history e marketing_leaders associados
 *    → Detecta marcas sem dados e força re-extração direcionada
 *    → A7: Validação de agência atual (últimos 90 dias) — corrige dados desatualizados
 *
 *  [OBJ 4] MOTOR PREDITIVO ALIMENTADO
 *    → A6: signal_events atualizados por marca
 *    → Verifica se marcas têm sinais suficientes para predição
 *    → Alerta quando uma marca fica sem sinais por > 7 dias
 *
 *  AUTO-REMEDIAÇÕES:
 *    → crawl_failed > 100    → reset automático
 *    → articles status=error → reset para pending
 *    → brand_id null em agency_history → tenta vincular pelo nome
 *    → marcas sem sinais há 7d → força A6 direcionado
 */

const supabase = require('../lib/supabase')

// ─── OBJ 1: Estado das fontes ─────────────────────────────────────────────────

async function checkSources() {
  const [
    { count: propmarkBacklog },
    { count: propmarkCrawlFailed },
    { count: propmarkTotal },
    lastPropmarkRSS,
    lastMedia,
    lastMM,
    lastCorporate,
  ] = await Promise.all([
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', 'propmark')
      .or('content.is.null,content.eq.')
      .not('extraction_status', 'eq', 'crawl_failed'),

    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', 'propmark')
      .eq('extraction_status', 'crawl_failed'),

    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', 'propmark'),

    supabase.from('articles').select('crawled_at')
      .eq('source_name', 'propmark')
      .order('crawled_at', { ascending: false })
      .limit(1),

    // RSS geral: Exame, Valor, M&M, Adnews
    supabase.from('articles').select('crawled_at')
      .in('source_name', ['exame', 'valor', 'meioemensagem', 'adnews'])
      .order('crawled_at', { ascending: false })
      .limit(1),

    // M&M especificamente
    supabase.from('articles').select('crawled_at')
      .eq('source_name', 'meioemensagem')
      .order('crawled_at', { ascending: false })
      .limit(1),

    // Busca corporativa (search-first)
    supabase.from('articles').select('crawled_at')
      .in('source_name', ['corporate_news', 'b9', 'portaldapropaganda', 'adnews', 'brainstorm9'])
      .order('crawled_at', { ascending: false })
      .limit(1),
  ])

  function ageH(res) {
    const ts = res?.data?.[0]?.crawled_at
    return ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : Infinity
  }

  return {
    propmark_backlog:      propmarkBacklog     || 0,
    propmark_crawl_failed: propmarkCrawlFailed || 0,
    propmark_total:        propmarkTotal       || 0,
    propmark_age_h:        Math.round(ageH(lastPropmarkRSS) * 10) / 10,
    media_age_h:           Math.round(ageH(lastMedia) * 10) / 10,
    mm_age_h:              Math.round(ageH(lastMM) * 10) / 10,
    corporate_age_h:       Math.round(ageH(lastCorporate) * 10) / 10,
  }
}

// ─── OBJ 2: Estado da extração e relacionamento ───────────────────────────────

async function checkExtraction() {
  const [
    { count: articlesPending },
    { count: editionsPending },
    { count: agencyHistoryTotal },
    { count: leadersTotal },
    { count: orphanHistory },    // agency_history sem brand_id
    { count: orphanLeaders },    // marketing_leaders sem brand_id
  ] = await Promise.all([
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .or('extraction_status.is.null,extraction_status.eq.pending')
      .not('content', 'is', null).neq('content', ''),

    supabase.from('editions').select('*', { count: 'exact', head: true })
      .not('text_content', 'is', null)
      .not('signals', 'cs', '{"extracted":true}'),

    supabase.from('agency_history').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),

    supabase.from('agency_history').select('*', { count: 'exact', head: true })
      .is('brand_id', null),

    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true })
      .is('brand_id', null),
  ])

  return {
    articles_pending:    articlesPending   || 0,
    editions_pending:    editionsPending   || 0,
    agency_history:      agencyHistoryTotal || 0,
    leaders:             leadersTotal       || 0,
    orphan_history:      orphanHistory      || 0,
    orphan_leaders:      orphanLeaders      || 0,
  }
}

// ─── OBJ 3: Estado do menu Marcas ────────────────────────────────────────────

async function checkBrands() {
  const [
    { count: totalBrands },
    brandsWithHistory,
    brandsWithLeaders,
    { count: agencyValidationPending },
  ] = await Promise.all([
    supabase.from('brands').select('*', { count: 'exact', head: true }),

    supabase.from('agency_history').select('brand_id')
      .not('brand_id', 'is', null)
      .then(({ data }) => new Set((data || []).map(r => r.brand_id)).size),

    supabase.from('marketing_leaders').select('brand_id')
      .not('brand_id', 'is', null)
      .then(({ data }) => new Set((data || []).map(r => r.brand_id)).size),

    // Itens pendentes de revisão de mudança de agência
    supabase.from('validation_queue').select('*', { count: 'exact', head: true })
      .eq('type', 'agency_change').eq('status', 'pending'),
  ])

  const total = totalBrands || 0
  return {
    total_brands:               total,
    brands_with_history:        brandsWithHistory,
    brands_with_leaders:        brandsWithLeaders,
    brands_without_history:     total - brandsWithHistory,
    brands_without_leaders:     total - brandsWithLeaders,
    coverage_pct:               total > 0 ? Math.round((brandsWithHistory / total) * 100) : 0,
    agency_validation_pending:  agencyValidationPending || 0,
  }
}

// ─── OBJ 4: Estado do motor preditivo ────────────────────────────────────────

async function checkPredictiveEngine() {
  const since7d = new Date(Date.now() - 7 * 24 * 3600000).toISOString()
  const since6h = new Date(Date.now() - 6 * 3600000).toISOString()

  const [
    { count: signalEventsTotal },
    { count: signalEventsFresh },
    { count: signalEventsRecent },
    { count: predictionsTotal },
    brandsWithSignals,
  ] = await Promise.all([
    supabase.from('signal_events').select('*', { count: 'exact', head: true }),
    supabase.from('signal_events').select('*', { count: 'exact', head: true }).gte('captured_at', since6h),
    supabase.from('signal_events').select('*', { count: 'exact', head: true }).gte('captured_at', since7d),
    supabase.from('predictions').select('*', { count: 'exact', head: true }),

    supabase.from('signal_events').select('brand_id')
      .gte('captured_at', since7d)
      .not('brand_id', 'is', null)
      .then(({ data }) => new Set((data || []).map(r => r.brand_id)).size),
  ])

  return {
    signal_events_total:  signalEventsTotal  || 0,
    signal_events_fresh:  signalEventsFresh  || 0,
    signal_events_recent: signalEventsRecent || 0,
    brands_with_signals:  brandsWithSignals,
    predictions_total:    predictionsTotal   || 0,
  }
}

// ─── OBJ: Métricas de eficiência do pipeline ──────────────────────────────────

async function checkEfficiency() {
  const [
    { count: articlesWithContent },
    { count: articlesExtractedOk },
    { count: articlesCrawlFailed },
    { count: articlesTotal },
    { count: articlesExtractionError },
    { count: editionsTotal },
    { count: editionsExtracted },
  ] = await Promise.all([
    supabase.from('articles').select('*', { count: 'exact', head: true })
      .not('content', 'is', null).neq('content', ''),

    supabase.from('articles').select('*', { count: 'exact', head: true })
      .in('extraction_status', ['ok', 'skipped']),

    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('extraction_status', 'crawl_failed'),

    supabase.from('articles').select('*', { count: 'exact', head: true }),

    supabase.from('articles').select('*', { count: 'exact', head: true })
      .eq('extraction_status', 'error'),

    supabase.from('editions').select('*', { count: 'exact', head: true })
      .not('text_content', 'is', null),

    supabase.from('editions').select('*', { count: 'exact', head: true })
      .not('text_content', 'is', null)
      .filter('signals', 'cs', '{"extracted":true}'),
  ])

  const total = articlesTotal || 0
  const withContent = articlesWithContent || 0
  const crawlFailed = articlesCrawlFailed || 0
  const extractedOk = articlesExtractedOk || 0
  const extractionError = articlesExtractionError || 0
  const edTotal = editionsTotal || 0
  const edExtracted = editionsExtracted || 0

  return {
    crawl_fail_rate:      total > 0 ? Math.round((crawlFailed / total) * 1000) / 10 : 0,
    extraction_ok_rate:   withContent > 0 ? Math.round((extractedOk / withContent) * 1000) / 10 : 0,
    extraction_error_count: extractionError,
    articles_with_content:  withContent,
    articles_crawl_failed:  crawlFailed,
    editions_extracted_pct: edTotal > 0 ? Math.round((edExtracted / edTotal) * 1000) / 10 : 0,
  }
}

// ─── Estado completo ──────────────────────────────────────────────────────────

async function getPipelineState() {
  const [sources, extraction, brands, predictive, efficiency] = await Promise.all([
    checkSources(),
    checkExtraction(),
    checkBrands(),
    checkPredictiveEngine(),
    checkEfficiency(),
  ])

  return { sources, extraction, brands, predictive, efficiency }
}

// ─── Auto-remediações ─────────────────────────────────────────────────────────

async function autoRemediate(state) {
  const actions = []

  // OBJ 1: crawl_failed > 100 → reset para nova tentativa
  if (state.sources.propmark_crawl_failed > 100) {
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: null, content: null })
      .eq('source_name', 'propmark')
      .eq('extraction_status', 'crawl_failed')
      .select('id')
    const reset = data?.length || 0
    if (reset > 0) {
      actions.push(`[OBJ1] Reset ${reset} artigos crawl_failed → nova tentativa de scraping`)
      state.sources.propmark_backlog += reset
      state.sources.propmark_crawl_failed = 0
    }
  }

  // OBJ 2: artigos com status=error mas com conteúdo → reset para pending
  const { count: errorCount } = await supabase
    .from('articles').select('*', { count: 'exact', head: true })
    .eq('extraction_status', 'error').not('content', 'is', null).neq('content', '')
  if ((errorCount || 0) > 0) {
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: 'pending', extracted_at: null })
      .eq('extraction_status', 'error')
      .not('content', 'is', null).neq('content', '')
      .select('id')
    if (data?.length > 0) {
      actions.push(`[OBJ2] Reset ${data.length} artigos status=error → pending`)
      state.extraction.articles_pending += data.length
    }
  }

  // OBJ 2: relações órfãs (sem brand_id) → tenta vincular pelo nome da marca
  if (state.extraction.orphan_history > 0) {
    // Busca registros sem brand_id e tenta match pelo campo 'brand' (texto)
    const { data: orphans } = await supabase
      .from('agency_history').select('id, brand').is('brand_id', null).limit(200)
    let linked = 0
    for (const orphan of (orphans || [])) {
      if (!orphan.brand) continue
      const { data: match } = await supabase
        .from('brands').select('id').ilike('name', `%${orphan.brand}%`).limit(1)
      if (match?.[0]) {
        await supabase.from('agency_history').update({ brand_id: match[0].id }).eq('id', orphan.id)
        linked++
      }
    }
    if (linked > 0) {
      actions.push(`[OBJ2/OBJ3] Vinculados ${linked} registros agency_history órfãos a brands`)
    }
  }

  if (state.extraction.orphan_leaders > 0) {
    const { data: orphans } = await supabase
      .from('marketing_leaders').select('id, company').is('brand_id', null).limit(200)
    let linked = 0
    for (const orphan of (orphans || [])) {
      if (!orphan.company) continue
      const { data: match } = await supabase
        .from('brands').select('id').ilike('name', `%${orphan.company}%`).limit(1)
      if (match?.[0]) {
        await supabase.from('marketing_leaders').update({ brand_id: match[0].id }).eq('id', orphan.id)
        linked++
      }
    }
    if (linked > 0) {
      actions.push(`[OBJ2/OBJ3] Vinculados ${linked} marketing_leaders órfãos a brands`)
    }
  }

  // EFICIÊNCIA: erros de extração > 50 → reset para reprocessar
  if ((state.efficiency?.extraction_error_count || 0) > 50) {
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: 'pending', extracted_at: null })
      .eq('extraction_status', 'error')
      .not('content', 'is', null).neq('content', '')
      .select('id')
    if (data?.length > 0) {
      actions.push(`[EFF] Reset ${data.length} artigos error→pending (extrator com alta taxa de falha)`)
      state.extraction.articles_pending += data.length
    }
  }

  // EFICIÊNCIA: crawl_failed muito alto (> 30% do total) → reset parcial (500 mais antigos)
  if ((state.efficiency?.crawl_fail_rate || 0) > 30 && state.sources.propmark_crawl_failed > 500) {
    const { data } = await supabase
      .from('articles')
      .update({ extraction_status: null, content: null })
      .eq('source_name', 'propmark')
      .eq('extraction_status', 'crawl_failed')
      .order('created_at', { ascending: true })
      .limit(500)
      .select('id')
    if (data?.length > 0) {
      actions.push(`[EFF] Reset ${data.length} artigos crawl_failed mais antigos (taxa=${state.efficiency.crawl_fail_rate}%) → nova tentativa`)
    }
  }

  return actions
}

// ─── Gaps e alertas ───────────────────────────────────────────────────────────

function buildHealthReport(state) {
  const gaps = []
  const tasks = []

  // OBJ 1 — Fontes
  if (state.sources.propmark_backlog > 0) {
    tasks.push({ agent: 'recrawl_propmark', priority: 1,
      label: `A1 Recrawl Propmark: ${state.sources.propmark_backlog} artigos sem conteúdo` })
  }
  if (state.sources.propmark_crawl_failed > 0) {
    gaps.push(`[OBJ1] ${state.sources.propmark_crawl_failed} artigos Propmark crawl_failed (abaixo do limiar de reset)`)
  }
  if (state.sources.media_age_h > 4) {
    tasks.push({ agent: 'crawl_media', priority: 2,
      label: `A3 Mídia RSS: última atualização ${state.sources.media_age_h === Infinity ? 'nunca' : Math.round(state.sources.media_age_h) + 'h atrás'} (Exame+Valor+M&M+Adnews)` })
  }
  if (state.sources.mm_age_h === Infinity) {
    gaps.push('[OBJ1] Meio & Mensagem nunca crawlado — verificar se RSS está configurado')
  }
  if (state.sources.corporate_age_h > 12) {
    tasks.push({ agent: 'corporate_search', priority: 2,
      label: `A8 Busca Corporativa: última busca ${state.sources.corporate_age_h === Infinity ? 'nunca' : Math.round(state.sources.corporate_age_h) + 'h atrás'}` })
  }

  // OBJ 2 — Extração
  if (state.extraction.articles_pending > 0) {
    tasks.push({ agent: 'extract_articles', priority: 3,
      label: `A2a Extração: ${state.extraction.articles_pending} artigos pendentes`,
      depends_on: ['recrawl_propmark', 'crawl_media'] })
  }
  if (state.extraction.editions_pending > 0) {
    tasks.push({ agent: 'extract_editions', priority: 3,
      label: `A2b Edições M&M: ${state.extraction.editions_pending} pendentes` })
  }
  if (state.extraction.agency_history === 0) {
    gaps.push('[OBJ2] agency_history vazio — A2 ainda não gerou relações marca↔agência')
  }
  if (state.extraction.leaders === 0) {
    gaps.push('[OBJ2] marketing_leaders vazio — executivos ainda não foram extraídos')
  }
  if (state.extraction.orphan_history > 0) {
    gaps.push(`[OBJ2/OBJ3] ${state.extraction.orphan_history} relações agency_history sem brand_id`)
  }

  // OBJ 3 — Menu Marcas
  if (state.brands.coverage_pct < 50 && state.brands.total_brands > 0) {
    gaps.push(`[OBJ3] Apenas ${state.brands.coverage_pct}% das marcas (${state.brands.brands_with_history}/${state.brands.total_brands}) têm histórico de agência`)
  }
  if (state.brands.brands_without_leaders > state.brands.total_brands * 0.5) {
    gaps.push(`[OBJ3] ${state.brands.brands_without_leaders} marcas sem executivos vinculados`)
  }
  // Alerta para dados de agência possivelmente desatualizados (nenhuma validação recente)
  if (state.brands.agency_validation_pending > 10) {
    gaps.push(`[OBJ3] ${state.brands.agency_validation_pending} itens pendentes na fila de validação de agência`)
  }

  // EFICIÊNCIA — Métricas de qualidade do pipeline
  if (state.efficiency) {
    if (state.efficiency.crawl_fail_rate > 20) {
      gaps.push(`[EFF] Taxa de crawl_failed: ${state.efficiency.crawl_fail_rate}% dos artigos Propmark não conseguiram conteúdo`)
    }
    if (state.efficiency.extraction_ok_rate < 60 && state.efficiency.articles_with_content > 100) {
      gaps.push(`[EFF] Taxa de extração: apenas ${state.efficiency.extraction_ok_rate}% dos artigos com conteúdo foram extraídos com sucesso`)
    }
    if (state.efficiency.extraction_error_count > 100) {
      gaps.push(`[EFF] ${state.efficiency.extraction_error_count} artigos com status=error bloqueando extração (serão resetados na próxima remediação)`)
    }
    if (state.efficiency.editions_extracted_pct < 10 && state.extraction.editions_pending > 1000) {
      gaps.push(`[EFF] Edições M&M: apenas ${state.efficiency.editions_extracted_pct}% extraídas — pipeline de edições pode estar travado`)
    }
  }

  // OBJ 4 — Motor preditivo
  const needsSignals = state.predictive.signal_events_fresh === 0 ||
    state.extraction.articles_pending > 0 ||
    state.extraction.editions_pending > 0
  if (needsSignals) {
    tasks.push({ agent: 'capture_signals', priority: 4,
      label: `A6 Sinais: ${state.predictive.signal_events_fresh} eventos nas últimas 6h`,
      depends_on: ['extract_articles', 'extract_editions'] })
  }
  if (state.predictive.signal_events_total === 0) {
    gaps.push('[OBJ4] signal_events vazio — motor preditivo sem dados')
  }
  if (state.predictive.brands_with_signals === 0 && state.brands.total_brands > 0) {
    gaps.push('[OBJ4] Nenhuma marca com sinais — predições não podem ser geradas')
  }
  if (state.predictive.signal_events_recent === 0 && state.predictive.signal_events_total > 0) {
    gaps.push('[OBJ4] Nenhum sinal novo nos últimos 7 dias — motor preditivo desatualizado')
  }

  return { tasks: tasks.sort((a, b) => a.priority - b.priority), gaps }
}

// ─── Executa passo do pipeline ────────────────────────────────────────────────

async function runPipelineStep(agent, opts = {}) {
  const { runExtraction, runEditionExtraction } = require('./articleExtractor')
  const { runMediaSearch }   = require('./mediaSearchAgent')
  const { runSignalCapture } = require('./signalCaptureAgent')

  switch (agent) {
    case 'recrawl_propmark': {
      const { scrapeArticlePage } = require('../crawlers/propmark')
      const { data: articles } = await supabase
        .from('articles').select('id, url')
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
          } catch { errors++ }
        }))
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

    case 'corporate_search': {
      const { runCorporateSearch } = require('./corporateSearchAgent')
      return await runCorporateSearch({ limitBrands: 40, limitAgencies: 20, limitLeaders: 20 })
    }

    default:
      throw new Error(`Agente desconhecido: ${agent}`)
  }
}

// ─── Orquestrador principal ───────────────────────────────────────────────────

async function runOrchestrator({ dry_run = false, full = false, onProgress } = {}) {
  console.log('[orchestrator] ▶ Verificando pipeline (4 objetivos)...')
  onProgress?.('checking', {})

  // 1. Estado completo (4 objetivos)
  const state = await getPipelineState()
  console.log(`[orchestrator] OBJ1 fontes: backlog=${state.sources.propmark_backlog} failed=${state.sources.propmark_crawl_failed} media_age=${state.sources.media_age_h}h`)
  console.log(`[orchestrator] OBJ2 extração: pending=${state.extraction.articles_pending} edicoes=${state.extraction.editions_pending} history=${state.extraction.agency_history} leaders=${state.extraction.leaders} orfaos=${state.extraction.orphan_history}`)
  console.log(`[orchestrator] OBJ3 marcas: ${state.brands.brands_with_history}/${state.brands.total_brands} com histórico (${state.brands.coverage_pct}%)`)
  console.log(`[orchestrator] OBJ4 preditivo: sinais_6h=${state.predictive.signal_events_fresh} sinais_7d=${state.predictive.signal_events_recent} marcas_com_sinais=${state.predictive.brands_with_signals}`)
  if (state.efficiency) {
    console.log(`[orchestrator] EFF crawl_fail=${state.efficiency.crawl_fail_rate}% extraction_ok=${state.efficiency.extraction_ok_rate}% errors=${state.efficiency.extraction_error_count} editions_pct=${state.efficiency.editions_extracted_pct}%`)
  }

  // 2. Auto-remediações
  const remediated = dry_run ? [] : await autoRemediate(state)
  if (remediated.length) remediated.forEach(a => console.log(`[orchestrator] ⚕ ${a}`))

  // 3. Plano de execução
  const { tasks, gaps } = buildHealthReport(state)
  if (gaps.length) gaps.forEach(g => console.log(`[orchestrator] ⚠ ${g}`))

  if (full) {
    for (const agent of ['crawl_media', 'extract_articles', 'extract_editions', 'capture_signals']) {
      if (!tasks.find(t => t.agent === agent))
        tasks.push({ agent, label: `${agent} (forçado)`, priority: 5 })
    }
  }

  const report = {
    checked_at:  new Date().toISOString(),
    state,
    gaps,
    remediated,
    plan:        tasks.map(t => t.label),
    executed:    [],
    results:     {},
    errors:      [],
    dry_run,
    health: {
      obj1_sources:    state.sources.propmark_backlog === 0 && state.sources.media_age_h < 4,
      obj2_extraction: state.extraction.articles_pending === 0 && state.extraction.editions_pending === 0,
      obj3_brands:     state.brands.coverage_pct >= 50,
      obj4_predictive: state.predictive.signal_events_fresh > 0,
      efficiency_ok:   (state.efficiency?.crawl_fail_rate || 0) < 20 && (state.efficiency?.extraction_ok_rate || 100) >= 60,
    },
  }

  if (dry_run) { console.log('[orchestrator] DRY RUN'); return report }
  if (tasks.length === 0) { console.log('[orchestrator] ✅ Todos os 4 objetivos em dia'); return report }

  // 4. Executa respeitando dependências
  const done = new Set()
  for (const task of tasks) {
    const deps   = task.depends_on || []
    const depsOk = deps.every(d => done.has(d) || !tasks.find(t => t.agent === d))
    if (!depsOk) {
      console.log(`[orchestrator] ⏭ ${task.agent} aguardando: ${deps.filter(d => !done.has(d)).join(', ')}`)
      continue
    }
    console.log(`[orchestrator] ▶ ${task.label}`)
    onProgress?.('running', { agent: task.agent, label: task.label })
    try {
      const result = await runPipelineStep(task.agent, { batch: 100, limit: 500,
        onProgress: (p, t) => onProgress?.('step_progress', { agent: task.agent, progress: p, total: t }) })
      report.executed.push(task.agent)
      report.results[task.agent] = result
      done.add(task.agent)

      // Verificação de resultado: detecta se o agente não fez progresso (possível ineficiência)
      const noProgress = (
        (task.agent === 'recrawl_propmark' && result?.ok === 0 && (result?.total || 0) > 0) ||
        (task.agent === 'extract_articles'  && result?.processed === 0 && (result?.skipped || 0) === 0) ||
        (task.agent === 'capture_signals'   && result?.events_saved === 0) ||
        (task.agent === 'crawl_media'       && result?.articles_saved === 0)
      )
      if (noProgress) {
        console.warn(`[orchestrator] ⚠ ${task.agent}: nenhum progresso detectado — possível problema no agente`)
        report.errors.push({ agent: task.agent, error: 'Sem progresso — agente pode estar com problemas' })
      } else {
        console.log(`[orchestrator] ✓ ${task.agent}:`, JSON.stringify(result))
      }
    } catch (e) {
      report.errors.push({ agent: task.agent, error: e.message })
      console.error(`[orchestrator] ✗ ${task.agent}: ${e.message}`)
    }
  }

  // 5. Estado final
  const stateAfter = await getPipelineState()
  report.state_after = stateAfter
  report.remaining_items = stateAfter.sources.propmark_backlog +
    stateAfter.extraction.articles_pending + stateAfter.extraction.editions_pending
  report.pipeline_complete = report.remaining_items === 0
  report.health_after = {
    obj1_sources:    stateAfter.sources.propmark_backlog === 0 && stateAfter.sources.media_age_h < 4,
    obj2_extraction: stateAfter.extraction.articles_pending === 0,
    obj3_brands:     stateAfter.brands.coverage_pct >= 50,
    obj4_predictive: stateAfter.predictive.signal_events_fresh > 0,
    efficiency_ok:   (stateAfter.efficiency?.crawl_fail_rate || 0) < 20 && (stateAfter.efficiency?.extraction_ok_rate || 100) >= 60,
  }

  console.log(`[orchestrator] ■ Fim. Restantes: ${report.remaining_items} | OBJ1:${report.health_after.obj1_sources} OBJ2:${report.health_after.obj2_extraction} OBJ3:${report.health_after.obj3_brands} OBJ4:${report.health_after.obj4_predictive}`)
  return report
}

module.exports = { runOrchestrator, getPipelineState, buildHealthReport }
