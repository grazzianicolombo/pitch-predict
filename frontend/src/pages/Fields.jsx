import { useState, useEffect } from 'react'
import { fieldsAPI } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = [
  { key: 'pessoas',       label: 'Pessoas',        icon: '◈', color: '#7C5CBF' },
  { key: 'marca',         label: 'Marca / Empresa', icon: '⊕', color: '#2B7FBB' },
  { key: 'agencia',       label: 'Agência',         icon: '◉', color: '#D97706' },
  { key: 'relacionamento',label: 'Relacionamento',  icon: '⊘', color: '#059669' },
  { key: 'conteudo',      label: 'Conteúdo / Mídia',icon: '◎', color: '#DC2626' },
  { key: 'scopen',        label: 'Scopen',          icon: '◷', color: '#0891B2' },
  { key: 'pitch',         label: 'Pitch',           icon: '⚡', color: '#9333EA' },
  { key: 'financeiro',    label: 'Financeiro',      icon: '⊛', color: '#65a30d' },
]

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

const empty = {
  name: '', category: 'pessoas', signal_key: '', description: '',
  examples: '', weight: 1.5, active: true
}

function WeightBar({ value }) {
  const max = 4.0
  const pct = Math.max(0, (Math.abs(value) / max) * 100)
  const color = value < 0 ? '#16a34a' : value >= 3 ? '#DC2626' : value >= 2 ? '#D97706' : '#2B7FBB'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: '#E9E9E7', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  )
}

function WeightSlider({ value, onChange }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <label className="field-label" style={{ marginBottom: 0 }}>
          Peso do sinal
        </label>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: value < 0 ? '#16a34a' : value >= 3 ? '#DC2626' : value >= 2 ? '#D97706' : '#2B7FBB'
        }}>
          {value > 0 ? `+${value}` : value}
          {value < 0 ? ' (protetor)' : value >= 3 ? ' (crítico)' : value >= 2 ? ' (alto)' : value >= 1 ? ' (médio)' : ' (baixo)'}
        </span>
      </div>
      <input
        type="range" min="-2" max="4" step="0.5"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: value < 0 ? '#16a34a' : '#1A1A1A' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        <span>-2 (protetor)</span>
        <span>0 (neutro)</span>
        <span>+4 (máximo)</span>
      </div>
    </div>
  )
}

function SignalCard({ item, onEdit, canEdit }) {
  const cat = CAT_MAP[item.category] || CAT_MAP['outro']
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 0', borderBottom: '1px solid #F0F0EE'
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginTop: 2,
        background: `${cat.color}18`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 14, color: cat.color
      }}>
        {cat.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13.5 }}>{item.name}</strong>
          {item.signal_key && (
            <code style={{ fontSize: 10, background: '#F4F4F2', padding: '1px 6px', borderRadius: 4, color: '#6B6B6B' }}>
              {item.signal_key}
            </code>
          )}
          {!item.active && (
            <span className="badge badge-gray" style={{ fontSize: 10 }}>Inativo</span>
          )}
        </div>
        {item.description && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: 1.5 }}>
            {item.description}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <WeightBar value={item.weight ?? 1.0} />
        {canEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(item)}
            style={{ whiteSpace: 'nowrap' }}>Editar</button>
        )}
      </div>
    </div>
  )
}

