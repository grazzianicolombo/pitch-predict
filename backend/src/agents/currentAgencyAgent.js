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

const DAYS_LOOKBACK         = 120
const DAYS_LOOKBACK_FALLBACK = 365  // para marcas sem notícias recentes
const SEARCH_DOMAINS        = [
  'meioemensagem.com.br',
  'propmark.com.br',
  'adnews.com.br',
  'portaldapropaganda.com.br',
  'brainstorm9.com.br',
  'valor.com.br',
  'exame.com',
  'forbes.com.br',
  'infomoney.com.br',
  'istoedinheiro.com.br',
  'mundodomarketing.com.br',
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

  const brandIds = Object.keys(byBrand)
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, segment, current_agency_validated_at')
    .in('id', brandIds)

  // Prioriza marcas nunca validadas ou validadas há mais tempo
  const sorted = (brands || []).sort((a, b) => {
    const dateA = a.current_agency_validated_at ? new Date(a.current_agency_validated_at) : new Date(0)
    const dateB = b.current_agency_validated_at ? new Date(b.current_agency_validated_at) : new Date(0)
    return dateA - dateB  // mais antigas primeiro
  })

  return sorted.slice(0, limit).map(b => ({
    ...b,
    active_agencies: byBrand[b.id] || [],
  }))
}

// ─── Busca notícias recentes de agência para a marca ──────────────────────────

