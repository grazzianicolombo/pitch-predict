/**
 * securityLog.js
 *
 * Registra eventos de segurança em console estruturado (JSON) e opcionalmente
 * persiste na tabela `security_events` do Supabase (se existir).
 *
 * Uso:
 *   securityLog(req, 'LOGIN_SUCCESS', { userId })
 *   securityLog(req, 'LOGIN_FAILURE', { email, reason: 'invalid_credentials' })
 */

const supabase = require('./supabase')

// Eventos suportados — enum para evitar strings livres
const EVENTS = {
  // Auth
  LOGIN_SUCCESS:          'LOGIN_SUCCESS',
  LOGIN_FAILURE:          'LOGIN_FAILURE',
  LOGOUT:                 'LOGOUT',
  PASSWORD_CHANGE:        'PASSWORD_CHANGE',
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST',
  PASSWORD_SET:           'PASSWORD_SET',
  // User management
  USER_CREATED:           'USER_CREATED',
  USER_DELETED:           'USER_DELETED',
  USER_DEACTIVATED:       'USER_DEACTIVATED',
  ROLE_CHANGED:           'ROLE_CHANGED',
  // Access control
  AUTH_FAILURE:           'AUTH_FAILURE',
  RATE_LIMIT_HIT:         'RATE_LIMIT_HIT',
  UNAUTHORIZED_ACCESS:    'UNAUTHORIZED_ACCESS',
  INVALID_TOKEN:          'INVALID_TOKEN',
  SESSION_EXPIRED:        'SESSION_EXPIRED',
  // Data audit trail (CRUD)
  DATA_CREATE:            'DATA_CREATE',
  DATA_UPDATE:            'DATA_UPDATE',
  DATA_DELETE:            'DATA_DELETE',
}

/**
 * @param {import('express').Request|null} req  — requisição Express (pode ser null em contextos sem req)
 * @param {string} event                         — um dos valores em EVENTS
 * @param {object} [meta]                        — dados extras (userId, email, etc.)
 */
async function securityLog(req, event, meta = {}) {
  const entry = {
    ts:      new Date().toISOString(),
    event,
    ip:      req?.ip || req?.socket?.remoteAddress || null,
    ua:      req?.headers?.['user-agent']?.slice(0, 200) || null,
    method:  req?.method || null,
    path:    req?.path || null,
    userId:  meta.userId || req?.user?.id || null,
    ...meta,
  }

  // Sempre loga em console como JSON estruturado (visível no Railway/Papertrail/etc.)
  console.log(`[security] ${JSON.stringify(entry)}`)

  // Persiste no banco de forma assíncrona e silenciosa (não bloqueia a resposta)
  supabase
    .from('security_events')
    .insert({
      event,
      ip:       entry.ip,
      user_agent: entry.ua,
      user_id:  entry.userId,
      meta:     meta,
    })
    .then(({ error }) => {
      // Ignora silenciosamente se a tabela não existir (404/42P01)
      // A tabela é opcional — o log em console já garante observabilidade
      if (error && !error.message?.includes('does not exist') && !error.code?.includes('42P01')) {
        console.warn('[securityLog] DB insert failed:', error.message)
      }
    })
    .catch(() => {}) // nunca deixa o processo crashar por causa de log
}

/**
 * Convenience wrapper para eventos de auditoria de dados (CREATE/UPDATE/DELETE).
 * @param {import('express').Request} req
 * @param {'DATA_CREATE'|'DATA_UPDATE'|'DATA_DELETE'} action
 * @param {string} resource  — nome da tabela/recurso (ex: 'brand', 'agency_history')
 * @param {string|null} resourceId
 * @param {object} [extra]   — campos adicionais (ex: { name: 'Nike' })
 */
function dataLog(req, action, resource, resourceId, extra = {}) {
  securityLog(req, EVENTS[action] || action, {
    resource,
    resourceId,
    ...extra,
  })
}

module.exports = { securityLog, dataLog, EVENTS }
