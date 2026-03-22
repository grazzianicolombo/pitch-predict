const express = require('express')
const router  = express.Router()
const supabase = require('../lib/supabase')
const { validateAgencies, saveSuggestions, applySuggestion, rejectSuggestion } = require('../agents/agencyValidator')
const { runArchiveExtraction } = require('../agents/archiveExtractor')
const { runExtraction, runEditionExtraction } = require('../agents/articleExtractor')

// ─── Job store persistente ─────────────────────────────────────────────────
// Jobs salvos em data/jobs.json — sobrevivem a reinicializações do servidor
const { jobs, persist } = require('../lib/jobStore')

function newJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ─── POST /api/agent/validate-agencies ─────────────────────────────────────
// Inicia o agente em background e retorna job_id imediatamente
router.post('/validate-agencies', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada no .env do backend' })
  }

  // Verifica se já há um job rodando
  const running = Object.values(jobs).find(j => j.status === 'running')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Agente já em execução' })
  }

  const jobId = newJobId()
  jobs[jobId] = { id: jobId, status: 'running', progress: 0, total: 0, result: null, error: null, startedAt: new Date() }

  // Executa em background (não bloqueia a resposta HTTP)
  ;(async () => {
    try {
      const { agencies, suggestions, confirmed_active, summary } =
        await validateAgencies((progress, total) => {
          jobs[jobId].progress = progress
          jobs[jobId].total    = total
        })

      const saved = await saveSuggestions(suggestions)

      jobs[jobId].status = 'done'
      jobs[jobId].result = {
        agencies_analyzed: agencies.length,
        confirmed_active,
        suggestions_found: suggestions.length,
        suggestions_saved: saved,
        news_backed: suggestions.filter(s => s.news_found).length,
        summary,
      }
    } catch (err) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = err.message
      console.error('[Agente] Erro:', err.message)
    }
  })()

  res.json({ job_id: jobId, status: 'running' })
})

// ─── GET /api/agent/jobs/:id ────────────────────────────────────────────────
// Polling de status do job
router.get('/jobs/:id', (req, res) => {
  const job = jobs[req.params.id]
  if (!job) return res.status(404).json({ error: 'Job não encontrado' })
  res.json({
    job_id:       job.id,
    status:       job.status,
    progress:     job.progress,
    total:        job.total,
    batches_done: job.batches_done,
    result:       job.result,
    error:        job.error,
  })
})

// ─── GET /api/agent/active-jobs ─────────────────────────────────────────────
// Retorna todos os jobs ativos (running) — usado pelo Status page para polling
router.get('/active-jobs', (req, res) => {
  const active = Object.values(jobs)
    .filter(j => j.status === 'running')
    .map(j => ({
      job_id:       j.id,
      type:         j.type,
      label:        j.label,
      status:       j.status,
      progress:     j.progress || 0,
      total:        j.total    || 0,
      batches_done: j.batches_done || 0,
      started_at:   j.startedAt,
    }))
  res.json(active)
})