async function searchAgencyNews(brandName) {
  const queries = [
    // Busca direta de relacionamento com agência
    `"${brandName}" agência publicidade criação mídia digital`,
    // Movimentações e trocas
    `"${brandName}" troca agência nova agência pitch concorrência contratou`,
    // Campanhas recentes (indicam agência atual)
    `"${brandName}" campanha lança nova campanha publicidade`,
    // Nomeações e executivos (indício de conta)
    `"${brandName}" anuncia nomeia VP marketing CMO diretor marketing`,
  ]

  const results = []
  for (const q of queries) {
    const found = await search(q, {
      maxResults:     6,
      days:           DAYS_LOOKBACK,
      includeDomains: SEARCH_DOMAINS,
    })
    results.push(...found)
  }

  // Se encontrou muito pouco, faz busca ampliada com lookback maior
  if (results.length < 3) {
    const fallback = await search(
      `"${brandName}" agência publicidade`,
      { maxResults: 8, days: DAYS_LOOKBACK_FALLBACK, includeDomains: SEARCH_DOMAINS }
    )
    results.push(...fallback)
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
  const since = new Date(Date.now() - DAYS_LOOKBACK_FALLBACK * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)

  const { data } = await supabase
    .from('articles')
    .select('title, excerpt, published_at, source_name, url')
    .or(`title.ilike.%${brandName}%,excerpt.ilike.%${brandName}%`)
    .gte('published_at', since)
    .not('extraction_status', 'eq', 'crawl_failed')
    .order('published_at', { ascending: false })
    .limit(20)

  return data || []
}

// ─── Normaliza nome de agência contra lista canônica ─────────────────────────
// Resolve aliases históricos (ex: "Leo Burnett Tailormade" → "Leo").
// Retorna null se nenhuma agência da lista corresponder.
function matchCanonicalAgency(raw, canonicals) {
  if (!raw || !canonicals.length) return null
  const rawLow = raw.toLowerCase().trim()
  const list = canonicals.map(n => ({ name: n, low: n.toLowerCase().trim() }))
  // 1. Match exato
  const exact = list.find(({ low }) => low === rawLow)
  if (exact) return exact.name
  // 2. Nome canônico é prefixo do nome bruto ("Leo" → "Leo Burnett Tailormade")
  const prefix = list.find(({ low }) => rawLow.startsWith(low + ' ') || rawLow.startsWith(low + ','))
  if (prefix) return prefix.name
  // 3. Nome bruto é prefixo do nome canônico
  const revPrefix = list.find(({ low }) => low.startsWith(rawLow + ' ') || low.startsWith(rawLow + ','))
  if (revPrefix) return revPrefix.name
  return null
}

// ─── Analisa evidências via Claude Haiku ──────────────────────────────────────

async function analyzeAgencyStatus(brand, webResults, localArticles, canonicalAgencies) {
  const activeAgenciesText = brand.active_agencies
    .map(a => `- ${a.agency} (escopo: ${a.scope}, desde: ${a.year_start}${a.month_start ? `/${String(a.month_start).padStart(2,'0')}` : ''})`)
    .join('\n')

  const webEvidenceText = webResults
    .map(r => `[${r.published_date || 'sem data'}] ${r.title}\n${(r.content || r.url || '').slice(0, 350)}`)
    .join('\n\n')

  const localEvidenceText = localArticles
    .map(a => `[${a.published_at?.slice(0,10) || ''}] ${a.source_name}: ${a.title}\n${(a.excerpt || '').slice(0, 200)}`)
    .join('\n\n')

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

  const canonicalsText = canonicalAgencies.length
    ? canonicalAgencies.map(n => `- ${n}`).join('\n')
    : '(lista não disponível)'

  const prompt = `Você é um analista especialista em movimentações de contas publicitárias no mercado brasileiro. Analise as evidências abaixo sobre a marca "${brand.name}" e determine se a agência registrada no sistema ainda é a atual.

DATA DE HOJE: ${currentMonth}

AGÊNCIAS REGISTRADAS COMO ATIVAS NO SISTEMA (podem estar desatualizadas):
${activeAgenciesText || '(nenhuma agência registrada — precisa identificar a atual)'}

LISTA OFICIAL DE AGÊNCIAS (2025) — use APENAS nomes desta lista:
${canonicalsText}

EVIDÊNCIAS DA WEB (notícias e artigos):
${webEvidenceText || '(nenhuma notícia encontrada)'}

ARTIGOS DO BANCO LOCAL:
${localEvidenceText || '(nenhum artigo local)'}

Responda APENAS com JSON válido:
{
  "agency_changed": true | false,
  "new_agency": "Nome EXATO da lista oficial" | null,
  "new_scope": "Criação" | "Mídia" | "Digital" | "PR" | "Geral" | null,
  "confidence": "alta" | "media" | "baixa",
  "evidence_summary": "1-2 frases descrevendo a evidência encontrada",
  "change_date": "YYYY-MM" | null
}

Regras de análise:
- "agency_changed": true se as evidências mostram que a agência atual é DIFERENTE da registrada no sistema, OR se o sistema não tem agência registrada mas as evidências apontam uma.
- Troca de agência pode ser identificada por: anúncio de novo contrato, campanha assinada por agência diferente, notícia de pitch vencido, executivo de marketing que mudou empresa (indica mudança de estratégia), reestruturação de marketing.
- "confidence": "alta" = agência nomeada diretamente no artigo como responsável pela conta/campanha. "media" = agência fortemente sugerida pelo contexto (ex: criou campanha recente, ganhou pitch). "baixa" = menção tangencial sem clareza.
- Se a agência registrada aparece confirmada nas notícias recentes → agency_changed: false, confidence: alta.
- Se não há evidência suficiente → agency_changed: false, confidence: baixa, evidence_summary explica a ausência.
- "new_agency" OBRIGATORIAMENTE deve ser um nome da LISTA OFICIAL acima. Se a agência identificada não estiver na lista, use null e defina confidence como "baixa".
- Ignore agências de mídia programática, produtoras e consultorias — foco em agências criativas/de comunicação.`

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
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
  let updateQuery = supabase
    .from('agency_history')
    .update({
      status:    'ended',
      year_end:  year,
      month_end: month,
    })
    .eq('brand_id', brand.id)
    .eq('status',   'active')

  if (new_scope) updateQuery = updateQuery.eq('scope', new_scope)
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

  // Carrega lista canônica de agências (menu Agências — lista 2025)
  const { data: agencyProfilesRows } = await supabase.from('agency_profiles').select('name')
  const canonicalAgencies = (agencyProfilesRows || []).map(a => a.name)
  console.log(`[current-agency] ${canonicalAgencies.length} agências canônicas carregadas`)

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

      const analysis = await analyzeAgencyStatus(brand, webResults, localArticles, canonicalAgencies)

      if (!analysis) {
        stats.errors++
        continue
      }

      // Normaliza new_agency contra a lista canônica — descarta se não bater com nenhuma agência da lista
      if (analysis.agency_changed && analysis.new_agency) {
        const canonical = matchCanonicalAgency(analysis.new_agency, canonicalAgencies)
        if (!canonical) {
          console.log(`[current-agency] ⚠ ${brand.name}: agência "${analysis.new_agency}" não encontrada na lista 2025 — ignorado`)
          analysis.agency_changed = false
        } else {
          analysis.new_agency = canonical  // usa nome canônico exato
        }
      }

      stats.brands_analyzed++

      // Registra timestamp de validação independente do resultado
      await supabase
        .from('brands')
        .update({ current_agency_validated_at: new Date().toISOString() })
        .eq('id', brand.id)

      if (!analysis.agency_changed) {
        stats.no_change++
        if (webResults.length > 0) {
          console.log(`[current-agency] ✓ ${brand.name}: agência confirmada (${webResults.length} evidências, confiança: ${analysis.confidence})`)
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
