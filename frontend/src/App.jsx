import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Brands from './pages/Brands'
import Sources from './pages/Sources'
import Fields from './pages/Fields'
import Variables from './pages/Variables'
import Agencies from './pages/Agencies'
import Validation from './pages/Validation'
import Pipeline from './pages/Pipeline'
import Setup from './pages/Setup'
import Archive from './pages/Archive'
import Predictions from './pages/Predictions'
import Login from './pages/Login'
import Users from './pages/Users'
import AuthCallback from './pages/AuthCallback'
import api from './services/api'
import './App.css'

const NAV_BASE = [
  {
    section: 'Inteligência',
    items: [
      { to: '/brands',    label: 'Marcas',    icon: '◈' },
      { to: '/agencies',  label: 'Agências',  icon: '◉' },
      { to: '/sources',   label: 'Fontes',    icon: '⊕' },
    ]
  },
  {
    section: 'Modelo',
    items: [
      { to: '/fields',    label: 'Sinais',    icon: '◎' },
      { to: '/variables', label: 'Variáveis', icon: '⊘' },
    ]
  },
  {
    section: 'Predição',
    items: [
      { to: '/predictions', label: 'Pitch Predict', icon: '◈' },
    ]
  },
  {
    section: 'Sistema',
    items: [
      { to: '/pipeline',   label: 'Status',        icon: '⟳' },
      { to: '/validation', label: 'Validação',     icon: '⊛' },
      { to: '/setup',      label: 'Configurações', icon: '⊙' },
    ]
  }
]

const NAV_SUPERADMIN = {
  section: 'Administração',
  items: [
    { to: '/users', label: 'Usuários', icon: '◎' },
  ]
}

const routeMeta = {
  '/brands':      { section: 'Inteligência', label: 'Marcas' },
  '/agencies':    { section: 'Inteligência', label: 'Agências' },
  '/sources':     { section: 'Inteligência', label: 'Fontes' },
  '/fields':      { section: 'Modelo',       label: 'Sinais' },
  '/variables':   { section: 'Modelo',       label: 'Variáveis' },
  '/predictions': { section: 'Predição',     label: 'Pitch Predict' },
  '/archive':     { section: 'Arquivo',      label: 'M&M Archive' },
  '/pipeline':    { section: 'Sistema',      label: 'Status' },
  '/validation':  { section: 'Sistema',      label: 'Validação' },
  '/setup':       { section: 'Sistema',      label: 'Configurações' },
  '/users':       { section: 'Administração',label: 'Usuários' },
}

function ChangePasswordModal({ onClose }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [ok, setOk]             = useState(false)
  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 8) { setMsg('Mínimo 8 caracteres.'); return }
    if (password !== confirm) { setMsg('As senhas não coincidem.'); return }
    setSaving(true); setMsg('')
    try {
      await api.post('/auth/change-password', { password })
      setOk(true)
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Erro ao alterar senha.')
    } finally { setSaving(false) }
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <h2 className="modal-title">Alterar senha</h2>
        {ok ? (
          <>
            <p style={{ fontSize: 13, color: '#16A34A', textAlign: 'center', margin: '16px 0' }}>
              ✅ Senha alterada com sucesso!
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>Fechar</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field" style={{ marginTop: 4 }}>
              <label className="field-label">NOVA SENHA</label>
              <input className="field-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="mínimo 8 caracteres" required />
            </div>
            <div className="field">
              <label className="field-label">CONFIRMAR SENHA</label>
              <input className="field-input" type="password" value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder="repita a nova senha" required />
            </div>
            {msg && <p style={{ fontSize: 12, color: '#DC2626', margin: '8px 0' }}>{msg}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Salvando…' : 'Alterar senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Topbar() {
  const { pathname } = useLocation()
  const { user, logout, isSuperadmin } = useAuth()
  const meta = routeMeta[pathname] || { section: '—', label: '—' }
  const [showChangePwd, setShowChangePwd] = useState(false)

  return (
    <div className="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="breadcrumb">
        <span>{meta.section}</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{meta.label}</span>
      </div>
      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {user.name}
            <span style={{
              marginLeft: 6, fontSize: 10, fontWeight: 700,
              padding: '2px 7px', borderRadius: 99,
              background: isSuperadmin ? '#7C3AED20' : '#2563EB20',
              color: isSuperadmin ? '#7C3AED' : '#2563EB',
            }}>
              {isSuperadmin ? 'SUPERADMIN' : 'USUÁRIO'}
            </span>
          </span>
          <button
            onClick={() => setShowChangePwd(true)}
            style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-dim)', cursor: 'pointer',
            }}
          >
            Alterar senha
          </button>
          <button
            onClick={logout}
            style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-dim)', cursor: 'pointer',
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  )
}

// Rota protegida — redireciona para login se não autenticado
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppLayout() {
  const { user, isSuperadmin, loading } = useAuth()

  if (loading) return null
  if (!user) return null

  const nav = isSuperadmin ? [...NAV_BASE, NAV_SUPERADMIN] : NAV_BASE

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-avatar">P</div>
          <div>
            <div className="sidebar-logo-name">Pitch Predict</div>
            <div className="sidebar-logo-tag">Radar de Mercado</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map(({ section, items }) => (
            <div key={section}>
              <div className="nav-section-label">{section}</div>
              {items.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-icon">{icon}</span>
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className="sidebar-status-dot" />
            Supabase conectado
          </div>
        </div>
      </aside>

      <main className="main">
        <Topbar />
        <div className="main-content">
          <Routes>
            <Route path="/"           element={<Navigate to="/brands" replace />} />
            <Route path="/brands"     element={<Brands />} />
            <Route path="/agencies"   element={<Agencies />} />
            <Route path="/sources"    element={<Sources />} />
            <Route path="/fields"     element={<Fields />} />
            <Route path="/variables"  element={<Variables />} />
            <Route path="/predictions" element={<Predictions />} />
            <Route path="/archive"    element={<Archive />} />
            <Route path="/pipeline"   element={<Pipeline />} />
            <Route path="/validation" element={<Validation />} />
            <Route path="/setup"      element={<Setup />} />
            <Route path="/users"      element={<Users />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
