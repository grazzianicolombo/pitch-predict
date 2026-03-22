/**
 * corporateSearchAgent.js — Agente 8
 *
 * Busca notícias corporativas de marcas, agências e executivos em fontes
 * especializadas usando abordagem search-first:
 *
 *  1. Parte de entidades conhecidas (marcas, agências, executivos)
 *  2. Busca Tavily por entidade (últimos 30 dias) em fontes de marketing/negócios
 *  3. Salva URLs encontradas na tabela articles (dedup por URL)
 *  4. Dispara extração nos artigos novos
 *
 * Diferença do mediaSearchAgent (RSS polling):
 *  - Não fica limitado a feeds RSS — encontra notícias em qualquer página indexada
 *  - Parte da entidade (marca/agência/executivo) para garantir relevância
 *  - Cobre fontes que não têm RSS (Brainstorm9, PortaldaPropaganda, etc.)
 */

const supabase = require('../lib/supabase')
const { search }  = require('../lib/tavilySearch')
const { runExtraction } = require('./articleExtractor')

// Fontes especializadas em marketing/negócios no Brasil
const CORPORATE_DOMAINS = [
  'meioemensagem.com.br',
  'propmark.com.br',
  'adnews.com.br',
  'valor.com.br',
  'valoreconomico.com.br',
  'exame.com',
  'forbes.com.br',
  'istoedinheiro.com.br',
  'infomoney.com.br',
  'brainstorm9.com.br',
  'b9.com.br',
  'portaldapropaganda.com.br',
  'mundodomarketing.com.br',
  'negociosempresariais.com.br',
  'startups.com.br',
]

const DAYS_LOOKBACK = 30  // foco nos últimos 30 dias

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Carrega entidades do banco ────────────────────────────────────────────────

async function loadEntities({ limitBrands = 40, limitAgencies = 20, limitLeaders = 20 } = {}) {
  const [brandsRes, agenciesRes, leadersRes] = await Promise.all([
    supabase
      .from('brands')
      .select('id, name')
      .order('name')
      .limit(limitBrands),

    supabase
      .from('agency_profiles')
      .select('id, name')
      .eq('status', 'ativa')
      .order('name')
      .limit(limitAgencies),

    supabase
      .from('marketing_leaders')
      .select('id, name, brand_id')
      .eq('is_current', true)
      .order('name')
      .limit(limitLeaders),
  ])

  return {
    brands:    (brandsRes.data    || []).map(b => ({ ...b, entityType: 'brand' })),
    agencies:  (agenciesRes.data  || []).map(a => ({ ...a, entityType: 'agency' })),
    leaders:   (leadersRes.data   || []).map(l => ({ ...l, entityType: 'executive' })),
  }
}

// ─── Queries de busca por tipo de entidade ─────────────────────────────────────

function buildQueries(entityName, entityType) {
  if (entityType === 'brand') {
    return [
      `"${entityName}" agência publicidade conta marketing`,
      `"${entityName}" CMO diretor marketing executivo`,
    ]
  }
  if (entityType === 'agency') {
    return [
      `"${entityName}" novo cliente conta publicidade conquistou`,
      `"${entityName}" agência resultado prêmio campanha`,
    ]
  }
  if (entityType === 'executive') {
    return [
      `"${entityName}" marketing cargo nomeação contratação demissão`,
    ]
  }
  return [`"${entityName}" marketing publicidade negócios`]
}

// ─── Identifica source_name a partir da URL ────────────────────────────────────

function sourceNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const MAP = {
      'meioemensagem.com.br': 'meioemensagem',
      'propmark.com.br':      'propmark',
      'adnews.com.br':        'adnews',
      'valor.com.br':         'valor',
      'valoreconomico.com.br':'valor',
      'exame.com':            'exame',
      'forbes.com.br':        'forbes',
      'infomoney.com.br':     'infomoney',
      'istoedinheiro.com.br': 'istoedinheiro',
      'brainstorm9.com.br':   'b9',
      'b9.com.br':            'b9',
      'portaldapropaganda.com.br': 'portaldapropaganda',
      'mundodomarketing.com.br':   'mundodomarketing',
      'startups.com.br':      'startups',
    }
    for (const [domain, name] of Object.entries(MAP)) {
      if (host.includes(domain)) return name
    }
    return 'corporate_news'
  } catch {
    return 'corporate_news'
  }
}

