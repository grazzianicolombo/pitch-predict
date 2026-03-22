import { Link } from 'react-router-dom'

export default function Header({ backendStatus }) {
  return (
    <header style={{ padding: '1rem', background: '#007bff', color: 'white' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>🎯 Pitch Predict</h1>
        <nav style={{ display: 'flex', gap: '1rem' }}>
          <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>Dashboard</Link>
          <Link to="/new" style={{ color: 'white', textDecoration: 'none' }}>Novo Pitch</Link>
          <Link to="/analytics" style={{ color: 'white', textDecoration: 'none' }}>Analytics</Link>
        </nav>
        <span>{backendStatus === 'conectado' ? '🟢' : '🔴'} {backendStatus}</span>
      </div>
    </header>
  )
}
