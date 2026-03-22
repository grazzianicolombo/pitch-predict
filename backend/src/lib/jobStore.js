/**
 * jobStore.js
 *
 * Persistência de jobs em disco (data/jobs.json) via Proxy reativo.
 * Qualquer atribuição em qualquer job — jobs[id].status = 'done',
 * jobs[id].progress = 42, etc. — dispara um persist() automático com
 * debounce de 500ms. Não é necessário alterar nenhum outro arquivo.
 *
 * Ao iniciar:
 *  - Carrega jobs do disco
 *  - Marca qualquer job "running" como "interrupted" (servidor caiu)
 *
 * Flush periódico a cada 30s como segurança extra.
 */

const fs   = require('fs')
const path = require('path')

const STORE_PATH = path.resolve(__dirname, '../../data/jobs.json')

// ─── Helpers de disco ──────────────────────────────────────────────────────

function ensureDir() {
  const dir = path.dirname(STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

let _timer = null
let _rawJobs = null   // referência ao objeto bruto (sem proxy) para serialização

function persist() {
  clearTimeout(_timer)
  _timer = setTimeout(_flush, 500)
}

function _flush() {
  if (!_rawJobs) return
  ensureDir()
  try {
    // Serializa os valores brutos (proxy é transparente ao JSON.stringify,
    // mas vamos iterar explicitamente para segurança)
    const plain = {}
    for (const [id, job] of Object.entries(_rawJobs)) {
      plain[id] = { ...job }
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(plain, null, 2))
  } catch (e) {
    console.error('[jobStore] Erro ao salvar:', e.message)
  }
}

// Flush periódico a cada 30s
setInterval(_flush, 30_000).unref()

// ─── Proxy reativo ──────────────────────────────────────────────────────────

/**
 * Envolve um job individual num Proxy que chama persist()
 * sempre que qualquer propriedade for alterada.
 */
function reactiveJob(obj) {
  return new Proxy(obj, {
    set(target, prop, value) {
      target[prop] = value
      persist()
      return true
    },
  })
}

/**
 * Envolve o mapa de jobs num Proxy que:
 *  - Ao criar um job (jobs[id] = {...}): envolve o valor em reactiveJob
 *  - Qualquer escrita no topo também chama persist()
 */
function reactiveJobs(raw) {
  return new Proxy(raw, {
    set(target, prop, value) {
      target[prop] = typeof value === 'object' && value !== null
        ? value  // já pode ser reactive — guarda o objeto bruto em _rawJobs
        : value
      persist()
      return true
    },
    get(target, prop) {
      const val = target[prop]
      // Wrap jobs individuais em reactive na leitura para interceptar
      // atribuições aninhadas: jobs[id].status = 'done'
      if (prop !== '__esModule' && typeof val === 'object' && val !== null && !val.__reactive) {
        const wrapped = reactiveJob(val)
        Object.defineProperty(val, '__reactive', { value: true, enumerable: false })
        return wrapped
      }
      return val
    },
  })
}

// ─── Carrega e exporta ──────────────────────────────────────────────────────

function load() {
  ensureDir()
  try {
    const raw  = fs.readFileSync(STORE_PATH, 'utf8')
    const data = JSON.parse(raw)

    let interrupted = 0
    for (const j of Object.values(data)) {
      if (j.status === 'running') {
        j.status = 'interrupted'
        j.error  = 'Servidor reiniciado durante execução'
        interrupted++
      }
    }

    console.log(`[jobStore] ${Object.keys(data).length} jobs carregados` +
      (interrupted ? `, ${interrupted} marcados como interrupted` : ''))

    // Flush imediato para persistir os "interrupted" antes do próximo ciclo
    if (interrupted > 0) {
      ensureDir()
      try { fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2)) } catch {}
    }

    return data
  } catch {
    return {}
  }
}

const rawJobs = load()
_rawJobs = rawJobs  // referência para o flush

const jobs = reactiveJobs(rawJobs)

module.exports = { jobs, persist }
