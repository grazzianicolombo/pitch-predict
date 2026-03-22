/**
 * scheduler.js
 *
 * Agendador automático de todos os agentes do Pitch Predict.
 * Usa node-cron para disparar cada agente no horário correto.
 *
 * Schedules:
 *  Agente 1 — Recrawl Propmark           → a cada 15min (5 concurrent, rate 300ms)
 *  Agente 3 — Busca Mídia de Negócios    → a cada 4h
 *  Agente 2 — Extração de Artigos        → a cada 10min (25 concurrent MiniMax)
 *  Agente 2 — Extração de Edições        → a cada 6h
 *  Agente 4 — Enriquecimento Executivos  → uma vez por dia (3h)
 *  Agente 6 — Captura de Sinais          → a cada 4h
 */

const cron    = require('node-cron')
const supabase = require('./lib/supabase')

// Flag para evitar execuções sobrepostas por agente
const running = {
  recrawl:     false,
  media:       false,
  extract:     false,
  editions:    false,
  executives:  false,
  signals:     false,
}

function log(tag, msg) {
  console.log(`[scheduler:${tag}] ${new Date().toISOString().slice(0,19)} ${msg}`)
}

// ─── Agente 1: Recrawl Propmark (a cada 15min, 5 concurrent, 300ms/req) ──────
cron.schedule('*/15 * * * *', async () => {
  if (running.recrawl) { log('recrawl', 'Já em execução, pulando'); return }
  running.recrawl = true
  log('recrawl', 'Iniciando recrawl Propmark sem conteúdo')
  try {
    const { scrapeArticlePage } = require('./crawlers/propmark')

    // Busca artigos sem conteúdo (exceto crawl_failed já descartados)
    const { data: articles } = await supabase
      .from('articles')
      .select('id, url')
      .or('content.is.null,content.eq.')
      .not('extraction_status', 'eq', 'crawl_failed')
      .eq('source_name', 'propmark')
      .limit(500)

    if (!articles?.length) {
      log('recrawl', 'Nenhum artigo pendente')
      return
    }

    log('recrawl', `${articles.length} artigos para recrawl`)
    const CONCURRENCY = 5
    const RATE_MS     = 300
    let ok = 0, errors = 0

    // Processa em chunks paralelos com rate limit por chunk
    for (let i = 0; i < articles.length; i += CONCURRENCY) {
      const chunk = articles.slice(i, i + CONCURRENCY)
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
            await supabase.from('articles').update({
              extraction_status: 'crawl_failed', content: '',
            }).eq('id', art.id)
            errors++
          }
        } catch (e) {
          await supabase.from('articles').update({
            extraction_status: 'crawl_failed', content: '',
          }).eq('id', art.id)
          errors++
        }
      }))
      await new Promise(r => setTimeout(r, RATE_MS))
    }

    log('recrawl', `Concluído: ${ok} ok, ${errors} crawl_failed`)
  } catch (e) {
    log('recrawl', `Erro: ${e.message}`)
  } finally {
    running.recrawl = false
  }
})

// ─── Agente 3: Busca em Mídia de Negócios (a cada 4h) ───────────────────────
cron.schedule('0 */4 * * *', async () => {
  if (running.media) { log('media', 'Já em execução, pulando'); return }
  running.media = true
  log('media', 'Iniciando crawl Exame + Valor')
  try {
    const { runMediaSearch } = require('./agents/mediaSearchAgent')
    const result = await runMediaSearch({ extract: true })
    log('media', `Concluído: ${result.articles_saved} artigos salvos`)
  } catch (e) {
    log('media', `Erro: ${e.message}`)
  } finally {
    running.media = false
  }
})

// ─── Agente 2: Extração de Artigos (a cada 10min, batch de 2000) ─────────────
cron.schedule('*/10 * * * *', async () => {
  if (running.extract) { log('extract', 'Já em execução, pulando'); return }
  running.extract = true
  log('extract', 'Iniciando extração de artigos pendentes')
  try {
    const { runExtraction } = require('./agents/articleExtractor')
    const result = await runExtraction({ limit: 2000 })
    log('extract', `Concluído: ${result.processed} processados, ${result.skipped} skipped`)
  } catch (e) {
    log('extract', `Erro: ${e.message}`)
  } finally {
    running.extract = false
  }
})

// ─── Agente 2: Extração de Edições M&M (a cada 6h) ──────────────────────────
cron.schedule('15 */6 * * *', async () => {
  if (running.editions) { log('editions', 'Já em execução, pulando'); return }
  running.editions = true
  log('editions', 'Iniciando extração de edições M&M pendentes')
  try {
    const { runEditionExtraction } = require('./agents/articleExtractor')
    const result = await runEditionExtraction({ limit: 500 })
    log('editions', `Concluído: ${result.processed} processados`)
  } catch (e) {
    log('editions', `Erro: ${e.message}`)
  } finally {
    running.editions = false
  }
})

// ─── Agente 4: Enriquecimento de Executivos PDL (diário às 3h) ──────────────
cron.schedule('0 3 * * *', async () => {
  if (!process.env.PDL_API_KEY) { log('executives', 'PDL_API_KEY não configurada, pulando'); return }
  if (running.executives) { log('executives', 'Já em execução, pulando'); return }
  running.executives = true
  log('executives', 'Iniciando enriquecimento de executivos via PDL')
  try {
    const { runExecutiveEnrichment } = require('./agents/executivesAgent')
    const result = await runExecutiveEnrichment({ limit: 100 })
    log('executives', `Concluído: ${result.saved} executivos salvos`)
  } catch (e) {
    log('executives', `Erro: ${e.message}`)
  } finally {
    running.executives = false
  }
})

// ─── Agente 6: Captura de Sinais (a cada 4h, offset de 2h) ──────────────────
cron.schedule('0 2,6,10,14,18,22 * * *', async () => {
  if (!process.env.ANTHROPIC_API_KEY) { log('signals', 'ANTHROPIC_API_KEY não configurada, pulando'); return }
  if (running.signals) { log('signals', 'Já em execução, pulando'); return }
  running.signals = true
  log('signals', 'Iniciando captura de sinais')
  try {
    const { runSignalCapture } = require('./agents/signalCaptureAgent')
    const result = await runSignalCapture({ limit: 100 })
    log('signals', `Concluído: ${result.events_saved} eventos salvos`)
  } catch (e) {
    log('signals', `Erro: ${e.message}`)
  } finally {
    running.signals = false
  }
})

// ─── Orquestrador: verificação a cada hora ───────────────────────────────────
// Verifica o estado do pipeline e executa o que estiver pendente
let orchRunning = false
cron.schedule('0 * * * *', async () => {
  if (orchRunning) { log('orch', 'Já em execução, pulando'); return }
  orchRunning = true
  log('orch', 'Verificando pipeline...')
  try {
    const { runOrchestrator } = require('./agents/orchestrator')
    const result = await runOrchestrator({ dry_run: false, full: false })
    const summary = `${result.executed.length} agentes executados | ${result.remaining_items} itens restantes | completo: ${result.pipeline_complete}`
    log('orch', summary)
    if (result.gaps?.length) {
      result.gaps.forEach(g => log('orch', `⚠ GAP: ${g}`))
    }
  } catch (e) {
    log('orch', `Erro: ${e.message}`)
  } finally {
    orchRunning = false
  }
})

log('init', 'Scheduler iniciado. Próximas execuções ativas.')

module.exports = {}
