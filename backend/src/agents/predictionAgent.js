/**
 * predictionAgent.js
 *
 * Agente de predição de pitches.
 * Dado uma marca + contexto (escopo, setor, etc.):
 *  1. Busca histórico da marca no banco (agências anteriores, executivos)
 *  2. Busca agências candidatas com track record em pitchs similares
 *  3. Claude analisa tudo e retorna predição estruturada com justificativa
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Coleta de contexto do banco ─────────────────────────────────────────────

async function getBrandContext(brandName) {
  // Busca brand pelo nome (fuzzy)
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, segment, country_of_origin, holding')
    .ilike('name', `%${brandName}%`)
    .limit(3)

  if (!brands?.length) return null
  const brand = brands[0]

  // Histórico de agências
  const { data: history } = await supabase
    .from('agency_history')
    .select('agency, agency_group, scope, status, year_start, year_end, pitch_type, confidence, source_name')
    .eq('brand_id', brand.id)
    .order('year_start', { ascending: false })
    .limit(20)

  // Líderes de marketing atuais e recentes
  const { data: leaders } = await supabase
    .from('marketing_leaders')
    .select('name, title, company, is_current, start_date, end_date, source')
    .eq('brand_id', brand.id)
    .order('is_current', { ascending: false })
    .limit(10)

  return { brand, history: history || [], leaders: leaders || [] }
}

async function getSimilarPitchWinners({ scope, segment, limit = 20 }) {
  // Agências que mais ganharam pitchs por escopo similar
  let query = supabase
    .from('agency_history')
    .select('agency, agency_group, scope, year_start, pitch_type, brand_id, confidence')
    .eq('pitch_type', 'concorrência')
    .eq('status', 'active')
    .order('year_start', { ascending: false })
    .limit(limit)

  if (scope) query = query.ilike('scope', `%${scope}%`)

  const { data } = await query
  return data || []
}

async function getAgencyProfiles(agencyNames) {
  if (!agencyNames.length) return []
  const { data } = await supabase
    .from('agency_profiles')
    .select('name, holding, category, specialties, headquarters, status')
    .in('name', agencyNames)
  return data || []
}

async function getRecentMarketMovements(yearFrom = 2023) {
  // Movimentações recentes do mercado para contexto
  const { data } = await supabase
    .from('agency_history')
    .select('agency, scope, year_start, month_start, pitch_type, source_name')
    .gte('year_start', yearFrom)
    .eq('status', 'active')
    .order('year_start', { ascending: false })
    .limit(30)
  return data || []
}

// ─── Prompt de predição ──────────────────────────────────────────────────────

function buildPrompt({ brandCtx, similarWinners, recentMovements, scope, additionalContext }) {
  const brand = brandCtx?.brand
  const history = brandCtx?.history || []
  const leaders = brandCtx?.leaders || []

  // Conta vitórias por agência nos pitchs similares
  const winCounts = {}
  for (const w of similarWinners) {
    const key = w.agency
    winCounts[key] = (winCounts[key] || 0) + 1
  }
  const topWinners = Object.entries(winCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ag, n]) => `${ag} (${n} pitchs ganhos)`)

  const currentAgency = history.find(h => h.status === 'active' && (!scope || h.scope?.includes(scope)))
  const pastAgencies  = history.filter(h => h.status === 'ended').map(h => h.agency)
  const currentLeader = leaders.find(l => l.is_current)

  let ctx = `## Marca: ${brand?.name || 'Desconhecida'}
Segmento: ${brand?.segment || '—'}
Holding/Grupo: ${brand?.holding || '—'}

## Agência atual (${scope || 'geral'}): ${currentAgency?.agency || 'Não identificada'}
Agências anteriores: ${pastAgencies.slice(0, 5).join(', ') || 'Nenhuma registrada'}

## Líder de marketing atual: ${currentLeader ? `${currentLeader.name} (${currentLeader.title})` : 'Não identificado'}
${currentLeader?.start_date ? `Assumiu em: ${currentLeader.start_date.slice(0, 7)}` : ''}

## Histórico completo marca-agência:
${history.slice(0, 10).map(h =>
  `- ${h.agency} | ${h.scope} | ${h.year_start}${h.year_end ? `–${h.year_end}` : '–hoje'} | ${h.pitch_type || 'sem pitch'} | confiança: ${h.confidence}`
).join('\n') || '— Sem histórico —'}

## Agências que mais ganharam pitchs similares (escopo: ${scope || 'geral'}) recentemente:
${topWinners.join('\n') || '— Sem dados suficientes —'}

## Movimentações recentes de mercado (2023+):
${recentMovements.slice(0, 10).map(m =>
  `- ${m.agency} | ${m.scope} | ${m.year_start}/${m.month_start || '?'} | ${m.pitch_type || '—'}`
).join('\n') || '— Sem dados —'}`

  if (additionalContext) {
    ctx += `\n\n## Contexto adicional fornecido:\n${additionalContext}`
  }

  return ctx
}

// ─── Função principal ────────────────────────────────────────────────────────

/**
 * Gera predição de pitch
 * @param {Object} opts
 * @param {string} opts.brand             - Nome da marca que abriu o pitch
 * @param {string} opts.scope             - Escopo do pitch (Criação, Mídia, Digital, etc.)
 * @param {string} opts.additionalContext - Contexto extra (ex: "CMO novo, foco em digital")
 * @param {number} opts.topN              - Quantas agências sugerir (default 3)
 */