// ─── Busca notícias de uma entidade via Tavily ─────────────────────────────────

async function searchEntityNews(entityName, entityType) {
  const queries = buildQueries(entityName, entityType)
  const results = []

  for (const q of queries) {
    const found = await search(q, {
      maxResults:     5,
      days:           DAYS_LOOKBACK,
      includeDomains: CORPORATE_DOMAINS,
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

// ─── Salva artigos descobertos no banco ───────────────────────────────────────

async function saveArticles(articles) {
  let saved = 0
  for (const a of articles) {
    const slug = (a.url || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\//g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200)

    const { error } = await supabase.from('articles').upsert(
      {
        title:       a.title         || null,
        url:         a.url,
        excerpt:     (a.content || '').slice(0, 500) || null,
        content:     a.content       || null,
        published_at: a.published_date
          ? new Date(a.published_date).toISOString()
          : null,
        source_name: sourceNameFromUrl(a.url),
        slug,
        crawled_at:  new Date().toISOString(),
      },
      { onConflict: 'url', ignoreDuplicates: true }
    )
    if (!error) saved++
  }
  return saved
}

// ─── Agente principal ─────────────────────────────────────────────────────────

/**
 * @param {Object}   opts
 * @param {number}   opts.limitBrands     - marcas por execução (default 40)
 * @param {number}   opts.limitAgencies   - agências por execução (default 20)
 * @param {number}   opts.limitLeaders    - executivos por execução (default 20)
 * @param {boolean}  opts.extract         - rodar extração após busca (default true)
 * @param {Function} opts.onProgress      - callback(i, total)
 */
async function runCorporateSearch({
  limitBrands   = 40,
  limitAgencies = 20,
  limitLeaders  = 20,
  extract       = true,
  onProgress,
} = {}) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY não configurada')
  }

  console.log('[corporate-search] Iniciando busca corporativa por entidades')

  const { brands, agencies, leaders } = await loadEntities({
    limitBrands, limitAgencies, limitLeaders,
  })

  const entities = [...brands, ...agencies, ...leaders]
  console.log(`[corporate-search] ${entities.length} entidades (${brands.length} marcas, ${agencies.length} agências, ${leaders.length} executivos)`)

  const stats = {
    entities_searched: 0,
    articles_found:    0,
    articles_saved:    0,
    extracted:         0,
    errors:            0,
    by_type:           { brand: 0, agency: 0, executive: 0 },
  }

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    onProgress?.(i + 1, entities.length)

    try {
      const results = await searchEntityNews(entity.name, entity.entityType)

      if (results.length > 0) {
        const saved = await saveArticles(results)
        stats.articles_found += results.length
        stats.articles_saved += saved
        if (saved > 0) {
          console.log(`[corporate-search] ${entity.entityType} "${entity.name}": ${results.length} encontrados, ${saved} salvos`)
        }
      }

      stats.entities_searched++
      stats.by_type[entity.entityType] = (stats.by_type[entity.entityType] || 0) + 1

      // Rate limit: ~1-2 buscas por entidade, delay entre entidades
      await sleep(600)
    } catch (e) {
      console.error(`[corporate-search] Erro em "${entity.name}": ${e.message}`)
      stats.errors++
    }
  }

  // Extração dos artigos recém-salvos
  if (extract && stats.articles_saved > 0) {
    console.log(`[corporate-search] Disparando extração de ${stats.articles_saved} artigos novos`)
    try {
      const result = await runExtraction({ limit: stats.articles_saved + 20 })
      stats.extracted = result.processed
    } catch (e) {
      console.error(`[corporate-search] Erro na extração: ${e.message}`)
    }
  }

  console.log('[corporate-search] Concluído:', JSON.stringify(stats))
  return stats
}

module.exports = { runCorporateSearch }
