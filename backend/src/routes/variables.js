const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('model_variables').select('*').order('weight', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { name, weight, type, description, active } = req.body
  if (!name) return res.status(400).json({ error: 'name obrigatório' })
  const safeWeight = Math.min(Math.max(parseFloat(weight) || 1.0, 0), 100)
  const { data, error } = await supabase
    .from('model_variables')
    .insert({ name, weight: safeWeight, type, description, active })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.put('/:id', async (req, res) => {
  const { name, weight, type, description, active } = req.body
  const safeWeight = weight !== undefined ? Math.min(Math.max(parseFloat(weight), 0), 100) : undefined
  const updates = { name, type, description, active }
  if (safeWeight !== undefined) updates.weight = safeWeight
  const { data, error } = await supabase
    .from('model_variables')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('model_variables').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
