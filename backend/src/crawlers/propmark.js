/**
 * Propmark Crawler
 *
 * Duas estratégias:
 *  1. RSS (/feed/) — artigos recentes com conteúdo completo (polling horário)
 *  2. Sitemap (sitemap-posts.xml) — backfill de 50K URLs (sob demanda)
 *
 * Ghost CMS — conteúdo server-rendered, sem anti-scraping.
 */
const https = require('https')
const http  = require('http')
const supabase = require('../lib/supabase')

const USER_AGENT = 'PitchPredict/1.0 (radar de mercado)'
const BASE       = 'https://propmark.com.br'
const RATE_MS    = 1000  // 1 req/seg para scraping de páginas

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetch(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href
        return resolve(fetch(next, maxRedirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** Extrai texto entre duas tags sem regex pesado */
function between(html, open, close) {
  const i = html.indexOf(open)
  if (i === -1) return ''
  const start = i + open.length
  const end = html.indexOf(close, start)
  return end === -1 ? '' : html.slice(start, end)
}

/** Decode entidades HTML básicas */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
    .replace(/&#8220;/g, '\u201C').replace(/&#8221;/g, '\u201D')
    .replace(/&#8216;/g, '\u2018').replace(/&#8217;/g, '\u2019')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
}

/** Strip tags HTML */
function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').trim()
}

// ── RSS Parser ───────────────────────────────────────────────────────────────

function parseRSSItems(xml) {
  const items = []
  const parts = xml.split('<item>')
  for (let i = 1; i < parts.length; i++) {
    const item = parts[i].split('</item>')[0]
    const title   = decodeEntities(between(item, '<title>', '</title>'))
    const link    = decodeEntities(between(item, '<link>', '</link>').trim())
    const pubDate = between(item, '<pubDate>', '</pubDate>')
    const author  = decodeEntities(between(item, '<dc:creator>', '</dc:creator>'))
    const excerpt = decodeEntities(stripTags(between(item, '<description>', '</description>')))

    // content:encoded tem o texto completo
    const content = decodeEntities(between(item, '<content:encoded>', '</content:encoded>'))
    const contentText = stripTags(content)

    // Categorias/tags
    const tags = []
    let tagSearch = item
    while (tagSearch.includes('<category>')) {
      const tag = decodeEntities(between(tagSearch, '<category>', '</category>'))
      if (tag) tags.push(tag)
      tagSearch = tagSearch.slice(tagSearch.indexOf('</category>') + 11)
    }

    // Slug extraído da URL
    const slug = link.replace(BASE, '').replace(/\//g, '')

    if (link) {
      items.push({ title, url: link, published_at: new Date(pubDate).toISOString(),
        author, excerpt, content: contentText, tags, slug, source_name: 'propmark' })
    }
  }
  return items
}

/**
 * Busca artigos via RSS feed (últimos ~15 artigos)
 * Retorna quantidade de artigos novos inseridos
 */
async function crawlRSS() {
  console.log('[propmark] Buscando RSS feed...')
  const xml = await fetch(`${BASE}/feed/`)
  const items = parseRSSItems(xml)
  console.log(`[propmark] RSS: ${items.length} artigos encontrados`)

  let inserted = 0
  for (const item of items) {
    const { error } = await supabase.from('articles').upsert(
      { ...item, crawled_at: new Date().toISOString() },
      { onConflict: 'url', ignoreDuplicates: true }
    )
    if (!error) inserted++
  }
  console.log(`[propmark] RSS: ${inserted} novos artigos inseridos`)
  return inserted
}

// ── Sitemap Parser ───────────────────────────────────────────────────────────

function parseSitemapURLs(xml) {
  const urls = []
  const parts = xml.split('<url>')
  for (let i = 1; i < parts.length; i++) {
    const entry = parts[i].split('</url>')[0]
    const loc     = between(entry, '<loc>', '</loc>')
    const lastmod = between(entry, '<lastmod>', '</lastmod>')
    if (loc && !loc.includes('/tag/') && !loc.includes('/author/')) {
      urls.push({ url: loc, lastmod })
    }
  }
  return urls
}

/** Scrape uma página de artigo individual */
async function scrapeArticlePage(url) {
  const html = await fetch(url)

  // Title
  const title = decodeEntities(stripTags(between(html, '<h1 class="title">', '</h1>')))

  // Author
  let author = ''
  const authorBlock = between(html, '<a class="author"', '</a>')
  if (authorBlock) {
    author = stripTags(authorBlock).replace(/^Por\s+/i, '').trim()
  }

  // Date (from meta tag — most reliable)
  let published_at = null
  const metaDate = between(html, 'property="article:published_time" content="', '"')
  if (metaDate) published_at = metaDate

  // Content
  const contentHtml = between(html, '<div class="post-content', '</article>')
  // Começa após o primeiro >
  const contentStart = contentHtml.indexOf('>')
  const contentBody = contentStart >= 0 ? contentHtml.slice(contentStart + 1) : contentHtml
  const content = stripTags(contentBody).replace(/\s+/g, ' ').trim()

  // Excerpt (primeiro blockquote ou primeiros 300 chars)
  const blockquote = between(contentBody, '<blockquote>', '</blockquote>')
  const excerpt = blockquote ? stripTags(blockquote).trim() : content.slice(0, 300)

  // Tags
  const tags = []
  const tagWrap = between(html, '<div class="tag-wrap">', '</div>')
  if (tagWrap) {
    let search = tagWrap
    while (search.includes('href="/tag/')) {
      const idx = search.indexOf('href="/tag/')
      const afterHref = search.slice(idx)
      const tagText = stripTags(between(afterHref, '>', '</a>'))
      if (tagText) tags.push(tagText.trim())
      search = afterHref.slice(afterHref.indexOf('</a>') + 4)
    }
  }

  // Slug
  const slug = url.replace(BASE, '').replace(/\//g, '')

  return { title, url, author, published_at, content, excerpt, tags, slug, source_name: 'propmark' }
}

// ── Tag page scraper (listing) ───────────────────────────────────────────────

function parseListingPage(html) {
  const items = []
  const cards = html.split('class="post-item')
  for (let i = 1; i < cards.length; i++) {
    const card = cards[i].split('</div>').slice(0, 10).join('</div>')

    // Title + URL
    const titleBlock = between(card, '<h2 class="title">', '</h2>')
    const href = between(titleBlock, 'href="', '"')
    const title = stripTags(titleBlock)

    // Date
    const datetime = between(card, 'datetime="', '"')

    // Excerpt
    const excerpt = stripTags(between(card, '<div class="excerpt">', '</div>'))

    if (href && title) {
      items.push({
        url: href.startsWith('http') ? href : BASE + href,
        title: decodeEntities(title),
        published_at: datetime || null,
        excerpt: decodeEntities(excerpt),
      })
    }
  }
  return items
}

/**
 * Backfill via sitemap — scrape artigos que ainda não temos
 * @param {Object} opts
 * @param {string} opts.since - ISO date, só artigos após esta data
 * @param {number} opts.limit - máximo de artigos a processar
 * @param {string[]} opts.keywords - filtrar URLs que contenham estas palavras
 */
async function crawlSitemap({ since, limit = 500, keywords, onProgress } = {}) {
  console.log('[propmark] Baixando sitemap...')
  const xml = await fetch(`${BASE}/sitemap-posts.xml`)
  let urls = parseSitemapURLs(xml)
  console.log(`[propmark] Sitemap: ${urls.length} URLs encontradas`)

  // Filtro por data
  if (since) {
    urls = urls.filter(u => u.lastmod >= since)
    console.log(`[propmark] Filtro since=${since}: ${urls.length} URLs`)
  }

  // Filtro por keywords na URL
  if (keywords?.length) {
    const kw = keywords.map(k => k.toLowerCase())
    urls = urls.filter(u => kw.some(k => u.url.toLowerCase().includes(k)))
    console.log(`[propmark] Filtro keywords: ${urls.length} URLs`)
  }

  // Verificar quais já temos COM content — artigos sem content precisam ser re-scraped
  const existingUrls = new Set()
  for (let i = 0; i < urls.length; i += 500) {
    const batch = urls.slice(i, i + 500).map(u => u.url)
    const { data } = await supabase.from('articles').select('url')
      .in('url', batch)
      .not('content', 'is', null)
      .neq('content', '')
    if (data) data.forEach(d => existingUrls.add(d.url))
  }

  const toScrape = urls.filter(u => !existingUrls.has(u.url)).slice(0, limit)
  console.log(`[propmark] ${existingUrls.size} já existentes, ${toScrape.length} para scraper`)
  onProgress?.(0, toScrape.length)

  let inserted = 0, errors = 0
  for (let i = 0; i < toScrape.length; i++) {
    try {
      const article = await scrapeArticlePage(toScrape[i].url)
      const { error } = await supabase.from('articles').upsert(
        { ...article, crawled_at: new Date().toISOString() },
        { onConflict: 'url', ignoreDuplicates: false }
      )
      if (!error) inserted++
      else errors++
    } catch (e) {
      errors++
      console.error(`[propmark] Erro em ${toScrape[i].url}: ${e.message}`)
    }
    onProgress?.(i + 1, toScrape.length, inserted, errors)
    if ((i + 1) % 50 === 0) {
      console.log(`[propmark] Progresso: ${i + 1}/${toScrape.length} (${inserted} inseridos, ${errors} erros)`)
    }
    await sleep(RATE_MS)
  }

  console.log(`[propmark] Sitemap concluído: ${inserted} inseridos, ${errors} erros`)
  return { total: toScrape.length, inserted, errors, skipped: existingUrls.size }
}

/**
 * Crawl por tag pages (listing) — para índice rápido da tag "mercado"
 * @param {Object} opts
 * @param {number} opts.maxPages - máximo de páginas a percorrer
 * @param {boolean} opts.fullContent - se true, scrape cada artigo para conteúdo completo
 */
async function crawlTagPages({ maxPages = 10, fullContent = false } = {}) {
  console.log(`[propmark] Crawling tag/mercado (até ${maxPages} páginas)...`)
  let inserted = 0, page = 1

  while (page <= maxPages) {
    const url = page === 1
      ? `${BASE}/tag/mercado/`
      : `${BASE}/tag/mercado/page/${page}/`

    try {
      const html = await fetch(url)
      const items = parseListingPage(html)
      if (items.length === 0) break

      for (const item of items) {
        if (fullContent) {
          try {
            const full = await scrapeArticlePage(item.url)
            const { error } = await supabase.from('articles').upsert(
              { ...full, crawled_at: new Date().toISOString() },
              { onConflict: 'url', ignoreDuplicates: true }
            )
            if (!error) inserted++
            await sleep(RATE_MS)
          } catch (e) {
            console.error(`[propmark] Erro scraping ${item.url}: ${e.message}`)
          }
        } else {
          const { error } = await supabase.from('articles').upsert(
            { ...item, tags: ['mercado'], source_name: 'propmark',
              slug: item.url.replace(BASE, '').replace(/\//g, ''),
              crawled_at: new Date().toISOString() },
            { onConflict: 'url', ignoreDuplicates: true }
          )
          if (!error) inserted++
        }
      }

      console.log(`[propmark] Página ${page}: ${items.length} artigos`)
      page++
      await sleep(RATE_MS)
    } catch (e) {
      console.error(`[propmark] Erro na página ${page}: ${e.message}`)
      break
    }
  }

  console.log(`[propmark] Tag crawl: ${inserted} artigos inseridos em ${page - 1} páginas`)
  return { pages: page - 1, inserted }
}

// ── Exporta ──────────────────────────────────────────────────────────────────

module.exports = { crawlRSS, crawlSitemap, crawlTagPages, scrapeArticlePage }
