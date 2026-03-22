/**
 * archiveExtractor.js
 * Agente que processa texto de edições do arquivo M&M e extrai:
 * - Mudanças de agência (marca → agência nova)
 * - Nomeações de executivos de marketing
 * - Aberturas de concorrência (pitchs)
 * Salva resultados em agency_history, brands, marketing_leaders
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')
const fs        = require('fs')
const path      = require('path')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ARCHIVE_DIR = path.join(__dirname, '../../../data/archive')

const SYSTEM_PROMPT = `Você é um especialista em marketing brasileiro analisando edições da revista Meio & Mensagem.

Seu objetivo é extrair dados ESTRUTURADOS de mudanças no mercado publicitário brasileiro.

Para cada trecho de texto, extraia APENAS eventos com alta confiança:

1. MUDANÇAS DE AGÊNCIA: quando uma marca troca de agência ou contrata uma nova
   - Campos: marca, agencia_nova, agencia_anterior, data_inicio, fonte_texto

2. NOMEAÇÕES DE EXECUTIVOS: CMO, Diretor de Marketing, VP Marketing, Gerente de Marketing
   - Campos: nome, cargo, empresa, tipo (nomeação/saída/promoção), data

3. PITCHS/CONCORRÊNCIAS: processos formais de seleção de agência
   - Campos: marca, status (aberto/finalizado/cancelado), agencias_participantes, data

Retorne APENAS JSON válido. Se não encontrar dados confiáveis, retorne arrays vazios.
Não invente dados — só extraia o que está explicitamente no texto.

Formato de resposta:
{
  "agency_changes": [
    {
      "brand": "Nome da Marca",
      "new_agency": "Nome da Agência",
      "previous_agency": "Agência Anterior ou null",
      "start_date": "YYYY-MM ou YYYY",
      "notes": "contexto curto"
    }
  ],
  "executive_changes": [
    {
      "name": "Nome Completo",
      "title": "CMO",
      "company": "Empresa",
      "change_type": "hired|left|promoted",
      "date": "YYYY-MM ou YYYY"
    }
  ],
  "pitches": [
    {
      "brand": "Marca",
      "status": "open|completed|cancelled",
      "agencies": ["Agência A", "Agência B"],
      "date": "YYYY-MM ou YYYY"
    }
  ]
}`


/**
 * Processa um trecho de texto de edição
 */
