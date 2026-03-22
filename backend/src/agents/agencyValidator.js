/**
 * Agente Validador de Agências — v2
 *
 * Regras de validação:
 * 1. Busca notícias de 2026 (últimos 3 meses) de cada agência via web_search
 * 2. SE encontrou notícia 2026 → agência ATIVA confirmada
 *    → Sugestão APENAS se a notícia reporta mudança (merge, encerramento, renomeação)
 * 3. SE não encontrou notícia 2026 → mantém sugestão como confiança BAIXA
 * 4. SE notícia confirma mudança estrutural → confiança ALTA
 *
 * Isso elimina falsos positivos: agências com notícias recentes nunca são sugeridas como encerradas.
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um especialista em mercado de publicidade e comunicação do Brasil.
Hoje é março de 2026. Você tem acesso a buscas na web.

REGRA PRINCIPAL:
- Antes de sugerir qualquer mudança (encerramento, absorção, renomeação) sobre uma agência, você DEVE buscar notícias dela no período janeiro-março 2026.
- Se encontrar notícias de 2026 confirmando atividade normal → agência está ATIVA, não sugira encerramento.
- Se encontrar notícias de 2026 sobre merge/encerramento/renomeação → sugestão com confiança ALTA.
- Se NÃO encontrar nenhuma notícia de 2026 → pode sugerir mas com confiança BAIXA.

CAMPOS QUE VOCÊ PODE SUGERIR MUDAR:
- name: nome da agência mudou
- group_name: holding incorreta
- status: "encerrada" ou "absorvida"
- absorbed_by: nome da agência que absorveu

FORMATO DE RETORNO (JSON estrito, sem markdown):
{
  "agencias_verificadas": [
    {
      "id": "uuid",
      "nome": "nome atual",
      "news_found": true/false,
      "news_headline": "manchete da notícia mais recente encontrada ou null",
      "news_url": "url ou null",
      "search_queries": ["query usada na busca"],
      "status_confirmado": "ativa|encerrada|renomeada|absorvida|indefinida",
      "sugestoes": [
        {
          "campo": "name|group_name|status|absorbed_by",
          "valor_atual": "...",
          "valor_sugerido": "...",
          "motivo": "explicação baseada na notícia encontrada",
          "confianca": "alta|média|baixa",
          "evidencia": "trecho ou resumo da notícia que justifica"
        }
      ]
    }
  ],
  "resumo": "resumo geral em português"
}`

// web_search_20250305 é uma server tool: Claude busca internamente e retorna end_turn diretamente.
// Não precisamos de loop manual — uma única chamada já retorna os resultados de busca embutidos.
async function runAgenticLoop(agencies) {
  const agencyList = agencies.map(a => ({
    id: a.id,
    nome: a.name,
    grupo: a.group_name,
    status: a.status || 'ativa',
  }))

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Valide as seguintes agências do mercado publicitário brasileiro buscando notícias de jan-mar 2026. Para cada agência faça ao menos uma busca. Retorne APENAS o JSON conforme o sistema instrui — sem texto adicional.

Lista:
${JSON.stringify(agencyList, null, 2)}`
    }],
  })

  // Extrai o último bloco de texto (após as buscas)
  const textBlocks = response.content.filter(b => b.type === 'text')
  if (!textBlocks.length) throw new Error('Agente não retornou texto')
  // Último bloco é o JSON final
  return textBlocks[textBlocks.length - 1].text
}

async function validateAgencies(onProgress) {
  const { data: agencies, error } = await supabase
    .from('agency_profiles')
    .select('id, name, group_name, status, former_names')
    .eq('status', 'ativa')
    .order('group_name, name')

  if (error) throw new Error('Erro ao buscar agências: ' + error.message)

  // Processa em lotes de 8 (menos por lote = busca mais focada)
  const BATCH_SIZE = 8
  const allResults = []
  let overallSummary = []
  const totalBatches = Math.ceil(agencies.length / BATCH_SIZE)
  if (onProgress) onProgress(0, totalBatches)

  for (let i = 0; i < agencies.length; i += BATCH_SIZE) {
    const batch = agencies.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    console.log(`[Agente] Lote ${batchNum}/${totalBatches}: ${batch.map(a => a.name).join(', ')}`)

    try {
      const rawJson = await runAgenticLoop(batch)

      // Extrai JSON do texto
      const jsonMatch = rawJson.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Resposta sem JSON válido')
      const parsed = JSON.parse(jsonMatch[0])

      if (parsed.agencias_verificadas) {
        allResults.push(...parsed.agencias_verificadas)
      }
      if (parsed.resumo) {
        overallSummary.push(parsed.resumo)
      }
    } catch (e) {
      console.error(`[Agente] Erro no lote ${batchNum}:`, e.message)
    }
    if (onProgress) onProgress(batchNum, totalBatches)
  }

  // Atualiza news_confirmed_at das agências onde encontrou notícia 2026
  const confirmedActive = allResults.filter(r => r.news_found && r.status_confirmado === 'ativa')
  for (const agency of confirmedActive) {
    await supabase
      .from('agency_profiles')
      .update({
        news_confirmed_at: new Date().toISOString(),
        news_headline: agency.news_headline,
        news_url: agency.news_url,
        last_validated_at: new Date().toISOString(),
      })
      .eq('id', agency.id)
  }

  // Monta sugestões finais (apenas agências com sugestões reais)
  const suggestions = []
  for (const agency of allResults) {
    for (const s of (agency.sugestoes || [])) {
      suggestions.push({
        agency_id: agency.id,
        agency_name: agency.nome,
        tipo: s.campo === 'name' ? 'renomeada' : s.campo === 'status' ? (s.valor_sugerido === 'encerrada' ? 'encerrada' : 'absorvida') : 'correção',
        campo: s.campo,
        valor_atual: s.valor_atual,
        valor_sugerido: s.valor_sugerido,
        motivo: s.motivo,
        confianca: s.confianca,
        evidencia: s.evidencia,
        news_found: agency.news_found,
        search_queries: agency.search_queries || [],
      })
    }
  }

  return {
    agencies,
    suggestions,
    confirmed_active: confirmedActive.length,
    summary: overallSummary.join(' | ') || 'Validação concluída.',
  }
}

async function saveSuggestions(suggestions) {
  if (!suggestions.length) return 0

  const rows = suggestions.map(s => ({
    entity_type: 'agency',
    entity_id: s.agency_id,
    entity_name: s.agency_name,
    field_name: s.campo,
    current_value: s.valor_atual,
    suggested_value: s.valor_sugerido,
    reason: s.motivo,
    confidence: s.confianca,
    evidence: s.evidencia,
    news_found: s.news_found,
    search_queries: s.search_queries,
    source: 'agente-validador-v2-websearch',
    status: 'pendente',
  }))

  // Limpa pendentes anteriores para as mesmas entidades
  const ids = suggestions.map(s => s.agency_id).filter(Boolean)
  if (ids.length) {
    await supabase
      .from('validation_queue')
      .delete()
      .in('entity_id', ids)
      .eq('status', 'pendente')
      .eq('entity_type', 'agency')
  }

  const { data, error } = await supabase
    .from('validation_queue')
    .insert(rows)
    .select()

  if (error) throw new Error('Erro ao salvar sugestões: ' + error.message)
  return data.length
}

async function applySuggestion(queueId) {
  const { data: item, error } = await supabase
    .from('validation_queue')
    .select('*')
    .eq('id', queueId)
    .single()

  if (error || !item) throw new Error('Sugestão não encontrada')
  if (item.status !== 'pendente') throw new Error('Sugestão já processada')

  if (item.entity_type === 'agency') {
    const update = { last_validated_at: new Date().toISOString() }

    if (item.field_name === 'name') {
      const { data: agency } = await supabase
        .from('agency_profiles')
        .select('former_names, name')
        .eq('id', item.entity_id)
        .single()

      update.name = item.suggested_value
      update.former_names = [...new Set([...(agency?.former_names || []), agency?.name])]

    } else if (item.field_name === 'status') {
      update.status = item.suggested_value
    } else if (item.field_name === 'group_name') {
      update.group_name = item.suggested_value
    } else if (item.field_name === 'absorbed_by') {
      update.absorbed_by = item.suggested_value
      update.status = 'absorvida'
    }

    await supabase.from('agency_profiles').update(update).eq('id', item.entity_id)
  }

  await supabase
    .from('validation_queue')
    .update({ status: 'aprovado', reviewed_at: new Date().toISOString() })
    .eq('id', queueId)

  return true
}

async function rejectSuggestion(queueId) {
  await supabase
    .from('validation_queue')
    .update({ status: 'rejeitado', reviewed_at: new Date().toISOString() })
    .eq('id', queueId)
  return true
}

module.exports = { validateAgencies, saveSuggestions, applySuggestion, rejectSuggestion }
