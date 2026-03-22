const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')

// GET /api/agencies
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('agency_profiles')
    .select('id, name, group_name, holding, category, leadership, specialties, website, headquarters, status')
    .order('name')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/agencies
router.post('/', async (req, res) => {
  const { name, group_name, holding, category, leadership, website, headquarters, founded_year, specialties, employee_count } = req.body
  const { data, error } = await supabase
    .from('agency_profiles')
    .insert({ name, group_name, holding, category, leadership, website, headquarters, founded_year, specialties, employee_count })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/agencies/:id
router.put('/:id', async (req, res) => {
  const { name, group_name, holding, category, leadership, website, headquarters, founded_year, specialties, employee_count } = req.body
  const { data, error } = await supabase
    .from('agency_profiles')
    .update({ name, group_name, holding, category, leadership, website, headquarters, founded_year, specialties, employee_count })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/agencies/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('agency_profiles').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
