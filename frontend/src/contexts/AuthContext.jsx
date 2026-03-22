import { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Restaura sessão do localStorage
  useEffect(() => {
    const stored = localStorage.getItem('pp_auth')
    if (stored) {
      try {
        const auth = JSON.parse(stored)
        // Verifica se o token não expirou
        if (auth.expires_at && new Date(auth.expires_at * 1000) > new Date()) {
          setUser(auth.user)
          api.defaults.headers.common['Authorization'] = `Bearer ${auth.access_token}`
        } else {
          localStorage.removeItem('pp_auth')
        }
      } catch { localStorage.removeItem('pp_auth') }
    }
    setLoading(false)
  }, [])

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('pp_auth', JSON.stringify(data))
    api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
    setUser(data.user)
    return data.user
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem('pp_auth')
    delete api.defaults.headers.common['Authorization']
    setUser(null)
  }

  const isSuperadmin = user?.role === 'superadmin'
  const isUser       = user?.role === 'user'

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isSuperadmin, isUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
