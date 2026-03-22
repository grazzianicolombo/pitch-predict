import { useState, useEffect } from 'react'
import { brandsAPI, agenciesAPI } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const SEGMENTS = ['Alimentação', 'Automotivo', 'Bancos e Finanças', 'Bebidas', 'Cosméticos',
  'E-commerce', 'Energia', 'Farmácia', 'Moda', 'Saúde', 'Seguros', 'Telecom', 'Varejo', 'Outro']

const CATEGORY_COLOR = {
  internacional: { bg: '#3B82F620', color: '#3B82F6', label: 'Internacional' },
  nacional:      { bg: '#EF444420', color: '#EF4444', label: 'Nacional' },
  independente:  { bg: '#10B98120', color: '#10B981', label: 'Independente' },
}
const REVENUE_OPTS = ['', '<R$100M', 'R$100M–1B', 'R$1B–10B', '>R$10B']
const TEAM_OPTS = ['', '1–5', '5–15', '15–40', '40–100', '+100']
const PITCH_TYPES = ['concorrência', 'convidada', 'renovação', 'indicação']
const SCOPE_COLORS = {
  'Criação': '#3B82F6', 'Mídia': '#8B5CF6', 'Digital': '#10B981',
  'PR': '#F59E0B', 'Social': '#EC4899', 'CRM': '#EF4444',
  'Performance': '#06B6D4', 'Tecnologia': '#6366F1',
}

const emptyBrand = { name: '', segment: 'Varejo', group_name: '', website: '', notes: '',
  country_of_origin: 'Brasil', revenue_estimate: '', marketing_team_size: '',
  is_listed: false, year_in_brazil: '', linkedin_company_url: '', instagram_handle: '' }
const emptyHistory = { agency: '', scope: 'Criação', agency_group: 'Independente',
  agency_website: '', year_start: new Date().getFullYear(), month_start: '',
  year_end: '', month_end: '', status: 'active', pitch_type: 'concorrência' }
const emptyLeader = { name: '', title: 'CMO', linkedin: '', start_date: '', end_date: '',
  is_current: true, team_size_estimate: '' }

