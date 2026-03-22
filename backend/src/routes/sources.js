const express  = require('express')
const router   = express.Router()
const supabase = require('../lib/supabase')
const multer   = require('multer')
const path     = require('path')
const fs       = require('fs')

// ─── Multer: upload de PDF para /uploads/scopen/ ────────────────────────────
const uploadDir = path.join(__dirname, '../../../uploads/scopen')
fs.mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },   // 50 MB
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf'))
  },
})

// ─── GET /api/sources/jobs ──────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  const { data, error } = await supabase
    .from('source_jobs')
    .select('*')
    .order('source_name')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── PUT /api/sources/jobs/:sourceId ───────────────────────────────────────
// Atualiza frequência e habilitação de um job
router.put('/jobs/:sourceId', async (req, res) => {
  const { frequency, enabled, config } = req.body
  const updates = { updated_at: new Date().toISOString() }
  if (frequency !== undefined) updates.frequency = frequency
  if (enabled  !== undefined) updates.enabled   = enabled
  if (config   !== undefined) updates.config    = config

  // Calcula próximo run quando habilitado
  if (enabled && frequency && frequency !== 'manual') {
    updates.next_run_at = calcNextRun(frequency)
  } else if (!enabled) {
    updates.next_run_at = null
  }

  const { data, error } = await supabase
    .from('source_jobs')
    .update(updates)
    .eq('source_id', req.params.sourceId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── POST /api/sources/jobs/:sourceId/run ───────────────────────────────────
// Dispara execução manual
router.post('/jobs/:sourceId/run', async (req, res) => {
  const { sourceId } = req.params

  // Marca como rodando
  await supabase
    .from('source_jobs')
    .update({ last_run_status: 'running', last_run_at: new Date().toISOString() })
    .eq('source_id', sourceId)

  // Executa em background
  setImmediate(async () => {
    const startedAt = Date.now()
    try {
      const count = await runSource(sourceId)
      const duration = Date.now() - startedAt
      await supabase.from('source_jobs').update({
        last_run_status: 'ok',
        last_run_count:  count,
        last_run_at:     new Date().toISOString(),
        next_run_at:     null,
      }).eq('source_id', sourceId)
      // Grava log
      await supabase.from('source_logs').insert({
        source_id:    sourceId,
        status:       'ok',
        records_added: count,
        duration_ms:  duration,
      })
    } catch (e) {
      const duration = Date.now() - startedAt
      console.error(`[source job ${sourceId}] erro:`, e.message)
      try {
        await supabase.from('source_jobs').update({
          last_run_status: 'error',
          last_run_at:     new Date().toISOString(),
        }).eq('source_id', sourceId)
        await supabase.from('source_logs').insert({
          source_id:   sourceId,
          status:      'error',
          duration_ms: duration,
          error_msg:   e.message?.slice(0, 500),
        })
      } catch (logErr) {
        console.error(`[source job ${sourceId}] falha ao gravar log de erro:`, logErr.message)
      }
    }
  })

  res.json({ status: 'running', source_id: sourceId })
})

// ─── POST /api/sources/jobs/propmark/full-crawl ─────────────────────────────
// Crawl completo do sitemap sem filtro de data (~50K URLs)
router.post('/jobs/propmark/full-crawl', async (req, res) => {
  const { limit = 5000 } = req.body   // padrão: 5 mil artigos por execução

  await supabase
    .from('source_jobs')
    .update({ last_run_status: 'running', last_run_at: new Date().toISOString() })
    .eq('source_id', 'propmark')

  setImmediate(async () => {
    const startedAt = Date.now()
    try {
      const { crawlSitemap } = require('../crawlers/propmark')
      const result = await crawlSitemap({ limit })   // sem 'since' = backfill total
      const duration = Date.now() - startedAt

      await supabase.from('source_jobs').update({
        last_run_status: 'ok',
        last_run_count:  result.inserted,
        last_run_at:     new Date().toISOString(),
      }).eq('source_id', 'propmark')

      await supabase.from('source_logs').insert({
        source_id:     'propmark',
        status:        'ok',
        records_added: result.inserted,
        duration_ms:   duration,
      })

      // Extração de entidades dos artigos novos em background
      setImmediate(async () => {
        try {
          const { runExtraction } = require('../agents/articleExtractor')
          await runExtraction({ source_name: 'propmark', limit: 200 })
        } catch (e) { console.error('[extractor] erro pós full-crawl:', e.message) }
      })
    } catch (e) {
      const duration = Date.now() - startedAt
      console.error('[propmark full-crawl] erro:', e.message)
      try {
        await supabase.from('source_jobs').update({
          last_run_status: 'error',
          last_run_at:     new Date().toISOString(),
        }).eq('source_id', 'propmark')
        await supabase.from('source_logs').insert({
          source_id:   'propmark',
          status:      'error',
          duration_ms: duration,
          error_msg:   e.message?.slice(0, 500),
        })
      } catch (logErr) {
        console.error('[propmark full-crawl] falha ao gravar log:', logErr.message)
      }
    }
  })

  res.json({ status: 'running', source_id: 'propmark', mode: 'full-crawl', limit })
})

// ─── GET /api/sources/jobs/:sourceId/logs ──────────────────────────────────
router.get('/jobs/:sourceId/logs', async (req, res) => {
  const { data, error } = await supabase
    .from('source_logs')
    .select('*')
    .eq('source_id', req.params.sourceId)
    .order('ran_at', { ascending: false })
    .limit(20)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── GET /api/sources/jobs/stats ───────────────────────────────────────────
router.get('/jobs/stats', async (req, res) => {
  const { data: editions } = await supabase
    .from('editions')
    .select('year, source')
    .order('year')

  if (!editions) return res.json({})

  const bySource = {}
  for (const e of editions) {
    bySource[e.source] = (bySource[e.source] || 0) + 1
  }
  res.json({ by_source: bySource, total: editions.length })
})

// ─── POST /api/sources/upload-scopen ────────────────────────────────────────
// Upload de PDF do Scopen
router.post('/upload-scopen', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

  // Valida magic bytes: PDF começa com %PDF (0x25 0x50 0x44 0x46)
  const buf = Buffer.alloc(4)
  const fd  = fs.openSync(req.file.path, 'r')
  fs.readSync(fd, buf, 0, 4, 0)
  fs.closeSync(fd)
  if (buf.toString('ascii') !== '%PDF') {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'Arquivo inválido — somente PDFs reais são aceitos' })
  }

  // Nome seguro: UUID + extensão fixa — nunca usa o nome original
  const { randomUUID } = require('crypto')
  const destName = `${randomUUID()}.pdf`
  const destPath = path.join(uploadDir, destName)

  fs.renameSync(req.file.path, destPath)

  // Registra no Supabase
  await supabase.from('source_jobs').update({
    last_run_at:     new Date().toISOString(),
    last_run_status: 'ok',
    config:          { last_file: destName, original_name: origName },
    updated_at:      new Date().toISOString(),
  }).eq('source_id', 'scopen')

  res.json({
    success:   true,
    file:      destName,
    size_kb:   Math.round(req.file.size / 1024),
    path:      destPath,
    message:   `PDF salvo — extração de sinais pendente (será processado pelo Claude Haiku)`,
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function calcNextRun(frequency) {
  const now = new Date()
  switch (frequency) {
    case 'hourly':  now.setHours(now.getHours() + 1); break
    case 'daily':   now.setDate(now.getDate() + 1); break
    case 'weekly':  now.setDate(now.getDate() + 7); break
    case 'monthly': now.setMonth(now.getMonth() + 1); break
    default:        return null
  }
  return now.toISOString()
}

async function runSource(sourceId) {
  // Dispatcher — chama o scraper correto para cada fonte
  switch (sourceId) {
    case 'mm_website': {
      const { execFileSync } = require('child_process')
      const archiveDir = path.join(__dirname, '../../../data/archive')
      const since = new Date()
      since.setDate(since.getDate() - 2)
      const sinceStr = since.toISOString().slice(0, 10)
      // execFileSync: args como array — imune a command injection
      execFileSync(
        'python3',
        [path.join(archiveDir, 'scrape_website.py'), '--since', sinceStr, '--workers', '6'],
        { timeout: 120_000 }
      )
      // Após crawl, extrai marcas/agências das novas edições em background
      setImmediate(async () => {
        try {
          const { runEditionExtraction } = require('../agents/articleExtractor')
          await runEditionExtraction({ limit: 200, since: sinceStr })
        } catch (e) { console.error('[edition-extractor] erro pós-crawl:', e.message) }
      })
      const { data } = await supabase
        .from('editions')
        .select('id', { count: 'exact' })
        .gte('date', sinceStr)
      return data?.length || 0
    }
    case 'mm_archive': {
      const { runArchiveExtraction } = require('../agents/archiveExtractor')
      const result = await runArchiveExtraction({ yearFrom: 1978, yearTo: 2017, limit: 50 })
      return result.ok
    }
    case 'propmark': {
      const { crawlRSS, crawlSitemap } = require('../crawlers/propmark')
      // Polling horário: RSS (15 recentes) + sitemap dos últimos 7 dias
      const rssCount = await crawlRSS()
      const since = new Date()
      since.setDate(since.getDate() - 7)
      const sitemap = await crawlSitemap({ since: since.toISOString().slice(0, 10), limit: 100 })
      // Após crawl, dispara extração dos novos artigos
      setImmediate(async () => {
        try {
          const { runExtraction } = require('../agents/articleExtractor')
          await runExtraction({ source_name: 'propmark', limit: 50 })
        } catch (e) { console.error('[extractor] erro pós-crawl:', e.message) }
      })
      return rssCount + sitemap.inserted
    }
    case 'extract_articles': {
      const { runExtraction } = require('../agents/articleExtractor')
      const result = await runExtraction({ limit: 200 })
      return result.processed
    }
    default:
      return 0
  }
}

// ─── GET /api/sources/domains ────────────────────────────────────────────────
// Retorna todos os domínios/URLs monitorados com estado ativo/inativo do banco
router.get('/domains', async (req, res) => {
  const { DOMAINS } = require('../lib/sourceDomains')

  // Busca estado ativo/inativo salvo no banco (tabela sources)
  const { data: dbSources } = await supabase
    .from('sources')
    .select('id, url, active')

  // Mapa: id → active (do banco)
  const dbMap = {}
  for (const s of (dbSources || [])) {
    dbMap[s.id] = s.active
  }

  // Mescla: se ID não existe no banco, default = true (ativo)
  const domains = DOMAINS.map(d => ({
    ...d,
    active: d.id in dbMap ? dbMap[d.id] : true,
  }))

  res.json(domains)
})

// ─── PUT /api/sources/domains/:id ────────────────────────────────────────────
// Ativa ou desativa um domínio (persiste na tabela sources)
router.put('/domains/:id', async (req, res) => {
  const { DOMAINS } = require('../lib/sourceDomains')
  const domain = DOMAINS.find(d => d.id === req.params.id)
  if (!domain) return res.status(404).json({ error: 'Domínio não encontrado' })

  const { active } = req.body
  if (typeof active !== 'boolean') return res.status(400).json({ error: '"active" deve ser boolean' })

  // Upsert na tabela sources
  const { error } = await supabase.from('sources').upsert(
    {
      id:      domain.id,
      name:    domain.name,
      url:     domain.url,
      type:    domain.method,
      active,
    },
    { onConflict: 'id' }
  )

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, id: domain.id, active })
})

// ─── DELETE /api/sources/domains/:id ─────────────────────────────────────────
// Remove permanentemente um domínio da lista ativa (desativa no banco)
router.delete('/domains/:id', async (req, res) => {
  const { DOMAINS } = require('../lib/sourceDomains')
  const domain = DOMAINS.find(d => d.id === req.params.id)
  if (!domain) return res.status(404).json({ error: 'Domínio não encontrado' })

  // Marca como inativo permanentemente
  const { error } = await supabase.from('sources').upsert(
    {
      id:      domain.id,
      name:    domain.name,
      url:     domain.url,
      type:    domain.method,
      active:  false,
    },
    { onConflict: 'id' }
  )

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, id: domain.id, removed: true })
})

// ─── Rotas legacy (mantidas) ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('sources').select('*').order('name')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
