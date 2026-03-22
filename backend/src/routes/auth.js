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
const { requireAuth, requireRole } = require('../lib/auth')

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

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

// ─── Refresh token ───────────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório' })

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token })
  if (error || !data.session) return res.status(401).json({ error: 'Sessão inválida ou expirada' })

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, name, active')
    .eq('user_id', data.user.id)
    .single()

  if (!profile?.active) return res.status(403).json({ error: 'Usuário desativado' })

  res.json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
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

// ─── Cria usuário via convite por email (superadmin) ─────────────────────────

router.post('/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { name, email, role = 'user' } = req.body
  if (!name || !email) {
    return res.status(400).json({ error: 'name e email obrigatórios' })
  }
  if (!['superadmin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role inválido' })
  }

  const FRONTEND = process.env.FRONTEND_URL || 'https://pitch-predict.vercel.app'

  // Cria o usuário no Supabase Auth
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { name },
  })
  if (authErr) return res.status(400).json({ error: authErr.message })

  // Cria perfil
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('user_profiles')
    .insert({ user_id: authData.user.id, name, email, role, active: true })
    .select()
    .single()

  if (profErr) {
    // Rollback: remove o usuário do Auth se o perfil falhou
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
    return res.status(500).json({ error: profErr.message })
  }

  // Gera link de convite para o usuário definir a senha
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${FRONTEND}/auth/callback` },
  })
  if (linkErr) return res.status(500).json({ error: linkErr.message })

  // Envia email via Gmail SMTP
  const inviteUrl = linkData.properties.action_link
  await sendEmail({
    to: email,
    subject: 'Você foi convidado para o Pitch Predict',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 22px; font-weight: 800;">Pitch Predict</span>
        </div>
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Olá, ${name}!</h2>
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
  })

  res.status(201).json({
    id:      profile.id,
    name:    profile.name,
    email:   profile.email,
    role:    profile.role,
    invited: true,
  })
})

// ─── Define senha via token do email (convite / reset) ────────────────────────

router.post('/set-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Token e senha (mín. 8 caracteres) obrigatórios' })
  }

  // Valida o token e obtém o usuário
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Link inválido ou expirado' })

  // Atualiza a senha
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password })
  if (updErr) return res.status(500).json({ error: updErr.message })

  // Garante que o perfil existe e está ativo
  await supabaseAdmin
    .from('user_profiles')
    .update({ active: true })
    .eq('user_id', user.id)

  res.json({ ok: true, message: 'Senha definida com sucesso' })
})

// ─── Esqueci minha senha ──────────────────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email obrigatório' })

  const FRONTEND = process.env.FRONTEND_URL || 'https://pitch-predict.vercel.app'

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
              Olá, ${profile.name}! Recebemos uma solicitação para redefinir sua senha.
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

  // Sempre retorna ok (não revela se o email existe)
  res.json({ ok: true, message: 'Se este email estiver cadastrado, você receberá um link em breve.' })
})

// ─── Alterar senha (usuário logado) ──────────────────────────────────────────

router.post('/change-password', requireAuth, async (req, res) => {
  const { password } = req.body
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Nova senha deve ter mínimo 8 caracteres' })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password })
  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true, message: 'Senha alterada com sucesso' })
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

  if (delProfErr) return res.status(500).json({ error: delProfErr.message })

  // Remove o usuário do Supabase Auth
  const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(profile.user_id)
  if (delAuthErr) return res.status(500).json({ error: delAuthErr.message })

  res.json({ ok: true, message: 'Usuário removido' })
})

module.exports = router
