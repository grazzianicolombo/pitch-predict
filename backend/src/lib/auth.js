/**
 * auth.js — Middleware de autenticação e autorização
 *
 * Valida JWT do Supabase e injeta req.user + req.role.
 * Expõe requireAuth() e requireRole('superadmin').
 */

const { createClient } = require('@supabase/supabase-js')

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Valida token e injeta req.user ──────────────────────────────────────────

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }

  try {
    // Valida o token com Supabase Auth
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido ou expirado' })
    }

    // Carrega perfil com role
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, name, active')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return res.status(403).json({ error: 'Perfil não encontrado' })
    }
    if (!profile.active) {
      return res.status(403).json({ error: 'Usuário desativado' })
    }

    req.user    = user
    req.profile = profile
    req.role    = profile.role

    // Atualiza last_login sem bloquear
    supabaseAdmin
      .from('user_profiles')
      .update({ last_login: new Date().toISOString() })
      .eq('user_id', user.id)
      .then(() => {})

    next()
  } catch (e) {
    console.error('[auth] Token validation error:', e?.message || e)
    return res.status(401).json({ error: 'Erro ao validar token' })
  }
}

// ─── Verifica role ────────────────────────────────────────────────────────────

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.role) {
      return res.status(401).json({ error: 'Não autenticado' })
    }
    if (!roles.includes(req.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' })
    }
    next()
  }
}

module.exports = { requireAuth, requireRole }
