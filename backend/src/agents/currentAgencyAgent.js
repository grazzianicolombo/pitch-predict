/**
 * currentAgencyAgent.js — Agente 7
 *
 * Valida qual é a agência ATUAL de cada marca baseado APENAS em
 * notícias dos últimos 90 dias. Corrige o problema de agências
 * desatualizadas no menu de Marcas e no dashboard.
 *
 * Fluxo:
 *  1. Carrega marcas com agency_history ativa
 *  2. Para cada marca: busca Tavily (90 dias) + artigos locais (90 dias)
 *  3. Claude Haiku analisa evidências → determina agência atual
 *  4. Alta confiança + mudança detectada  → atualiza agency_history automaticamente
 *  5. Média confiança + mudança detectada → vai para validation_queue
 *  6. Sem mudança ou baixa confiança     → registra como "sem alteração"
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')
const { search } = require('../lib/tavilySearch')

const client = new Anthropic()

const DAYS_LOOKBACK         = 90
const SEARCH_DOMAINS        = [
  'meioemensagem.com.br',
  'propmark.com.br',
  'adnews.com.br',
  'valor.com.br',
  'exame.com',
  'portaldapropaganda.com.br',
]

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Carrega marcas com agências ativas ─────────────────────────────────────

async function loadBrandsWithActiveAgencies(limit = 50) {
  // Busca agency_history ativas
  const { data: histories } = await supabase
    .from('agency_history')
    .select('brand_id, agency, scope, year_start, month_start, year_end, status')
    .eq('status', 'active')
    .order('year_start', { ascending: false })

  if (!histories?.length) return []

  // Agrupa por brand_id
  const byBrand = {}
  for (const h of histories) {
    if (!byBrand[h.brand_id]) byBrand[h.brand_id] = []
    byBrand[h.brand_id].push(h)
  }

  const brandIds = Object.keys(byBrand).slice(0, limit)
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, segment')
    .in('id', brandIds)

  return (brands || []).map(b => ({
    ...b,
    active_agencies: byBrand[b.id] || [],
  }))
}

// ─── Busca notícias recentes de agência para a marca ──────────────────────────

async function searchAgencyNews(brandName) {
  const queries = [
    `"${brandName}" agência publicidade conta criação mídia digital 2025 2026`,
    `"${brandName}" troca agência nova agência pitch concorrência`,
    `"${brandName}" anuncia contratou escolheu agência`,
  ]

  const results = []
  for (const q of queries) {
    const found = await search(q, {
      maxResults:     5,
      days:           DAYS_LOOKBACK,
      includeDomains: SEARCH_DOMAINS,
    })
    results.push(...found)
  }

  // Dedup por URL
  const seen = new Set()
  return results.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

// ─── Carrega artigos locais relevantes ───────────────────────────────────────

async function loadLocalArticles(brandName) {
  const since = new Date(Date.now() - DAYS_LOOKBACK * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)

  const { data } = await supabase
    .from('articles')
    .select('title, excerpt, published_at, source_name, url')
    .or(`title.ilike.%${brandName}%,excerpt.ilike.%${brandName}%`)
    .gte('published_at', since)
    .not('extraction_status', 'eq', 'crawl_failed')
    .order('published_at', { ascending: false })
    .limit(15)

  return data || []
}

// ─── Analisa evidências via Claude Haiku ──────────────────────────────────────

async function analyzeAgencyStatus(brand, webResults, localArticles) {
  const activeAgenciesText = brand.active_agencies
    .map(a => `- ${a.agency} (escopo: ${a.scope}, desde: ${a.year_start}${a.month_start ? `/${String(a.month_start).padStart(2,'0')}` : ''})`)
    .join('\n')

  const webEvidenceText = webResults
    .map(r => `[${r.published_date || 'sem data'}] ${r.title}\n${(r.content || r.url || '').slice(0, 350)}`)
    .join('\n\n')

  const localEvidenceText = localArticles
    .map(a => `[${a.published_at?.slice(0,10) || ''}] ${a.source_name}: ${a.title}\n${(a.excerpt || '').slice(0, 200)}`)
    .join('\n\n')

  const prompt = `Analise as notícias recentes (últimos 90 dias) sobre a marca "${brand.name}" e determine o status atual da sua relação com agências de publicidade.

AGÊNCIAS REGISTRADAS ATUALMENTE COMO ATIVAS NO BANCO:
${activeAgenciesText || '(nenhuma agência ativa registrada)'}

NOTÍCIAS DA WEB (últimos 90 dias via busca):
${webEvidenceText || '(nenhuma notícia encontrada)'}

ARTIGOS DO BANCO LOCAL (últimos 90 dias):
${localEvidenceText || '(nenhum artigo local)'}

Responda APENAS com JSON válido:
{
  "agency_changed": true | false,
  "new_agency": "Nome exato da nova agência" | null,
  "new_scope": "Criação" | "Mídia" | "Digital" | "PR" | "Geral" | null,
  "confidence": "alta" | "media" | "baixa",
  "evidence_summary": "1-2 frases descrevendo a evidência",
  "change_date": "YYYY-MM" | null
}

Regras:
- "agency_changed": true SOMENTE se há evidência EXPLÍCITA de mudança nos últimos 90 dias (novo contrato anunciado, pitch encerrado, saída confirmada).
- "confidence": "alta" = notícia direta confirmando troca de agência com nome citado. "media" = indícios claros mas sem confirmação explícita. "baixa" = especulação, pitch em andamento sem resultado.
- Se não há evidência de mudança → agency_changed: false (não altere dados corretos por falta de informação).
- "new_agency" deve ser o nome EXATO da agência como aparece nos artigos, não o nome atual registrado.`

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  } catch (e) {
    console.error(`[current-agency] Erro na análise de ${brand.name}: ${e.message}`)
    return null
  }
}

// ─── Aplica mudança de agência no banco ──────────────────────────────────────

async function applyAgencyChange(brand, analysis) {
  const { new_agency, new_scope, change_date, evidence_summary } = analysis
  if (!new_agency) return false

  const [changeYear, changeMonth] = (change_date || '').split('-').map(Number)
  const year  = changeYear  || new Date().getFullYear()
  const month = changeMonth || (new Date().getMonth() + 1)

  // Encerra registros ativos do mesmo escopo (ou todos se escopo não especificado)
  const updateQuery = supabase
    .from('agency_history')
    .update({
      status:    'ended',
      year_end:  year,
      month_end: month,
    })
    .eq('brand_id', brand.id)
    .eq('status',   'active')

  if (new_scope) updateQuery.eq('scope', new_scope)
  await updateQuery

  // Cria novo registro ativo
  const { error } = await supabase.from('agency_history').insert({
    brand_id:    brand.id,
    agency:      new_agency,
    scope:       new_scope || 'Geral',
    year_start:  year,
    month_start: month,
    status:      'active',
    confidence:  0.9,
    source:      'current_agency_agent',
    notes:       evidence_summary || null,
  })

  if (error) {
    console.error(`[current-agency] Erro ao inserir agência para ${brand.name}: ${error.message}`)
    return false
  }
  return true
}

// ─── Envia para validation_queue ─────────────────────────────────────────────

async function queueForReview(brand, analysis) {
  const { error } = await supabase.from('validation_queue').insert({
    type:     'agency_change',
    brand_id: brand.id,
    payload:  {
      brand_name:        brand.name,
      current_agencies:  brand.active_agencies,
      proposed_agency:   analysis.new_agency,
      scope:             analysis.new_scope,
      confidence:        analysis.confidence,
      evidence:          analysis.evidence_summary,
      change_date:       analysis.change_date,
    },
    status:     'pending',
    created_at: new Date().toISOString(),
  })
  return !error
}

// ─── Agente principal ─────────────────────────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {number}   opts.limit        - máximo de marcas por execução (default 50)
 * @param {Function} opts.onProgress   - callback(i, total)
 */
