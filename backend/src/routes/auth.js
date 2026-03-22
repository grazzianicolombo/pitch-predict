/**
 * routes/auth.js — Endpoints de autenticação
 *
 * POST /api/auth/login         — login email+senha
 * POST /api/auth/logout        — invalida sessão
 * GET  /api/auth/me            — dados do usuário logado
 * GET  /api/auth/users         — lista usuários (superadmin)
 * POST /api/auth/users         — cria usuário (superadmin)
 * PATCH /api/auth/users/:id    — atualiza role/status (superadmin)
 * DELETE /api/auth/users/:id   — desativa usuário (superadmin)
 */

const express  = require('express')
const router   = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireRole } = require('../lib/auth')

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Login ───────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha obrigatórios' })
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password })
  if (error) {
    return res.status(401).json({ error: 'Email ou senha incorretos' })
  }

  // Carrega perfil
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, name, active')
    .eq('user_id', data.user.id)
    .single()

  if (!profile?.active) {
    return res.status(403).json({ error: 'Usuário desativado' })
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id:    data.user.id,
      email: data.user.email,
      name:  profile.name,
      role:  profile.role,
    }
  })
})

// ─── Logout ──────────────────────────────────────────────────────────────────

router.post('/logout', requireAuth, async (req, res) => {
  await supabaseAdmin.auth.admin.signOut(req.user.id)
  res.json({ ok: true })
})

// ─── Me ──────────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id:    req.user.id,
    email: req.user.email,
    name:  req.profile.name,
    role:  req.role,
  })
})

// ─── Lista usuários (superadmin) ─────────────────────────────────────────────

router.get('/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, user_id, name, email, role, active, created_at, last_login')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── Cria usuário (superadmin) ───────────────────────────────────────────────

router.post('/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { name, email, password, role = 'user' } = req.body
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email e password obrigatórios' })
  }
  if (!['superadmin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role inválido' })
  }

  // Cria no Supabase Auth
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authErr) return res.status(400).json({ error: authErr.message })

  // Cria perfil
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('user_profiles')
    .insert({ user_id: authData.user.id, name, email, role })
    .select()
    .single()

  if (profErr) return res.status(500).json({ error: profErr.message })

  res.status(201).json({
    id:    profile.id,
    name:  profile.name,
    email: profile.email,
    role:  profile.role,
  })
})

// ─── Atualiza role/status (superadmin) ───────────────────────────────────────

router.patch('/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params
  const { role, active, name } = req.body

  const updates = {}
  if (role   !== undefined) updates.role   = role
  if (active !== undefined) updates.active = active
  if (name   !== undefined) updates.name   = name

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── Desativa usuário (superadmin) ───────────────────────────────────────────

router.delete('/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({ active: false })
    .eq('id', id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, message: 'Usuário desativado' })
})

module.exports = router
