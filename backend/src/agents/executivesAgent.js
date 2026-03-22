/**
 * executivesAgent.js — Agente 4
 *
 * Busca executivos de marketing das marcas no PeopleDataLabs (PDL).
 * Para cada marca, pesquisa pessoas com cargos de marketing e salva
 * o histórico completo (atual + passados) na tabela marketing_leaders.
 *
 * Fluxo:
 *  1. Carrega marcas do banco
 *  2. Para cada marca: busca no PDL por marketing leaders
 *  3. Salva executivos encontrados (upsert por linkedin ou nome+marca)
 */

const supabase = require('../lib/supabase')
const { searchExecutives, searchPerson } = require('../lib/tavilySearch')
const Anthropic = require('@anthropic-ai/sdk')

const claude = new Anthropic()

// Cargos-alvo para busca
const TITLE_ROLES   = ['marketing', 'brand']
const TITLE_LEVELS  = ['cxo', 'vp', 'director', 'manager']

// ─── Busca PDL por brand ───────────────────────────────────────────────────

async function searchPDLForBrand(client, brand) {
  const mustClauses = [
    {
      bool: {
        should: [
          { term: { job_company_name: brand.name.toLowerCase() } },
          ...(brand.website
            ? [{ term: { job_company_website: brand.website.replace(/^https?:\/\//, '').replace(/\/$/, '') } }]
            : []),
        ],
        minimum_should_match: 1,
      },
    },
    {
      bool: {
        should: [
          ...TITLE_ROLES.map(r  => ({ term: { job_title_role:  r } })),
          ...TITLE_LEVELS.map(l => ({ term: { job_title_levels: l } })),
        ],
        minimum_should_match: 1,
      },
    },
  ]

  const result = await client.person.search.elastic({
    params: {
      query: { bool: { must: mustClauses } },
      size: 15,
      dataset: 'all',
    },
  })

  return result?.data || []
}

// ─── Salva executivo no banco ──────────────────────────────────────────────

async function saveExecutive(brandId, person) {
  if (!person.full_name) return 0
  let saved = 0

  // Posição atual
  const currentExp = (person.experience || []).find(e => !e.end_date || e.is_primary)
  if (currentExp) {
    const row = {
      brand_id:   brandId,
      name:       person.full_name,
      title:      currentExp.title?.name || person.job_title || 'Marketing Leader',
      linkedin:   person.linkedin_url || null,
      start_date: currentExp.start_date?.year
        ? `${currentExp.start_date.year}-${String(currentExp.start_date.month || 1).padStart(2,'0')}-01`
        : null,
      end_date:   null,
      is_current: true,
      source:     'pdl',
    }
    const err = await upsertLeader(row)
    if (!err) saved++
  }

  // Posições passadas na mesma empresa
  const pastExps = (person.experience || []).filter(e =>
    e.end_date &&
    e.company?.name &&
    normalizeCompany(e.company.name).includes(normalizeCompany(person.job_company_name || ''))
  )

  for (const exp of pastExps) {
    const row = {
      brand_id:   brandId,
      name:       person.full_name,
      title:      exp.title?.name || 'Marketing',
      linkedin:   person.linkedin_url || null,
      start_date: exp.start_date?.year
        ? `${exp.start_date.year}-${String(exp.start_date.month || 1).padStart(2,'0')}-01`
        : null,
      end_date: exp.end_date?.year
        ? `${exp.end_date.year}-${String(exp.end_date.month || 12).padStart(2,'0')}-01`
        : null,
      is_current: false,
      source:     'pdl',
    }
    const err = await upsertLeader(row)
    if (!err) saved++
  }

  return saved
}

function normalizeCompany(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function upsertLeader(row) {
  // Dedup: mesmo brand_id + linkedin (se tiver) OU mesmo brand_id + name + is_current
  if (row.linkedin) {
    const { data: existing } = await supabase
      .from('marketing_leaders')
      .select('id')
      .eq('brand_id', row.brand_id)
      .eq('linkedin', row.linkedin)
      .eq('is_current', row.is_current)
      .limit(1)
    if (existing?.length) {
      const { error } = await supabase
        .from('marketing_leaders')
        .update({ title: row.title, start_date: row.start_date, end_date: row.end_date })
        .eq('id', existing[0].id)
      return error
    }
  } else {
    const { data: existing } = await supabase
      .from('marketing_leaders')
      .select('id')
      .eq('brand_id', row.brand_id)
      .ilike('name', row.name)
      .eq('is_current', row.is_current)
      .limit(1)
    if (existing?.length) return null  // já existe, pula
  }

  const { error } = await supabase.from('marketing_leaders').insert(row)
  return error
}

// ─── Busca via Tavily + Claude (fallback ao PDL ou standalone) ─────────────

/**
 * Busca executivos de uma marca via Tavily (web) e extrai estruturado com Claude.
 * Retorna array de { name, title, start_date, end_date, is_current, source_url }
 */
async function searchTavilyExecutives(brand) {
  const webResults = await searchExecutives(brand.name, { days: 730 })
  if (!webResults.length) return []

  const context = webResults.slice(0, 8).map(r =>
    `Fonte: ${r.url}\nTítulo: ${r.title}\nConteúdo: ${(r.content || '').slice(0, 400)}`
  ).join('\n---\n')

  let raw
  try {
    const response = await claude.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Extraia executivos de marketing da empresa "${brand.name}" a partir das notícias abaixo.
Retorne APENAS JSON válido, sem texto fora do JSON:
{
  "executives": [
    {
      "name": "Nome Completo",
      "title": "Cargo exato",
      "is_current": true,
      "start_date": "YYYY-MM-DD ou null",
      "end_date": "YYYY-MM-DD ou null",
      "source_url": "URL da fonte"
    }
  ]
}

Notícias:
${context}`
      }],
    })
    raw = response.content[0]?.text || '{}'
  } catch (e) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed?.executives || []
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    try {
      return JSON.parse(match?.[0] || '{}')?.executives || []
    } catch { return [] }
  }
}

async function saveTavilyExecutive(brandId, exec) {
  if (!exec.name || !exec.title) return 0

  const { data: existing } = await supabase
    .from('marketing_leaders')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('name', exec.name)
    .limit(1)
  if (existing?.length) return 0

  const { error } = await supabase.from('marketing_leaders').insert({
    brand_id:   brandId,
    name:       exec.name,
    title:      exec.title,
    linkedin:   null,
    start_date: exec.start_date || null,
    end_date:   exec.end_date || null,
    is_current: exec.is_current !== false,
    source:     'tavily',
    metadata:   { source_url: exec.source_url || null },
  })
  return error ? 0 : 1
}

// ─── Agente principal ──────────────────────────────────────────────────────

/**
 * Enriquece marcas com executivos do PeopleDataLabs + Tavily (web).
 *
 * @param {Object} opts
 * @param {number}   opts.limit       - máx marcas (default 50)
 * @param {string[]} opts.brand_ids   - IDs específicos
 * @param {boolean}  opts.web         - usar Tavily além do PDL (default true)
 * @param {Function} opts.onProgress
 */
async function runExecutiveEnrichment({ limit = 50, brand_ids, web = true, onProgress } = {}) {
  const hasPDL = !!process.env.PDL_API_KEY
  let pdlClient = null

  if (hasPDL) {
    const PDLjs = require('peopledatalabs')
    pdlClient = new PDLjs.default({ apiKey: process.env.PDL_API_KEY })
  } else {
    console.log('[executives] PDL_API_KEY não configurada — usando apenas Tavily')
  }

  if (!hasPDL && !web) throw new Error('Configure PDL_API_KEY ou habilite web=true')

  let query = supabase.from('brands').select('id, name, website').order('name').limit(limit)
  if (brand_ids?.length) query = query.in('id', brand_ids)
  const { data: brands } = await query

  console.log(`[executives] ${brands?.length || 0} marcas | PDL=${hasPDL} | Tavily=${web}`)

  const totals = { processed: 0, pdl_found: 0, tavily_found: 0, saved: 0, errors: 0, total: brands?.length || 0 }

  for (const brand of (brands || [])) {
    onProgress?.('searching', { brand: brand.name, progress: totals.processed, total: totals.total })

    try {
      // ── PDL ──────────────────────────────────────────────────────────────
      if (hasPDL) {
        const people = await searchPDLForBrand(pdlClient, brand)
        totals.pdl_found += people.length
        for (const person of people) {
          const n = await saveExecutive(brand.id, person)
          totals.saved += n
        }
      }

      // ── Tavily ───────────────────────────────────────────────────────────
      if (web) {
        const execs = await searchTavilyExecutives(brand)
        totals.tavily_found += execs.length
        for (const exec of execs) {
          const n = await saveTavilyExecutive(brand.id, exec)
          totals.saved += n
        }
        if (execs.length > 0) {
          console.log(`[executives] ${brand.name}: +${execs.length} via Tavily`)
        }
      }

    } catch (e) {
      console.error(`[executives] Erro em ${brand.name}: ${e.message}`)
      totals.errors++
    }

    totals.processed++
    await new Promise(r => setTimeout(r, 400))
  }

  console.log('[executives] Concluído:', JSON.stringify(totals))
  return totals
}

module.exports = { runExecutiveEnrichment }
