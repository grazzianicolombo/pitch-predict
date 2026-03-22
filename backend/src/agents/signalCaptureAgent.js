/**
 * signalCaptureAgent.js — Agente 6
 *
 * Varre todos os dados coletados (artigos, edições, executivos, agency_history)
 * + busca Tavily na web (Valor, Exame, Forbes BR, Globo, etc.)
 * e detecta eventos de sinal para cada marca, preenchendo a tabela signal_events.
 *
 * Fluxo:
 *  1. Carrega todos os sinais ativos do banco
 *  2. Para cada marca: carrega evidências locais + busca Tavily
 *  3. Analisa via Claude Haiku — detecta quais sinais se aplicam
 *  4. Salva em signal_events (dedup por marca + sinal + 30 dias)
 */

const Anthropic  = require('@anthropic-ai/sdk')
const supabase   = require('../lib/supabase')
const {
  searchExecutives,
  searchPitchSignals,
  searchFinancialSignals,
  searchBrandNews,
} = require('../lib/tavilySearch')

const client = new Anthropic()

// ─── Carrega sinais ativos ──────────────────────────────────────────────────

async function loadSignals() {
  const { data } = await supabase
    .from('collected_fields')
    .select('id, name, category, signal_key, description, examples, weight')
    .eq('active', true)
    .order('weight', { ascending: false })
  return data || []
}

// ─── Carrega evidências locais do banco ───────────────────────────────────

async function loadBrandEvidence(brandId, brandName, since) {
  const sinceFilter = since || new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [articlesRes, leadersRes, agencyRes] = await Promise.all([
    supabase
      .from('articles')
      .select('id, title, excerpt, published_at, source_name')
      .or(`title.ilike.%${brandName}%,excerpt.ilike.%${brandName}%`)
      .gte('published_at', sinceFilter)
      .not('extraction_status', 'eq', 'crawl_failed')
      .order('published_at', { ascending: false })
      .limit(20),

    supabase
      .from('marketing_leaders')
      .select('name, title, is_current, start_date, end_date')
      .eq('brand_id', brandId)
      .order('start_date', { ascending: false })
      .limit(10),

    supabase
      .from('agency_history')
      .select('agency, scope, year_start, year_end, month_start, month_end, status, pitch_type')
      .eq('brand_id', brandId)
      .order('year_start', { ascending: false })
      .limit(10),
  ])

  return {
    articles: articlesRes.data || [],
    leaders:  leadersRes.data  || [],
    agencies: agencyRes.data   || [],
  }
}

// ─── Busca evidências Tavily na web ────────────────────────────────────────

async function loadTavilyEvidence(brandName, signals) {
  // Decide quais buscas fazer com base nos tipos de sinais ativos
  const hasFinancialSignals = signals.some(s => s.category === 'Financeiro')
  const hasExecSignals      = signals.some(s => ['cmo_change', 'leadership_instability', 'tenure_5plus'].includes(s.signal_key))
  const hasPitchSignals     = signals.some(s => ['agency_key_person_left', 'agency_losing_clients', 'cmo_chose_agency'].includes(s.signal_key))

  const searches = []

  // Notícias gerais (sempre)
  searches.push(searchBrandNews(brandName, { days: 180, maxResults: 5 }))

  // Sinais financeiros → Valor Econômico, Exame, InfoMoney
  if (hasFinancialSignals) {
    searches.push(searchFinancialSignals(brandName, { days: 365 }))
  }

  // Sinais de executivos → Forbes BR, Globo, portais corporativos
  if (hasExecSignals) {
    searches.push(searchExecutives(brandName, { days: 730 }))
  }

  // Sinais de pitch / agência
  if (hasPitchSignals) {
    searches.push(searchPitchSignals(brandName, { days: 365 }))
  }

  const allResults = await Promise.allSettled(searches)

  // Agrega e deduplica por URL
  const seen = new Set()
  const webResults = []
  for (const r of allResults) {
    if (r.status !== 'fulfilled') continue
    for (const item of r.value) {
      if (!seen.has(item.url)) {
        seen.add(item.url)
        webResults.push(item)
      }
    }
  }

  return webResults
}

// ─── Prompt de captura de sinais ──────────────────────────────────────────