// ─── GET /api/agent/queue ───────────────────────────────────────────────────
router.get('/queue', async (req, res) => {
  const { data, error } = await supabase
    .from('validation_queue')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── POST /api/agent/queue/:id/approve ─────────────────────────────────────
router.post('/queue/:id/approve', async (req, res) => {
  try {
    await applySuggestion(req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/agent/queue/:id/reject ──────────────────────────────────────
router.post('/queue/:id/reject', async (req, res) => {
  try {
    await rejectSuggestion(req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/agent/extract-archive ────────────────────────────────────────
// Roda extrator de sinais do arquivo M&M (jobs assíncronos)
router.post('/extract-archive', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'archive')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Extração já em andamento' })
  }

  const { yearFrom = 2015, yearTo = 2017, limit = 50 } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'archive', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(),
    label: `Arquivo ${yearFrom}–${yearTo}`,
  }

  setImmediate(async () => {
    try {
      const result = await runArchiveExtraction(
        { yearFrom, yearTo, limit },
        (done, total, edTitle) => {
          jobs[jobId].progress = done
          jobs[jobId].total    = total
          jobs[jobId].current  = edTitle
        }
      )
      jobs[jobId].status = 'done'
      jobs[jobId].result = result
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── GET /api/agent/archive/stats ───────────────────────────────────────────
router.get('/archive/stats', async (req, res) => {
  const path = require('path')
  const fs   = require('fs')
  const archiveDir = path.join(__dirname, '../../../data/archive')
  const catalogPath = path.join(archiveDir, 'catalog.json')

  if (!fs.existsSync(catalogPath)) {
    return res.json({ catalog: false })
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

  // Conta text.txt por ano
  const { execSync } = require('child_process')
  let extracted = 0
  try {
    extracted = parseInt(execSync(`find ${archiveDir} -name text.txt | wc -l`).toString().trim())
  } catch (e) {}

  // Distribuição por ano
  const byYear = {}
  for (const ed of catalog) {
    const yr = (ed.date || ed.uid || '').slice(0, 4)
    if (!byYear[yr]) byYear[yr] = { total: 0, drm: yr >= '2018' }
    byYear[yr].total++
  }

  res.json({
    catalog: true,
    total_editions: catalog.length,
    extracted_text: extracted,
    open_editions: catalog.filter(e => parseInt((e.date || e.uid || '').slice(0, 4)) < 2018).length,
    drm_editions:  catalog.filter(e => parseInt((e.date || e.uid || '').slice(0, 4)) >= 2018).length,
    by_year: byYear,
  })
})

// ─── POST /api/agent/recrawl-articles ────────────────────────────────────────
// Re-scrapa artigos que estão sem conteúdo (content vazio)
router.post('/recrawl-articles', (req, res) => {
  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'recrawl')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Recrawl já em andamento' })
  }

  const { limit = 200 } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'recrawl', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(), label: 'Recrawl artigos sem conteúdo',
  }

  setImmediate(async () => {
    try {
      const { scrapeArticlePage } = require('../crawlers/propmark')
      const supabase = require('../lib/supabase')

      // Busca artigos sem conteúdo
      const { data: articles } = await supabase
        .from('articles')
        .select('id, url, source_name')
        .or('content.is.null,content.eq.')
        .eq('source_name', 'propmark')
        .limit(limit)

      jobs[jobId].total = articles?.length || 0
      let ok = 0, errors = 0

      for (const art of (articles || [])) {
        try {
          const scraped = await scrapeArticlePage(art.url)
          if (scraped.content && scraped.content.length > 50) {
            await supabase.from('articles').update({
              content:      scraped.content,
              excerpt:      scraped.excerpt || null,
              author:       scraped.author  || null,
              published_at: scraped.published_at || null,
              tags:         scraped.tags || [],
              extraction_status: 'pending',
              extracted_at: null,
            }).eq('id', art.id)
            ok++
          }
        } catch (e) {
          errors++
        }
        jobs[jobId].progress = ok + errors
        // Rate limit: 1 req/s
        await new Promise(r => setTimeout(r, 1000))
      }

      jobs[jobId].status = 'done'
      jobs[jobId].result = { total: articles?.length || 0, ok, errors }
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── POST /api/agent/extract-articles ───────────────────────────────────────
// Roda extrator de marcas/agências/executivos sobre artigos já capturados
router.post('/extract-articles', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'extract_articles')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Extração já em andamento' })
  }

  const { limit = 200, source_name, since } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'extract_articles', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(),
    label: `Extração artigos${source_name ? ` (${source_name})` : ''}`,
  }

  setImmediate(async () => {
    try {
      const result = await runExtraction({ limit, source_name, since })
      jobs[jobId].status = 'done'
      jobs[jobId].result = result
      jobs[jobId].progress = result.processed
      jobs[jobId].total = result.processed + result.skipped + result.errors
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── GET /api/agent/extract-articles/stats ──────────────────────────────────
router.get('/extract-articles/stats', async (req, res) => {
  // Count per (source_name, extraction_status) using individual count queries
  // Avoids Supabase's 1000-row default limit on select queries
  const sources = ['propmark', 'mm_website']
  const statuses = ['ok', 'skipped', 'error', 'crawl_failed']

  const by_source = {}

  for (const src of sources) {
    const counts = { pending: 0, ok: 0, skipped: 0, error: 0, crawl_failed: 0, total: 0 }

    // Total
    const { count: total } = await supabase
      .from('articles').select('*', { count: 'exact', head: true }).eq('source_name', src)
    counts.total = total || 0

    // Each explicit status
    for (const st of statuses) {
      const { count } = await supabase
        .from('articles').select('*', { count: 'exact', head: true })
        .eq('source_name', src).eq('extraction_status', st)
      counts[st] = count || 0
    }

    // Pending = NULL or 'pending' status
    const { count: pendingNull } = await supabase
      .from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', src).is('extraction_status', null)
    const { count: pendingExp } = await supabase
      .from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', src).eq('extraction_status', 'pending')
    counts.pending = (pendingNull || 0) + (pendingExp || 0)

    // Sem content = precisa de recrawl (exclui crawl_failed — irrecuperáveis)
    const { count: noContent } = await supabase
      .from('articles').select('*', { count: 'exact', head: true })
      .eq('source_name', src)
      .or('content.is.null,content.eq.')
      .not('extraction_status', 'eq', 'crawl_failed')
    counts.no_content = noContent || 0

    if (counts.total > 0) by_source[src] = counts
  }

  const totals = { pending: 0, ok: 0, skipped: 0, error: 0, crawl_failed: 0, total: 0 }
  for (const s of Object.values(by_source)) {
    totals.pending      += s.pending      || 0
    totals.ok           += s.ok           || 0
    totals.skipped      += s.skipped      || 0
    totals.error        += s.error        || 0
    totals.crawl_failed += s.crawl_failed || 0
    totals.total        += s.total        || 0
  }

  res.json({ by_source, totals })
})

// ─── GET /api/agent/intelligence-stats ──────────────────────────────────────
// Totais do que foi extraído e quantos geraram matches (agency_history, marketing_leaders)
router.get('/intelligence-stats', async (req, res) => {
  const [
    { count: articlesOk },
    { count: articlesSkipped },
    { count: editionsExtracted },
    { count: editionsEmpty },
    { count: agencyHistory },
    { count: marketingLeaders },
  ] = await Promise.all([
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('extraction_status', 'ok'),
    supabase.from('articles').select('*', { count: 'exact', head: true }).eq('extraction_status', 'skipped'),
    supabase.from('editions').select('*', { count: 'exact', head: true }).filter('signals', 'cs', '{"extracted":true}').not('signals', 'cs', '{"empty":true}'),
    supabase.from('editions').select('*', { count: 'exact', head: true }).filter('signals', 'cs', '{"empty":true}'),
    supabase.from('agency_history').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),
  ])

  const totalExtracted = (articlesOk || 0) + (articlesSkipped || 0) + (editionsExtracted || 0) + (editionsEmpty || 0)
  const totalWithMatch = (articlesOk || 0) + (editionsExtracted || 0)

  res.json({
    articles_ok:        articlesOk      || 0,
    articles_skipped:   articlesSkipped || 0,
    editions_extracted: editionsExtracted || 0,
    editions_empty:     editionsEmpty   || 0,
    total_extracted:    totalExtracted,
    total_with_match:   totalWithMatch,
    agency_history:     agencyHistory   || 0,
    marketing_leaders:  marketingLeaders || 0,
  })
})

// ─── GET /api/agent/extract-editions/stats ──────────────────────────────────
router.get('/extract-editions/stats', async (req, res) => {
  const [{ count: total }, { count: pending }] = await Promise.all([
    supabase.from('editions').select('*', { count: 'exact', head: true }),
    supabase.from('editions').select('*', { count: 'exact', head: true })
      .not('signals', 'cs', '{"extracted":true}'),
  ])
  const t = total || 0
  const p = pending || 0
  res.json({ total: t, pending: p, extracted: t - p })
})

// ─── POST /api/agent/extract-editions ───────────────────────────────────────
// Extrai marcas/agências/executivos das edições M&M Website (tabela editions)
router.post('/extract-editions', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'extract_editions')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Extração já em andamento' })
  }

  const { limit = 500, since } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'extract_editions', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(), label: 'Extração edições M&M Website',
  }

  setImmediate(async () => {
    try {
      const result = await runEditionExtraction({ limit, since })
      jobs[jobId].status = 'done'
      jobs[jobId].result = result
      jobs[jobId].progress = result.processed + result.skipped + result.errors
      jobs[jobId].total    = result.processed + result.skipped + result.errors
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── POST /api/agent/crawl-propmark ─────────────────────────────────────────
// Crawl histórico do sitemap com janela configurável (padrão: 2 anos)
router.post('/crawl-propmark', (req, res) => {
  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'crawl_propmark')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Crawl já em andamento' })
  }

  const { yearsSince = 2, limit = 20000 } = req.body
  const since = new Date()
  since.setFullYear(since.getFullYear() - yearsSince)
  const sinceStr = since.toISOString().slice(0, 10)

  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'crawl_propmark', status: 'running',
    progress: 0, total: 0, inserted: 0, errors: 0,
    result: null, error: null, startedAt: new Date(),
    label: `Propmark — últimos ${yearsSince} ano(s) (desde ${sinceStr})`,
  }

  setImmediate(async () => {
    try {
      const { crawlSitemap } = require('../crawlers/propmark')
      const result = await crawlSitemap({
        since: sinceStr,
        limit,
        onProgress: (done, total, inserted = 0, errors = 0) => {
          jobs[jobId].progress = done
          jobs[jobId].total    = total
          jobs[jobId].inserted = inserted
          jobs[jobId].errors   = errors
        },
      })
      jobs[jobId].status   = 'done'
      jobs[jobId].result   = result
      jobs[jobId].progress = result.total
      jobs[jobId].total    = result.total
      jobs[jobId].inserted = result.inserted
      jobs[jobId].errors   = result.errors
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
      console.error('[crawl-propmark] Erro:', e.message)
    }
  })

  res.json({ job_id: jobId, status: 'running', since: sinceStr })
})

// ─── POST /api/agent/extract-editions-all ───────────────────────────────────
// Loop que extrai TODAS as edições M&M Website pendentes em batches de 500
// Roda até zerar — pode levar horas (36K edições × Claude Haiku)
router.post('/extract-editions-all', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'extract_editions_all')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Loop já em andamento' })
  }

  const { batch = 1200, maxBatches = 999, since_year = 2022 } = req.body
  const sinceDate = `${since_year}-01-01`
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'extract_editions_all', status: 'running',
    progress: 0, total: 0, batches_done: 0,
    result: null, error: null, startedAt: new Date(),
    label: `Extração edições M&M Website ${since_year}+ (loop)`,
    since_year,
    params: { batch, since_year },
  }

  setImmediate(async () => {
    const totals = { processed: 0, skipped: 0, errors: 0, agency_relations: 0, executives: 0, pitches: 0 }
    try {
      for (let b = 0; b < maxBatches; b++) {
        // Conta pendentes antes de cada batch (filtrado por since_year)
        let countQuery = supabase
          .from('editions')
          .select('id', { count: 'exact', head: true })
          .not('text_content', 'is', null)
          .not('signals', 'cs', '{"extracted":true}')
          .gte('date', sinceDate)

        const { count } = await countQuery

        jobs[jobId].total = (count || 0) + totals.processed + totals.skipped + totals.errors

        if (!count || count === 0) break   // Zerou!

        const batchOffset = totals.processed + totals.skipped + totals.errors
        const result = await runEditionExtraction({
          limit: batch,
          since: sinceDate,
          onProgress: ({ processed }) => {
            jobs[jobId].progress = batchOffset + processed
          },
        })
        totals.processed       += result.processed
        totals.skipped         += result.skipped
        totals.errors          += result.errors
        totals.agency_relations += result.agency_relations
        totals.executives      += result.executives
        totals.pitches         += result.pitches

        jobs[jobId].batches_done = b + 1
        jobs[jobId].progress     = totals.processed + totals.skipped + totals.errors

        console.log(`[extract-editions-all] Batch ${b+1}: +${result.processed} processados, ${count} restantes`)

        // Se o batch não processou nada novo (loop infinito?), para
        if (result.processed + result.skipped + result.errors === 0) break
      }

      jobs[jobId].status = 'done'
      jobs[jobId].result = totals
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running', batch })
})

// ─── POST /api/agent/recrawl-articles-all ────────────────────────────────────
// Loop que re-scrapa TODOS os artigos propmark sem content, em batches de 200
router.post('/recrawl-articles-all', (req, res) => {
  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'recrawl_all')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Recrawl já em andamento' })
  }

  const { batch = 200 } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'recrawl_all', status: 'running',
    progress: 0, total: 0, batches_done: 0,
    result: null, error: null, startedAt: new Date(),
    label: 'Recrawl completo artigos Propmark sem conteúdo',
  }

  setImmediate(async () => {
    const { scrapeArticlePage } = require('../crawlers/propmark')
    const totals = { ok: 0, errors: 0 }

    try {
      while (true) {
        const { data: articles } = await supabase
          .from('articles')
          .select('id, url')
          .or('content.is.null,content.eq.')
          .not('extraction_status', 'eq', 'crawl_failed')   // evita retentar artigos irrecuperáveis
          .eq('source_name', 'propmark')
          .limit(batch)

        if (!articles?.length) break

        jobs[jobId].total = totals.ok + totals.errors + articles.length

        for (const art of articles) {
          try {
            const scraped = await scrapeArticlePage(art.url)
            if (scraped.content && scraped.content.length > 50) {
              await supabase.from('articles').update({
                content:      scraped.content,
                excerpt:      scraped.excerpt || null,
                author:       scraped.author  || null,
                published_at: scraped.published_at || null,
                tags:         scraped.tags || [],
                extraction_status: 'pending',
                extracted_at: null,
              }).eq('id', art.id)
              totals.ok++
            } else {
              // Sem conteúdo útil: marca como irrecuperável para não entrar em loop
              await supabase.from('articles').update({
                extraction_status: 'crawl_failed',
                content: '',    // garante que não seja null — sai da query
              }).eq('id', art.id)
              totals.errors++
            }
          } catch (e) {
            // Erro de rede/HTTP: marca como falha definitiva após 1 tentativa
            await supabase.from('articles').update({
              extraction_status: 'crawl_failed',
              content: '',
            }).eq('id', art.id)
            totals.errors++
            console.error(`[recrawl-all] Erro em ${art.url}: ${e.message}`)
          }
          jobs[jobId].progress = totals.ok + totals.errors
          await new Promise(r => setTimeout(r, 1000))
        }

        jobs[jobId].batches_done++
        console.log(`[recrawl-all] Batch ${jobs[jobId].batches_done}: ${totals.ok} ok, ${totals.errors} erros`)
      }

      // Após recrawl completo, dispara extração automática
      setImmediate(async () => {
        try {
          const { runExtraction } = require('../agents/articleExtractor')
          await runExtraction({ source_name: 'propmark', limit: 500 })
        } catch (e) { console.error('[recrawl-all] Erro na extração pós-recrawl:', e.message) }
      })

      jobs[jobId].status = 'done'
      jobs[jobId].result = totals
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
    }
  })

  res.json({ job_id: jobId, status: 'running', batch })
})

// ─── POST /api/agent/crawl-media ─────────────────────────────────────────────
// Agente 4: crawla Exame + Valor (e futuras fontes), filtra por marcas/agências
router.post('/crawl-media', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'crawl_media')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Já em andamento' })
  }

  const { sources, extract = true } = req.body   // sources: ['exame','valor'] ou null (todas)
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'crawl_media', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(), label: `Mídia: ${(sources || ['exame','valor']).join(', ')}`,
    phase: 'iniciando',
  }

  setImmediate(async () => {
    try {
      const { runMediaSearch } = require('../agents/mediaSearchAgent')
      const result = await runMediaSearch({
        sources,
        extract,
        onProgress: (phase, details) => {
          jobs[jobId].phase = phase
          if (details.count) {
            jobs[jobId].progress = details.count
            jobs[jobId].total    = details.count
          }
        },
      })
      jobs[jobId].status   = 'done'
      jobs[jobId].result   = result
      jobs[jobId].progress = result.articles_saved
      jobs[jobId].total    = result.articles_relevant
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
      console.error('[crawl-media] Erro:', e.message)
    }
  })

  res.json({ job_id: jobId, status: 'running', sources: sources || ['exame','valor'] })
})

// ─── GET /api/agent/crawl-media/stats ────────────────────────────────────────
router.get('/crawl-media/stats', async (req, res) => {
  const sources = ['exame', 'valor']
  const by_source = {}

  for (const src of sources) {
    const [{ count: total }, { count: ok }, { count: pending }, { count: no_content }] = await Promise.all([
      supabase.from('articles').select('*', { count: 'exact', head: true }).eq('source_name', src),
      supabase.from('articles').select('*', { count: 'exact', head: true }).eq('source_name', src).eq('extraction_status', 'ok'),
      supabase.from('articles').select('*', { count: 'exact', head: true }).eq('source_name', src).is('extraction_status', null),
      supabase.from('articles').select('*', { count: 'exact', head: true }).eq('source_name', src).or('content.is.null,content.eq.'),
    ])
    by_source[src] = {
      total:      total      || 0,
      ok:         ok         || 0,
      pending:    pending    || 0,
      no_content: no_content || 0,
    }
  }

  res.json(by_source)
})

// ─── POST /api/agent/enrich-executives ───────────────────────────────────────
// Agente 4: busca executivos no PeopleDataLabs e preenche marketing_leaders
router.post('/enrich-executives', (req, res) => {
  if (!process.env.PDL_API_KEY) {
    return res.status(503).json({ error: 'PDL_API_KEY não configurada no .env' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'enrich_executives')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Já em andamento' })
  }

  const { limit = 50, brand_ids } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'enrich_executives', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(), label: 'Enriquecimento de executivos (PDL)',
  }

  setImmediate(async () => {
    try {
      const { runExecutiveEnrichment } = require('../agents/executivesAgent')
      const result = await runExecutiveEnrichment({
        limit, brand_ids,
        onProgress: (phase, details) => {
          if (details.progress !== undefined) jobs[jobId].progress = details.progress
          if (details.total   !== undefined) jobs[jobId].total     = details.total
        },
      })
      jobs[jobId].status   = 'done'
      jobs[jobId].result   = result
      jobs[jobId].progress = result.processed
      jobs[jobId].total    = result.total
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
      console.error('[enrich-executives] Erro:', e.message)
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── GET /api/agent/enrich-executives/stats ───────────────────────────────────
router.get('/enrich-executives/stats', async (req, res) => {
  const [{ count: total }, { count: current }, { count: pdl }] = await Promise.all([
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }).eq('is_current', true),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }).eq('source', 'pdl'),
  ])
  res.json({ total: total || 0, current: current || 0, pdl: pdl || 0 })
})

// ─── GET /api/agent/signal-audit ─────────────────────────────────────────────
// Agente 5: audita cobertura de dados por sinal (síncrono — leve, usa Claude Haiku)
router.get('/signal-audit', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }
  try {
    const { runSignalAudit } = require('../agents/signalAuditor')
    const result = await runSignalAudit()
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/agent/capture-signals ─────────────────────────────────────────
// Agente 6: varre dados e preenche signal_events por marca
router.post('/capture-signals', (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'capture_signals')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Já em andamento' })
  }

  const { limit = 50, brand_ids, since } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'capture_signals', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(), label: 'Captura de sinais',
  }

  setImmediate(async () => {
    try {
      const { runSignalCapture } = require('../agents/signalCaptureAgent')
      const result = await runSignalCapture({
        limit, brand_ids, since,
        onProgress: (phase, details) => {
          if (details.progress !== undefined) jobs[jobId].progress = details.progress
          if (details.total   !== undefined) jobs[jobId].total     = details.total
        },
      })
      jobs[jobId].status   = 'done'
      jobs[jobId].result   = result
      jobs[jobId].progress = result.processed
      jobs[jobId].total    = result.total
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
      console.error('[capture-signals] Erro:', e.message)
    }
  })

  res.json({ job_id: jobId, status: 'running' })
})

// ─── GET /api/agent/capture-signals/stats ────────────────────────────────────
router.get('/capture-signals/stats', async (req, res) => {
  const [{ count: total }, { count: active }, { count: brands_with_signals }] = await Promise.all([
    supabase.from('signal_events').select('*', { count: 'exact', head: true }),
    supabase.from('signal_events').select('*', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString()),
    supabase.from('signal_events').select('brand_id', { count: 'exact', head: true }),
  ])

  // Top sinais mais capturados
  const { data: topSignals } = await supabase
    .from('signal_events')
    .select('signal_key, signal_name')
    .gt('expires_at', new Date().toISOString())
    .limit(1000)

  const signalCounts = {}
  for (const ev of (topSignals || [])) {
    const key = `${ev.signal_key}||${ev.signal_name}`
    signalCounts[key] = (signalCounts[key] || 0) + 1
  }
  const top = Object.entries(signalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, count]) => {
      const [signal_key, signal_name] = k.split('||')
      return { signal_key, signal_name, count }
    })

  res.json({
    total:               total  || 0,
    active:              active || 0,
    top_signals:         top,
  })
})

// ─── GET /api/agent/orchestrator/status ──────────────────────────────────────
// Retorna o estado atual do pipeline sem executar nada (dry_run)
router.get('/orchestrator/status', async (req, res) => {
  try {
    const { getPipelineState, buildRunPlan } = require('../agents/orchestrator')
    const state = await getPipelineState()
    const { tasks, gaps } = buildRunPlan(state)
    res.json({
      state,
      gaps,
      plan: tasks.map(t => ({ agent: t.agent, label: t.label, priority: t.priority })),
      pipeline_healthy: gaps.length === 0 && tasks.length === 0,
      checked_at: new Date().toISOString(),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── POST /api/agent/orchestrator/run ────────────────────────────────────────
// Executa o pipeline completo de forma controlada e sequencial
router.post('/orchestrator/run', (req, res) => {
  const running = Object.values(jobs).find(j => j.status === 'running' && j.type === 'orchestrator')
  if (running) {
    return res.json({ job_id: running.id, status: 'running', message: 'Orquestrador já em execução' })
  }

  const { full = false, dry_run = false } = req.body
  const jobId = newJobId()
  jobs[jobId] = {
    id: jobId, type: 'orchestrator', status: 'running',
    progress: 0, total: 0, result: null, error: null,
    startedAt: new Date(),
    label: dry_run ? 'Orquestrador (dry run)' : 'Orquestrador — pipeline completo',
    phase: 'checking',
  }

  setImmediate(async () => {
    try {
      const { runOrchestrator } = require('../agents/orchestrator')
      const result = await runOrchestrator({
        dry_run,
        full,
        onProgress: (phase, details) => {
          jobs[jobId].phase = phase
          if (details.progress !== undefined) jobs[jobId].progress = details.progress
          if (details.total   !== undefined) jobs[jobId].total     = details.total
        },
      })
      jobs[jobId].status = 'done'
      jobs[jobId].result = result
    } catch (e) {
      jobs[jobId].status = 'error'
      jobs[jobId].error  = e.message
      console.error('[orchestrator] Erro:', e.message)
    }
  })

  res.json({ job_id: jobId, status: 'running', dry_run, full })
})

// ─── DELETE /api/agent/queue ────────────────────────────────────────────────
router.delete('/queue', async (req, res) => {
  const { error } = await supabase
    .from('validation_queue')
    .delete()
    .in('status', ['aprovado', 'rejeitado'])
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
