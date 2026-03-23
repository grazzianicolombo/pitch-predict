/**
 * routeHelpers.js
 * Utilitários de segurança reutilizáveis nas rotas Express.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Valida se um valor é UUID v4 válido.
 */
function isUUID(val) {
  return UUID_RE.test(val)
}

/**
 * Middleware: valida req.params.id como UUID.
 * Retorna 400 se inválido — nunca chega ao handler.
 */
function requireValidId(req, res, next) {
  if (!isUUID(req.params.id)) {
    return res.status(400).json({ error: 'ID inválido' })
  }
  next()
}

/**
 * Middleware factory: valida múltiplos params como UUID.
 * Ex: requireValidIds('id', 'hid') valida req.params.id e req.params.hid.
 */
function requireValidIds(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      if (!isUUID(req.params[name])) {
        return res.status(400).json({ error: `Parâmetro '${name}' inválido` })
      }
    }
    next()
  }
}

/**
 * Retorna 500 genérico e loga detalhes server-side.
 * Nunca expõe mensagens internas do Supabase ao cliente.
 */
function dbError(res, error, context = 'DB') {
  console.error(`[${context}] ${error?.message || error}`)
  return res.status(500).json({ error: 'Erro interno. Tente novamente.' })
}

/**
 * Valida se uma URL é segura para ser requisitada pelo servidor (anti-SSRF).
 * Bloqueia: IPs privados (RFC 1918), localhost, link-local, loopback, metadata endpoints.
 * Permite apenas http/https com hostname público.
 *
 * @param {string} rawUrl
 * @returns {{ ok: boolean, error?: string }}
 */
function isSafeUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'URL inválida' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Protocolo não permitido (apenas http/https)' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Bloqueia hostnames literalmente privados/locais
  const BLOCKED_HOSTS = [
    'localhost', '0.0.0.0',
    'metadata.google.internal', // GCP metadata
    '169.254.169.254',          // AWS/Azure/GCP instance metadata
    '100.100.100.200',          // Alibaba Cloud metadata
  ]
  if (BLOCKED_HOSTS.includes(hostname)) {
    return { ok: false, error: 'Host não permitido (endereço reservado)' }
  }

  // Bloqueia IPs literais privados/reservados (RFC 1918, loopback, link-local)
  // Regex cobre os blocos mais comuns sem bibliotecas extras
  const PRIVATE_IP = /^(
    127\.|                          # loopback
    10\.|                           # RFC 1918
    192\.168\.|                     # RFC 1918
    172\.(1[6-9]|2\d|3[01])\.|     # RFC 1918
    169\.254\.|                     # link-local
    ::1$|                           # IPv6 loopback
    fc00:|fd                        # IPv6 ULA
  )/x
  // Versão sem flag /x (não suportada em JS):
  const PRIVATE_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc00:|fd)/
  if (PRIVATE_RE.test(hostname)) {
    return { ok: false, error: 'Host não permitido (IP privado ou reservado)' }
  }

  return { ok: true }
}

module.exports = { isUUID, requireValidId, requireValidIds, dbError, isSafeUrl }
