const { dbError } = require('../lib/routeHelpers')
const express = require('express')
const router  = express.Router()
const supabase = require('../lib/supabase')

// ─── Helpers ────────────────────────────────────────────────────────────────

// Retorna apenas se a chave está configurada — nunca expõe fragmentos
function isConfigured(key) {
  const val = process.env[key]
  return !!(val && val.length > 10 && !val.includes('...'))
}

// ─── GET /api/setup ─────────────────────────────────────────────────────────
// Retorna configuração de todas as APIs (apenas configured: true/false) + usage do DB
router.get('/', async (req, res) => {
  const apis = [
    {
      id:          'anthropic',
      name:        'Anthropic Claude',
      description: 'Motor de IA para validação e análise de dados',
      key_env:     'ANTHROPIC_API_KEY',
      configured:  isConfigured('ANTHROPIC_API_KEY'),
      docs_url:    'https://console.anthropic.com',
      model:       'claude-sonnet-4-5',
      pricing:     '$3 / 1M tokens input · $15 / 1M output',
    },
    {
      id:          'tavily',
      name:        'Tavily Search',
      description: 'Busca web com conteúdo completo — M&M, Propmark, LinkedIn',
      key_env:     'TAVILY_API_KEY',
      configured:  isConfigured('TAVILY_API_KEY'),
      docs_url:    'https://app.tavily.com',
      pricing:     'Free 1.000/mês · $1 / 1.000 buscas',
    },
    {
      id:          'pdl',
      name:        'People Data Labs',
      description: 'Dados de empresas e executivos — CMO, tamanho de equipe, LinkedIn',
      key_env:     'PDL_API_KEY',
      configured:  isConfigured('PDL_API_KEY'),
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
// Gerenciamento de chaves via Doppler — edição direta não é permitida
router.put('/key', (req, res) => {
  res.status(403).json({
    error: 'Edição de chaves desativada. Atualize os segredos diretamente no Doppler Dashboard.',
    doppler_url: 'https://dashboard.doppler.com',
  })
})

// ─── GET /api/setup/usage/log ────────────────────────────────────────────────
// Log detalhado de uso
router.get('/usage/log', async (req, res) => {
  const { data, error } = await supabase
    .from('api_usage')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return dbError(res, error, 'setup')
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
