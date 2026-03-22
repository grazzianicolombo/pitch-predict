/**
 * rssMediaCrawler.js
 *
 * Crawler RSS para fontes de mídia de negócios (Exame, Valor Econômico, etc.)
 * Diferença do Propmark: só salva artigos que mencionam marcas ou agências
 * conhecidas na base de dados.
 *
 * Cada fonte tem uma config com: URL do RSS e scraper de conteúdo (opcional).
 */
const https = require('https')
const http  = require('http')

const USER_AGENT = 'PitchPredict/1.0 (radar de mercado)'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href
        return resolve(fetchUrl(next, maxRedirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function between(s, open, close) {
  const i = s.indexOf(open)
  if (i === -1) return ''
  const start = i + open.length
  const end = s.indexOf(close, start)
  return end === -1 ? '' : s.slice(start, end)
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, '\u2018').replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201C').replace(/&#8221;/g, '\u201D')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
}

function stripTags(s) { return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }

// ─── Configurações por fonte ───────────────────────────────────────────────────

const SOURCE_CONFIGS = {
  exame: {
    name: 'exame',
    label: 'Exame',
    rssUrl: 'https://exame.com/feed/',
    hasFullContent: true,   // content:encoded no RSS
    rateMs: 1500,
  },
  valor: {
    name: 'valor',
    label: 'Valor Econômico',
    rssUrl: 'https://valor.globo.com/rss/valor',
    hasFullContent: false,  // apenas título + subtitle + excerpt truncado
    rateMs: 1500,
  },
}

// ─── Parser RSS genérico ──────────────────────────────────────────────────────

function parseRSS(xml, config) {
  const items = []
  const parts = xml.split('<item>')
  for (let i = 1; i < parts.length; i++) {
    const raw = parts[i].split('</item>')[0]

    const title   = decodeEntities(stripTags(between(raw, '<title>', '</title>')))
    const link    = decodeEntities(between(raw, '<link>', '</link>').trim())
      || decodeEntities(between(raw, '<guid isPermaLink="true">', '</guid>').trim())
      || decodeEntities(between(raw, '<guid>', '</guid>').trim())
    const pubDate = between(raw, '<pubDate>', '</pubDate>')

    // Excerpt: atom:subtitle > description
    const subtitle  = decodeEntities(stripTags(between(raw, '<atom:subtitle>', '</atom:subtitle>')))
    const descRaw   = stripTags(between(raw, '<description>', '</description>'))
    const excerpt   = subtitle || decodeEntities(descRaw).slice(0, 500)

    // Conteúdo completo (Exame)
    let content = ''
    if (config.hasFullContent) {
      const encoded = between(raw, '<content:encoded>', '</content:encoded>')
      content = stripTags(decodeEntities(encoded)).replace(/\s+/g, ' ').trim()
    }

    // Categorias
    const tags = []
    let search = raw
    while (search.includes('<category>')) {
      const tag = decodeEntities(between(search, '<category>', '</category>'))
      if (tag) tags.push(tag)
      search = search.slice(search.indexOf('</category>') + 11)
    }

    if (link && title) {
      items.push({
        title,
        url: link,
        published_at: pubDate ? new Date(pubDate).toISOString() : null,
        excerpt:  excerpt  || null,
        content:  content  || null,
        tags,
        slug:        link.replace(/^https?:\/\/[^/]+/, '').replace(/\//g, '-').replace(/^-/, ''),
        source_name: config.name,
      })
    }
  }
  return items
}

// ─── Keyword matching ─────────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Verifica se o texto menciona alguma keyword.
 * Usa word-boundary simples (espaço ou início/fim de string).
 */
function mentionsKeyword(text, keywords) {
  const norm = normalize(text)
  for (const kw of keywords) {
    if (kw.length < 3) continue
    if (norm.includes(kw)) return kw
  }
  return null
}

// ─── Crawl de uma fonte ───────────────────────────────────────────────────────

/**
 * Crawla o RSS de uma fonte e retorna apenas artigos que mencionam
 * alguma das keywords (marcas ou agências).
 *
 * @param {string} sourceName - 'exame' | 'valor' | ...
 * @param {string[]} keywords - lista de nomes normalizados (marcas + agências)
 * @param {string[]} existingUrls - URLs já no banco (para dedup)
 * @returns {Array} artigos relevantes com todos os campos
 */
async function crawlSource(sourceName, keywords, existingUrls = new Set()) {
  const config = SOURCE_CONFIGS[sourceName]
  if (!config) throw new Error(`Fonte desconhecida: ${sourceName}`)

  console.log(`[rss:${sourceName}] Buscando RSS: ${config.rssUrl}`)
  const xml = await fetchUrl(config.rssUrl)
  const items = parseRSS(xml, config)
  console.log(`[rss:${sourceName}] ${items.length} artigos no feed`)

  const relevant = []
  for (const item of items) {
    // Dedup
    if (existingUrls.has(item.url)) continue

    // Filtra por keyword
    const searchText = `${item.title} ${item.excerpt || ''}`
    const matched = mentionsKeyword(searchText, keywords)
    if (!matched) continue

    item.matched_keyword = matched
    relevant.push(item)
  }

  console.log(`[rss:${sourceName}] ${relevant.length} relevantes (mencionam marca/agência)`)
  return relevant
}

// ─── Exporta ──────────────────────────────────────────────────────────────────

module.exports = { crawlSource, SOURCE_CONFIGS, normalize, sleep }