async function runPrediction({ brand, scope, additionalContext, topN = 3 }) {
  console.log(`[prediction] Gerando predição para: ${brand} | escopo: ${scope || 'geral'}`)

  // 1. Coleta contexto
  const [brandCtx, similarWinners, recentMovements] = await Promise.all([
    getBrandContext(brand),
    getSimilarPitchWinners({ scope, limit: 30 }),
    getRecentMarketMovements(2022),
  ])

  if (!brandCtx) {
    console.log(`[prediction] Marca "${brand}" não encontrada no banco — gerando com contexto limitado`)
  }

  // Perfis das agências candidatas
  const candidateNames = [...new Set(similarWinners.map(w => w.agency))].slice(0, 15)
  const agencyProfiles = await getAgencyProfiles(candidateNames)

  // 2. Monta contexto
  const contextText = buildPrompt({ brandCtx, similarWinners, recentMovements, scope, additionalContext })

  // 3. Claude analisa e prediz
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: `Você é um especialista em mercado publicitário brasileiro com 20 anos de experiência.
Analise os dados históricos fornecidos e gere uma predição fundamentada de quais agências têm maior probabilidade de vencer o pitch descrito.

Sua predição deve ser:
- Baseada nos dados históricos do banco (não invente fatos)
- Considerar padrões de relacionamento marca-agência
- Avaliar o perfil do CMO atual (agências de onde veio, estilo)
- Considerar movimentações recentes de mercado
- Honesta sobre incertezas quando dados são escassos

Retorne APENAS JSON válido neste formato:
{
  "predictions": [
    {
      "agency": "Nome da Agência",
      "probability": 0.45,
      "reasoning": "Justificativa concisa baseada nos dados",
      "signals": ["sinal 1", "sinal 2"],
      "risk": "baixo|médio|alto"
    }
  ],
  "market_context": "Análise geral do momento de mercado para esta marca",
  "data_quality": "alta|média|baixa",
  "data_quality_note": "Explicação sobre limitações dos dados",
  "recommended_watch": ["Agência para monitorar que pode surpreender"]
}`,
    messages: [{
      role: 'user',
      content: `Pitch aberto pela marca **${brand}**\nEscopo: ${scope || 'não especificado'}\nTop ${topN} agências mais prováveis\n\n${contextText}`,
    }]
  })

  const raw = response.content[0]?.text || '{}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Resposta inválida do Claude')

  const result = JSON.parse(jsonMatch[0])

  // Limita ao topN
  result.predictions = (result.predictions || []).slice(0, topN)

  return {
    brand,
    scope: scope || null,
    brand_found: !!brandCtx,
    brand_segment: brandCtx?.brand?.segment || null,
    current_agency: brandCtx?.history?.find(h => h.status === 'active' && (!scope || h.scope?.includes(scope)))?.agency || null,
    current_leader: brandCtx?.leaders?.find(l => l.is_current)?.name || null,
    history_records: brandCtx?.history?.length || 0,
    similar_pitches_analyzed: similarWinners.length,
    ...result,
    generated_at: new Date().toISOString(),
  }
}

module.exports = { runPrediction }
