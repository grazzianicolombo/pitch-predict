export default function PredictionCard({ prediction }) {
  const getRiskColor = (level) => {
    const colors = {
      'BAIXO': '#10B981',
      'MÉDIO': '#F59E0B',
      'ALTO': '#EF4444',
      'CRÍTICO': '#7C3AED'
    }
    return colors[level] || '#6B7280'
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px', background: 'white' }}>
      <h3>{prediction.pitchTitle}</h3>
      <div style={{ margin: '1rem 0' }}>
        <span style={{ fontSize: '24px', fontWeight: 'bold' }}>{prediction.successScore}</span>
        <span style={{ fontSize: '14px', color: '#666' }}>/10</span>
      </div>
      <p style={{ color: getRiskColor(prediction.riskLevel) }}>
        Risco: <strong>{prediction.riskLevel}</strong>
      </p>
      <p style={{ fontSize: '12px', color: '#666' }}>
        Confiança: {prediction.confidence.toFixed(0)}%
      </p>
    </div>
  )
}
