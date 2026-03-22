import { useEffect } from 'react'
import usePitchStore from '../store/pitchStore'

export default function Analytics() {
  const { predictions, fetchPredictions } = usePitchStore()

  useEffect(() => {
    fetchPredictions()
  }, [])

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <h1>📈 Analytics</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Total Predições</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{predictions.length}</p>
        </div>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Score Médio</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {predictions.length ? (predictions.reduce((sum, p) => sum + p.successScore, 0) / predictions.length).toFixed(1) : '—'}
          </p>
        </div>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
          <h3>Taxa Sucesso</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {predictions.length ? Math.round((predictions.filter(p => p.successScore >= 6).length / predictions.length) * 100) : 0}%
          </p>
        </div>
      </div>

      <h2 style={{ marginBottom: '1rem' }}>Todas as Predições</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
        {predictions.map(p => (
          <div key={p.id} style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px', background: 'white' }}>
            <h3>{p.pitchTitle}</h3>
            <p>Score: <strong>{p.successScore}/10</strong></p>
            <p>Risco: <strong>{p.riskLevel}</strong></p>
            <p style={{ fontSize: '12px', color: '#666' }}>
              {new Date(p.createdAt).toLocaleDateString('pt-BR')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
