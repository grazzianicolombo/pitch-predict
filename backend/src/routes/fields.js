const { dbError, requireValidId, isUUID } = require('../lib/routeHelpers')
const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('collected_fields')
    .select('*')
    .order('category')
    .order('weight', { ascending: false })
  if (error) return dbError(res, error, 'fields')
  res.json(data)
})

router.post('/', async (req, res) => {
  const { name, category, signal_key, description, examples, weight, active } = req.body
  if (!name) return res.status(400).json({ error: 'name obrigatório' })
  const safeWeight = Math.min(Math.max(parseFloat(weight) || 1.0, 0), 100)
  const { data, error } = await supabase
    .from('collected_fields')
    .insert({ name, category, signal_key, description, examples, weight: safeWeight, active })
    .select()
    .single()
  if (error) return dbError(res, error, 'fields')
  res.status(201).json(data)
})

router.put('/:id', requireValidId, async (req, res) => {
  const { name, category, signal_key, description, examples, weight, active } = req.body
  const safeWeight = weight !== undefined ? Math.min(Math.max(parseFloat(weight), 0), 100) : undefined
  const updates = { name, category, signal_key, description, examples, active }
  if (safeWeight !== undefined) updates.weight = safeWeight
  const { data, error } = await supabase
    .from('collected_fields')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return dbError(res, error, 'fields')
  res.json(data)
})

// ── Signal Events (must be BEFORE /:id to avoid route conflict) ──────────────
router.get('/events', async (req, res) => {
  const { brand_id } = req.query
  const limit = Math.min(parseInt(req.query.limit) || 50, 500)
  let q = supabase
    .from('signal_events')
    .select('*, brands(name, segment)')
    .order('captured_at', { ascending: false })
    .limit(limit)
  if (brand_id) q = q.eq('brand_id', brand_id)
  const { data, error } = await q
  if (error) return dbError(res, error, 'fields')
  res.json(data)
})

router.post('/events', async (req, res) => {
  const { brand_id, signal_key, signal_name, weight_applied, evidence_text, source_article_id, expires_at, metadata } = req.body
  if (!isUUID(brand_id)) return res.status(400).json({ error: 'brand_id inválido' })
  // Verifica existência da marca antes de inserir
  const { data: brand } = await supabase.from('brands').select('id').eq('id', brand_id).single()
  if (!brand) return res.status(404).json({ error: 'Marca não encontrada' })
  const { data, error } = await supabase
    .from('signal_events')
    .insert({ brand_id, signal_key, signal_name, weight_applied, evidence_text, source_article_id, expires_at, metadata })
    .select()
    .single()
  if (error) return dbError(res, error, 'fields')
  res.status(201).json(data)
})

router.delete('/:id', requireValidId, async (req, res) => {
  const { error } = await supabase.from('collected_fields').delete().eq('id', req.params.id)
  if (error) return dbError(res, error, 'fields')
  res.json({ success: true })
})

module.exports = router
