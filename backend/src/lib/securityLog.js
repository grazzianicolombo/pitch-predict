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
  LOGIN_SUCCESS:          'LOGIN_SUCCESS',
  LOGIN_FAILURE:          'LOGIN_FAILURE',
  LOGOUT:                 'LOGOUT',
  PASSWORD_CHANGE:        'PASSWORD_CHANGE',
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST',
  PASSWORD_SET:           'PASSWORD_SET',
  USER_CREATED:           'USER_CREATED',
  USER_DELETED:           'USER_DELETED',
  USER_DEACTIVATED:       'USER_DEACTIVATED',
  ROLE_CHANGED:           'ROLE_CHANGED',
  AUTH_FAILURE:           'AUTH_FAILURE',
  RATE_LIMIT_HIT:         'RATE_LIMIT_HIT',
  UNAUTHORIZED_ACCESS:    'UNAUTHORIZED_ACCESS',
  INVALID_TOKEN:          'INVALID_TOKEN',
  SESSION_EXPIRED:        'SESSION_EXPIRED',
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

module.exports = { securityLog, EVENTS }
