import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import usePitchStore from '../store/pitchStore'

export default function NewPitch() {
  const navigate = useNavigate()
  const { createPitch, createPrediction, loading } = usePitchStore()
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'SaaS',
    fundingNeeded: 0,
    teamSize: 1,
    marketSize: 'Médio',
    metrics: {
      innovation: 5,
      marketDemand: 5,
      teamExperience: 5,
      feasibility: 5
    }
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const pitch = await createPitch(formData)
      const prediction = await createPrediction(pitch)
      alert(`Pitch criado! Score de sucesso: ${prediction.successScore}/10`)
      navigate('/')
    } catch (error) {
      alert('Erro ao criar pitch: ' + error.message)
    }
  }

  const handleMetricChange = (metric, value) => {
    setFormData(prev => ({
      ...prev,
      metrics: {
        ...prev.metrics,
        [metric]: parseInt(value)
      }
    }))
  }

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem', background: 'white', borderRadius: '8px' }}>
      <h1>Novo Pitch</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>Título *</label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            placeholder="Ex: AI Marketplace"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Descrição *</label>
          <textarea
            required
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            placeholder="Descreva seu pitch..."
            style={{ width: '100%', minHeight: '100px' }}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Categoria</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({...formData, category: e.target.value})}
            style={{ width: '100%' }}
          >
            <option>SaaS</option>
            <option>Hardware</option>
            <option>Marketplace</option>
            <option>IA</option>
            <option>Outro</option>
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label>Métricas (1-10)</label>
          {Object.entries(formData.metrics).map(([key, value]) => (
            <div key={key} style={{ marginBottom: '0.5rem' }}>
              <label>{key.charAt(0).toUpperCase() + key.slice(1)}: {value}</label>
              <input
                type="range"
                min="1"
                max="10"
                value={value}
                onChange={(e) => handleMetricChange(key, e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          ))}
        </div>

        <button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Criando...' : 'Analisar Pitch'}
        </button>
      </form>
    </div>
  )
}