async function runCurrentAgencyValidation({ limit = 50, onProgress } = {}) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY não configurada')
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada')
  }

  console.log('[current-agency] Iniciando validação de agências atuais')

  const brands = await loadBrandsWithActiveAgencies(limit)
  console.log(`[current-agency] ${brands.length} marcas com agências ativas`)

  const stats = {
    brands_analyzed:    0,
    no_change:          0,
    auto_updated:       0,
    queued_for_review:  0,
    errors:             0,
    changes: [],
  }

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i]
    onProgress?.(i + 1, brands.length)

    try {
      const [webResults, localArticles] = await Promise.all([
        searchAgencyNews(brand.name),
        loadLocalArticles(brand.name),
      ])

      const analysis = await analyzeAgencyStatus(brand, webResults, localArticles)

      if (!analysis) {
        stats.errors++
        continue
      }

      stats.brands_analyzed++

      if (!analysis.agency_changed) {
        stats.no_change++
        // Sem ruído no log para marcas sem mudança — só loga se havia evidência
        if (webResults.length > 0) {
          console.log(`[current-agency] ✓ ${brand.name}: sem mudança (${webResults.length} notícias analisadas)`)
        }
      } else if (analysis.confidence === 'alta') {
        // Auto-atualiza sem intervenção humana
        const updated = await applyAgencyChange(brand, analysis)
        if (updated) {
          stats.auto_updated++
          stats.changes.push({ brand: brand.name, new_agency: analysis.new_agency, confidence: 'alta' })
          console.log(`[current-agency] ✅ ${brand.name} → ${analysis.new_agency} (auto-atualizado)`)
        } else {
          stats.errors++
        }
      } else if (analysis.confidence === 'media') {
        // Envia para revisão humana
        const queued = await queueForReview(brand, analysis)
        if (queued) {
          stats.queued_for_review++
          stats.changes.push({ brand: brand.name, new_agency: analysis.new_agency, confidence: 'media' })
          console.log(`[current-agency] 🔍 ${brand.name} → ${analysis.new_agency} (na fila p/ revisão)`)
        }
      } else {
        // Baixa confiança: ignora
        stats.no_change++
        console.log(`[current-agency] ⚠ ${brand.name}: baixa confiança (${analysis.evidence_summary})`)
      }

      // Rate limit: Tavily + Claude ≈ 3 chamadas por marca
      await sleep(1200)
    } catch (e) {
      console.error(`[current-agency] Erro em "${brand.name}": ${e.message}`)
      stats.errors++
    }
  }

  console.log(`[current-agency] Concluído: ${stats.auto_updated} atualizados, ${stats.queued_for_review} na fila, ${stats.no_change} sem mudança, ${stats.errors} erros`)
  return stats
}

module.exports = { runCurrentAgencyValidation }
