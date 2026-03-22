/**
 * articleExtractor.js
 *
 * Agente que processa artigos já capturados (Propmark, M&M web, etc.) e extrai:
 *  - Relações marca ↔ agência (scope, período, tipo de pitch)
 *  - Executivos de marketing, martech, performance, growth, commerce
 *  - Timelines completas com datas inferidas do artigo
 *
 * Enriquece executivos com PeopleDataLabs (PDL).
 * NÃO interfere com o crawl — processa apenas o que já está em `articles`.
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Concorrência ────────────────────────────────────────────────────────────
// Tier2+ Anthropic (com créditos): limite de 400k tokens/min em claude-haiku-4-5
// Cada edição usa ~2.500 tokens de input → 10 simultâneas = ~25k tokens/chunk
// Com delay de 200ms entre chunks → máximo ~300k tokens/min (margem segura)
const CONCURRENCY   = 10
const CHUNK_DELAY_MS = 200  // ms de pausa entre cada chunk (controla token rate)

// Mapas de promessas pendentes — evita race condition ao criar brand/agency nova
// quando múltiplas coroutines processam ao mesmo tempo
const _pendingBrands   = new Map()
const _pendingAgencies = new Map()

// ─── Títulos de executivos relevantes ──────────────────────────────────────
const EXEC_TITLES = [
  'CMO', 'Chief Marketing Officer',
  'VP Marketing', 'VP de Marketing', 'Vice-Presidente de Marketing',
  'Diretor de Marketing', 'Diretora de Marketing',
  'Diretor de Growth', 'Diretora de Growth',
  'Head de Marketing', 'Head de Growth', 'Head de Performance',
  'Head de E-commerce', 'Head de Commerce', 'Head de Martech',
  'Head de Digital', 'Diretor Digital', 'Diretora Digital',
  'CDO', 'Chief Digital Officer',
  'CGO', 'Chief Growth Officer',
  'CCO', 'Chief Commerce Officer',
  'Head de CRM', 'Head de Data', 'Head de Analytics',
  'Gerente de Marketing', 'Gerente Geral de Marketing',
  'Superintendente de Marketing',
]

// ─── System prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um especialista em marketing brasileiro analisando artigos de veículos especializados como Propmark e Meio & Mensagem.

Extraia APENAS informações explicitamente mencionadas no texto. NÃO invente dados.

Foque em:
1. RELAÇÕES MARCA-AGÊNCIA: qual agência atende qual marca, escopo de trabalho, quando começou/terminou
2. EXECUTIVOS: CMO, VP Marketing, Diretor de Marketing, Head de Growth/Performance/E-commerce/Martech/Digital/CRM/Commerce/Data
3. PITCHS: processos de seleção de agência (abertos, finalizados, vencedores)

Retorne JSON válido neste formato exato:
{
  "agency_relations": [
    {
      "brand": "Nome exato da marca",
      "agency": "Nome exato da agência",
      "scope": "Criação|Mídia|Digital|PR|Social|CRM|Performance|Tecnologia|Branding|E-commerce|Conteúdo|Saúde|Varejo",
      "status": "active|ended",
      "year_start": 2024,
      "month_start": 3,
      "year_end": null,
      "month_end": null,
      "pitch_type": "concorrência|convidada|renovação|indicação|null",
      "confidence": "alta|media|baixa",
      "notes": "contexto curto"
    }
  ],
  "executives": [
    {
      "name": "Nome Completo",
      "title": "cargo exato",
      "title_normalized": "CMO|VP Marketing|Diretor de Marketing|Head de Growth|Head de Performance|Head de E-commerce|Head de Martech|Head de Digital|Head de CRM|Head de Data|CDO|CGO|Outro",
      "company": "Nome da empresa",
      "change_type": "hired|left|promoted|appointed",
      "year": 2024,
      "month": 3,
      "is_current": true,
      "confidence": "alta|media|baixa"
    }
  ],
  "pitches": [
    {
      "brand": "Nome da Marca",
      "status": "open|completed|cancelled",
      "winner_agency": "Agência vencedora ou null",
      "agencies_invited": ["Agência A", "Agência B"],
      "scope": "Criação|Mídia|Digital|...",
      "year": 2024,
      "month": 3,
      "confidence": "alta|media|baixa"
    }
  ]
}`

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fuzzy match: normaliza nome para comparação */
function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim()
}

