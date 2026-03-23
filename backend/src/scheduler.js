/**
 * scheduler.js
 *
 * Agendador automático de todos os agentes do Pitch Predict.
 * Usa node-cron para disparar cada agente no horário correto.
 *
 * Schedules:
 *  Agente 1 — Recrawl Propmark                → a cada 15min (5 concurrent, rate 300ms)
 *  Agente 3 — Busca Mídia (Exame+Valor+M&M+Adnews) → a cada 4h
 *  Agente 2 — Extração de Artigos             → a cada 10min (25 concurrent MiniMax)
 *  Agente 2 — Extração de Edições             → a cada 6h
 *  Agente 4 — Enriquecimento Executivos       → uma vez por dia (3h)
 *  Agente 6 — Captura de Sinais               → a cada 4h
 *  Agente 7 — Validação Agência Atual         → 2x por dia (8h e 20h)
 *  Agente 8 — Busca Corporativa (search-first) → a cada 8h
 */

const cron           = require('node-cron')
const { createClient } = require('@supabase/supabase-js')

// Scheduler usa service key — bypassa RLS para acesso total aos dados do pipeline
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Wrapper com timeout para evitar jobs travados indefinidamente
async function withTimeout(fn, ms, label) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout após ${ms / 60000}min`)), ms)
    ),
  ]).catch(e => { log(label, `Erro/Timeout: ${e.message}`) })
}

// Flag para evitar execuções sobrepostas por agente
const running = {
  recrawl:         false,
  media:           false,
  extract:         false,
  editions:        false,
  executives:      false,
  signals:         false,
  currentAgency:   false,
  corporateSearch: false,
}

function log(tag, msg) {
  console.log(`[scheduler:${tag}] ${new Date().toISOString().slice(0,19)} ${msg}`)
}

// ─── Agente 1: Recrawl Propmark (a cada 15min, 5 concurrent, 300ms/req) ──────
cron.schedule('*/15 * * * *', async () => {
  if (running.recrawl) { log('recrawl', 'Já em execução, pulando'); return }
  running.recrawl = true
  log('recrawl', 'Iniciando recrawl Propmark sem conteúdo')
  await withTimeout(async () => {
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
  }, 14 * 60 * 1000, 'recrawl')
})

// ─── Agente 3: Busca em Mídia de Negócios (a cada 4h) ───────────────────────
// Inclui: Exame, Valor Econômico, Meio & Mensagem, Adnews
cron.schedule('0 */4 * * *', async () => {
  if (running.media) { log('media', 'Já em execução, pulando'); return }
  running.media = true
  log('media', 'Iniciando crawl Exame + Valor + M&M + Adnews')
  await withTimeout(async () => {
    try {
      const { runMediaSearch } = require('./agents/mediaSearchAgent')
      const result = await runMediaSearch({ extract: true })
      log('media', `Concluído: ${result.articles_saved} artigos salvos (${Object.keys(result.by_source || {}).join(', ')})`)
    } catch (e) {
      log('media', `Erro: ${e.message}`)
    } finally {
      running.media = false
    }
  }, 30 * 60 * 1000, 'media')
})

// ─── Agente 2: Extração de Artigos (a cada 10min, batch de 2000) ─────────────
cron.schedule('*/10 * * * *', async () => {
  if (running.extract) { log('extract', 'Já em execução, pulando'); return }
  running.extract = true
  log('extract', 'Iniciando extração de artigos pendentes')
  await withTimeout(async () => {
    try {
      const { runExtraction } = require('./agents/articleExtractor')
      const result = await runExtraction({ limit: 2000 })
      log('extract', `Concluído: ${result.processed} processados, ${result.skipped} skipped`)
    } catch (e) {
      log('extract', `Erro: ${e.message}`)
    } finally {
      running.extract = false
    }
  }, 8 * 60 * 1000, 'extract')
})

// ─── Agente 2: Extração de Edições M&M (a cada 6h) ──────────────────────────
cron.schedule('15 */6 * * *', async () => {
  if (running.editions) { log('editions', 'Já em execução, pulando'); return }
  running.editions = true
  log('editions', 'Iniciando extração de edições M&M pendentes')
  await withTimeout(async () => {
    try {
      const { runEditionExtraction } = require('./agents/articleExtractor')
      const result = await runEditionExtraction({ limit: 500 })
      log('editions', `Concluído: ${result.processed} processados`)
    } catch (e) {
      log('editions', `Erro: ${e.message}`)
    } finally {
      running.editions = false
    }
  }, 45 * 60 * 1000, 'editions')
})

// ─── Agente 4: Enriquecimento de Executivos PDL (diário às 3h) ──────────────
cron.schedule('0 3 * * *', async () => {
  if (!process.env.PDL_API_KEY) { log('executives', 'PDL_API_KEY não configurada, pulando'); return }
  if (running.executives) { log('executives', 'Já em execução, pulando'); return }
  running.executives = true
  log('executives', 'Iniciando enriquecimento de executivos via PDL')
  await withTimeout(async () => {
    try {
      const { runExecutiveEnrichment } = require('./agents/executivesAgent')
      const result = await runExecutiveEnrichment({ limit: 100 })
      log('executives', `Concluído: ${result.saved} executivos salvos`)
    } catch (e) {
      log('executives', `Erro: ${e.message}`)
    } finally {
      running.executives = false
    }
  }, 60 * 60 * 1000, 'executives')
})

// ─── Agente 6: Captura de Sinais (a cada 4h, offset de 2h) ──────────────────
cron.schedule('0 2,6,10,14,18,22 * * *', async () => {
  if (!process.env.ANTHROPIC_API_KEY) { log('signals', 'ANTHROPIC_API_KEY não configurada, pulando'); return }
  if (running.signals) { log('signals', 'Já em execução, pulando'); return }
  running.signals = true
  log('signals', 'Iniciando captura de sinais')
  await withTimeout(async () => {
    try {
      const { runSignalCapture } = require('./agents/signalCaptureAgent')
      const result = await runSignalCapture({ limit: 100 })
      log('signals', `Concluído: ${result.events_saved} eventos salvos`)
    } catch (e) {
      log('signals', `Erro: ${e.message}`)
    } finally {
      running.signals = false
    }
  }, 30 * 60 * 1000, 'signals')
})

// ─── Agente 7: Validação de Agência Atual (2x por dia: 8h e 20h) ────────────
// Valida agência atual de cada marca com base em notícias dos últimos 90 dias.
// Alta confiança → atualiza automaticamente. Média → vai para revisão humana.
cron.schedule('0 8,20 * * *', async () => {
  if (!process.env.ANTHROPIC_API_KEY) { log('current-agency', 'ANTHROPIC_API_KEY não configurada, pulando'); return }
  if (!process.env.TAVILY_API_KEY)    { log('current-agency', 'TAVILY_API_KEY não configurada, pulando'); return }
  if (running.currentAgency) { log('current-agency', 'Já em execução, pulando'); return }
  running.currentAgency = true
  log('current-agency', 'Iniciando validação de agências atuais')
  await withTimeout(async () => {
    try {
      const { runCurrentAgencyValidation } = require('./agents/currentAgencyAgent')
      const result = await runCurrentAgencyValidation({ limit: 50 })
      log('current-agency', `Concluído: ${result.auto_updated} atualizados, ${result.queued_for_review} na fila, ${result.no_change} sem mudança`)
    } catch (e) {
      log('current-agency', `Erro: ${e.message}`)
    } finally {
      running.currentAgency = false
    }
  }, 45 * 60 * 1000, 'current-agency')
})

// ─── Agente 8: Busca Corporativa search-first (a cada 8h) ───────────────────
// Parte de marcas/agências/executivos conhecidos → busca notícias via Tavily
// → salva URLs descobertas → dispara extração.
cron.schedule('30 1,9,17 * * *', async () => {
  if (!process.env.TAVILY_API_KEY) { log('corporate-search', 'TAVILY_API_KEY não configurada, pulando'); return }
  if (running.corporateSearch) { log('corporate-search', 'Já em execução, pulando'); return }
  running.corporateSearch = true
  log('corporate-search', 'Iniciando busca corporativa por entidades')
  await withTimeout(async () => {
    try {
      const { runCorporateSearch } = require('./agents/corporateSearchAgent')
      const result = await runCorporateSearch({ limitBrands: 40, limitAgencies: 20, limitLeaders: 20 })
      log('corporate-search', `Concluído: ${result.articles_saved} artigos salvos (${result.entities_searched} entidades)`)
    } catch (e) {
      log('corporate-search', `Erro: ${e.message}`)
    } finally {
      running.corporateSearch = false
    }
  }, 60 * 60 * 1000, 'corporate-search')
})

// ─── Orquestrador: verificação a cada hora ───────────────────────────────────
// Verifica o estado do pipeline e executa o que estiver pendente
let orchRunning = false
cron.schedule('0 * * * *', async () => {
  if (orchRunning) { log('orch', 'Já em execução, pulando'); return }
  orchRunning = true
  log('orch', 'Verificando pipeline...')
  await withTimeout(async () => {
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
  }, 50 * 60 * 1000, 'orch')
})

log('init', 'Scheduler iniciado. Próximas execuções ativas.')

module.exports = {}
