import { createContext, useContext, useState, useEffect, useRef } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)

const AUTH_KEY = 'pp_auth'

function getStorage() {
  // Usa localStorage se "lembrar" foi marcado, senão sessionStorage
  return localStorage.getItem('pp_remember') === 'false' ? sessionStorage : localStorage
}

const REFRESH_INTERVAL_MS = 50 * 60 * 1000 // 50 minutos

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const refreshTimer          = useRef(null)

  async function refreshToken() {
    const stored = getStorage().getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY)
    if (!stored) return
    try {
      const auth = JSON.parse(stored)
      if (!auth.refresh_token) return
      const { data } = await api.post('/auth/refresh', { refresh_token: auth.refresh_token })
      getStorage().setItem(AUTH_KEY, JSON.stringify(data))
      api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
      setUser(data.user)
    } catch (err) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        getStorage().removeItem(AUTH_KEY)
        localStorage.removeItem(AUTH_KEY)
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

  // Restaura sessão (com refresh automático se expirado)
  useEffect(() => {
    async function restoreSession() {
      const stored = getStorage().getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY)
      if (stored) {
        try {
          const auth = JSON.parse(stored)
          const expiresAt = auth.expires_at ? new Date(auth.expires_at * 1000) : null
          const now = new Date()
          const expired = expiresAt && (expiresAt - now) < 5 * 60 * 1000

          if (!expiresAt || expired) {
            if (auth.refresh_token) {
              try {
                const { data } = await api.post('/auth/refresh', { refresh_token: auth.refresh_token })
                getStorage().setItem(AUTH_KEY, JSON.stringify(data))
                api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
                setUser(data.user)
                startRefreshTimer()
              } catch (err) {
                // Só limpa a sessão se for erro de autenticação (401/403), não de rede
                if (err?.response?.status === 401 || err?.response?.status === 403) {
                  getStorage().removeItem(AUTH_KEY)
                  localStorage.removeItem(AUTH_KEY)
                } else {
                  // Erro de rede: mantém token e deixa o usuário entrar com o token atual
                  setUser(auth.user)
                  api.defaults.headers.common['Authorization'] = `Bearer ${auth.access_token}`
                }
              }
            } else {
              getStorage().removeItem(AUTH_KEY)
              localStorage.removeItem(AUTH_KEY)
            }
          } else {
            setUser(auth.user)
            api.defaults.headers.common['Authorization'] = `Bearer ${auth.access_token}`
            startRefreshTimer()
          }
        } catch {
          localStorage.removeItem(AUTH_KEY)
          sessionStorage.removeItem(AUTH_KEY)
        }
      }
      setLoading(false)
    }
    restoreSession()
    return () => clearInterval(refreshTimer.current)
  }, [])

  async function login(email, password, remember = true) {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('pp_remember', remember ? 'true' : 'false')
    const storage = remember ? localStorage : sessionStorage
    storage.setItem(AUTH_KEY, JSON.stringify(data))
    // Remove do outro storage se existir
    if (remember) sessionStorage.removeItem(AUTH_KEY)
    else localStorage.removeItem(AUTH_KEY)
    api.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
    setUser(data.user)
    startRefreshTimer()
    return data.user
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem(AUTH_KEY)
    sessionStorage.removeItem(AUTH_KEY)
    localStorage.removeItem('pp_remember')
    delete api.defaults.headers.common['Authorization']
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