/** Resolução interna de brand (sem proteção de concorrência) */
async function _resolveBrandInner(brandName, brandCache) {
  const key = normalize(brandName)

  // Busca exata primeiro
  const { data: exact } = await supabase
    .from('brands').select('id, name').ilike('name', brandName).limit(1)
  if (exact?.length) {
    brandCache.set(key, exact[0].id)
    return exact[0].id
  }

  // Busca parcial — nome contém
  const words = key.split(' ').filter(w => w.length > 3)
  for (const word of words) {
    const { data: partial } = await supabase
      .from('brands').select('id, name').ilike('name', `%${word}%`).limit(1)
    if (partial?.length) {
      brandCache.set(key, partial[0].id)
      return partial[0].id
    }
  }

  // Cria brand nova — se falhar (race condition), re-busca
  const { data: created, error: insErr } = await supabase
    .from('brands')
    .insert({ name: brandName, segment: 'Outro', country_of_origin: 'Brasil' })
    .select('id').single()
  if (created) {
    brandCache.set(key, created.id)
    return created.id
  }
  if (insErr) {
    // Outra coroutine criou primeiro — busca o existente
    const { data: retry } = await supabase
      .from('brands').select('id').ilike('name', brandName).limit(1)
    if (retry?.length) {
      brandCache.set(key, retry[0].id)
      return retry[0].id
    }
  }
  return null
}

/** Encontra brand_id no DB pelo nome (fuzzy) — thread-safe para concorrência */
async function resolveBrand(brandName, brandCache) {
  const key = normalize(brandName)
  if (brandCache.has(key)) return brandCache.get(key)

  // Se outra coroutine já está resolvendo este brand, aguarda o resultado dela
  if (_pendingBrands.has(key)) return _pendingBrands.get(key)

  const promise = _resolveBrandInner(brandName, brandCache)
    .finally(() => _pendingBrands.delete(key))
  _pendingBrands.set(key, promise)
  return promise
}

/** Resolução interna de agency (sem proteção de concorrência) */
async function _resolveAgencyInner(agencyName, agencyCache) {
  const key = normalize(agencyName)

  const { data: exact } = await supabase
    .from('agency_profiles').select('id, name, holding').ilike('name', `%${agencyName}%`).limit(1)
  if (exact?.length) {
    agencyCache.set(key, exact[0])
    return exact[0]
  }

  const words = key.split(' ').filter(w => w.length > 3)
  for (const word of words) {
    const { data: partial } = await supabase
      .from('agency_profiles').select('id, name, holding').ilike('name', `%${word}%`).limit(1)
    if (partial?.length) {
      agencyCache.set(key, partial[0])
      return partial[0]
    }
  }

  agencyCache.set(key, null)
  return null
}

/** Encontra agency no DB pelo nome (fuzzy) — thread-safe para concorrência */
async function resolveAgency(agencyName, agencyCache) {
  const key = normalize(agencyName)
  if (agencyCache.has(key)) return agencyCache.get(key)

  if (_pendingAgencies.has(key)) return _pendingAgencies.get(key)

  const promise = _resolveAgencyInner(agencyName, agencyCache)
    .finally(() => _pendingAgencies.delete(key))
  _pendingAgencies.set(key, promise)
  return promise
}

// ─── Enriquecimento PDL ──────────────────────────────────────────────────────
async function enrichWithPDL(executive) {
  if (!process.env.PDL_API_KEY) return null

  try {
    const PDLjs = require('peopledatalabs')
    const client = new PDLjs.default({ apiKey: process.env.PDL_API_KEY })

    const params = {
      name: executive.name,
      company: executive.company,
      titlecase: true,
    }

    const searchParams = {
      query: { bool: { must: [
        { match: { full_name: executive.name } },
        { match: { 'experience.company.name': executive.company } },
      ]}},
      size: 1,
      dataset: 'all',
    }
    const result = await client.person.search.elastic({ params: searchParams })

    if (result?.data?.length) {
      const p = result.data[0]
      return {
        linkedin: p.linkedin_url,
        pdl_id: p.id,
        location: p.location_name,
        seniority: p.job_title_levels?.join(', '),
      }
    }
  } catch (e) {
    // PDL não encontrou — ok
  }
  return null
}

