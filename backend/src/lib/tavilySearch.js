/**
 * tavilySearch.js
 *
 * Wrapper centralizado do Tavily para o Pitch Predict.
 * Usado sempre que precisamos buscar informações na web sobre:
 *  - Executivos de marketing (CMO, VP, Diretor)
 *  - Pitchs e mudanças de agência
 *  - Resultados financeiros e sinais de negócio
 *  - Notícias recentes de marcas
 *
 * Fontes priorizadas: Valor Econômico, Exame, Forbes BR, Globo,
 * Meio & Mensagem, Propmark, UOL, InfoMoney
 */

const { tavily } = require('@tavily/core')

const client = tavily({ apiKey: process.env.TAVILY_API_KEY })

// Domínios com alta relevância para marketing/negócios no Brasil
const PRIORITY_DOMAINS = [
  'meioemensagem.com.br',
  'propmark.com.br',
  'valor.com.br',
  'valoreconomico.com.br',
  'exame.com',
  'forbes.com.br',
  'infomoney.com.br',
  'uol.com.br',
  'folha.uol.com.br',
  'estadao.com.br',
  'globo.com',
  'g1.globo.com',
  'economia.uol.com.br',
  'canaltech.com.br',
  'startups.com.br',
  'istoedinheiro.com.br',
  'anuncie.globo.com',
]

/**
 * Busca genérica — base de todas as funções específicas
 */
async function search(query, opts = {}) {
  const {
    maxResults    = 5,
    searchDepth   = 'basic',       // 'basic' | 'advanced' (advanced custa mais)
    includeDomains = [],
    excludeDomains = [],
    days          = 365,           // lookback em dias (1 = último dia, 365 = último ano)
    includeAnswer = false,
  } = opts

  try {
    const result = await client.search(query, {
      maxResults,
      searchDepth,
      includeDomains: includeDomains.length ? includeDomains : undefined,
      excludeDomains: excludeDomains.length ? excludeDomains : undefined,
      days,
      includeAnswer,
    })
    return result.results || []
  } catch (e) {
    console.error(`[tavily] Erro na busca "${query}": ${e.message}`)
    return []
  }
}

// ─── Buscas especializadas ────────────────────────────────────────────────────

/**
 * Busca executivos de marketing de uma marca
 * Ex: CMO, VP Marketing, Diretor de Marketing, Head de Growth
 */
async function searchExecutives(brandName, opts = {}) {
  const queries = [
    `"${brandName}" CMO "diretor de marketing" OR "VP marketing" OR "head de marketing" 2024 2025`,
    `"${brandName}" executivo marketing nomeação contratação`,
  ]

  const results = []
  for (const q of queries) {
    const r = await search(q, {
      maxResults: 5,
      days: opts.days || 730, // 2 anos
      includeDomains: opts.includeDomains || PRIORITY_DOMAINS,
    })
    results.push(...r)
  }

  // Deduplica por URL
  const seen = new Set()
  return results.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

/**
 * Busca sinais de pitch / mudança de agência para uma marca
 */
async function searchPitchSignals(brandName, opts = {}) {
  const queries = [
    `"${brandName}" agência publicidade pitch concorrência contratação 2024 2025`,
    `"${brandName}" troca agência nova agência criação mídia`,
  ]

  const results = []
  for (const q of queries) {
    const r = await search(q, {
      maxResults: 5,
      days: opts.days || 365,
      includeDomains: opts.includeDomains || PRIORITY_DOMAINS,
    })
    results.push(...r)
  }

  const seen = new Set()
  return results.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

/**
 * Busca sinais financeiros de uma marca (resultado, corte de custos, expansão)
 */
async function searchFinancialSignals(brandName, opts = {}) {
  const queries = [
    `"${brandName}" resultado financeiro lucro prejuízo receita 2024 2025`,
    `"${brandName}" corte custos redução investimento reestruturação`,
    `"${brandName}" expansão crescimento aquisição fusão IPO`,
  ]

  const results = []
  for (const q of queries) {
    const r = await search(q, {
      maxResults: 4,
      days: opts.days || 365,
      includeDomains: ['valor.com.br', 'valoreconomico.com.br', 'exame.com',
                       'infomoney.com.br', 'istoedinheiro.com.br', 'forbes.com.br'],
    })
    results.push(...r)
  }

  const seen = new Set()
  return results.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

/**
 * Busca notícias gerais recentes de uma marca (últimos N dias)
 */
async function searchBrandNews(brandName, opts = {}) {
  return search(`"${brandName}" marketing publicidade negócios`, {
    maxResults: opts.maxResults || 8,
    days: opts.days || 90,
    includeDomains: PRIORITY_DOMAINS,
  })
}

/**
 * Busca informações sobre uma agência (expansão, perda de clientes, prêmios)
 */
async function searchAgencySignals(agencyName, opts = {}) {
  const queries = [
    `"${agencyName}" cliente conta novos negócios 2024 2025`,
    `"${agencyName}" prêmio cannes effie clio reconhecimento`,
  ]

  const results = []
  for (const q of queries) {
    const r = await search(q, {
      maxResults: 4,
      days: opts.days || 365,
      includeDomains: PRIORITY_DOMAINS,
    })
    results.push(...r)
  }

  const seen = new Set()
  return results.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

/**
 * Busca um executivo específico pelo nome + empresa
 */
async function searchPerson(name, company, opts = {}) {
  return search(`"${name}" "${company}" marketing linkedin cargo`, {
    maxResults: opts.maxResults || 5,
    days: opts.days || 730,
  })
}

module.exports = {
  search,
  searchExecutives,
  searchPitchSignals,
  searchFinancialSignals,
  searchBrandNews,
  searchAgencySignals,
  searchPerson,
  PRIORITY_DOMAINS,
}