export default function Fields() {
  const { isSuperadmin } = useAuth()
  const [items, setItems]         = useState([])
  const [events, setEvents]       = useState([])
  const [modal, setModal]         = useState(null)
  const [form, setForm]           = useState(empty)
  const [loading, setLoading]     = useState(true)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [tab, setTab]             = useState('signals')   // 'signals' | 'events'
  const [filterCat, setFilterCat] = useState('all')
  const [search, setSearch]       = useState('')

  useEffect(() => { loadSignals() }, [])
  useEffect(() => { if (tab === 'events' && events.length === 0) loadEvents() }, [tab])

  async function loadSignals() {
    setLoading(true)
    const { data } = await fieldsAPI.getAll()
    setItems(data || [])
    setLoading(false)
  }

  async function loadEvents() {
    setEventsLoading(true)
    try {
      const { data } = await fieldsAPI.getEvents({ limit: 100 })
      setEvents(data || [])
    } catch {}
    setEventsLoading(false)
  }

  function openAdd()       { setForm(empty); setModal('add') }
  function openEdit(item)  { setForm({ ...item }); setModal(item) }
  function close()         { setModal(null) }

  async function save() {
    if (modal === 'add') await fieldsAPI.create(form)
    else await fieldsAPI.update(modal.id, form)
    close(); loadSignals()
  }

  async function remove(id) {
    if (!confirm('Remover este sinal?')) return
    await fieldsAPI.delete(id)
    loadSignals()
  }

  // Filter
  const filtered = items.filter(item => {
    if (filterCat !== 'all' && item.category !== filterCat) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.description || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Group by category
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const catItems = filtered.filter(i => i.category === cat.key)
    if (catItems.length > 0) acc[cat.key] = catItems
    return acc
  }, {})

  const totalActive = items.filter(i => i.active).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Sinais de Troca</h1>
          <p className="page-subtitle">{totalActive} sinais ativos · Agente correlacionador de agência</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isSuperadmin && <button className="btn btn-primary" onClick={openAdd}>+ Novo sinal</button>}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #E9E9E7', paddingBottom: 0 }}>
        {[
          { key: 'signals', label: `Tipos de sinal (${items.length})` },
          { key: 'events',  label: `Eventos capturados (${events.length || '…'})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer',
            fontSize: 13.5, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? '#1A1A1A' : '#9B9A97',
            borderBottom: tab === t.key ? '2px solid #1A1A1A' : '2px solid transparent',
            marginBottom: -1
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'signals' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="field-input"
              placeholder="Buscar sinal…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200, marginBottom: 0 }}
            />
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button
                className={`btn btn-sm ${filterCat === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterCat('all')}
              >Todos</button>
              {CATEGORIES.map(c => (
                <button
                  key={c.key}
                  className={`btn btn-sm ${filterCat === c.key ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterCat(c.key)}
                  style={filterCat === c.key ? {} : { color: c.color }}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="loading">Carregando sinais…</p>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Nenhum sinal encontrado
            </div>
          ) : (
            <div className="stagger">
              {Object.entries(grouped).map(([catKey, catItems]) => {
                const cat = CAT_MAP[catKey]
                return (
                  <div key={catKey} style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 4, padding: '0 2px'
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: cat.color
                      }}>
                        {cat.icon} {cat.label}
                      </span>
                      <span style={{ fontSize: 11, color: '#C4C4C0' }}>· {catItems.length} sinais</span>
                    </div>
                    <div className="card" style={{ padding: '0 16px' }}>
                      {catItems.map((item, idx) => (
                        <div key={item.id} style={{ position: 'relative' }}>
                          <SignalCard item={item} onEdit={openEdit} canEdit={isSuperadmin} />
                          {idx === catItems.length - 1 && (
                            // Remove bottom border on last item
                            <style>{`#card-${item.id} { border-bottom: none }`}</style>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'events' && (
        <div>
          {eventsLoading ? (
            <p className="loading">Carregando eventos…</p>
          ) : events.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Nenhum evento capturado ainda</p>
              <p style={{ fontSize: 12, color: '#C4C4C0' }}>
                Sinais são capturados automaticamente durante a extração de artigos
              </p>
            </div>
          ) : (
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sinal</th>
                    <th>Marca</th>
                    <th>Evidência</th>
                    <th>Peso</th>
                    <th>Capturado</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => {
                    const cat = CATEGORIES.find(c => items.find(i => i.signal_key === ev.signal_key)?.category === c.key)
                    return (
                      <tr key={ev.id}>
                        <td>
                          <strong style={{ fontSize: 13 }}>{ev.signal_name}</strong>
                          {ev.signal_key && (
                            <div>
                              <code style={{ fontSize: 10, color: '#9B9A97' }}>{ev.signal_key}</code>
                            </div>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                          {ev.brands?.name || ev.brand_id?.slice(0, 8)}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 320 }}>
                          {ev.evidence_text
                            ? ev.evidence_text.length > 120
                              ? ev.evidence_text.slice(0, 120) + '…'
                              : ev.evidence_text
                            : '—'}
                        </td>
                        <td><WeightBar value={ev.weight_applied ?? 1.0} /></td>
                        <td style={{ fontSize: 12, color: '#9B9A97', whiteSpace: 'nowrap' }}>
                          {new Date(ev.captured_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && close()}>
          <div className="modal" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="modal-title">{modal === 'add' ? 'Novo Sinal' : 'Editar Sinal'}</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label className="field-label">Nome do sinal *</label>
                <input className="field-input" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Troca de CMO" />
              </div>

              <div className="field">
                <label className="field-label">Categoria</label>
                <select className="field-input" value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(c => (
                    <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label">Chave do sinal (signal_key)</label>
                <input className="field-input" value={form.signal_key || ''}
                  onChange={e => setForm({ ...form, signal_key: e.target.value })}
                  placeholder="Ex: cmo_change" style={{ fontFamily: 'monospace', fontSize: 13 }} />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Descrição</label>
              <textarea className="field-input" rows={3} value={form.description || ''}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="O que este sinal detecta e por que é relevante para predição de pitch" />
            </div>

            <div className="field">
              <label className="field-label">Exemplos de evidência</label>
              <textarea className="field-input" rows={2} value={form.examples || ''}
                onChange={e => setForm({ ...form, examples: e.target.value })}
                placeholder="Ex: 'Renault anuncia novo VP de Marketing'; 'CMO da Vivo assume presidência'" />
            </div>

            <div className="field">
              <WeightSlider value={form.weight ?? 1.5} onChange={v => setForm({ ...form, weight: v })} />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.active}
                  onChange={e => setForm({ ...form, active: e.target.checked })} />
                Sinal ativo (usado no modelo)
              </label>
            </div>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              {modal !== 'add' && (
                <button className="btn btn-danger btn-sm" onClick={() => { remove(modal.id); close() }}
                  style={{ marginRight: 'auto' }}>
                  Remover
                </button>
              )}
              <button className="btn btn-ghost" onClick={close}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}
                disabled={!form.name}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
