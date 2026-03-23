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

const express      = require('express')
const router       = express.Router()
const { createClient } = require('@supabase/supabase-js')
const nodemailer   = require('nodemailer')
const rateLimit    = require('express-rate-limit')
const { requireAuth, requireRole } = require('../lib/auth')
const { dbError } = require('../lib/routeHelpers')
const { securityLog, EVENTS } = require('../lib/securityLog')

// Escapa caracteres HTML para uso seguro em templates de email
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production'
// Frontend (Vercel) e backend (Railway) são origens diferentes — SameSite=None é necessário
// para que o browser envie cookies httpOnly em requests cross-origin (withCredentials: true).
// SameSite=None requer Secure=true (HTTPS), o que é garantido em produção.
const SAME_SITE = IS_PROD ? 'none' : 'lax'

// ACCESS TOKEN — curta duração, lido pelo requireAuth
function setAuthCookies(res, session, remember = true) {
  const accessMaxAge  = 60 * 60                          // 1 hora (segundos)
  const refreshMaxAge = remember
    ? 30 * 24 * 60 * 60  // 30 dias (lembrar)
    :      24 * 60 * 60  // 24 horas (sessão)

  res.cookie('pp_access_token', session.access_token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: SAME_SITE,
    path:     '/',
    maxAge:   accessMaxAge * 1000, // ms
  })
  res.cookie('pp_refresh_token', session.refresh_token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: SAME_SITE,
    path:     '/', // path='/' para compatibilidade com proxies reversos (Railway/nginx)
    maxAge:   refreshMaxAge * 1000,
  })
}

function clearAuthCookies(res) {
  res.clearCookie('pp_access_token',  { httpOnly: true, secure: IS_PROD, sameSite: SAME_SITE, path: '/' })
  res.clearCookie('pp_refresh_token', { httpOnly: true, secure: IS_PROD, sameSite: SAME_SITE, path: '/' })
}

// ─── Rate limiters ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
})

const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de redefinição. Aguarde 1 hora.' },
})

