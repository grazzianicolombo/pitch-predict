/**
 * autoResume.js
 *
 * Ao iniciar o servidor, relança automaticamente qualquer job que estava
 * "running" (agora marcado como "interrupted" pelo jobStore).
 *
 * SEGURANÇA: invoca as funções dos agentes diretamente, sem fazer chamadas
 * HTTP internas que exigiriam auth — elimina o bug silencioso de 401.
 */

const { jobs } = require('./jobStore')

// Mapeia tipo de job → função do agente correspondente
function getAgentFn(type) {
  switch (type) {
    case 'extract_articles':     return () => require('../agents/articleExtractor').runExtraction({ limit: 500 })
    case 'extract_editions':     return () => require('../agents/articleExtractor').runEditionExtraction({ limit: 200 })
    case 'extract_editions_all': return () => require('../agents/articleExtractor').runEditionExtraction({ limit: 500 })
    case 'recrawl_all':          return () => require('../agents/articleExtractor').runExtraction({ limit: 1000 })
    case 'capture_signals':      return () => require('../agents/signalCaptureAgent').runSignalCapture({ limit: 100 })
    case 'enrich_executives':    return () => require('../agents/executivesAgent').runExecutiveEnrichment({ limit: 100 })
    case 'orchestrator':         return () => require('../agents/orchestrator').runOrchestrator({ dry_run: false, full: false })
    default:                     return null
  }
}

async function autoResume() {
  const interrupted = Object.values(jobs).filter(j => j.status === 'interrupted')
  if (!interrupted.length) return

  // Deduplica por tipo — evita lançar dois jobs do mesmo tipo
  const byType = {}
  for (const j of interrupted) {
    if (!byType[j.type]) byType[j.type] = j
  }

  const unique = Object.values(byType)
  console.log(`[autoResume] Relançando ${unique.length} job(s): ${unique.map(j => j.type).join(', ')}`)

  for (const job of unique) {
    const fn = getAgentFn(job.type)
    if (!fn) {
      console.log(`[autoResume] Sem handler para tipo "${job.type}" — ignorado`)
      continue
    }

    // Dispara em background — não bloqueia o startup do servidor
    setImmediate(async () => {
      try {
        console.log(`[autoResume] Iniciando ${job.type}`)
        await fn()
        console.log(`[autoResume] ${job.type} concluído`)
      } catch (e) {
        console.error(`[autoResume] Falha ao relancar ${job.type}: ${e.message}`)
      }
    })
  }
}

module.exports = { autoResume }
