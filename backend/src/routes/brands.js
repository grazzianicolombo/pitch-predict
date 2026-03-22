const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')

function safeUrl(val) {
  if (!val) return null
  try { new URL(val); return val } catch { return null }
}
function safeStr(val, max = 255) {
  return val ? String(val).trim().slice(0, max) : null
}

// GET /api/brands — listar com líder atual
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('brands')
    .select('*, marketing_leaders(id, name, title, is_current), agency_history(id, agency, scope, year_start, year_end, status)')
    .order('name')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/brands/:id — detalhe
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('brands')
    .select('*, marketing_leaders(*), agency_history(*)')
    .eq('id', req.params.id)
    .single()
  if (error) return res.status(404).json({ error: 'Marca não encontrada' })
  res.json(data)
})

// POST /api/brands — criar
router.post('/', async (req, res) => {
  const { name, segment, group_name, website, notes,
    country_of_origin, revenue_estimate, marketing_team_size,
    is_listed, year_in_brazil, linkedin_company_url, instagram_handle } = req.body
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name obrigatório' })
  const { data, error } = await supabase
    .from('brands')
    .insert({
      name:                safeStr(name),
      segment:             safeStr(segment),
      group_name:          safeStr(group_name),
      website:             safeUrl(website),
      notes:               safeStr(notes, 2000),
      country_of_origin:   safeStr(country_of_origin),
      revenue_estimate:    safeStr(revenue_estimate),
      marketing_team_size: marketing_team_size != null ? parseInt(marketing_team_size) : null,
      is_listed:           !!is_listed,
      year_in_brazil:      year_in_brazil != null ? parseInt(year_in_brazil) : null,
      linkedin_company_url: safeUrl(linkedin_company_url),
      instagram_handle:    safeStr(instagram_handle),
    })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/brands/:id — atualizar
router.put('/:id', async (req, res) => {
  const { name, segment, group_name, website, notes,
    country_of_origin, revenue_estimate, marketing_team_size,
    is_listed, year_in_brazil, linkedin_company_url, instagram_handle } = req.body
  const { data, error } = await supabase
    .from('brands')
    .update({
      name:                safeStr(name),
      segment:             safeStr(segment),
      group_name:          safeStr(group_name),
      website:             safeUrl(website),
      notes:               safeStr(notes, 2000),
      country_of_origin:   safeStr(country_of_origin),
      revenue_estimate:    safeStr(revenue_estimate),
      marketing_team_size: marketing_team_size != null ? parseInt(marketing_team_size) : null,
      is_listed:           is_listed != null ? !!is_listed : undefined,
      year_in_brazil:      year_in_brazil != null ? parseInt(year_in_brazil) : null,
      linkedin_company_url: safeUrl(linkedin_company_url),
      instagram_handle:    safeStr(instagram_handle),
      updated_at:          new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/brands/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('brands').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

// --- HISTÓRICO DE AGÊNCIAS ---

// POST /api/brands/:id/history
router.post('/:id/history', async (req, res) => {
  const { agency, scope, year_start, year_end, status,
    agency_group, agency_website, month_start, month_end, pitch_type } = req.body
  const { data, error } = await supabase
    .from('agency_history')
    .insert({ brand_id: req.params.id, agency, scope, year_start, year_end, status,
      agency_group, agency_website, month_start, month_end, pitch_type })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/brands/:id/history/:hid
router.put('/:id/history/:hid', async (req, res) => {
  const { agency, scope, year_start, year_end, status,
    agency_group, agency_website, month_start, month_end, pitch_type } = req.body
  const { data, error } = await supabase
    .from('agency_history')
    .update({ agency, scope, year_start, year_end, status,
      agency_group, agency_website, month_start, month_end, pitch_type })
    .eq('id', req.params.hid)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/brands/:id/history/:hid
router.delete('/:id/history/:hid', async (req, res) => {
  const { error } = await supabase.from('agency_history').delete().eq('id', req.params.hid)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

// --- LÍDERES DE MARKETING ---

// POST /api/brands/:id/leaders
router.post('/:id/leaders', async (req, res) => {
  const { name, title, linkedin, start_date, end_date, is_current, team_size_estimate } = req.body
  if (is_current) {
    await supabase.from('marketing_leaders').update({ is_current: false }).eq('brand_id', req.params.id)
  }
  const { data, error } = await supabase
    .from('marketing_leaders')
    .insert({ brand_id: req.params.id, name, title, linkedin, start_date, end_date, is_current, team_size_estimate })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/brands/:id/leaders/:lid
router.put('/:id/leaders/:lid', async (req, res) => {
  const { name, title, linkedin, start_date, end_date, is_current, team_size_estimate } = req.body
  if (is_current) {
    await supabase.from('marketing_leaders').update({ is_current: false }).eq('brand_id', req.params.id)
  }
  const { data, error } = await supabase
    .from('marketing_leaders')
    .update({ name, title, linkedin, start_date, end_date, is_current, team_size_estimate })
    .eq('id', req.params.lid)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/brands/:id/leaders/:lid
router.delete('/:id/leaders/:lid', async (req, res) => {
  const { error } = await supabase.from('marketing_leaders').delete().eq('id', req.params.lid)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

module.exports = router
