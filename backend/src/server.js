require('dotenv').config({ override: true })
const express = require('express')
const cors = require('cors')

const brandsRouter = require('./routes/brands')
const sourcesRouter = require('./routes/sources')
const fieldsRouter = require('./routes/fields')
const variablesRouter = require('./routes/variables')
const agenciesRouter = require('./routes/agencies')
const agentRouter       = require('./routes/agent')
const setupRouter       = require('./routes/setup')
const predictionsRouter = require('./routes/predictions')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : '*',
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api/brands', brandsRouter)
app.use('/api/sources', sourcesRouter)
app.use('/api/fields', fieldsRouter)
app.use('/api/variables', variablesRouter)
app.use('/api/agencies', agenciesRouter)
app.use('/api/agent', agentRouter)
app.use('/api/setup', setupRouter)
app.use('/api/predictions', predictionsRouter)

// Inicia o scheduler de agentes automáticos
require('./scheduler')

const { autoResume } = require('./lib/autoResume')

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
