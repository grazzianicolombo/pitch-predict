/**
 * autoResume.js
 *
 * Ao iniciar o servidor, relança automaticamente qualquer job que estava
 * "running" (agora marcado como "interrupted" pelo jobStore).
 * Usa http nativo do Node — sem dependência de node-fetch.
 */

const http = require('http')
const { jobs } = require('./jobStore')

function httpPost(path, body = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve(buf))
    })
    req.on('error', () => resolve(null))
    req.write(data)
    req.end()
  })
}

// Mapeia tipo de job → rota de re-trigger
const ROUTE_MAP = {
  recrawl_all:          '/api/agent/recrawl-articles-all',
  extract_editions_all: '/api/agent/extract-editions-all',
  extract_articles:     '/api/agent/extract-articles',
  extract_editions:     '/api/agent/extract-editions',
  capture_signals:      '/api/agent/capture-signals',
  orchestrator:         '/api/agent/orchestrator/run',
  enrich_executives:    '/api/agent/enrich-executives',
}

async function autoResume() {
  const interrupted = Object.values(jobs).filter(j => j.status === 'interrupted')
  if (!interrupted.length) return

  // Deduplica por tipo — evita lançar dois recrawl_all se havia dois
  const byType = {}
  for (const j of interrupted) {
    if (!byType[j.type]) byType[j.type] = j
  }

  const unique = Object.values(byType)
  console.log(`[autoResume] Relançando ${unique.length} job(s): ${unique.map(j => j.type).join(', ')}`)

  for (const job of unique) {
    const route = ROUTE_MAP[job.type]
    if (!route) {
      console.log(`[autoResume] Sem rota para tipo "${job.type}" — ignorado`)
      continue
    }
    // Repassa params salvos (ex: since_year) para manter contexto do job original
    const savedParams = job.params || {}
    try {
      await httpPost(route, savedParams)
      console.log(`[autoResume] ${job.type} → ${route} : disparado`)
    } catch (e) {
      console.error(`[autoResume] Falha ao relancar ${job.type}: ${e.message}`)
    }
  }
}

module.exports = { autoResume }
