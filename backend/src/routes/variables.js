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
  const { data, error } = await supabase
    .from('model_variables')
    .insert({ name, weight, type, description, active })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.put('/:id', async (req, res) => {
  const { name, weight, type, description, active } = req.body
  const { data, error } = await supabase
    .from('model_variables')
    .update({ name, weight, type, description, active })
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
