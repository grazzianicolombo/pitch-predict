import { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Restaura sessão do localStorage (com refresh automático se expirado)
  useEffect(() => {
    async function restoreSession() {
      const stored = localStorage.getItem('pp_auth')
      if (stored) {
        try {
          const auth = JSON.parse(stored)
          const expiresAt = auth.expires_at ? new Date(auth.expires_at * 1000) : null
          const now = new Date()
          const almostExpired = expiresAt && (expiresAt - now) < 5 * 60 * 1000 // < 5 min

          if (!expiresAt || almostExpired) {
            // Token expirado ou quase — tenta refresh
            if (auth.refresh_token) {
              try {
                const { data } = await api.post('/auth/refresh', { refresh_token: auth.refresh_token })
                localStorage.setItem('pp_auth', JSON.stringify(data))
                api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
                setUser(data.user)
              } catch {
                localStorage.removeItem('pp_auth')
              }
            } else {
              localStorage.removeItem('pp_auth')
            }
          } else {
            setUser(auth.user)
            api.defaults.headers.common['Authorization'] = `Bearer ${auth.access_token}`
          }
        } catch { localStorage.removeItem('pp_auth') }
      }
      setLoading(false)
    }
    restoreSession()
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
