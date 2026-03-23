// Variáveis de ambiente injetadas pelo Doppler (local: doppler run -- node ...  |  prod: doppler run via start.sh)
// NÃO usar require('dotenv') — o Doppler CLI injeta direto no process.env antes do processo iniciar.
// Em desenvolvimento sem Doppler configurado, use: npm run dev:nodoppler (carrega .env local como fallback)
if (!process.env.DOPPLER_PROJECT && !process.env.SUPABASE_URL) {
  // Fallback para .env local apenas em dev (nunca em produção)
  require('dotenv').config()
}

const express      = require('express')
const cors         = require('cors')
const helmet       = require('helmet')
const rateLimit    = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const crypto       = require('crypto')
const { doubleCsrf } = require('csrf-csrf')

const brandsRouter      = require('./routes/brands')
const sourcesRouter     = require('./routes/sources')
const fieldsRouter      = require('./routes/fields')
const variablesRouter   = require('./routes/variables')
const agenciesRouter    = require('./routes/agencies')
const agentRouter       = require('./routes/agent')
const setupRouter       = require('./routes/setup')
const predictionsRouter = require('./routes/predictions')
const authRouter        = require('./routes/auth')
const { requireAuth }   = require('./lib/auth')

const app = express()
const PORT = process.env.PORT || 3001

// ── Segurança: headers HTTP via helmet ────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // permite assets de CDN
  contentSecurityPolicy: false, // API pura — CSP não se aplica
}))

// ── CORS fail-closed ──────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : []

if (allowedOrigins.length === 0) {
  if (process.env.NODE_ENV === 'production') {
    // Em produção sem ALLOWED_ORIGINS configurado é erro crítico — aborta
    console.error('[CORS] FATAL: ALLOWED_ORIGINS não definido em produção. Configure via Doppler.')
    process.exit(1)
  }
  // Em dev local, permite apenas localhost
  allowedOrigins.push('http://localhost:5173', 'http://localhost:3000')
  console.warn('[CORS] ALLOWED_ORIGINS não definido — permitindo apenas localhost.')
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// ── CSRF — Double Submit Cookie (defense-in-depth além do SameSite=Strict) ────
// Em produção, configure CSRF_SECRET no Doppler para consistência entre restarts.
// Em dev sem CSRF_SECRET: gera um segredo por processo (tokens expiram no restart).
const _csrfSecret = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex')

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret:            () => _csrfSecret,
  cookieName:           'pp_csrf',
  cookieOptions: {
    httpOnly: false,    // deve ser legível pelo JS do frontend para envio no header
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
  },
  getTokenFromRequest:  (req) => req.headers['x-csrf-token'],
  size:                 64,
  ignoredMethods:       ['GET', 'HEAD', 'OPTIONS'],
})

// Endpoint público para o frontend obter o token CSRF
app.get('/api/auth/csrf', (req, res) => {
  res.json({ token: generateToken(req, res) })
})

// Endpoints isentos de CSRF (pré-autenticação ou fluxo de reset por token)
const CSRF_EXEMPT = ['/auth/login', '/auth/refresh', '/auth/forgot-password', '/auth/set-password', '/auth/mfa/login-verify']

app.use('/api', (req, res, next) => {
  if (CSRF_EXEMPT.some(p => req.path.startsWith(p))) return next()
  if (req.path === '/health') return next()
  doubleCsrfProtection(req, res, (err) => {
    if (err) {
      console.warn(`[csrf] Token inválido: ${req.method} ${req.path} IP=${req.ip}`)
      return res.status(403).json({ error: 'Token CSRF inválido ou ausente' })
    }
    next()
  })
})

// ── Rate limit global: 300 req/min por usuário autenticado ou IP ──────────────
// Protege todos os endpoints CRUD de abuso/scraping em massa
app.use('/api', rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max: 300,
  keyGenerator: (req) => req.headers.authorization?.slice(-20) || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { error: 'Muitas requisições. Aguarde 1 minuto e tente novamente.' },
}))

// Autenticação — pública
app.use('/api/auth', authRouter)

// Todas as demais rotas exigem autenticação
app.use('/api/brands',      requireAuth, brandsRouter)
app.use('/api/sources',     requireAuth, sourcesRouter)
app.use('/api/fields',      requireAuth, fieldsRouter)
app.use('/api/variables',   requireAuth, variablesRouter)
app.use('/api/agencies',    requireAuth, agenciesRouter)
app.use('/api/agent',       requireAuth, agentRouter)
app.use('/api/setup',       requireAuth, setupRouter)
app.use('/api/predictions', requireAuth, predictionsRouter)

// Inicia o scheduler de agentes automáticos
require('./scheduler')

const { autoResume } = require('./lib/autoResume')

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// ── /.well-known/security.txt — RFC 9116 ─────────────────────────────────────
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send([
    'Contact: mailto:security@pitchpredict.com.br',
    'Expires: 2027-01-01T00:00:00.000Z',
    'Preferred-Languages: pt, en',
    'Policy: https://pitchpredict.com.br/security-policy',
  ].join('\n'))
})

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`)
  // Relança jobs que estavam rodando antes do restart
  autoResume()
})

module.exports = app
