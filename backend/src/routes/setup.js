const express = require('express')
const router  = express.Router()
const fs      = require('fs')
const path    = require('path')
const supabase = require('../lib/supabase')

const ENV_PATH = path.resolve(__dirname, '../../.env')

// ─── Helpers ────────────────────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 12) return '••••••••'
  return key.slice(0, 8) + '••••••••••••' + key.slice(-4)
}

function readEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  const map = {}
  raw.split('\n').forEach(line => {
    const [k, ...rest] = line.split('=')
    if (k && rest.length) map[k.trim()] = rest.join('=').trim()
  })
  return map
}

function writeEnvKey(key, value) {
  let raw = fs.readFileSync(ENV_PATH, 'utf8')
  const regex = new RegExp(`^${key}=.*$`, 'm')
  if (regex.test(raw)) {
    raw = raw.replace(regex, `${key}=${value}`)
  } else {
    raw += `\n${key}=${value}`
  }
  fs.writeFileSync(ENV_PATH, raw, 'utf8')
  process.env[key] = value  // aplica imediatamente sem reiniciar
}

// ─── GET /api/setup ─────────────────────────────────────────────────────────
// Retorna configuração de todas as APIs com chaves mascaradas + usage do DB
router.get('/', async (req, res) => {
  const env = readEnv()

  const apis = [
    {
      id:          'anthropic',
      name:        'Anthropic Claude',
      description: 'Motor de IA para validação e análise de dados',
      key_env:     'ANTHROPIC_API_KEY',
      key_masked:  maskKey(env.ANTHROPIC_API_KEY),
      configured:  !!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.includes('...'),
      docs_url:    'https://console.anthropic.com',
      model:       'claude-sonnet-4-5',
      pricing:     '$3 / 1M tokens input · $15 / 1M output',
    },
    {
      id:          'tavily',
      name:        'Tavily Search',
      description: 'Busca web com conteúdo completo — M&M, Propmark, LinkedIn',
      key_env:     'TAVILY_API_KEY',
      key_masked:  maskKey(env.TAVILY_API_KEY),
      configured:  !!env.TAVILY_API_KEY,
      docs_url:    'https://app.tavily.com',
      pricing:     'Free 1.000/mês · $1 / 1.000 buscas',
    },
    {
      id:          'pdl',
      name:        'People Data Labs',
      description: 'Dados de empresas e executivos — CMO, tamanho de equipe, LinkedIn',
      key_env:     'PDL_API_KEY',
      key_masked:  maskKey(env.PDL_API_KEY),
      configured:  !!env.PDL_API_KEY,
      docs_url:    'https://dashboard.peopledatalabs.com',
      pricing:     '$0,001 / registro · 100 créditos grátis/mês',
    },
  ]

  // Busca totais de uso por API no banco
  const { data: usageRows } = await supabase
    .from('api_usage')
    .select('api_name, requests, tokens_in, tokens_out, credits, cost_usd, created_at')
    .order('created_at', { ascending: false })

  // Agrega por api_name
  const usageMap = {}
  ;(usageRows || []).forEach(row => {
    if (!usageMap[row.api_name]) {
      usageMap[row.api_name] = { requests: 0, tokens_in: 0, tokens_out: 0, credits: 0, cost_usd: 0, last_used: null }
    }
    const u = usageMap[row.api_name]
    u.requests  += row.requests || 0
    u.tokens_in += row.tokens_in || 0
    u.tokens_out+= row.tokens_out || 0
    u.credits   += Number(row.credits) || 0
    u.cost_usd  += Number(row.cost_usd) || 0
    if (!u.last_used || row.created_at > u.last_used) u.last_used = row.created_at
  })

  // Últimas 10 entradas (log recente)
  const recent = (usageRows || []).slice(0, 10)

  apis.forEach(api => {
    api.usage = usageMap[api.id] || { requests: 0, tokens_in: 0, tokens_out: 0, credits: 0, cost_usd: 0, last_used: null }
  })

  res.json({ apis, recent_log: recent })
})

// ─── PUT /api/setup/key ──────────────────────────────────────────────────────
// Atualiza uma chave de API no .env
router.put('/key', (req, res) => {
  const { key_env, value } = req.body
  const ALLOWED = ['ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'PDL_API_KEY']

  if (!ALLOWED.includes(key_env)) {
    return res.status(400).json({ error: 'Chave não permitida' })
  }
  if (!value || value.length < 10) {
    return res.status(400).json({ error: 'Valor inválido' })
  }

  try {
    writeEnvKey(key_env, value)
    res.json({ success: true, message: `${key_env} atualizada e aplicada imediatamente` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/setup/usage/log ────────────────────────────────────────────────
// Log detalhado de uso
router.get('/usage/log', async (req, res) => {
  const { data, error } = await supabase
    .from('api_usage')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── POST /api/setup/test/:apiId ────────────────────────────────────────────
// Testa conexão com uma API
router.post('/test/:apiId', async (req, res) => {
  const { apiId } = req.params

  try {
    if (apiId === 'anthropic') {
      const Anthropic = require('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const r = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ok' }]
      })
      return res.json({ ok: true, model: r.model })
    }

    if (apiId === 'tavily') {
      const { tavily } = require('@tavily/core')
      const client = tavily({ apiKey: process.env.TAVILY_API_KEY })
      const r = await client.search('test', { maxResults: 1 })
      return res.json({ ok: true, results: r.results?.length })
    }

    if (apiId === 'pdl') {
      const https = require('https')
      const result = await new Promise((resolve, reject) => {
        https.get({
          hostname: 'api.peopledatalabs.com',
          path: '/v5/company/enrich?name=Google',
          headers: { 'X-Api-Key': process.env.PDL_API_KEY }
        }, res => {
          let body = ''
          res.on('data', d => body += d)
          res.on('end', () => resolve(JSON.parse(body)))
        }).on('error', reject)
      })
      return res.json({ ok: result.status === 200, status: result.status, company: result.display_name })
    }

    res.status(400).json({ error: 'API desconhecida' })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router
