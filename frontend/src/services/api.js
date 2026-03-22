import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  headers: { 'Content-Type': 'application/json' }
})

// ─── Request interceptor: attach token ───────────────────────────────────────
api.interceptors.request.use(config => {
  try {
    const stored = localStorage.getItem('pp_auth')
    if (stored) {
      const { access_token } = JSON.parse(stored)
      if (access_token) config.headers['Authorization'] = `Bearer ${access_token}`
    }
  } catch {}
  return config
})

// ─── Response interceptor: auto-refresh on 401 ───────────────────────────────
let _refreshing = false
let _queue = []

function processQueue(error, token = null) {
  _queue.forEach(({ resolve, reject }) => error ? reject(error) : resolve(token))
  _queue = []
}

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config
    if (error.response?.status !== 401 || original._retry) return Promise.reject(error)

    if (_refreshing) {
      return new Promise((resolve, reject) => {
        _queue.push({ resolve, reject })
      }).then(token => {
        original.headers['Authorization'] = `Bearer ${token}`
        return api(original)
      })
    }

    original._retry = true
    _refreshing = true

    try {
      const stored = localStorage.getItem('pp_auth')
      if (!stored) throw new Error('no session')
      const { refresh_token } = JSON.parse(stored)
      if (!refresh_token) throw new Error('no refresh token')

      // Call backend refresh endpoint
      const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
      const { data } = await axios.post(`${baseURL}/auth/refresh`, { refresh_token })

      const newToken  = data.access_token
      const newRefresh = data.refresh_token

      // Update stored session
      localStorage.setItem('pp_auth', JSON.stringify(data))

      api.defaults.headers['Authorization'] = `Bearer ${newToken}`
      processQueue(null, newToken)
      original.headers['Authorization'] = `Bearer ${newToken}`
      return api(original)
    } catch (err) {
      processQueue(err, null)
      localStorage.removeItem('pp_auth')
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
