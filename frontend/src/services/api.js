import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
  // Envia cookies httpOnly automaticamente em todas as requisições (CORS com credenciais)
  withCredentials: true,
})

// ── CSRF token — Double Submit Cookie ─────────────────────────────────────────
// Busca o token do backend (que seta o cookie pp_csrf) e o armazena em memória
// para envio como header X-CSRF-Token em todas as requisições de estado.
export async function initCsrfToken() {
  try {
    const { data } = await axios.get(`${BASE}/auth/csrf`, { withCredentials: true })
    api.defaults.headers.common['X-CSRF-Token'] = data.token
  } catch {
    // Falha silenciosa em dev sem backend; token será obtido no próximo request
  }
}
initCsrfToken()

// ─── Response interceptors ────────────────────────────────────────────────────
let _refreshing = false
let _queue = []

function processQueue(error) {
  _queue.forEach(({ resolve, reject }) => error ? reject(error) : resolve())
  _queue = []
}

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config

    // ── 403 CSRF: renova token e retenta uma vez ───────────────────────────────
    // Acontece quando o backend reinicia e gera novo CSRF_SECRET (token em memória
    // fica desatualizado). Renovar o token e reenviar resolve silenciosamente.
    if (
      error.response?.status === 403 &&
      error.response?.data?.error?.includes('CSRF') &&
      !original._csrfRetry
    ) {
      original._csrfRetry = true
      await initCsrfToken()
      original.headers['X-CSRF-Token'] = api.defaults.headers.common['X-CSRF-Token']
      return api(original)
    }

    // ── 401: renova access token via refresh cookie ────────────────────────────
    // Não tenta refresh para o próprio endpoint de refresh ou login (evita loop)
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/refresh') ||
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/me')
    ) {
      return Promise.reject(error)
    }

    if (_refreshing) {
      return new Promise((resolve, reject) => {
        _queue.push({ resolve, reject })
      }).then(() => api(original)).catch(err => Promise.reject(err))
    }

    original._retry = true
    _refreshing = true

    try {
      // O cookie pp_refresh_token é enviado automaticamente (withCredentials)
      await axios.post(`${BASE}/auth/refresh`, {}, { withCredentials: true })
      // Re-fetch CSRF token após refresh (cookie pode ter sido atualizado)
      await initCsrfToken()
      processQueue(null)
      return api(original)
    } catch (err) {
      processQueue(err)
      // Limpa qualquer estado residual e redireciona para login
      window.location.href = '/login'
      return Promise.reject(err)
    } finally {
      _refreshing = false
    }
  }
)

export const brandsAPI = {
  getAll: () => api.get('/brands'),
  getById: (id) => api.get(`/brands/${id}`),
  create: (data) => api.post('/brands', data),
  update: (id, data) => api.put(`/brands/${id}`, data),
  delete: (id) => api.delete(`/brands/${id}`),
  addHistory: (id, data) => api.post(`/brands/${id}/history`, data),
  updateHistory: (id, hid, data) => api.put(`/brands/${id}/history/${hid}`, data),
  deleteHistory: (id, hid) => api.delete(`/brands/${id}/history/${hid}`),
  addLeader: (id, data) => api.post(`/brands/${id}/leaders`, data),
  updateLeader: (id, lid, data) => api.put(`/brands/${id}/leaders/${lid}`, data),
  deleteLeader: (id, lid) => api.delete(`/brands/${id}/leaders/${lid}`)
}

export const sourcesAPI = {
  getAll: () => api.get('/sources'),
  create: (data) => api.post('/sources', data),
  update: (id, data) => api.put(`/sources/${id}`, data),
  delete: (id) => api.delete(`/sources/${id}`)
}

export const fieldsAPI = {
  getAll:    ()         => api.get('/fields'),
  create:    (data)     => api.post('/fields', data),
  update:    (id, data) => api.put(`/fields/${id}`, data),
  delete:    (id)       => api.delete(`/fields/${id}`),
  getEvents: (params)   => api.get('/fields/events', { params }),
  createEvent: (data)   => api.post('/fields/events', data),
}

export const variablesAPI = {
  getAll: () => api.get('/variables'),
  create: (data) => api.post('/variables', data),
  update: (id, data) => api.put(`/variables/${id}`, data),
  delete: (id) => api.delete(`/variables/${id}`)
}

export const agenciesAPI = {
  getAll: () => api.get('/agencies'),
  create: (data) => api.post('/agencies', data),
  update: (id, data) => api.put(`/agencies/${id}`, data),
  delete: (id) => api.delete(`/agencies/${id}`)
}

export default api
