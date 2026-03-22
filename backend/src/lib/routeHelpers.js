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

module.exports = { isUUID, requireValidId, requireValidIds, dbError }
