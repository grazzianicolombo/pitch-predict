import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import usePitchStore from '../store/pitchStore'
import PitchList from '../components/PitchList'
import PredictionCard from '../components/PredictionCard'

export default function Dashboard() {
  const { pitches, predictions, loading, error, fetchPitches, fetchPredictions } = usePitchStore()

  useEffect(() => {
    fetchPitches()
    fetchPredictions()
  }, [])

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>📊 Dashboard</h1>
        <Link to="/new" style={{ background: '#28a745', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px', textDecoration: 'none' }}>
          ➕ Novo Pitch
        </Link>
      </div>

      {error && <div style={{ background: '#f8d7da', color: '#721c24', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Total Pitches</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{pitches.length}</p>
        </div>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Predições</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{predictions.length}</p>
        </div>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Score Médio</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {predictions.length > 0 ? (predictions.reduce((sum, p) => sum + p.successScore, 0) / predictions.length).toFixed(1) : '—'}
          </p>
        </div>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Taxa Sucesso</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {predictions.length > 0 ? Math.round((predictions.filter(p => p.successScore >= 6).length / predictions.length) * 100) : 0}%
          </p>
        </div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>📝 Meus Pitches</h2>
      {loading ? <p>Carregando...</p> : pitches.length === 0 ? <p>Nenhum pitch cadastrado</p> : <PitchList pitches={pitches} />}

      <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>🎯 Predições Recentes</h2>
      {predictions.length === 0 ? <p>Nenhuma predição</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {predictions.slice(0, 3).map(p => <PredictionCard key={p.id} prediction={p} />)}
        </div>
      )}
    </div>
  )
}