export default function Brands() {
  const { isSuperadmin } = useAuth()
  const [brands, setBrands] = useState([])
  const [agencies, setAgencies] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [editTarget, setEditTarget] = useState(null)
  const [tab, setTab] = useState('timeline')

  useEffect(() => {
    loadBrands()
    agenciesAPI.getAll().then(r => setAgencies(r.data))
  }, [])

  async function loadBrands() {
    setLoading(true)
    const { data } = await brandsAPI.getAll()
    setBrands(data)
    setLoading(false)
  }

  async function selectBrand(id) {
    const { data } = await brandsAPI.getById(id)
    setSelected(data)
    setTab('timeline')
  }

  async function saveBrand() {
    if (editTarget) await brandsAPI.update(editTarget.id, form)
    else await brandsAPI.create(form)
    setModal(null); setEditTarget(null)
    await loadBrands()
    if (selected) selectBrand(selected.id)
  }

  async function deleteBrand(id) {
    if (!confirm('Remover esta marca?')) return
    await brandsAPI.delete(id)
    setSelected(null); loadBrands()
  }

  async function saveHistory() {
    if (editTarget) await brandsAPI.updateHistory(selected.id, editTarget.id, form)
    else await brandsAPI.addHistory(selected.id, form)
    setModal(null); setEditTarget(null); selectBrand(selected.id)
  }

  async function deleteHistory(hid) {
    if (!confirm('Remover?')) return
    await brandsAPI.deleteHistory(selected.id, hid)
    selectBrand(selected.id)
  }

  async function saveLeader() {
    if (editTarget) await brandsAPI.updateLeader(selected.id, editTarget.id, form)
    else await brandsAPI.addLeader(selected.id, form)
    setModal(null); setEditTarget(null); selectBrand(selected.id)
  }

  async function deleteLeader(lid) {
    if (!confirm('Remover?')) return
    await brandsAPI.deleteLeader(selected.id, lid)
    selectBrand(selected.id)
  }

  function f(key, val) { setForm(p => ({ ...p, [key]: val })) }

  const filtered = brands
    .filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.rank_2024 || 9999) - (b.rank_2024 || 9999))
  const currentLeader = selected?.marketing_leaders?.find(l => l.is_current)
  const currentAgencies = selected?.agency_history?.filter(h => h.status === 'active') || []
  const history10y = (selected?.agency_history || []).filter(h => (h.year_end || 9999) >= new Date().getFullYear() - 10)

  return (
    <div style={{ display: 'flex', gap: '1.25rem', height: 'calc(100vh - 100px)' }}>

      {/* ── Lista ── */}
      <div className="card" style={{ width: 256, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="section-header">
          <span className="section-title">Marcas <span style={{ color: 'var(--text-dim)' }}>({brands.length})</span></span>
          {isSuperadmin && <button className="btn btn-primary btn-sm" onClick={() => { setForm(emptyBrand); setEditTarget(null); setModal('brand') }}>+</button>}
        </div>
        <div style={{ padding: '8px' }}>
          <input className="field-input" placeholder="Buscar marca..." value={search}
            onChange={e => setSearch(e.target.value)} style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p className="loading">Carregando</p>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><span className="icon">◈</span><p>Nenhuma marca</p></div>
          ) : filtered.map(brand => (
            <div key={brand.id} onClick={() => selectBrand(brand.id)} style={{
              padding: '8px 12px', cursor: 'pointer',
              borderBottom: '1px solid var(--border)',
              borderLeft: `2px solid ${selected?.id === brand.id ? 'var(--accent)' : 'transparent'}`,
              background: selected?.id === brand.id ? 'var(--accent-dim)' : 'transparent',
              transition: 'all 0.08s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand.name}</div>
                {brand.rank_2024 && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>#{brand.rank_2024}</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{brand.segment}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 9.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Fonte: Kantar IBOPE Media · Ranking Maiores Anunciantes 2024 (investimento em mídia)
        </div>
      </div>

      {/* ── Detalhe ── */}
      <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        {!selected ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <span className="icon" style={{ fontSize: 40 }}>◈</span>
            <p>Selecione uma marca para ver os detalhes</p>
          </div>
        ) : (
          <div>
            {/* Header card */}
            <div className="card card-padded" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px' }}>{selected.name}</h2>
                    {selected.is_listed && <span className="badge badge-blue">B3</span>}
                    {selected.segment && <span className="badge badge-gray">{selected.segment}</span>}
                    {selected.group_name && <span className="badge badge-gray">{selected.group_name}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
                    {selected.rank_2024 && <KV label="Rank Kantar 2024" value={`#${selected.rank_2024}`} sub="por invest. mídia" />}
                    {selected.invest_mi && <KV label="Invest. Mídia 2024" value={`R$ ${selected.invest_mi}M`} sub="estimado" />}
                    <KV label="CMO Atual" value={currentLeader?.name} sub={currentLeader?.title} />
                    <KV label="Equipe de Mkt" value={currentLeader?.team_size_estimate || selected.marketing_team_size} sub="pessoas" />
                    <KV label="Receita estimada" value={selected.revenue_estimate} />
                    <KV label="No Brasil desde" value={selected.year_in_brazil} />
                    <KV label="Agências ativas" value={currentAgencies.length || '—'} sub={currentAgencies.map(a => a.agency).join(', ') || ''} />
                    <KV label="Agências 10 anos" value={new Set(history10y.map(h => h.agency)).size || '—'} />
                  </div>
                </div>
                {isSuperadmin && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => { setForm({ ...selected }); setEditTarget(selected); setModal('brand') }}>
                      Editar
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteBrand(selected.id)}>Remover</button>
                  </div>
                )}
              </div>
              {selected.website && (
                <a href={selected.website} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10, display: 'inline-block' }}>
                  ↗ {selected.website}
                </a>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
              {[['timeline', 'Timeline'], ['agencies', 'Agências'], ['leaders', 'Líderes']].map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)} style={{
                  padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: tab === key ? 600 : 400,
                  color: tab === key ? 'var(--text)' : 'var(--text-dim)',
                  borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
                  marginBottom: -1,
                }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab: Timeline */}
            {tab === 'timeline' && (
              <div>
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="section-header">
                    <span className="section-title">Histórico de Agências · Timeline</span>
                    {isSuperadmin && <button className="btn btn-ghost btn-sm"
                      onClick={() => { setForm(emptyHistory); setEditTarget(null); setModal('history') }}>
                      + Adicionar
                    </button>}
                  </div>
                  {(selected.agency_history || []).length === 0 ? (
                    <div className="empty-state"><p>Nenhum histórico registrado</p></div>
                  ) : (
                    <div style={{ padding: '16px 20px', overflowX: 'auto' }}>
                      <AgencyTimeline history={selected.agency_history} />
                    </div>
                  )}
                </div>
                {(selected.marketing_leaders || []).length > 0 && (
                  <div className="card">
                    <div className="section-header">
                      <span className="section-title">Líderes de Marketing · Timeline</span>
                      {isSuperadmin && <button className="btn btn-ghost btn-sm"
                        onClick={() => { setForm(emptyLeader); setEditTarget(null); setModal('leader') }}>
                        + Adicionar
                      </button>}
                    </div>
                    <div style={{ padding: '16px 20px', overflowX: 'auto' }}>
                      <LeadersTimeline leaders={selected.marketing_leaders} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab: Agências */}
            {tab === 'agencies' && (
              <div className="card">
                <div className="section-header">
                  <span className="section-title">Histórico de Agências</span>
                  {isSuperadmin && <button className="btn btn-ghost btn-sm"
                    onClick={() => { setForm(emptyHistory); setEditTarget(null); setModal('history') }}>
                    + Adicionar
                  </button>}
                </div>
                <table className="data-table">
                  <thead>
                    <tr>{['Agência', 'Grupo / Holding', 'Escopo', 'Período', 'Duração', 'Contratação', 'Fonte', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(selected.agency_history || []).sort((a, b) => (b.year_start || 0) - (a.year_start || 0)).map(h => {
                      const profile = agencies.find(a => a.name === h.agency)
                      const cat = profile?.category ? CATEGORY_COLOR[profile.category] : null
                      return (
                      <tr key={h.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong>{h.agency}</strong>
                            {cat && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: cat.bg, color: cat.color, fontWeight: 600 }}>{cat.label}</span>}
                          </div>
                          {h.agency_website && <div className="sub">{h.agency_website}</div>}
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{profile?.holding || h.agency_group || '—'}</td>
                        <td>
                          <span className="badge" style={{
                            background: (SCOPE_COLORS[h.scope] || '#6B7280') + '18',
                            color: SCOPE_COLORS[h.scope] || '#6B7280',
                            borderColor: (SCOPE_COLORS[h.scope] || '#6B7280') + '40',
                          }}>{h.scope}</span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {h.year_start}{h.month_start ? `/${String(h.month_start).padStart(2,'0')}` : ''}
                          {h.year_end ? ` – ${h.year_end}${h.month_end ? `/${String(h.month_end).padStart(2,'0')}` : ''}` : ' – atual'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {calcDuration(h.year_start, h.month_start, h.year_end, h.month_end)}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.pitch_type || '—'}</td>
                        <td><SourceBadge source={h.source_name} confidence={h.confidence} articleId={h.source_article_id} /></td>
                        <td>
                          <span className={`badge ${h.status === 'active' ? 'badge-green' : 'badge-gray'}`}>
                            {h.status === 'active' ? 'Ativo' : 'Encerrado'}
                          </span>
                        </td>
                        {isSuperadmin && (
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => { setForm({ ...h }); setEditTarget(h); setModal('history') }}>Editar</button>
                            {' '}
                            <button className="btn btn-danger btn-sm" onClick={() => deleteHistory(h.id)}>×</button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab: Líderes */}
            {tab === 'leaders' && (
              <div className="card">
                <div className="section-header">
                  <span className="section-title">Líderes de Marketing</span>
                  {isSuperadmin && <button className="btn btn-ghost btn-sm"
                    onClick={() => { setForm(emptyLeader); setEditTarget(null); setModal('leader') }}>
                    + Adicionar
                  </button>}
                </div>
                <table className="data-table">
                  <thead>
                    <tr>{['Nome', 'Cargo', 'Equipe', 'Período', 'Duração', 'LinkedIn', 'Fonte', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(selected.marketing_leaders || []).sort((a, b) => (b.is_current ? 1 : 0) - (a.is_current ? 1 : 0)).map(l => (
                      <tr key={l.id}>
                        <td><strong>{l.name}</strong></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{l.title}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.team_size_estimate || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {l.start_date ? l.start_date.slice(0, 7) : ''}
                          {l.end_date ? ` – ${l.end_date.slice(0, 7)}` : l.is_current ? ' – atual' : ''}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {calcDurationDates(l.start_date, l.end_date)}
                        </td>
                        <td>
                          {l.linkedin
                            ? <a href={l.linkedin} target="_blank" rel="noreferrer"
                                style={{ fontSize: 12, color: 'var(--blue)' }}>↗ perfil</a>
                            : <span style={{ color: 'var(--text-dim)' }}>—</span>
                          }
                        </td>
                        <td><SourceBadge source={l.source} confidence={l.confidence} articleId={l.source_article_id} /></td>
                        <td>
                          <span className={`badge ${l.is_current ? 'badge-green' : 'badge-gray'}`}>
                            {l.is_current ? 'Atual' : 'Ex'}
                          </span>
                        </td>
                        {isSuperadmin && (
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => { setForm({ ...l }); setEditTarget(l); setModal('leader') }}>Editar</button>
                            {' '}
                            <button className="btn btn-danger btn-sm" onClick={() => deleteLeader(l.id)}>×</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!selected.marketing_leaders?.length && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '1.5rem' }}>Nenhum registro</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal Marca ── */}
      {modal === 'brand' && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h2 className="modal-title">{editTarget ? 'Editar Marca' : 'Nova Marca'}</h2>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Nome *</label>
                <input className="field-input" value={form.name} onChange={e => f('name', e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Segmento</label>
                <select className="field-input" value={form.segment} onChange={e => f('segment', e.target.value)}>
                  {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Grupo Econômico</label>
                <input className="field-input" value={form.group_name} onChange={e => f('group_name', e.target.value)} placeholder="Ex: Ambev, Itaú..." />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">País de Origem</label>
                <input className="field-input" value={form.country_of_origin} onChange={e => f('country_of_origin', e.target.value)} placeholder="Brasil" />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Receita estimada</label>
                <select className="field-input" value={form.revenue_estimate} onChange={e => f('revenue_estimate', e.target.value)}>
                  {REVENUE_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Equipe de marketing</label>
                <select className="field-input" value={form.marketing_team_size} onChange={e => f('marketing_team_size', e.target.value)}>
                  {TEAM_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Website</label>
                <input className="field-input" value={form.website} onChange={e => f('website', e.target.value)} placeholder="https://..." />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">No Brasil desde</label>
                <input type="number" className="field-input" value={form.year_in_brazil} onChange={e => f('year_in_brazil', e.target.value)} placeholder="Ex: 1990" />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">LinkedIn (empresa)</label>
                <input className="field-input" value={form.linkedin_company_url} onChange={e => f('linkedin_company_url', e.target.value)} placeholder="linkedin.com/company/..." />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Instagram</label>
                <input className="field-input" value={form.instagram_handle} onChange={e => f('instagram_handle', e.target.value)} placeholder="@marca" />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Notas</label>
              <textarea className="field-input" value={form.notes} onChange={e => f('notes', e.target.value)} />
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={!!form.is_listed} onChange={e => f('is_listed', e.target.checked)} />
              Empresa de capital aberto (B3 / bolsa)
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBrand}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Histórico ── */}
      {modal === 'history' && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h2 className="modal-title">{editTarget ? 'Editar Histórico' : 'Nova Agência'}</h2>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Agência *</label>
                <input className="field-input" value={form.agency} onChange={e => f('agency', e.target.value)}
                  placeholder="WMcCann, AlmapBBDO..." list="agencies-list" />
                <datalist id="agencies-list">
                  {agencies.map(a => <option key={a.id} value={a.name} />)}
                </datalist>
              </div>
              <div className="field">
                <label className="field-label">Grupo da Agência</label>
                <input className="field-input" value={form.agency_group} onChange={e => f('agency_group', e.target.value)}
                  placeholder="WPP, Publicis, IPG..." />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Escopo</label>
                <input className="field-input" value={form.scope} onChange={e => f('scope', e.target.value)}
                  placeholder="Criação, Mídia, Digital..." list="scope-list" />
                <datalist id="scope-list">
                  {Object.keys(SCOPE_COLORS).map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Tipo de contratação</label>
                <select className="field-input" value={form.pitch_type} onChange={e => f('pitch_type', e.target.value)}>
                  {PITCH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Início (ano)</label>
                <input type="number" className="field-input" value={form.year_start}
                  onChange={e => f('year_start', parseInt(e.target.value))} />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Início (mês)</label>
                <input type="number" min="1" max="12" className="field-input" value={form.month_start}
                  onChange={e => f('month_start', e.target.value ? parseInt(e.target.value) : '')} placeholder="1–12" />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Fim (ano)</label>
                <input type="number" className="field-input" value={form.year_end}
                  onChange={e => f('year_end', e.target.value ? parseInt(e.target.value) : '')} placeholder="vazio = atual" />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Fim (mês)</label>
                <input type="number" min="1" max="12" className="field-input" value={form.month_end}
                  onChange={e => f('month_end', e.target.value ? parseInt(e.target.value) : '')} placeholder="1–12" />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Status</label>
                <select className="field-input" value={form.status} onChange={e => f('status', e.target.value)}>
                  <option value="active">Ativo</option>
                  <option value="ended">Encerrado</option>
                </select>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Site da agência</label>
                <input className="field-input" value={form.agency_website} onChange={e => f('agency_website', e.target.value)} placeholder="agencia.com.br" />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveHistory}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Líder ── */}
      {modal === 'leader' && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-sm">
            <h2 className="modal-title">{editTarget ? 'Editar Líder' : 'Novo Líder de Marketing'}</h2>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Nome *</label>
                <input className="field-input" value={form.name} onChange={e => f('name', e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Cargo</label>
                <input className="field-input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="CMO, VP de Marketing..." />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Tamanho da equipe</label>
                <select className="field-input" value={form.team_size_estimate} onChange={e => f('team_size_estimate', e.target.value)}>
                  {TEAM_OPTS.map(o => <option key={o} value={o}>{o || '—'}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">LinkedIn (URL)</label>
                <input className="field-input" value={form.linkedin} onChange={e => f('linkedin', e.target.value)} placeholder="linkedin.com/in/..." />
              </div>
            </div>
            <div className="field-row" style={{ marginTop: '1rem' }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Data início</label>
                <input type="date" className="field-input" value={form.start_date || ''} onChange={e => f('start_date', e.target.value)} />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label className="field-label">Data fim</label>
                <input type="date" className="field-input" value={form.end_date || ''} onChange={e => f('end_date', e.target.value)} />
              </div>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={!!form.is_current} onChange={e => f('is_current', e.target.checked)} />
              É o líder atual
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveLeader}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AgencyTimeline({ history }) {
  const currentYear = new Date().getFullYear()
  const sorted = [...history].sort((a, b) => (a.year_start || 0) - (b.year_start || 0))
  const minYear = Math.min(...sorted.map(h => h.year_start || currentYear), currentYear - 5)
  const maxYear = currentYear
  const totalYears = maxYear - minYear + 1
  const years = Array.from({ length: totalYears }, (_, i) => minYear + i)

  // Group by agency name to stack multiple scopes on same row
  const byAgency = {}
  sorted.forEach(h => {
    if (!byAgency[h.agency]) byAgency[h.agency] = []
    byAgency[h.agency].push(h)
  })

  const COL_W = 54 // px per year
  const LABEL_W = 140

  return (
    <div style={{ minWidth: LABEL_W + COL_W * totalYears }}>
      {/* Year header */}
      <div style={{ display: 'flex', marginBottom: 8, marginLeft: LABEL_W }}>
        {years.map(y => (
          <div key={y} style={{
            width: COL_W, fontSize: 10, color: 'var(--text-dim)',
            textAlign: 'center', fontFamily: 'var(--font-mono)',
            borderLeft: '1px solid var(--border)', paddingTop: 2,
          }}>{y}</div>
        ))}
      </div>

      {/* Agency rows */}
      {Object.entries(byAgency).map(([agencyName, rows]) => (
        <div key={agencyName} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{
              width: LABEL_W, flexShrink: 0,
              fontSize: 12, fontWeight: 500, color: 'var(--text)',
              paddingRight: 8, paddingTop: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={agencyName}>{agencyName}</div>
            <div style={{ flex: 1, position: 'relative' }}>
              {rows.map(h => {
                const start = Math.max((h.year_start || minYear) - minYear, 0)
                const end = (h.year_end || currentYear) - minYear + 1
                const left = start * COL_W
                const width = Math.max((end - start) * COL_W - 2, COL_W - 2)
                const color = SCOPE_COLORS[h.scope] || '#6B7280'
                return (
                  <div key={h.id} title={`${h.agency} · ${h.scope} · ${h.year_start}–${h.year_end || 'atual'}`}
                    style={{
                      position: 'relative', marginBottom: 3,
                      marginLeft: left,
                      width, height: 24,
                      background: color + '20',
                      border: `1px solid ${color}60`,
                      borderRadius: 4,
                      display: 'flex', alignItems: 'center',
                      padding: '0 7px',
                      fontSize: 11, color,
                      fontWeight: 500,
                      overflow: 'hidden', whiteSpace: 'nowrap',
                    }}>
                    {h.scope}
                    {h.status === 'active' && (
                      <span style={{
                        marginLeft: 4, width: 5, height: 5, borderRadius: '50%',
                        background: color, flexShrink: 0, display: 'inline-block',
                      }} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        {Object.entries(SCOPE_COLORS).map(([scope, color]) => (
          <div key={scope} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color + '40', border: `1px solid ${color}80` }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{scope}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KV({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 500, fontSize: 14, color: value ? 'var(--text)' : 'var(--text-dim)' }}>{value || '—'}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

// ── Helpers de duração ────────────────────────────────────────────────────────

function calcDuration(yearStart, monthStart, yearEnd, monthEnd) {
  if (!yearStart) return '—'
  const start = new Date(yearStart, (monthStart || 1) - 1, 1)
  const end = yearEnd ? new Date(yearEnd, (monthEnd || 12) - 1, 1) : new Date()
  const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (totalMonths < 0) return '—'
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (years === 0) return `${months}m`
  if (months === 0) return `${years}a`
  return `${years}a ${months}m`
}

function calcDurationDates(startDate, endDate) {
  if (!startDate) return '—'
  const start = new Date(startDate)
  const end = endDate ? new Date(endDate) : new Date()
  const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (totalMonths < 0) return '—'
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (years === 0) return `${months}m`
  if (months === 0) return `${years}a`
  return `${years}a ${months}m`
}

// ── SourceBadge ───────────────────────────────────────────────────────────────

function SourceBadge({ source, confidence }) {
  if (!source) {
    return <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>manual</span>
  }
  const confColor = { alta: '#10B981', média: '#F59E0B', media: '#F59E0B' }[confidence] || '#94A3B8'
  const confLabel = { alta: 'alta', média: 'méd', media: 'méd' }[confidence] || ''
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        fontSize: 9, padding: '1px 5px', borderRadius: 3,
        background: '#3B82F618', color: '#3B82F6',
        fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      }}>auto</span>
      {confidence && (
        <span style={{ fontSize: 9, color: confColor, fontWeight: 600 }}>{confLabel}</span>
      )}
    </span>
  )
}

// ── LeadersTimeline ───────────────────────────────────────────────────────────

const LEADER_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444', '#6366F1']

function LeadersTimeline({ leaders }) {
  const currentYear = new Date().getFullYear()
  const sorted = [...leaders].sort((a, b) => {
    const ay = a.start_date ? new Date(a.start_date).getFullYear() : currentYear
    const by = b.start_date ? new Date(b.start_date).getFullYear() : currentYear
    return ay - by
  })

  const minYear = Math.min(
    ...sorted.map(l => l.start_date ? new Date(l.start_date).getFullYear() : currentYear),
    currentYear - 5
  )
  const maxYear = currentYear
  const totalYears = maxYear - minYear + 1
  const years = Array.from({ length: totalYears }, (_, i) => minYear + i)

  const COL_W = 54
  const LABEL_W = 160

  return (
    <div style={{ minWidth: LABEL_W + COL_W * totalYears }}>
      {/* Year header */}
      <div style={{ display: 'flex', marginBottom: 8, marginLeft: LABEL_W }}>
        {years.map(y => (
          <div key={y} style={{
            width: COL_W, fontSize: 10, color: 'var(--text-dim)',
            textAlign: 'center', fontFamily: 'var(--font-mono)',
            borderLeft: '1px solid var(--border)', paddingTop: 2,
          }}>{y}</div>
        ))}
      </div>

      {/* Leader rows */}
      {sorted.map((l, idx) => {
        const startY = l.start_date ? new Date(l.start_date).getFullYear() : minYear
        const endY = l.end_date ? new Date(l.end_date).getFullYear() : currentYear
        const start = Math.max(startY - minYear, 0)
        const end = endY - minYear + 1
        const left = start * COL_W
        const width = Math.max((end - start) * COL_W - 2, COL_W - 2)
        const color = LEADER_COLORS[idx % LEADER_COLORS.length]
        const dur = calcDurationDates(l.start_date, l.end_date)

        return (
          <div key={l.id} style={{ marginBottom: 6, display: 'flex', alignItems: 'center' }}>
            <div style={{
              width: LABEL_W, flexShrink: 0,
              fontSize: 12, fontWeight: 500, color: 'var(--text)',
              paddingRight: 8,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={`${l.name} · ${l.title}`}>
              <span>{l.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>{l.title}</span>
            </div>
            <div style={{ position: 'relative', flex: 1 }}>
              <div
                title={`${l.name} · ${l.title} · ${l.start_date?.slice(0,7) || '?'} – ${l.end_date?.slice(0,7) || 'atual'} · ${dur}`}
                style={{
                  marginLeft: left,
                  width, height: 24,
                  background: color + '20',
                  border: `1px solid ${color}60`,
                  borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                  padding: '0 7px',
                  fontSize: 11, color,
                  fontWeight: 500,
                  overflow: 'hidden', whiteSpace: 'nowrap',
                  gap: 5,
                }}>
                <span>{dur}</span>
                {l.is_current && (
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
                )}
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>
        ● = líder atual &nbsp;·&nbsp; barra = período de mandato
      </div>
    </div>
  )
}
