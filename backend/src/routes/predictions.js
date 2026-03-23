const { dbError } = require('../lib/routeHelpers')
const express   = require('express')
const router    = express.Router()
const rateLimit = require('express-rate-limit')
const supabase  = require('../lib/supabase')
const { runPrediction } = require('../agents/predictionAgent')

// Rate limit específico para operações de IA: 10 por hora por usuário
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  validate: { keyGeneratorIpFallback: false }, // prefere user ID; fallback a req.ip é intencional
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de predições atingido (10/hora). Aguarde e tente novamente.' },
})

// ─── POST /api/predictions ───────────────────────────────────────────────────
// Gera uma nova predição de pitch
router.post('/', aiLimiter, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada' })
  }

  const { brand, scope, additionalContext, topN = 3 } = req.body
  if (!brand) return res.status(400).json({ error: 'Campo "brand" obrigatório' })

  try {
    const result = await runPrediction({ brand, scope, additionalContext, topN })

    // Persiste no banco para histórico
    const { data: saved } = await supabase
      .from('predictions')
      .insert({
        brand,
        scope:      scope || null,
        context:    additionalContext || null,
        result,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    res.json({ id: saved?.id, ...result })
  } catch (e) {
    console.error('[predictions] Erro:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/predictions/dashboard ─────────────────────────────────────────
// Calcula probabilidade de troca de agência por marca × escopo usando pesos do banco
router.get('/dashboard', async (req, res) => {
  const NOW_YEAR = new Date().getFullYear()
  const NOW_MONTH = new Date().getMonth() + 1

  // 1. Carrega dados em paralelo: histórico, brands, líderes, pesos dos sinais, signal_events
  const [
    { data: history, error: hErr },
    { data: brandsData },
    { data: leaders },
    { data: signalDefs },
    { data: signalEvents },
    { data: scopenData },
  ] = await Promise.all([
    supabase.from('agency_history')
      .select('brand_id, agency, scope, status, year_start, month_start, year_end, month_end, pitch_type, confidence')
      .order('year_start', { ascending: false }),
    supabase.from('brands').select('id, name, segment'),
    supabase.from('marketing_leaders').select('brand_id, name, title, is_current, start_date').eq('is_current', true),
    supabase.from('collected_fields').select('signal_key, weight, active').not('signal_key', 'is', null),
    supabase.from('signal_events').select('brand_id, signal_key, signal_name, weight_applied, evidence_text, captured_at, expires_at'),
    supabase.from('scopen_data').select('brand_id, brand_name, year, satisfaction_score, review_intent, review_probability'),
  ])

  if (hErr) return res.status(500).json({ error: hErr.message })

  // Mapa de pesos dos sinais (signal_key → weight)
  const weightMap = {}
  for (const s of (signalDefs || [])) {
    if (s.active) weightMap[s.signal_key] = s.weight
  }
  const w = (key, fallback) => weightMap[key] ?? fallback

  const brandMap = Object.fromEntries((brandsData || []).map(b => [b.id, b]))

  // CMO por brand
  const cmoByBrand = {}
  for (const l of (leaders || [])) {
    if (!cmoByBrand[l.brand_id]) cmoByBrand[l.brand_id] = l
  }

  // Signal events por brand (apenas não expirados)
  const now = new Date()
  const eventsByBrand = {}
  for (const ev of (signalEvents || [])) {
    if (ev.expires_at && new Date(ev.expires_at) < now) continue
    if (!eventsByBrand[ev.brand_id]) eventsByBrand[ev.brand_id] = []
    eventsByBrand[ev.brand_id].push(ev)
  }

  // Scopen por brand_id
  const scopenByBrand = {}
  for (const s of (scopenData || [])) {
    if (s.brand_id) scopenByBrand[s.brand_id] = s
  }

  // Scopes canônicos
  const CANONICAL_SCOPES = new Set(['Criação','Mídia','Digital','PR','Social','CRM','Performance','Branding','E-commerce','Conteúdo','Saúde','Varejo','Tecnologia'])
  const normalizeScope = s => (s && s.length <= 30 && CANONICAL_SCOPES.has(s)) ? s : 'Criação'

  // 2. Agrupa por brand + scope
  const grouped = {}
  for (const row of (history || [])) {
    const brand = brandMap[row.brand_id]
    if (!brand) continue
    const scope = normalizeScope(row.scope)
    const key = `${row.brand_id}||${scope}`
    if (!grouped[key]) {
      grouped[key] = { brand_id: row.brand_id, brand: brand.name, segment: brand.segment, scope, current: null, past: [], pitches: 0 }
    }
    const g = grouped[key]
    if (row.status === 'active' && !g.current) {
      g.current = { agency: row.agency, year_start: row.year_start, month_start: row.month_start }
    } else if (row.status === 'ended') {
      g.past.push(row.agency)
    }
    if (row.pitch_type === 'concorrência') g.pitches++
  }

  // 3. Calcula score de churn com pesos dinâmicos + todos os sinais
  // Escala: 0.0–1.0, clamped 0.05–0.95 (sem divisão — peso padrão gera ~0.45 igual ao modelo anterior)
  const SCORE_BASE = 0.15

  const results = []
  for (const g of Object.values(grouped)) {
    const signals = []   // { key, label, weight, evidence }
    let rawScore = SCORE_BASE

    // ── Tenure da agência atual ────────────────────────────────────────────
    if (g.current) {
      const yearsOn = NOW_YEAR - (g.current.year_start || NOW_YEAR) +
        (NOW_MONTH - (g.current.month_start || NOW_MONTH)) / 12
      if (yearsOn >= 5) {
        const wt = w('tenure_5plus', 2.5)
        rawScore += wt * 0.12
        signals.push({ key: 'tenure_5plus', label: `${Math.round(yearsOn)} anos com a mesma agência`, weight: wt })
      } else if (yearsOn >= 3) {
        const wt = w('tenure_3to4', 1.8)
        rawScore += wt * 0.07
        signals.push({ key: 'tenure_3to4', label: `${Math.round(yearsOn)} anos com a mesma agência`, weight: wt })
      } else if (yearsOn >= 2) {
        rawScore += 0.04
      }
    } else {
      rawScore += 0.05
      signals.push({ key: 'no_agency', label: 'Agência atual não identificada', weight: 0.5 })
    }

    // ── Histórico de trocas ────────────────────────────────────────────────
    const changes = g.past.length
    if (changes >= 4) {
      const wt = w('agency_change_history', 1.2)
      rawScore += wt * 0.18
      signals.push({ key: 'agency_change_history', label: `${changes} trocas históricas`, weight: wt })
    } else if (changes >= 2) {
      const wt = w('agency_change_history', 1.2)
      rawScore += wt * 0.09
      signals.push({ key: 'agency_change_history', label: `${changes} trocas históricas`, weight: wt })
    } else if (changes === 1) {
      rawScore += 0.03
    }

    // ── Pitchs anteriores ─────────────────────────────────────────────────
    if (g.pitches >= 2) {
      const wt = w('prior_pitch_multi', 2.2)
      rawScore += wt * 0.08
      signals.push({ key: 'prior_pitch_multi', label: `${g.pitches} concorrências realizadas`, weight: wt })
    } else if (g.pitches === 1) {
      const wt = w('prior_pitch_1', 1.8)
      rawScore += wt * 0.04
      signals.push({ key: 'prior_pitch_1', label: 'Já abriu concorrência antes', weight: wt })
    }

    // ── CMO recente ───────────────────────────────────────────────────────
    const cmo = cmoByBrand[g.brand_id]
    if (cmo?.start_date) {
      const cmoYear  = parseInt(cmo.start_date.slice(0, 4))
      const cmoMonth = parseInt(cmo.start_date.slice(5, 7)) || 1
      const monthsAgo = (NOW_YEAR - cmoYear) * 12 + (NOW_MONTH - cmoMonth)
      if (monthsAgo <= 12) {
        const wt = w('cmo_change', 3.0)
        rawScore += wt * 0.09
        signals.push({ key: 'cmo_change', label: `Novo CMO (${cmo.name}) há ${monthsAgo}m`, weight: wt })
      } else if (monthsAgo <= 24) {
        const wt = w('cmo_change', 3.0)
        rawScore += wt * 0.05
        signals.push({ key: 'cmo_change', label: `CMO ${cmo.name} assumiu em ${cmoYear}`, weight: wt })
      }
    }

    // ── Signal events capturados para esta brand ───────────────────────────
    const brandEvents = eventsByBrand[g.brand_id] || []
    for (const ev of brandEvents) {
      const wt = ev.weight_applied ?? w(ev.signal_key, 1.0)
      if (wt < 0) {
        // Sinal protetor (ex: campanha premiada)
        rawScore = Math.max(0, rawScore + wt * 0.06)
        signals.push({ key: ev.signal_key, label: ev.signal_name, weight: wt, evidence: ev.evidence_text, protective: true })
      } else {
        rawScore += wt * 0.07
        signals.push({ key: ev.signal_key, label: ev.signal_name, weight: wt, evidence: ev.evidence_text })
      }
    }

    // ── Scopen ────────────────────────────────────────────────────────────
    const scopen = scopenByBrand[g.brand_id]
    if (scopen) {
      if (scopen.review_intent) {
        const wt = w('scopen_review_intent', 3.5)
        rawScore += wt * 0.10
        signals.push({ key: 'scopen_review_intent', label: `Scopen ${scopen.year}: intenção de review declarada`, weight: wt })
      }
      if (scopen.satisfaction_score !== null && scopen.satisfaction_score < 7) {
        const wt = w('scopen_low_nps', 3.0)
        rawScore += wt * 0.09
        signals.push({ key: 'scopen_low_nps', label: `Scopen: satisfação ${scopen.satisfaction_score}/10`, weight: wt })
      }
    }

    // Normaliza para 0.05–0.95 (clamp direto — escala absoluta igual ao modelo anterior)
    const probability = Math.min(0.95, Math.max(0.05, rawScore))
    const risk = probability >= 0.65 ? 'alto' : probability >= 0.40 ? 'médio' : 'baixo'

    // ── Estimativa de prazo para abertura de pitch (meses) ────────────────
    // Baseado na probabilidade + sinais específicos de urgência
    let monthsBase = Math.round(36 * (1 - probability))   // 0.95 → ~2m; 0.05 → 34m
    // Ajuste fino por sinais de urgência:
    if (scopen?.review_intent)                                         monthsBase = Math.min(monthsBase, 8)
    if (signals.some(s => s.key === 'cmo_change' && s.label.includes('há') && parseInt(s.label.match(/há (\d+)m/)?.[1]) <= 6)) monthsBase = Math.min(monthsBase, 10)
    if (signals.some(s => s.key === 'scopen_low_nps'))                monthsBase = Math.min(monthsBase, 12)
    if (signals.some(s => s.key === 'ma_event' || s.key === 'holding_change')) monthsBase = Math.min(monthsBase, 6)
    if (signals.some(s => s.key === 'pitch_mention'))                 monthsBase = Math.min(monthsBase, 3)
    const months_to_pitch = Math.max(2, monthsBase)

    // Ordena sinais por peso desc para exibição
    signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

    results.push({
      brand_id:       g.brand_id,
      brand:          g.brand,
      segment:        g.segment,
      scope:          g.scope,
      current_agency: g.current?.agency || null,
      tenure_years:   g.current ? Math.round((NOW_YEAR - (g.current.year_start || NOW_YEAR)) * 10) / 10 : null,
      past_agencies:  g.past.length,
      pitches:        g.pitches,
      cmo:            cmo?.name || null,
      probability:    Math.round(probability * 100) / 100,
      months_to_pitch,
      risk,
      signals,
      signal_count:   signals.length,
    })
  }

  results.sort((a, b) => b.probability - a.probability)

  const stats = {
    total:  results.length,
    high:   results.filter(r => r.risk === 'alto').length,
    medium: results.filter(r => r.risk === 'médio').length,
    low:    results.filter(r => r.risk === 'baixo').length,
    scopes: [...new Set(results.map(r => r.scope))].sort(),
  }

  res.json({ stats, items: results })
})

// ─── GET /api/predictions ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('predictions')
    .select('id, brand, scope, context, result, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return dbError(res, error, 'predictions')
  res.json(data)
})

// ─── GET /api/predictions/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('id', req.params.id)
    .single()
  if (error) return res.status(404).json({ error: 'Predição não encontrada' })
  res.json(data)
})

module.exports = router
