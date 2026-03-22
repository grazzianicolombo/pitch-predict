import { useState, useEffect } from 'react'
import { variablesAPI } from '../services/api'

const TYPES = ['sinal', 'indicador']
const empty = { name: '', weight: 1.0, type: 'sinal', description: '', active: true }

export default function Variables() {
  const [items, setItems] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await variablesAPI.getAll()
    setItems(data)
    setLoading(false)
  }

  function openAdd() { setForm(empty); setModal('add') }
  function openEdit(item) { setForm({ ...item }); setModal(item) }
  function close() { setModal(null) }

  async function save() {
    if (modal === 'add') await variablesAPI.create(form)
    else await variablesAPI.update(modal.id, form)
    close(); load()
  }

  async function remove(id) {
    if (!confirm('Remover esta variável?')) return
    await variablesAPI.delete(id)
    load()
  }

  const maxWeight = Math.max(...items.map(i => parseFloat(i.weight)), 1)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Variáveis do Modelo</h1>
          <p className="page-subtitle">Fatores preditivos · pesos calibrados</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Adicionar</button>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">Carregando variáveis</p>
        ) : (
          <table className="data-table stagger">
            <thead>
              <tr>
                {['Variável', 'Tipo', 'Peso', 'Impacto relativo', 'Status', ''].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...items].sort((a, b) => b.weight - a.weight).map(item => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.description && <div className="sub">{item.description}</div>}
                  </td>
                  <td>
                    <span className={`badge ${item.type === 'sinal' ? 'badge-orange' : 'badge-blue'}`}>
                      {item.type}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 16, fontWeight: 500, color: 'var(--accent-text)' }}>
                      {parseFloat(item.weight).toFixed(1)}
                    </span>
                  </td>
                  <td style={{ width: 160 }}>
                    <div className="impact-track">
                      <div
                        className="impact-fill"
                        style={{ width: `${(parseFloat(item.weight) / maxWeight) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${item.active ? 'badge-green' : 'badge-gray'}`}>
                      {item.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>Editar</button>
                    {' '}
                    <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && close()}>
          <div className="modal modal-sm">
            <h2 className="modal-title">{modal === 'add' ? 'Nova Variável' : 'Editar Variável'}</h2>

            <div className="field">
              <label className="field-label">Nome</label>
              <input className="field-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">Tipo</label>
              <select className="field-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Peso: <span className="mono" style={{ color: 'var(--accent-text)', fontWeight: 500 }}>{parseFloat(form.weight).toFixed(1)}</span></label>
              <input
                type="range" min="0.1" max="5" step="0.1"
                value={form.weight}
                onChange={e => setForm({ ...form, weight: parseFloat(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field-label">Descrição</label>
              <textarea className="field-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
              Variável ativa
            </label>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={close}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
