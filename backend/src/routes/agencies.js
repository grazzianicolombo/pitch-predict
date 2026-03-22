const express = require('express')
const router  = express.Router()
const supabase = require('../lib/supabase')
const { requireValidId, dbError } = require('../lib/routeHelpers')

function safeUrl(val) {
  if (!val) return null
  try { new URL(val); return val } catch { return null }
}
function safeStr(val, max = 255) {
  return val ? String(val).trim().slice(0, max) : null
}
function safeInt(val, min = 0, max = 99999) {
  const n = parseInt(val)
  if (isNaN(n) || n < min || n > max) return null
  return n
}

// GET /api/agencies
router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 200, 500)
  const offset = Math.max(parseInt(req.query.offset) || 0,   0)
  const { data, error } = await supabase
    .from('agency_profiles')
    .select('id, name, group_name, holding, category, leadership, specialties, website, headquarters, status')
    .order('name')
    .range(offset, offset + limit - 1)
  if (error) return dbError(res, error, 'agencies')
  res.json(data)
})

// POST /api/agencies
router.post('/', async (req, res) => {
  const { name, group_name, holding, category, leadership, website,
    headquarters, founded_year, specialties, employee_count } = req.body
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name obrigatório' })
  const { data, error } = await supabase
    .from('agency_profiles')
    .insert({
      name:          safeStr(name),
      group_name:    safeStr(group_name),
      holding:       safeStr(holding),
      category:      safeStr(category),
      leadership:    safeStr(leadership),
      website:       safeUrl(website),
      headquarters:  safeStr(headquarters),
      founded_year:  safeInt(founded_year, 1800, 2100),
      specialties:   safeStr(specialties, 1000),
      employee_count: safeInt(employee_count, 0, 999999),
    })
    .select()
    .single()
  if (error) return dbError(res, error, 'agencies')
  res.status(201).json(data)
})

// PUT /api/agencies/:id
router.put('/:id', requireValidId, async (req, res) => {
  const { name, group_name, holding, category, leadership, website,
    headquarters, founded_year, specialties, employee_count } = req.body
  const { data, error } = await supabase
    .from('agency_profiles')
    .update({
      name:          safeStr(name),
      group_name:    safeStr(group_name),
      holding:       safeStr(holding),
      category:      safeStr(category),
      leadership:    safeStr(leadership),
      website:       safeUrl(website),
      headquarters:  safeStr(headquarters),
      founded_year:  safeInt(founded_year, 1800, 2100),
      specialties:   safeStr(specialties, 1000),
      employee_count: safeInt(employee_count, 0, 999999),
    })
    .eq('id', req.params.id)
    .select()
    .single()
  if (error) return dbError(res, error, 'agencies')
  res.json(data)
})

// GET /api/agencies/history
router.get('/history', async (req, res) => {
  const { data, error } = await supabase
    .from('agency_history')
    .select('id, brand_id, agency, scope, year_start, year_end, status, brands(name)')
    .order('year_start', { ascending: false })
    .limit(200)
  if (error) return dbError(res, error, 'agencies')
  res.json(data)
})

// DELETE /api/agencies/:id
router.delete('/:id', requireValidId, async (req, res) => {
  const { error } = await supabase.from('agency_profiles').delete().eq('id', req.params.id)
  if (error) return dbError(res, error, 'agencies')
  res.json({ success: true })
})

module.exports = router