function buildCapturePrompt(brand, evidence, webResults, signals) {
  const signalList = signals.map(s =>
    `  - "${s.signal_key}" (${s.name}, peso ${s.weight > 0 ? '+' + s.weight : s.weight}): ${s.description || s.examples || ''}`
  ).join('\n')

  const articleTexts = evidence.articles.slice(0, 8).map(a =>
    `[${a.published_at?.slice(0, 10) || '?'} | ${a.source_name}] ${a.title}\n${(a.excerpt || '').slice(0, 200)}`
  ).join('\n---\n')

  const leadersText = evidence.leaders.map(l =>
    `${l.name} — ${l.title} | ${l.is_current ? 'atual' : `até ${l.end_date?.slice(0,7) || '?'}`} | desde ${l.start_date?.slice(0,7) || '?'}`
  ).join('\n')

  const agencyText = evidence.agencies.map(a =>
    `${a.agency} (${a.scope}) ${a.year_start}–${a.year_end || 'atual'} | status: ${a.status}`
  ).join('\n')

  const webText = webResults.slice(0, 10).map(r =>
    `[WEB | ${new URL(r.url).hostname}] ${r.title}\n${(r.content || '').slice(0, 250)}`
  ).join('\n---\n')

  return `Você analisa dados de uma marca para detectar sinais de que ela pode trocar de agência em breve.

Marca: ${brand.name} | Segmento: ${brand.segment || '?'} | Receita: ${brand.revenue_estimate || '?'}

=== SINAIS A DETECTAR ===
${signalList}

=== ARTIGOS ESPECIALIZADOS (Propmark / M&M) ===
${articleTexts || 'Nenhum artigo encontrado'}

=== EXECUTIVOS ===
${leadersText || 'Nenhum executivo cadastrado'}

=== HISTÓRICO DE AGÊNCIAS ===
${agencyText || 'Nenhum histórico cadastrado'}

=== NOTÍCIAS WEB RECENTES (Valor, Exame, Forbes BR, Globo, etc.) ===
${webText || 'Nenhuma notícia encontrada'}

---
Para cada sinal detectado, retorne JSON com este formato EXATO:
{
  "events": [
    {
      "signal_key": "chave_do_sinal",
      "signal_name": "Nome do sinal",
      "weight_applied": 1.5,
      "evidence_text": "Evidência concreta (máx 300 chars) — cite a fonte",
      "source_url": "https://... ou null",
      "confidence": "alta|media|baixa",
      "detected_date": "YYYY-MM-DD"
    }
  ]
}

Regras:
- Só inclua sinais com evidência CONCRETA nos dados fornecidos
- Não invente informações que não estão nos dados
- evidence_text deve citar a fonte (ex: "Valor Econômico 2025-01: ...")
- detected_date é a data da evidência, não hoje
- Sinais negativos (peso < 0) também devem ser incluídos se houver evidência`
}

// ─── Extrai sinais via Claude ─────────────────────────────────────────────

async function extractSignalsForBrand(brand, evidence, webResults, signals) {
  if (
    evidence.articles.length === 0 &&
    evidence.leaders.length === 0 &&
    evidence.agencies.length === 0 &&
    webResults.length === 0
  ) {
    return []
  }

  const prompt = buildCapturePrompt(brand, evidence, webResults, signals)

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0]?.text || '{}'

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    try { parsed = match ? JSON.parse(match[0]) : null } catch { parsed = null }
  }

  return parsed?.events || []
}

// ─── Salva eventos no banco ────────────────────────────────────────────────

async function saveSignalEvents(brandId, events) {
  let saved = 0
  for (const ev of events) {
    if (!ev.signal_key || !ev.evidence_text) continue

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('signal_events')
      .select('id')
      .eq('brand_id', brandId)
      .eq('signal_key', ev.signal_key)
      .gte('captured_at', since)
      .limit(1)

    if (existing?.length) continue

    const { error } = await supabase.from('signal_events').insert({
      brand_id:          brandId,
      signal_key:        ev.signal_key,
      signal_name:       ev.signal_name,
      weight_applied:    ev.weight_applied || 1.0,
      evidence_text:     ev.evidence_text,
      source_article_id: null,
      metadata: {
        confidence:    ev.confidence,
        detected_date: ev.detected_date,
        source_url:    ev.source_url || null,
      },
      expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    })

    if (!error) saved++
    else console.error(`[signal-capture] Erro ao salvar evento: ${error.message}`)
  }
  return saved
}

// ─── Agente principal ──────────────────────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {number}   opts.limit      - máx marcas (default 50)
 * @param {string[]} opts.brand_ids  - IDs específicos
 * @param {string}   opts.since      - data mínima YYYY-MM-DD
 * @param {boolean}  opts.web        - usar Tavily (default true)
 * @param {Function} opts.onProgress
 */
async function runSignalCapture({ limit = 50, brand_ids, since, web = true, onProgress } = {}) {
  onProgress?.('loading_signals', {})
  const signals = await loadSignals()
  if (!signals.length) throw new Error('Nenhum sinal ativo cadastrado')
  console.log(`[signal-capture] ${signals.length} sinais ativos | web=${web}`)

  let query = supabase.from('brands').select('id, name, segment, revenue_estimate').order('name').limit(limit)
  if (brand_ids?.length) query = query.in('id', brand_ids)
  const { data: brands } = await query

  console.log(`[signal-capture] Processando ${brands?.length || 0} marcas`)

  const totals = { processed: 0, with_data: 0, events_found: 0, events_saved: 0, errors: 0, total: brands?.length || 0 }

  for (const brand of (brands || [])) {
    onProgress?.('capturing', { brand: brand.name, progress: totals.processed, total: totals.total })

    try {
      // Evidências locais (banco)
      const evidence = await loadBrandEvidence(brand.id, brand.name, since)

      // Evidências web (Tavily) — em paralelo com as locais já carregadas
      const webResults = web ? await loadTavilyEvidence(brand.name, signals) : []

      const hasData = evidence.articles.length + evidence.leaders.length +
                      evidence.agencies.length + webResults.length > 0

      if (!hasData) { totals.processed++; continue }

      totals.with_data++

      if (webResults.length > 0) {
        console.log(`[signal-capture] ${brand.name}: ${webResults.length} resultados Tavily`)
      }

      const events = await extractSignalsForBrand(brand, evidence, webResults, signals)
      totals.events_found += events.length

      const saved = await saveSignalEvents(brand.id, events)
      totals.events_saved += saved

      if (events.length > 0) {
        console.log(`[signal-capture] ${brand.name}: ${events.length} sinais, ${saved} salvos`)
      }
    } catch (e) {
      console.error(`[signal-capture] Erro em ${brand.name}: ${e.message}`)
      totals.errors++
    }

    totals.processed++
    // Pequeno delay — Tavily tem rate limit generoso mas Claude tem custo por req
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('[signal-capture] Concluído:', JSON.stringify(totals))
  return totals
}

module.exports = { runSignalCapture }
