import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  headers: { 'Content-Type': 'application/json' }
})

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
