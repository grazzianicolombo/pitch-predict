import { createContext, useContext, useState, useEffect, useRef } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)

const REFRESH_INTERVAL_MS = 50 * 60 * 1000 // 50 minutos

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const refreshTimer          = useRef(null)

  async function refreshToken() {
    try {
      // O cookie pp_refresh_token é enviado automaticamente (withCredentials)
      const { data } = await api.post('/auth/refresh', {})
      setUser(data.user)
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setUser(null)
        clearInterval(refreshTimer.current)
      }
      // Erros de rede: ignora, tenta de novo no próximo intervalo
    }
  }

  function startRefreshTimer() {
    clearInterval(refreshTimer.current)
    refreshTimer.current = setInterval(refreshToken, REFRESH_INTERVAL_MS)
  }

  // Restaura sessão chamando /auth/me — o cookie httpOnly é enviado automaticamente
  useEffect(() => {
    async function restoreSession() {
      try {
        const { data } = await api.get('/auth/me')
        setUser(data)
        startRefreshTimer()
      } catch (err) {
        // 401 = sem sessão válida — normal no primeiro acesso
        if (err?.response?.status !== 401) {
          console.warn('[auth] Falha ao restaurar sessão:', err?.message)
        }
        setUser(null)
      } finally {
        setLoading(false)
      }
    }
    restoreSession()
    return () => clearInterval(refreshTimer.current)
  }, [])

  async function login(email, password, remember = true) {
    const { data } = await api.post('/auth/login', { email, password, remember })
    // Cookies httpOnly são definidos pelo backend; apenas armazenamos o user no state
    setUser(data.user)
    startRefreshTimer()
    return data.user
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    // Backend limpa os cookies; apenas resetamos o state local
    clearInterval(refreshTimer.current)
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
