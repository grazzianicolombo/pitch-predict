import { useState, useEffect, useMemo } from 'react'
import { agenciesAPI } from '../services/api'

const CATEGORY = {
  internacional: { label: 'Grupos Internacionais', color: '#3B82F6' },
  nacional:      { label: 'Grupos Nacionais',       color: '#EF4444' },
  independente:  { label: 'Agências Independentes', color: '#10B981' },
}

// Merge Interpublic + Omnicom into a single filter group (table still shows original)
const MERGED_GROUPS = { 'Interpublic': 'IPG/Omnicom', 'Omnicom': 'IPG/Omnicom' }
const filterGroup4 = (holding) => MERGED_GROUPS[holding] || holding

const empty = {
  name: '', holding: '', category: 'nacional',
  headquarters: 'Brasil', website: '', founded_year: '',
  specialties: '', leadership: '',
}

export default function Agencies() {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterCat, setFilterCat]   = useState('todos')
  const [filterGroup, setFilterGroup] = useState('todos')
  const [search, setSearch]         = useState('')
  const [sort, setSort]             = useState({ col: 'name', dir: 'asc' })
  const [modal, setModal]           = useState(null)
  const [form, setForm]             = useState(empty)
  const [editTarget, setEditTarget] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await agenciesAPI.getAll()
    setItems(data)
    setLoading(false)
  }

  function openAdd()  { setForm(empty); setEditTarget(null); setModal(true) }
  function openEdit(item) {
    setForm({ ...item, specialties: (item.specialties || []).join(', ') })
    setEditTarget(item); setModal(true)
  }

  async function save() {
    const payload = {
      ...form,
      specialties: form.specialties
        ? form.specialties.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    }
    if (editTarget) await agenciesAPI.update(editTarget.id, payload)
    else            await agenciesAPI.create(payload)
    setModal(null); load()
  }

  async function remove(id) {
    if (!confirm('Remover esta agência?')) return
    await agenciesAPI.delete(id)
    load()
  }

  function f(key, val) { setForm(p => ({ ...p, [key]: val })) }

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }

  // Reset group filter when category changes
  function handleCatChange(cat) {
    setFilterCat(cat)
    setFilterGroup('todos')
  }

  // Counts
  const counts = useMemo(() => items.reduce((acc, i) => {
    if (i.category) acc[i.category] = (acc[i.category] || 0) + 1
    return acc
  }, {}), [items])

  const groupCounts = useMemo(() => {
    const cat = filterCat === 'todos' ? null : filterCat
    return items
      .filter(i => !cat || i.category === cat)
      .filter(i => i.holding)
      .reduce((acc, i) => {
        const g = filterGroup4(i.holding)
        acc[g] = (acc[g] || 0) + 1
        return acc
      }, {})
  }, [items, filterCat])

  // Distinct group counts per category (for stat cards)
  const groupsByCat = useMemo(() => {
    const result = {}
    for (const cat of ['internacional', 'nacional', 'independente']) {
      const holdings = new Set(items.filter(i => i.category === cat && i.holding).map(i => filterGroup4(i.holding)))
      result[cat] = holdings.size
    }
    return result
  }, [items])

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = items
      .filter(i => filterCat === 'todos' || i.category === filterCat)
      .filter(i => filterGroup === 'todos' || filterGroup4(i.holding) === filterGroup)
      .filter(i => {
        const q = search.toLowerCase()
        return !q
          || i.name.toLowerCase().includes(q)
          || (i.holding || '').toLowerCase().includes(q)
          || (i.leadership || '').toLowerCase().includes(q)
      })

    list = [...list].sort((a, b) => {
      let av = a[sort.col] || ''
      let bv = b[sort.col] || ''
      if (Array.isArray(av)) av = av.join(',')
      if (Array.isArray(bv)) bv = bv.join(',')
      const cmp = String(av).localeCompare(String(bv), 'pt', { sensitivity: 'base' })
      return sort.dir === 'asc' ? cmp : -cmp
    })

    return list
  }, [items, filterCat, filterGroup, search, sort])

  const sortedGroups = useMemo(() =>
    Object.entries(groupCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  , [groupCounts])

  const activeCatColor = filterCat !== 'todos' ? CATEGORY[filterCat]?.color : 'var(--accent)'

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agências</h1>
          <p className="page-subtitle">Mapa das Agências no Brasil 2025 · Meio &amp; Mensagem</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Nova agência</button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{items.filter(i => i.category).length}</div>
          <div className="stat-sub">agências mapeadas</div>
        </div>
        {Object.entries(CATEGORY).map(([key, meta]) => (
          <div key={key} className="stat-card" style={{ borderTop: `2px solid ${meta.color}`, cursor: 'pointer' }}
            onClick={() => handleCatChange(filterCat === key ? 'todos' : key)}>
            <div className="stat-label" style={{ color: meta.color }}>{meta.label}</div>
            <div className="stat-value">{counts[key] || 0}</div>
            <div className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              agências
              {key !== 'independente' && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: meta.color,
                  background: meta.color + '15', borderRadius: 4,
                  padding: '1px 5px', marginLeft: 2,
                }}>
                  {groupsByCat[key] || 0} grupos
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Filtros de categoria */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="field-input"
          placeholder="Buscar agência, holding, liderança..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 260, fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <CatBtn label="Todos" value="todos" active={filterCat} onClick={handleCatChange} count={items.filter(i=>i.category).length} />
          {Object.entries(CATEGORY).map(([key, meta]) => (
            <CatBtn key={key} label={meta.label} value={key} active={filterCat}
              onClick={handleCatChange} count={counts[key] || 0} color={meta.color} />
          ))}
        </div>
      </div>

      {/* Seletor de grupos */}
      {filterCat !== 'todos' && filterCat !== 'independente' && sortedGroups.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>
            Grupo
          </span>
          <GroupBtn label="Todos os grupos" value="todos" active={filterGroup} onClick={setFilterGroup} color={activeCatColor} />
          {sortedGroups.map(([g, n]) => (
            <GroupBtn key={g} label={g} value={g} active={filterGroup} onClick={setFilterGroup} count={n} color={activeCatColor} />
          ))}
        </div>
      )}

      {/* Tabela */}
      <div className="card">
        {loading ? (
          <p className="loading">Carregando agências</p>
        ) : (
          <table className="data-table stagger">
            <thead>
              <tr>
                <SortTh label="Agência"         col="name"       sort={sort} onSort={toggleSort} />
                <SortTh label="Holding / Grupo" col="holding"    sort={sort} onSort={toggleSort} />
                <SortTh label="Liderança"       col="leadership" sort={sort} onSort={toggleSort} />
                <SortTh label="Especialidades"  col={null}       sort={sort} onSort={toggleSort} />
                <SortTh label="Categoria"       col="category"   sort={sort} onSort={toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const cat = CATEGORY[item.category]
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      {item.website && <div className="sub">{item.website}</div>}
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {item.holding || '—'}
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {item.leadership || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(item.specialties || []).map(s => (
                          <span key={s} className="badge badge-gray" style={{ fontSize: 10.5 }}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {cat && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500, color: cat.color }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                          {cat.label}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>Editar</button>
                      {' '}
                      <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>×</button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                    Nenhuma agência encontrada
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-sm">
            <h2 className="modal-title">{editTarget ? 'Editar Agência' : 'Nova Agência'}</h2>
            <div className="field">
              <label className="field-label">Nome *</label>
              <input className="field-input" value={form.name} onChange={e => f('name', e.target.value)} />
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Categoria</label>
                <select className="field-input" value={form.category} onChange={e => f('category', e.target.value)}>
                  <option value="internacional">● Internacional</option>
                  <option value="nacional">● Nacional</option>
                  <option value="independente">● Independente</option>
                </select>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Holding / Grupo</label>
                <input className="field-input" value={form.holding || ''} onChange={e => f('holding', e.target.value)}
                  placeholder="WPP, Omnicom, Cadastra..." />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Liderança (CEO)</label>
                <input className="field-input" value={form.leadership || ''} onChange={e => f('leadership', e.target.value)}
                  placeholder="Nome do CEO / sócio-diretor" />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Website</label>
                <input className="field-input" value={form.website || ''} onChange={e => f('website', e.target.value)}
                  placeholder="agencia.com.br" />
              </div>
            </div>
            <div className="field" style={{ marginTop: '1rem' }}>
              <label className="field-label">
                Especialidades <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(separadas por vírgula)</span>
              </label>
              <input className="field-input" value={form.specialties} onChange={e => f('specialties', e.target.value)}
                placeholder="Publicidade, Mídia, Digital, CRM..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────────

function SortTh({ label, col, sort, onSort }) {
  const active = sort.col === col
  return (
    <th
      onClick={() => col && onSort(col)}
      style={{ cursor: col ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {col && (
          <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-dim)', lineHeight: 1 }}>
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⬍'}
          </span>
        )}
      </span>
    </th>
  )
}

function CatBtn({ label, value, active, onClick, count, color }) {
  const isActive = active === value
  const c = color || 'var(--accent)'
  return (
    <button onClick={() => onClick(value)} style={{
      padding: '4px 12px', border: '1px solid',
      borderColor: isActive ? c : 'var(--border)',
      borderRadius: 99, fontSize: 12, fontWeight: isActive ? 600 : 400,
      color: isActive ? c : 'var(--text-muted)',
      background: isActive ? c + '15' : 'var(--surface)',
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.1s',
    }}>
      {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, opacity: isActive ? 1 : 0.5 }} />}
      {label}
      <span style={{ fontSize: 10.5, opacity: 0.65 }}>{count}</span>
    </button>
  )
}

function GroupBtn({ label, value, active, onClick, count, color }) {
  const isActive = active === value
  return (
    <button onClick={() => onClick(value)} style={{
      padding: '3px 10px', border: '1px solid',
      borderColor: isActive ? color : 'var(--border)',
      borderRadius: 6, fontSize: 11.5, fontWeight: isActive ? 600 : 400,
      color: isActive ? color : 'var(--text-muted)',
      background: isActive ? color + '12' : 'var(--surface)',
      cursor: 'pointer', transition: 'all 0.1s',
    }}>
      {label}
      {count !== undefined && (
        <span style={{ marginLeft: 4, opacity: 0.65, fontSize: 10.5 }}>({count})</span>
      )}
    </button>
  )
}