// ─── Extração via Claude ─────────────────────────────────────────────────────
async function extractFromArticle(article) {
  const text = [article.title, article.excerpt, article.content]
    .filter(Boolean).join('\n\n')

  if (text.length < 100) return null

  // Trunca para evitar tokens excessivos (~8K chars = ~2K tokens)
  const truncated = text.slice(0, 8000)

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Artigo: "${article.title}"\nData: ${article.published_at?.slice(0, 10) || 'desconhecida'}\nFonte: ${article.source_name}\n\nTexto:\n${truncated}`,
    }]
  })

  const raw = response.content[0]?.text || '{}'

  // Tenta parse direto, depois com regex (fallback)
  try {
    return JSON.parse(raw)
  } catch {
    // Extrai o maior bloco JSON do texto
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // Tenta pegar o último bloco caso o greedy tenha capturado demais
      const blocks = [...raw.matchAll(/\{[\s\S]*?\}/g)]
      for (const block of blocks.reverse()) {
        try { return JSON.parse(block[0]) } catch {}
      }
      return null
    }
  }
}

// ─── Save results ────────────────────────────────────────────────────────────
async function saveResults(extracted, article, brandCache, agencyCache) {
  const counts = { agency_relations: 0, executives: 0, pitches: 0 }
  const hits = { brands: [], agencies: [], executives: [] }

  const articleDate = article.published_at ? new Date(article.published_at) : new Date()
  const articleYear  = articleDate.getFullYear()
  const articleMonth = articleDate.getMonth() + 1

  // ── Agency relations ──────────────────────────────────────────────────────
  for (const rel of (extracted.agency_relations || [])) {
    if (!rel.brand || !rel.agency || rel.confidence === 'baixa') continue

    const brandId = await resolveBrand(rel.brand, brandCache)
    if (!brandId) continue

    const agencyInfo = await resolveAgency(rel.agency, agencyCache)
    const agencyName = agencyInfo?.name || rel.agency
    const agencyGroup = agencyInfo?.holding || null

    const row = {
      brand_id:    brandId,
      agency:      agencyName,
      agency_group: agencyGroup,
      scope:       rel.scope || 'Criação',
      status:      rel.status || 'active',
      year_start:  rel.year_start || articleYear,
      month_start: rel.month_start || articleMonth,
      year_end:    rel.year_end || null,
      month_end:   rel.month_end || null,
      pitch_type:  rel.pitch_type || null,
      source_article_id: article.id,
      source_name: article.source_name,
      confidence:  rel.confidence || 'media',
    }

    // Evita duplicata por (brand_id, agency, scope, year_start)
    const { data: exists } = await supabase.from('agency_history')
      .select('id').eq('brand_id', brandId).eq('agency', agencyName)
      .eq('scope', row.scope).eq('year_start', row.year_start).limit(1)

    if (!exists?.length) {
      const { error } = await supabase.from('agency_history').insert(row)
      if (!error) {
        counts.agency_relations++
        hits.brands.push(rel.brand)
        hits.agencies.push(agencyName)
      }
    } else {
      // Atualiza status se relation existente ficou ativa/inativa
      if (rel.status === 'ended' && rel.year_end) {
        await supabase.from('agency_history')
          .update({ status: 'ended', year_end: rel.year_end, month_end: rel.month_end })
          .eq('id', exists[0].id)
      }
    }
  }

  // ── Pitches → também gera agency_history com pitch_type ──────────────────
  for (const pitch of (extracted.pitches || [])) {
    if (!pitch.brand || pitch.confidence === 'baixa') continue

    const brandId = await resolveBrand(pitch.brand, brandCache)
    if (!brandId) continue

    if (pitch.winner_agency && pitch.status === 'completed') {
      const agencyInfo = await resolveAgency(pitch.winner_agency, agencyCache)
      const agencyName = agencyInfo?.name || pitch.winner_agency

      const { data: exists } = await supabase.from('agency_history')
        .select('id').eq('brand_id', brandId).eq('agency', agencyName)
        .eq('year_start', pitch.year || articleYear).limit(1)

      if (!exists?.length) {
        await supabase.from('agency_history').insert({
          brand_id:    brandId,
          agency:      agencyName,
          agency_group: agencyInfo?.holding || null,
          scope:       pitch.scope || 'Criação',
          status:      'active',
          year_start:  pitch.year || articleYear,
          month_start: pitch.month || articleMonth,
          pitch_type:  'concorrência',
          source_article_id: article.id,
          source_name: article.source_name,
          confidence:  pitch.confidence || 'media',
        })
        counts.pitches++
        hits.brands.push(pitch.brand)
        hits.agencies.push(agencyName)
      }
    }
  }

  // ── Executives ────────────────────────────────────────────────────────────
  for (const exec of (extracted.executives || [])) {
    if (!exec.name || !exec.company || exec.confidence === 'baixa') continue

    const brandId = await resolveBrand(exec.company, brandCache)
    if (!brandId) continue

    // Desativa cargo atual anterior se for hired/appointed
    if (['hired', 'appointed', 'promoted'].includes(exec.change_type) && exec.is_current) {
      await supabase.from('marketing_leaders')
        .update({ is_current: false, end_date: `${exec.year || articleYear}-${String(exec.month || articleMonth).padStart(2,'0')}-01` })
        .eq('brand_id', brandId)
        .ilike('title', `%${exec.title_normalized || exec.title}%`)
        .eq('is_current', true)
    }

    // Verifica se já existe
    const { data: exists } = await supabase.from('marketing_leaders')
      .select('id').eq('brand_id', brandId).ilike('name', exec.name).limit(1)
    if (exists?.length) continue

    // Enriquece com PDL
    const pdlData = exec.confidence === 'alta'
      ? await enrichWithPDL(exec)
      : null

    const row = {
      brand_id:   brandId,
      name:       exec.name,
      title:      exec.title,
      company:    exec.company,
      is_current: exec.change_type !== 'left',
      start_date: exec.change_type !== 'left'
        ? `${exec.year || articleYear}-${String(exec.month || articleMonth).padStart(2,'0')}-01`
        : null,
      end_date: exec.change_type === 'left'
        ? `${exec.year || articleYear}-${String(exec.month || articleMonth).padStart(2,'0')}-01`
        : null,
      source:     article.source_name,
      source_article_id: article.id,
      linkedin:   pdlData?.linkedin || null,
    }

    const { error } = await supabase.from('marketing_leaders').insert(row)
    if (!error) {
      counts.executives++
      hits.executives.push(exec.name)
    }
  }

  return { counts, hits }
}

// ─── Função principal ────────────────────────────────────────────────────────

/**
 * Processa artigos pendentes de extração
 * @param {Object} opts
 * @param {number} opts.limit        - máx artigos por run (default 100)
 * @param {string} opts.source_name  - filtrar por fonte (ex: 'propmark')
 * @param {string} opts.since        - só artigos publicados após esta data
 * @param {boolean} opts.pdl         - usar PDL para enriquecer executivos (default true)
 */
async function runExtraction({ limit = 100, source_name, since, pdl = true } = {}) {
  console.log('[extractor] Iniciando extração de artigos...')

  let query = supabase
    .from('articles')
    .select('id, title, excerpt, content, published_at, source_name, url')
    .is('extracted_at', null)
    .or('extraction_status.is.null,extraction_status.eq.pending')
    .not('content', 'is', null)
    .neq('content', '')
    .order('published_at', { ascending: false })
    .limit(limit)

  if (source_name) query = query.eq('source_name', source_name)
  if (since)       query = query.gte('published_at', since)

  const { data: articles, error } = await query
  if (error) throw new Error(`DB error: ${error.message}`)

  console.log(`[extractor] ${articles.length} artigos para processar`)

  const brandCache  = new Map()
  const agencyCache = new Map()
  const totals = { processed: 0, skipped: 0, errors: 0,
    agency_relations: 0, executives: 0, pitches: 0 }

  // Processa em chunks paralelos de CONCURRENCY artigos simultâneos
  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const chunk = articles.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(chunk.map(async article => {
      const extracted = await extractFromArticle(article)

      if (!extracted) {
        await supabase.from('articles').update({
          extracted_at: new Date().toISOString(),
          extraction_status: 'skipped',
        }).eq('id', article.id)
        return { status: 'skipped' }
      }

      const hasData = (extracted.agency_relations?.length || 0) +
                      (extracted.executives?.length || 0) +
                      (extracted.pitches?.length || 0) > 0

      if (!hasData) {
        await supabase.from('articles').update({
          extracted_at: new Date().toISOString(),
          extraction_status: 'skipped',
          extraction_hits: { brands: [], agencies: [], executives: [] },
        }).eq('id', article.id)
        return { status: 'skipped' }
      }

      const { counts, hits } = await saveResults(extracted, article, brandCache, agencyCache)

      await supabase.from('articles').update({
        extracted_at: new Date().toISOString(),
        extraction_status: 'ok',
        extraction_hits: hits,
      }).eq('id', article.id)

      return { status: 'processed', counts }
    }))

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.status === 'processed') {
          totals.processed++
          totals.agency_relations += r.value.counts.agency_relations
          totals.executives       += r.value.counts.executives
          totals.pitches          += r.value.counts.pitches
        } else {
          totals.skipped++
        }
      } else {
        console.error(`[extractor] Erro em artigo: ${r.reason?.message}`)
        totals.errors++
      }
    }

    if (i % (CONCURRENCY * 5) === 0 && i > 0) {
      console.log(`[extractor] ${i}/${articles.length} — ` +
        `${totals.agency_relations} relações, ${totals.executives} executivos, ${totals.pitches} pitchs`)
    }
    await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))
  }

  console.log('[extractor] Concluído:', JSON.stringify(totals))
  return totals
}

// ─── Extração de edições M&M Website (tabela editions) ───────────────────────

/**
 * Processa edições M&M Website pendentes de extração (tabela editions)
 * @param {Object} opts
 * @param {number} opts.limit   - máx edições por run (default 200)
 * @param {string} opts.since   - só edições a partir desta data (YYYY-MM-DD)
 */
async function runEditionExtraction({ limit = 200, since, onProgress } = {}) {
  console.log('[edition-extractor] Iniciando extração de edições M&M Website...')

  // Pendentes = signals não contém a chave "extracted" (nunca processadas)
  // signals = '{}' é o estado inicial de todas as editions não extraídas
  let query = supabase
    .from('editions')
    .select('id, title, date, year, text_content, source, signals')
    .not('text_content', 'is', null)
    .not('signals', 'cs', '{"extracted":true}')
    .order('date', { ascending: false })
    .limit(limit)

  if (since) query = query.gte('date', since)

  const { data: editions, error } = await query
  if (error) throw new Error(`DB error: ${error.message}`)

  console.log(`[edition-extractor] ${editions.length} edições para processar`)

  const brandCache  = new Map()
  const agencyCache = new Map()
  const totals = { processed: 0, skipped: 0, errors: 0,
    agency_relations: 0, executives: 0, pitches: 0 }

  // Processa em chunks paralelos de CONCURRENCY edições simultâneas
  for (let i = 0; i < editions.length; i += CONCURRENCY) {
    const chunk = editions.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(chunk.map(async ed => {
      const articleLike = {
        id:           ed.id,
        title:        ed.title,
        excerpt:      null,
        content:      ed.text_content,
        published_at: ed.date,
        source_name:  'mm_website',
        url:          null,
      }

      const extracted = await extractFromArticle(articleLike)

      if (!extracted) {
        await supabase.from('editions').update({ signals: { extracted: true, empty: true } }).eq('id', ed.id)
        return { status: 'skipped' }
      }

      const hasData = (extracted.agency_relations?.length || 0) +
                      (extracted.executives?.length || 0) +
                      (extracted.pitches?.length || 0) > 0

      if (!hasData) {
        await supabase.from('editions').update({ signals: { extracted: true, empty: true } }).eq('id', ed.id)
        return { status: 'skipped' }
      }

      const { counts, hits } = await saveResults(extracted, articleLike, brandCache, agencyCache)

      await supabase.from('editions').update({
        signals: { extracted: true, hits, counts },
      }).eq('id', ed.id)

      return { status: 'processed', counts }
    }))

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.status === 'processed') {
          totals.processed++
          totals.agency_relations += r.value.counts.agency_relations
          totals.executives       += r.value.counts.executives
          totals.pitches          += r.value.counts.pitches
        } else {
          totals.skipped++
        }
      } else {
        console.error(`[edition-extractor] Erro em edição: ${r.reason?.message}`)
        totals.errors++
      }
    }

    const done = totals.processed + totals.skipped + totals.errors
    onProgress?.({ processed: done, total: editions.length, totals })

    if (i % (CONCURRENCY * 10) === 0 && i > 0) {
      console.log(`[edition-extractor] ${i}/${editions.length} — ` +
        `${totals.agency_relations} relações, ${totals.executives} executivos, ${totals.pitches} pitchs`)
    }
    await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))
  }

  console.log('[edition-extractor] Concluído:', JSON.stringify(totals))
  return totals
}

module.exports = { runExtraction, runEditionExtraction }
