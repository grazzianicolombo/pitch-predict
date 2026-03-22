import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
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
import './App.css'

const nav = [
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
      { to: '/validation', label: 'Validação',    icon: '⊛' },
      { to: '/setup',      label: 'Configurações', icon: '⊙' },
    ]
  }
]

const routeMeta = {
  '/brands':     { section: 'Inteligência', label: 'Marcas' },
  '/agencies':   { section: 'Inteligência', label: 'Agências' },
  '/sources':    { section: 'Inteligência', label: 'Fontes' },
  '/fields':     { section: 'Modelo',       label: 'Sinais' },
  '/variables':  { section: 'Modelo',       label: 'Variáveis' },
  '/predictions': { section: 'Predição',     label: 'Pitch Predict' },
  '/archive':    { section: 'Arquivo',      label: 'M&M Archive' },
  '/pipeline':   { section: 'Sistema',      label: 'Status' },
  '/validation': { section: 'Sistema',      label: 'Validação' },
  '/setup':      { section: 'Sistema',      label: 'Configurações' },
}

function Topbar() {
  const { pathname } = useLocation()
  const meta = routeMeta[pathname] || { section: '—', label: '—' }
  return (
    <div className="topbar">
      <div className="breadcrumb">
        <span>{meta.section}</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-current">{meta.label}</span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
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
              <Route path="/"          element={<Navigate to="/brands" replace />} />
              <Route path="/brands"    element={<Brands />} />
              <Route path="/agencies"  element={<Agencies />} />
              <Route path="/sources"   element={<Sources />} />
              <Route path="/fields"    element={<Fields />} />
              <Route path="/variables"  element={<Variables />} />
              <Route path="/predictions" element={<Predictions />} />
              <Route path="/archive"    element={<Archive />} />
              <Route path="/pipeline"    element={<Pipeline />} />
              <Route path="/validation" element={<Validation />} />
              <Route path="/setup"      element={<Setup />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