// ─── Validação de senha ───────────────────────────────────────────────────────
function validatePassword(password) {
  if (!password || password.length < 12) return 'Senha deve ter mínimo 12 caracteres'
  if (!/[A-Z]/.test(password)) return 'Senha deve conter pelo menos uma letra maiúscula'
  if (!/[0-9]/.test(password)) return 'Senha deve conter pelo menos um número'
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/.test(password)) return 'Senha deve conter pelo menos um caractere especial (!@#$%...)'
  return null
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Cria cliente Supabase com sessão do usuário (necessário para MFA API)
function getUserSupabase(accessToken) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function sendEmail({ to, subject, html }) {
  return mailer.sendMail({
    from: `"Pitch Predict" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  })
}

// ─── Login ───────────────────────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res) => {
  const { email, password, remember = true } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha obrigatórios' })
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password })
  if (error) {
    securityLog(req, EVENTS.LOGIN_FAILURE, { email, reason: 'invalid_credentials' })
    return res.status(401).json({ error: 'Email ou senha incorretos' })
  }

  // Carrega perfil
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, name, active')
    .eq('user_id', data.user.id)
    .single()

  if (!profile?.active) {
    securityLog(req, EVENTS.LOGIN_FAILURE, { email, userId: data.user.id, reason: 'account_disabled' })
    return res.status(403).json({ error: 'Usuário desativado' })
  }

  // Verifica se superadmin tem MFA ativo — se sim, exige 2ª etapa
  if (profile.role === 'superadmin') {
    const { data: adminUser } = await supabaseAdmin.auth.admin.getUserById(data.user.id)
    const verifiedTotp = adminUser?.user?.factors?.find(f => f.factor_type === 'totp' && f.status === 'verified')
    if (verifiedTotp) {
      // Armazena sessão temporária (10min) para verificação do TOTP
      res.cookie('pp_mfa_token', data.session.access_token, {
        httpOnly: true, secure: IS_PROD, sameSite: SAME_SITE, path: '/', maxAge: 10 * 60 * 1000,
      })
      securityLog(req, 'MFA_CHALLENGE_ISSUED', { userId: data.user.id, email })
      return res.json({ mfa_required: true, factor_id: verifiedTotp.id })
    }
  }

  securityLog(req, EVENTS.LOGIN_SUCCESS, { userId: data.user.id, email })
  setAuthCookies(res, data.session, remember !== false)
  res.json({
    user: {
      id:    data.user.id,
      email: data.user.email,
      name:  profile.name,
      role:  profile.role,
    }
  })
})

// ─── Refresh token ───────────────────────────────────────────────────────────

router.post('/refresh', authLimiter, async (req, res) => {
  // Accept refresh token from httpOnly cookie (preferred) or request body (backward compat)
  const refresh_token = req.cookies?.pp_refresh_token || req.body?.refresh_token
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório' })

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token })
  if (error || !data.session) return res.status(401).json({ error: 'Sessão inválida ou expirada' })

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, name, active')
    .eq('user_id', data.user.id)
    .single()

  if (!profile?.active) return res.status(403).json({ error: 'Usuário desativado' })

  setAuthCookies(res, data.session)
  res.json({
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
  securityLog(req, EVENTS.LOGOUT, { userId: req.user.id })
  clearAuthCookies(res)
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

  if (error) return dbError(res, error, 'auth-list-users')
  res.json(data)
})

// ─── Cria usuário via convite por email (superadmin) ─────────────────────────

router.post('/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { name, email, role = 'user' } = req.body
  if (!name || !email) {
    return res.status(400).json({ error: 'name e email obrigatórios' })
  }
  if (!['superadmin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role inválido' })
  }

  const FRONTEND = process.env.FRONTEND_URL
  if (!FRONTEND) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[auth] FRONTEND_URL não configurada em produção — links de convite podem estar incorretos')
    }
  }
  const frontendUrl = FRONTEND || 'http://localhost:5173'

  // Cria o usuário no Supabase Auth
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name },
  })
  if (authErr) return dbError(res, authErr, 'auth-create-user')

  // Cria perfil
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('user_profiles')
    .insert({ user_id: authData.user.id, name, email, role, active: true })
    .select()
    .single()

  if (profErr) {
    // Rollback: remove o usuário do Auth se o perfil falhou
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return dbError(res, profErr, 'auth-create-profile')
  }

  // Gera link de convite para o usuário definir a senha
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${frontendUrl}/auth/callback` },
  })
  if (linkErr) return dbError(res, linkErr, 'auth-generate-invite-link')

  securityLog(req, EVENTS.USER_CREATED, { createdBy: req.user.id, newUserId: authData.user.id, email, role })

  // Responde imediatamente — envia email em background
  res.status(201).json({
    id:      profile.id,
    name:    profile.name,
    email:   profile.email,
    role:    profile.role,
    invited: true,
  })

  // Envia email em background (não bloqueia a resposta)
  const inviteUrl = linkData.properties.action_link
  sendEmail({
    to: email,
    subject: 'Você foi convidado para o Pitch Predict',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 22px; font-weight: 800;">Pitch Predict</span>
        </div>
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Olá, ${escapeHtml(name)}!</h2>
        <p style="color: #555; margin-bottom: 24px;">
          Você foi convidado para acessar o <strong>Pitch Predict</strong> — inteligência preditiva para pitchs de agências.
        </p>
        <a href="${inviteUrl}" style="
          display: inline-block; padding: 12px 28px; border-radius: 8px;
          background: linear-gradient(135deg, #2563EB, #7C3AED);
          color: #fff; font-weight: 700; font-size: 15px; text-decoration: none;
        ">
          Ativar minha conta
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Este link expira em 24 horas. Se não reconhece este convite, ignore este email.
        </p>
      </div>
    `,
  }).catch(err => console.error('[email] invite error:', err.message))
})

// ─── Define senha via token do email (convite / reset) ────────────────────────

router.post('/set-password', passwordLimiter, async (req, res) => {
  const { token, password } = req.body
  const passErr = validatePassword(password)
  if (!token || passErr) {
    return res.status(400).json({ error: passErr || 'Token obrigatório' })
  }

  // Valida o token e obtém o usuário
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Link inválido ou expirado' })

  // Atualiza a senha
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password })
  if (updErr) return dbError(res, updErr, 'auth-set-password')

  // Garante que o perfil existe e está ativo
  await supabaseAdmin
    .from('user_profiles')
    .update({ active: true })
    .eq('user_id', user.id)

  securityLog(req, EVENTS.PASSWORD_SET, { userId: user.id })
  res.json({ ok: true, message: 'Senha definida com sucesso' })
})

// ─── Esqueci minha senha ──────────────────────────────────────────────────────

router.post('/forgot-password', passwordLimiter, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email obrigatório' })

  // Garante tempo de resposta constante para prevenir enumeração de usuários por timing
  const MIN_RESPONSE_MS = 600
  const startedAt = Date.now()

  const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173'

  // Verifica se o usuário existe (sem revelar para o cliente)
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('name')
    .eq('email', email)
    .single()

  if (profile) {
    // Gera link de reset via Supabase
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${FRONTEND}/auth/callback` },
    })

    if (!linkErr && linkData) {
      const resetUrl = linkData.properties.action_link
      await sendEmail({
        to: email,
        subject: 'Redefinir senha — Pitch Predict',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <div style="margin-bottom: 24px;">
              <span style="font-size: 22px; font-weight: 800;">Pitch Predict</span>
            </div>
            <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Redefinir senha</h2>
            <p style="color: #555; margin-bottom: 24px;">
              Olá, ${escapeHtml(profile.name)}! Recebemos uma solicitação para redefinir sua senha.
            </p>
            <a href="${resetUrl}" style="
              display: inline-block; padding: 12px 28px; border-radius: 8px;
              background: linear-gradient(135deg, #2563EB, #7C3AED);
              color: #fff; font-weight: 700; font-size: 15px; text-decoration: none;
            ">
              Redefinir minha senha
            </a>
            <p style="color: #999; font-size: 12px; margin-top: 24px;">
              Este link expira em 1 hora. Se não solicitou a redefinição, ignore este email.
            </p>
          </div>
        `,
      })
    }
  }

  // Loga a tentativa de reset (sem revelar se o email existe)
  securityLog(req, EVENTS.PASSWORD_RESET_REQUEST, { email: profile ? email : '[unknown]' })

  // Sempre retorna ok (não revela se o email existe)
  // Aguarda o tempo mínimo antes de responder para evitar timing attack
  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed))
  }
  res.json({ ok: true, message: 'Se este email estiver cadastrado, você receberá um link em breve.' })
})

// ─── Alterar senha (usuário logado) ──────────────────────────────────────────

router.post('/change-password', requireAuth, passwordLimiter, async (req, res) => {
  const { password } = req.body
  const passErr = validatePassword(password)
  if (passErr) {
    return res.status(400).json({ error: passErr })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password })
  if (error) return dbError(res, error, 'auth-change-password')

  // Invalida todas as sessões ativas exceto a atual (scope: 'others')
  // Garante que tokens roubados não permaneçam válidos após troca de senha
  await supabaseAdmin.auth.admin.signOut(req.user.id, { scope: 'others' }).catch(() => {})

  securityLog(req, EVENTS.PASSWORD_CHANGE, { userId: req.user.id })
  res.json({ ok: true, message: 'Senha alterada com sucesso' })
})

// ─── MFA (TOTP) ──────────────────────────────────────────────────────────────
// Apenas para contas superadmin. Usa Supabase MFA API (RFC 6238 / TOTP).

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas MFA. Aguarde 15 minutos.' },
})

// POST /api/auth/mfa/enroll — inicia enrollment TOTP (superadmin only)
router.post('/mfa/enroll', requireAuth, requireRole('superadmin'), async (req, res) => {
  const userSupabase = getUserSupabase(req.cookies.pp_access_token)
  const { data, error } = await userSupabase.auth.mfa.enroll({
    factorType: 'totp', issuer: 'PitchPredict', friendlyName: 'Authenticator',
  })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ factor_id: data.id, qr_code: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri })
})

// POST /api/auth/mfa/verify-enrollment — confirma enrollment com código TOTP
router.post('/mfa/verify-enrollment', mfaLimiter, requireAuth, requireRole('superadmin'), async (req, res) => {
  const { factor_id, code } = req.body
  if (!factor_id || !code) return res.status(400).json({ error: 'factor_id e code obrigatórios' })
  const userSupabase = getUserSupabase(req.cookies.pp_access_token)
  const { data: ch, error: chErr } = await userSupabase.auth.mfa.challenge({ factorId: factor_id })
  if (chErr) return res.status(400).json({ error: chErr.message })
  const { error: vErr } = await userSupabase.auth.mfa.verify({ factorId: factor_id, challengeId: ch.id, code })
  if (vErr) return res.status(401).json({ error: 'Código inválido. Verifique o autenticador e tente novamente.' })
  securityLog(req, 'MFA_ENROLLED', { userId: req.user.id })
  res.json({ ok: true })
})

// POST /api/auth/mfa/unenroll — remove fator MFA (superadmin only)
router.post('/mfa/unenroll', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { factor_id } = req.body
  if (!factor_id) return res.status(400).json({ error: 'factor_id obrigatório' })
  const userSupabase = getUserSupabase(req.cookies.pp_access_token)
  const { error } = await userSupabase.auth.mfa.unenroll({ factorId: factor_id })
  if (error) return res.status(400).json({ error: error.message })
  securityLog(req, 'MFA_UNENROLLED', { userId: req.user.id, factorId: factor_id })
  res.json({ ok: true })
})

// POST /api/auth/mfa/login-verify — verifica TOTP na 2ª etapa do login
router.post('/mfa/login-verify', mfaLimiter, async (req, res) => {
  const mfaToken = req.cookies?.pp_mfa_token
  if (!mfaToken) return res.status(401).json({ error: 'Sessão MFA não encontrada. Faça login novamente.' })
  const { factor_id, code } = req.body
  if (!factor_id || !code) return res.status(400).json({ error: 'factor_id e code obrigatórios' })

  const userSupabase = getUserSupabase(mfaToken)
  const { data: ch, error: chErr } = await userSupabase.auth.mfa.challenge({ factorId: factor_id })
  if (chErr) return res.status(400).json({ error: 'Erro ao criar desafio MFA' })

  const { error: vErr } = await userSupabase.auth.mfa.verify({ factorId: factor_id, challengeId: ch.id, code })
  if (vErr) {
    securityLog(req, 'MFA_VERIFY_FAILURE', { reason: vErr.message })
    return res.status(401).json({ error: 'Código inválido. Tente novamente.' })
  }

  // Obtém sessão atualizada (AAL2) após verificação MFA
  const { data: sessionData } = await userSupabase.auth.getSession()
  if (!sessionData?.session) return res.status(401).json({ error: 'Sessão não encontrada após MFA' })

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, name, active')
    .eq('user_id', sessionData.session.user.id)
    .single()
  if (!profile?.active) return res.status(403).json({ error: 'Usuário desativado' })

  res.clearCookie('pp_mfa_token', { httpOnly: true, secure: IS_PROD, sameSite: SAME_SITE, path: '/' })
  setAuthCookies(res, sessionData.session, true)
  securityLog(req, 'MFA_VERIFY_SUCCESS', { userId: sessionData.session.user.id })
  res.json({
    user: {
      id:    sessionData.session.user.id,
      email: sessionData.session.user.email,
      name:  profile.name,
      role:  profile.role,
    }
  })
})

// ─── Atualiza role/status (superadmin) ───────────────────────────────────────

router.patch('/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params
  const { role, active, name } = req.body

  // Valida existência antes de atualizar (evita IDOR silencioso)
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('id', id)
    .single()
  if (fetchErr || !existing) return res.status(404).json({ error: 'Usuário não encontrado' })

  // Valida role se fornecido
  if (role !== undefined && !['superadmin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role inválido' })
  }

  const updates = {}
  if (role   !== undefined) updates.role   = role
  if (active !== undefined) updates.active = !!active
  if (name   !== undefined) updates.name   = String(name).trim().slice(0, 100)

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return dbError(res, error, 'auth-patch-user')

  if (updates.role)    securityLog(req, EVENTS.ROLE_CHANGED,     { changedBy: req.user.id, targetId: id, newRole: updates.role })
  if (updates.active === false) securityLog(req, EVENTS.USER_DEACTIVATED, { changedBy: req.user.id, targetId: id })

  res.json(data)
})

// ─── Remove usuário permanentemente (superadmin) ─────────────────────────────

router.delete('/users/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params

  // Busca o user_id do Supabase Auth a partir do profile id
  const { data: profile, error: fetchErr } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('id', id)
    .single()

  if (fetchErr || !profile) return res.status(404).json({ error: 'Usuário não encontrado' })

  // Remove o perfil da tabela
  const { error: delProfErr } = await supabaseAdmin
    .from('user_profiles')
    .delete()
    .eq('id', id)

  if (delProfErr) return dbError(res, delProfErr, 'auth-delete-profile')

  // Remove o usuário do Supabase Auth
  const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(profile.user_id)
  if (delAuthErr) return dbError(res, delAuthErr, 'auth-delete-user')

  securityLog(req, EVENTS.USER_DELETED, { deletedBy: req.user.id, targetId: id })
  res.json({ ok: true, message: 'Usuário removido' })
})

module.exports = router