async function extractFromText(text, editionMeta) {
  // Divide o texto em chunks de ~6000 chars (contexto maior = menos chamadas)
  const CHUNK_SIZE = 6000
  const MAX_CHUNKS = 12   // máx 12 chunks por edição (~72KB) — evita rate limit
  const chunks = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE))
    if (chunks.length >= MAX_CHUNKS) break
  }

  const allResults = { agency_changes: [], executive_changes: [], pitches: [] }

  for (const chunk of chunks) {
    // Filtra chunks irrelevantes (publicidade sem conteúdo editorial)
    if (chunk.length < 200) continue

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',   // haiku = rápido e barato para extração
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Edição: ${editionMeta.title} (${editionMeta.date})\n\nTexto:\n${chunk}`
        }]
      })

      const raw = response.content[0]?.text || '{}'
      // Extrai JSON mesmo se vier com texto ao redor
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) continue

      const data = JSON.parse(jsonMatch[0])
      if (data.agency_changes)    allResults.agency_changes.push(...data.agency_changes)
      if (data.executive_changes) allResults.executive_changes.push(...data.executive_changes)
      if (data.pitches)           allResults.pitches.push(...data.pitches)

    } catch (e) {
      // Continua no próximo chunk
    }
  }

  return allResults
}


/**
 * Salva resultados no Supabase
 */
async function saveResults(results, editionMeta) {
  const saved = { brands: 0, history: 0, leaders: 0 }

  // Agency changes → garante brand existe + insere em agency_history
  for (const change of results.agency_changes) {
    if (!change.brand || !change.new_agency) continue

    // Upsert brand (onConflict: name)
    const { data: brand } = await supabase
      .from('brands')
      .upsert({ name: change.brand }, { onConflict: 'name' })
      .select('id')
      .single()

    if (brand) {
      saved.brands++

      // Extrai ano/mês da data da edição
      const dateStr = change.start_date || editionMeta.date || ''
      const yearNum  = parseInt(dateStr.slice(0, 4)) || null
      const monthNum = parseInt(dateStr.slice(5, 7)) || null

      await supabase.from('agency_history').insert({
        brand_id:   brand.id,
        agency:     change.new_agency,
        year_start: yearNum,
        month_start: monthNum,
        status:     'active',
        scope:      'Criação',
        notes:      change.notes || null,
      }).select()

      saved.history++
    }
  }

  // Executive changes → marketing_leaders (vincula brand se possível)
  for (const exec of results.executive_changes) {
    if (!exec.name || !exec.company) continue

    // Tenta achar brand_id
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .ilike('name', exec.company)
      .maybeSingle()

    const dateStr = exec.date || editionMeta.date || ''
    const startDate = dateStr.length >= 7 ? dateStr.slice(0, 7) + '-01' : null

    await supabase.from('marketing_leaders').insert({
      brand_id:   brand?.id || null,
      name:       exec.name,
      title:      exec.title || '',
      company:    exec.company || null,
      is_current: exec.change_type === 'hired' || exec.change_type === 'promoted',
      start_date: startDate,
      source:     `archive_${(editionMeta.date || '').slice(0, 4)}`,
    })
    saved.leaders++
  }

  return saved
}


/**
 * Processa uma edição completa (lê text.txt, extrai, salva)
 */
async function processEdition(editionMeta) {
  const { title, date, sunflower_id } = editionMeta

  // Encontra a pasta da edição
  const year = (date || '').slice(0, 4) || 'desconhecido'
  const numMatch = title?.match(/(\d{4})/)
  const num = numMatch?.[1] || sunflower_id

  const textPath = path.join(ARCHIVE_DIR, year, `Edicao-${num}`, 'text.txt')
  if (!fs.existsSync(textPath)) return { status: 'no_text' }

  const text = fs.readFileSync(textPath, 'utf8')
  if (text.length < 500) return { status: 'too_short' }

  const results = await extractFromText(text, editionMeta)
  const saved   = await saveResults(results, editionMeta)

  return {
    status:  'ok',
    found:   {
      agency_changes: results.agency_changes.length,
      executives:     results.executive_changes.length,
      pitches:        results.pitches.length,
    },
    saved,
  }
}


/**
 * Roda extração em lote (chamado pelo route /agent/extract-archive)
 * @param {string[]} sunflowerIds - IDs das edições a processar (opcional, processa tudo se vazio)
 * @param {Function} onProgress - callback(done, total, lastResult)
 */
async function runArchiveExtraction(options = {}, onProgress = null) {
  const { yearFrom = 2010, yearTo = 2017, limit = 100 } = options

  // Lê catálogo
  const catalogPath = path.join(ARCHIVE_DIR, 'catalog.json')
  if (!fs.existsSync(catalogPath)) throw new Error('Catálogo não encontrado — execute build_catalog.py primeiro')

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

  // Filtra edições no range de anos
  const editions = catalog.filter(ed => {
    const yr = parseInt((ed.date || ed.uid || '').slice(0, 4))
    return yr >= yearFrom && yr <= yearTo
  }).slice(0, limit)

  const total   = editions.length
  const results = { total, processed: 0, ok: 0, skipped: 0, errors: 0, totals: {} }

  for (let i = 0; i < editions.length; i++) {
    const ed = editions[i]
    try {
      const r = await processEdition(ed)
      results.processed++

      if (r.status === 'ok') {
        results.ok++
        // Acumula totais
        for (const [k, v] of Object.entries(r.saved)) {
          results.totals[k] = (results.totals[k] || 0) + v
        }
      } else {
        results.skipped++
      }
    } catch (e) {
      results.errors++
    }

    if (onProgress) onProgress(i + 1, total, ed.title)
  }

  return results
}


module.exports = { runArchiveExtraction, processEdition, extractFromText }
