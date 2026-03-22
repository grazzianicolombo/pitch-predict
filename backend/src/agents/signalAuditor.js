/**
 * signalAuditor.js — Agente 5
 *
 * Analisa a cobertura de dados para cada sinal cadastrado.
 * Usa Claude para mapear quais agentes/fontes alimentam cada sinal
 * e identifica lacunas onde não há dados suficientes.
 *
 * Retorna um relatório com:
 *  - cobertura por sinal (coberto/parcial/sem cobertura)
 *  - quais agentes já alimentam cada categoria
 *  - sinais sem nenhum agente correspondente
 *  - sugestões de novos agentes para preencher lacunas
 */

const Anthropic = require('@anthropic-ai/sdk')
const supabase  = require('../lib/supabase')

const client = new Anthropic()

// ─── Contexto dos agentes existentes ─────────────────────────────────────────

const AGENTS_CONTEXT = `
Agentes ativos no Pitch Predict:

Agente 1 — Editoriais de Marketing
  Fontes: Propmark (artigos de marketing), M&M Website (edições pós-2017)
  Produz: artigos com conteúdo editorial sobre marcas/agências/executivos
  Alimenta: notícias de troca de agência, movimentações de executivos, pitches anunciados

Agente 2 — Extrator de Inteligência (Claude Haiku)
  Consome: saída do Agente 1
  Produz: agency_history (relações marca↔agência com datas), marketing_leaders (executivos e cargos)
  Alimenta: histórico de agência, trocas de executivo, datas de pitch

Agente 3 — Busca em Mídia de Negócios
  Fontes: Exame, Valor Econômico (RSS filtrado por marcas/agências)
  Produz: artigos de negócios mencionando as marcas
  Alimenta: contexto financeiro, movimentações corporativas, fusões/aquisições

Agente 4 — Enriquecimento de Executivos (PeopleDataLabs)
  Fonte: API PeopleDataLabs
  Produz: atualização de marketing_leaders com cargos atuais e histórico via LinkedIn
  Alimenta: executivos atuais e histórico de carreira

Agente 6 — Captura de Sinais
  Consome: saídas de todos os agentes anteriores + sinais cadastrados
  Produz: signal_events (eventos capturados por sinal para cada marca)
  Alimenta: diretamente os sinais do modelo preditivo

Dados disponíveis no banco:
- articles: artigos de Propmark, M&M Website, Exame, Valor (com content, excerpt, título)
- editions: edições M&M Website com text_content
- agency_history: relações marca↔agência (scope, year_start, year_end, status)
- marketing_leaders: executivos de marketing (name, title, is_current, start_date, end_date)
- signal_events: eventos de sinal capturados pelo Agente 6
- brands: marcas com segment, revenue_estimate, is_listed
- agency_profiles: perfis de agências

Dados NÃO disponíveis (sem agente atual):
- Resultados financeiros/balanços trimestrais
- Avaliações de Scopen (pesquisa proprietária)
- Dados de investimento publicitário (market share de mídia)
- Notas de satisfação de clientes com agências
- Dados de RH / tamanho do time de marketing em tempo real
`

const AUDIT_PROMPT = `Você é um auditor de dados para um sistema de predição de pitches publicitários no Brasil.

Abaixo estão os sinais cadastrados no modelo preditivo, organizados por categoria.
Cada sinal representa um fator que indica probabilidade de uma marca trocar de agência.

${AGENTS_CONTEXT}

Analise cada sinal e determine:
1. **coverage**: "full" (agente produz dados diretos), "partial" (agente produz dados indiretos/inferidos), "none" (nenhum agente cobre)
2. **agent**: qual agente alimenta (ex: "Agente 2", "Agente 4", ou "Nenhum")
3. **data_field**: campo da tabela que contém os dados (ex: "marketing_leaders.is_current")
4. **gap**: o que falta para cobertura completa (null se full)

Responda em JSON com este formato exato:
{
  "signals": [
    {
      "signal_key": "...",
      "signal_name": "...",
      "coverage": "full|partial|none",
      "agent": "...",
      "data_field": "...",
      "gap": "..." ou null
    }
  ],
  "missing_agents": [
    {
      "name": "Nome do Agente Sugerido",
      "purpose": "O que ele faria",
      "signals_covered": ["signal_key1", "signal_key2"],
      "data_source": "Fonte de dados a usar"
    }
  ],
  "summary": {
    "full": N,
    "partial": N,
    "none": N
  }
}

Sinais para auditar:
`

// ─── Auditoria principal ──────────────────────────────────────────────────────

async function runSignalAudit() {
  // Carrega sinais ativos
  const { data: signals } = await supabase
    .from('collected_fields')
    .select('id, name, category, signal_key, description')
    .eq('active', true)
    .order('category')

  if (!signals?.length) return { error: 'Nenhum sinal ativo cadastrado' }

  console.log(`[signal-auditor] Auditando ${signals.length} sinais...`)

  // Formata sinais para o prompt
  const signalList = signals.map(s =>
    `- signal_key: "${s.signal_key || s.name.toLowerCase().replace(/\s+/g, '_')}" | name: "${s.name}" | category: "${s.category}" | desc: "${s.description || ''}"`
  ).join('\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: AUDIT_PROMPT + signalList,
    }],
  })

  const raw = response.content[0]?.text || '{}'

  let audit
  try {
    audit = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    audit = match ? JSON.parse(match[0]) : { error: 'Falha no parse da resposta' }
  }

  // Enriquece com contagens reais do banco
  const [
    { count: articlesCount },
    { count: leadersCount },
    { count: agencyCount },
    { count: signalEventsCount },
  ] = await Promise.all([
    supabase.from('articles').select('*', { count: 'exact', head: true }),
    supabase.from('marketing_leaders').select('*', { count: 'exact', head: true }),
    supabase.from('agency_history').select('*', { count: 'exact', head: true }),
    supabase.from('signal_events').select('*', { count: 'exact', head: true }),
  ])

  audit.data_inventory = {
    articles:       articlesCount || 0,
    leaders:        leadersCount  || 0,
    agency_history: agencyCount   || 0,
    signal_events:  signalEventsCount || 0,
  }

  audit.total_signals = signals.length
  audit.audited_at    = new Date().toISOString()

  console.log(`[signal-auditor] Cobertura: ${JSON.stringify(audit.summary)}`)
  return audit
}

module.exports = { runSignalAudit }
