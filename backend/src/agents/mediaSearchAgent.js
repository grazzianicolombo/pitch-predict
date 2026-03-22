/**
 * mediaSearchAgent.js — Agente 4
 *
 * Crawla fontes de mídia de negócios (Exame, Valor Econômico, etc.)
 * e salva APENAS artigos que mencionam marcas ou agências do banco.
 *
 * Fluxo:
 *  1. Carrega lista de marcas + agências do banco
 *  2. Para cada fonte: crawla RSS → filtra por keywords → salva artigos relevantes
 *  3. Dispara extração nos artigos recém-salvos
 */

const supabase  = require('../lib/supabase')
const { crawlSource, normalize, sleep, SOURCE_CONFIGS } = require('../crawlers/rssMediaCrawler')
const { runExtraction } = require('./articleExtractor')

// ─── Carrega keywords do banco ────────────────────────────────────────────────

async function loadKeywords() {
  const [{ data: brands }, { data: agencies }] = await Promise.all([
    supabase.from('brands').select('name'),
    supabase.from('agency_profiles').select('name'),
  ])

  const keywords = new Set()

  for (const b of (brands || [])) {
    const norm = normalize(b.name)
    if (norm.length >= 3) keywords.add(norm)
    // Adiciona palavras individuais com 4+ chars para marcas compostas
    norm.split(' ').filter(w => w.length >= 4).forEach(w => keywords.add(w))
  }

  for (const a of (agencies || [])) {
    const norm = normalize(a.name)
    if (norm.length >= 3) keywords.add(norm)
    norm.split(' ').filter(w => w.length >= 4).forEach(w => keywords.add(w))
  }

  return [...keywords]
}

// ─── Carrega URLs já no banco para dedup ─────────────────────────────────────

async function loadExistingUrls(sourceNames) {
  const existing = new Set()
  for (const src of sourceNames) {
    // Busca em lotes de 1000 (pode ter muitos artigos no futuro)
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('articles')
        .select('url')
        .eq('source_name', src)
        .range(from, from + 999)
      if (!data?.length) break
      data.forEach(r => existing.add(r.url))
      if (data.length < 1000) break
      from += 1000
    }
  }
  return existing
}

// ─── Salva artigos no banco ───────────────────────────────────────────────────

async function saveArticles(articles) {
  let saved = 0
  for (const article of articles) {
    // Remove campos internos que não existem na tabela
    const { matched_keyword, ...row } = article
    const { error } = await supabase
      .from('articles')
      .upsert(
        { ...row, crawled_at: new Date().toISOString() },
        { onConflict: 'url', ignoreDuplicates: false }
      )
    if (!error) saved++
    else console.error(`[media-agent] Erro ao salvar ${article.url}: ${error.message}`)
  }
  return saved
}

// ─── Agente principal ─────────────────────────────────────────────────────────

/**
 * Executa o agente de busca em fontes de mídia.
 *
 * @param {Object} opts
 * @param {string[]} opts.sources     - fontes a crawlar (default: todas configuradas)
 * @param {boolean}  opts.extract     - rodar extração após crawl (default: true)
 * @param {Function} opts.onProgress  - callback(fase, detalhes)
 */
async function runMediaSearch({ sources, extract = true, onProgress } = {}) {
  const sourceNames = sources || Object.keys(SOURCE_CONFIGS)
  console.log(`[media-agent] Iniciando para fontes: ${sourceNames.join(', ')}`)

  // 1. Carrega keywords
  onProgress?.('loading_keywords', {})
  const keywords = await loadKeywords()
  console.log(`[media-agent] ${keywords.length} keywords (marcas + agências)`)

  // 2. URLs existentes para dedup
  const existingUrls = await loadExistingUrls(sourceNames)
  console.log(`[media-agent] ${existingUrls.size} URLs já no banco`)

  const totals = {
    sources_crawled: 0,
    articles_found: 0,
    articles_relevant: 0,
    articles_saved: 0,
    extracted: 0,
    skipped: 0,
    errors: 0,
    by_source: {},
  }

  // 3. Crawla cada fonte
  for (const src of sourceNames) {
    onProgress?.('crawling', { source: src })
    try {
      const relevant = await crawlSource(src, keywords, existingUrls)
      const saved = await saveArticles(relevant)

      totals.articles_relevant += relevant.length
      totals.articles_saved    += saved
      totals.sources_crawled++
      totals.by_source[src] = { relevant: relevant.length, saved }

      console.log(`[media-agent] ${src}: ${relevant.length} relevantes, ${saved} salvos`)
    } catch (e) {
      console.error(`[media-agent] Erro em ${src}: ${e.message}`)
      totals.by_source[src] = { error: e.message }
      totals.errors++
    }
  }

  // 4. Extração dos artigos recém-salvos
  if (extract && totals.articles_saved > 0) {
    onProgress?.('extracting', { count: totals.articles_saved })
    console.log(`[media-agent] Iniciando extração de ${totals.articles_saved} artigos salvos`)

    for (const src of sourceNames) {
      if (totals.by_source[src]?.saved > 0) {
        try {
          const result = await runExtraction({
            source_name: src,
            limit: totals.by_source[src].saved + 10,
          })
          totals.extracted += result.processed
          totals.skipped   += result.skipped
          totals.errors    += result.errors
        } catch (e) {
          console.error(`[media-agent] Erro na extração de ${src}: ${e.message}`)
        }
      }
    }
  }

  console.log('[media-agent] Concluído:', JSON.stringify(totals))
  return totals
}

module.exports = { runMediaSearch, loadKeywords, SOURCE_CONFIGS }
