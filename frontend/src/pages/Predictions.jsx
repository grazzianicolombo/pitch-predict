import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'

const SCOPES = ['Criação', 'Mídia', 'Digital', 'PR', 'Social', 'CRM', 'Performance', 'Branding', 'E-commerce', 'Conteúdo']

const RISK = {
  alto:  { bg: '#FEE2E2', color: '#991B1B', bar: '#EF4444', label: 'Alto' },
  médio: { bg: '#FEF9C3', color: '#92400E', bar: '#F59E0B', label: 'Médio' },
  baixo: { bg: '#DCFCE7', color: '#15803D', bar: '#22C55E', label: 'Baixo' },
}

const QUALITY = {
  alta:  { color: '#15803D', icon: '◉' },
  média: { color: '#92400E', icon: '◎' },
  media: { color: '#92400E', icon: '◎' },
  baixa: { color: '#DC2626', icon: '○' },
}

// ─── Dashboard de probabilidade de troca ─────────────────────────────────────

function DashboardTab({ onPredict }) {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [scopeFilter, setScope]   = useState('Todos')
  const [riskFilter, setRisk]     = useState('Todos')
  const [search, setSearch]       = useState('')

  useEffect(() => {
    api.get('/predictions/dashboard')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const items  = data?.items || []
  const stats  = data?.stats || {}
  const scopes = ['Todos', ...(stats.scopes || [])]

  const filtered = items.filter(r => {
    if (scopeFilter !== 'Todos' && r.scope !== scopeFilter) return false
    if (riskFilter  !== 'Todos' && r.risk  !== riskFilter)  return false
    if (search && !r.brand.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (loading) return <p className="loading">Calculando probabilidades…</p>

  return (
    <div>
      {/* Stats */}
      <div className="stats-row" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Marcas monitoradas</div>
          <div className="stat-value">{stats.total || 0}</div>
          <div className="stat-sub">com histórico no banco</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Risco alto</div>
          <div className="stat-value" style={{ color: '#DC2626' }}>{stats.high || 0}</div>
          <div className="stat-sub">probabilidade ≥ 65%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Risco médio</div>
          <div className="stat-value" style={{ color: '#D97706' }}>{stats.medium || 0}</div>
          <div className="stat-sub">probabilidade 40–65%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Risco baixo</div>
          <div className="stat-value" style={{ color: '#16A34A' }}>{stats.low || 0}</div>
          <div className="stat-sub">probabilidade &lt; 40%</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Buscar marca…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, width: 180 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {scopes.map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`btn btn-sm ${scopeFilter === s ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11 }}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {['Todos', 'alto', 'médio', 'baixo'].map(r => {
            const rs = RISK[r]
            return (
              <button key={r} onClick={() => setRisk(r)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 99, border: 'none', cursor: 'pointer', fontWeight: 600,
                  background: riskFilter === r ? (rs?.bar || '#374151') : '#F3F4F6',
                  color: riskFilter === r ? '#fff' : '#6B7280',
                }}>
                {r === 'Todos' ? 'Todos' : `${rs.label}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tabela */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>Marca</th>
              <th style={{ padding: '10px 8px',  textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>Escopo</th>
              <th style={{ padding: '10px 8px',  textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>Agência atual</th>
              <th style={{ padding: '10px 8px',  textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11 }}>Sinais ativos</th>
              <th style={{ padding: '10px 8px',  textAlign: 'center', fontWeight: 600, color: '#6B7280', fontSize: 11, width: 110 }}>Prazo estimado</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#6B7280', fontSize: 11, width: 160 }}>Prob. de troca</th>
              <th style={{ padding: '10px 8px',  width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                Nenhuma marca encontrada
              </td></tr>
            )}
            {filtered.map((r, i) => {
              const rs  = RISK[r.risk] || RISK.médio
              const pct = Math.round(r.probability * 100)
              const mo  = r.months_to_pitch
              const moYears  = Math.round(mo / 12 * 10) / 10
              const moLabel  = mo <= 3 ? 'Iminente' : mo <= 6 ? `${mo} meses` : mo <= 12 ? `${mo} meses` : mo <= 24 ? `${moYears} ano${moYears !== 1 ? 's' : ''}` : `+2 anos`
              const moColor = mo <= 6 ? '#DC2626' : mo <= 12 ? '#D97706' : '#6B7280'
              // Signals are now objects {key, label, weight, evidence} or legacy strings
              const sigLabels = (r.signals || []).map(s => typeof s === 'string' ? s : s.label).slice(0, 4)
              const protective = (r.signals || []).filter(s => typeof s === 'object' && s.weight < 0)
              return (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.brand}</div>
                    {r.segment && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.segment}</div>}
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 500 }}>
                      {r.scope}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', color: '#374151', fontSize: 12 }}>
                    {r.current_agency || <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    {r.tenure_years > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.tenure_years} anos</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 8px', maxWidth: 220 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {sigLabels.map((s, j) => (
                        <span key={j} style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: rs.bg, color: rs.color, fontWeight: 500, whiteSpace: 'nowrap',
                        }}>{s}</span>
                      ))}
                      {protective.length > 0 && (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#DCFCE7', color: '#15803D', fontWeight: 500 }}>
                          ✓ {protective[0].label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    {mo != null ? (
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: moColor }}>{moLabel}</div>
                        <div style={{ fontSize: 10, color: '#9B9A97' }}>para pitch</div>
                      </div>
                    ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ flex: 1, minWidth: 80, maxWidth: 100 }}>
                        <div style={{ height: 6, background: '#E5E7EB', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: rs.bar, width: `${pct}%`, borderRadius: 99, transition: 'width 0.5s' }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: rs.color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                    </div>
                    <div style={{ textAlign: 'right', marginTop: 2 }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: rs.bg, color: rs.color, fontWeight: 600 }}>
                        {rs.label}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <button
                      onClick={() => onPredict({ brand: r.brand, scope: r.scope })}
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: 10 }}>
                      ◈ Analisar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)' }}>
        {filtered.length} de {items.length} marcas · Calculado com {items[0]?.signal_count != null ? 'pesos dinâmicos por sinal' : 'histórico marca-agência'}
      </div>
    </div>
  )
}

// ─── Aba de predição individual ───────────────────────────────────────────────

function PredictionResult({ result }) {
  const q   = QUALITY[result.data_quality] || QUALITY.media
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{result.brand}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {result.scope ? `Escopo: ${result.scope}` : 'Escopo geral'}
          {result.current_agency && ` · Atual: ${result.current_agency}`}
          {result.current_leader && ` · CMO: ${result.current_leader}`}
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14, padding:'8px 12px', background:'#F8FAFC', borderRadius:8, border:'1px solid #E2E8F0', fontSize:12 }}>
        <span style={{ color: q.color, fontWeight:700 }}>{q.icon} Dados: {result.data_quality}</span>
        <span style={{ color:'var(--text-muted)' }}>·</span>
        <span style={{ color:'var(--text-muted)' }}>{result.history_records} registros · {result.similar_pitches_analyzed} pitchs similares</span>
        {result.data_quality_note && <span style={{ color:'var(--text-muted)', fontStyle:'italic' }}>— {result.data_quality_note}</span>}
      </div>

      {result.market_context && (
        <div style={{ padding:'10px 14px', background:'#EFF6FF', borderRadius:8, border:'1px solid #BFDBFE', marginBottom:14, fontSize:12, color:'#1D4ED8', lineHeight:1.6 }}>
          <span style={{ fontWeight:600 }}>Contexto: </span>{result.market_context}
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14 }}>
        {(result.predictions || []).map((p, i) => {
          const rs  = RISK[p.risk] || RISK.médio
          const pct = Math.round((p.probability || 0) * 100)
          return (
            <div key={i} className="card" style={{ padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:24, height:24, borderRadius:'50%', background: i===0?'#1D4ED8':'#E5E7EB', color: i===0?'#fff':'#6B7280', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>{i+1}</span>
                  <span style={{ fontWeight:700, fontSize:14 }}>{p.agency}</span>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:99, fontWeight:600, background:rs.bg, color:rs.color }}>risco {rs.label}</span>
                </div>
                <span style={{ fontSize:20, fontWeight:800, color: i===0?'#1D4ED8':'#374151' }}>{pct}%</span>
              </div>
              <div style={{ height:4, background:'#E5E7EB', borderRadius:99, marginBottom:8, overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:99, background: i===0?'#3B82F6':'#9CA3AF', width:`${pct}%` }} />
              </div>
              <p style={{ fontSize:12, color:'#374151', lineHeight:1.6, marginBottom:6 }}>{p.reasoning}</p>
              {p.signals?.length > 0 && (
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  {p.signals.map((s,j) => (
                    <span key={j} style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'var(--accent-dim)', color:'var(--accent)', fontWeight:500 }}>{s}</span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {result.recommended_watch?.length > 0 && (
        <div style={{ padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, fontSize:11, color:'#92400E' }}>
          <span style={{ fontWeight:600 }}>⚑ Monitorar: </span>{result.recommended_watch.join(', ')}
        </div>
      )}
    </div>
  )
}

function PredictTab({ prefill }) {
  const [brand, setBrand]     = useState(prefill?.brand || '')
  const [scope, setScope]     = useState(prefill?.scope || '')
  const [context, setContext] = useState('')
  const [topN, setTopN]       = useState(3)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (prefill?.brand) setBrand(prefill.brand)
    if (prefill?.scope) setScope(prefill.scope)
  }, [prefill])

  useEffect(() => {
    api.get('/predictions')
      .then(r => setHistory(r.data || []))
      .catch(() => {})
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!brand.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const { data } = await api.post('/predictions', { brand: brand.trim(), scope: scope || undefined, additionalContext: context || undefined, topN })
      setResult(data)
      setHistory(prev => [{ id: data.id, brand: data.brand, scope: data.scope, result: data, created_at: data.generated_at }, ...prev])
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao gerar predição')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:24, alignItems:'start' }}>
      <div>
        <div className="card card-padded" style={{ marginBottom:14 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>Gerar predição</div>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:11, color:'var(--text-dim)', fontWeight:500, display:'block', marginBottom:3 }}>Marca *</label>
              <input type="text" value={brand} onChange={e => setBrand(e.target.value)}
                placeholder="Ex: Ambev, Itaú, Magazine Luiza…"
                style={{ width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid #D1D5DB', fontSize:13, boxSizing:'border-box' }} required />
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:11, color:'var(--text-dim)', fontWeight:500, display:'block', marginBottom:3 }}>Escopo</label>
              <select value={scope} onChange={e => setScope(e.target.value)}
                style={{ width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid #D1D5DB', fontSize:13, background:'white', boxSizing:'border-box' }}>
                <option value="">— Geral —</option>
                {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:11, color:'var(--text-dim)', fontWeight:500, display:'block', marginBottom:3 }}>Contexto adicional</label>
              <textarea value={context} onChange={e => setContext(e.target.value)}
                placeholder="CMO novo, foco em performance…" rows={3}
                style={{ width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid #D1D5DB', fontSize:12, resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, color:'var(--text-dim)', fontWeight:500, display:'block', marginBottom:3 }}>Top agências: {topN}</label>
              <input type="range" min={1} max={5} value={topN} onChange={e => setTopN(+e.target.value)} style={{ width:'100%', accentColor:'#3B82F6' }} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !brand.trim()} style={{ width:'100%', fontSize:13 }}>
              {loading ? '⟳ Analisando…' : '◈ Gerar predição'}
            </button>
          </form>
          {error && <div style={{ marginTop:8, padding:'7px 10px', background:'#FEF2F2', color:'#991B1B', borderRadius:7, fontSize:12 }}>✗ {error}</div>}
        </div>

        {history.length > 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--text-dim)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>Histórico</div>
            {history.slice(0,8).map(p => {
              const top = p.result?.predictions?.[0]
              return (
                <div key={p.id || p.created_at} className="card card-padded" style={{ marginBottom:6, padding:'8px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <span style={{ fontWeight:600, fontSize:12 }}>{p.brand}</span>
                      {p.scope && <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:6 }}>{p.scope}</span>}
                      {top && <span style={{ fontSize:10, color:'#2563EB', marginLeft:6 }}>→ {top.agency} ({Math.round((top.probability||0)*100)}%)</span>}
                    </div>
                    <span style={{ fontSize:10, color:'var(--text-dim)' }}>{new Date(p.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        {!result && !loading && (
          <div className="card card-padded" style={{ textAlign:'center', padding:'48px 32px', color:'var(--text-dim)' }}>
            <div style={{ fontSize:32, marginBottom:10 }}>◈</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>Aguardando análise</div>
            <div style={{ fontSize:12 }}>Informe a marca e o escopo.<br/>O agente busca o histórico no banco e gera uma predição fundamentada.</div>
          </div>
        )}
        {loading && (
          <div className="card card-padded" style={{ textAlign:'center', padding:'48px 32px', color:'var(--text-muted)' }}>
            <div style={{ fontSize:13 }}>⟳ Buscando histórico e consultando Claude…</div>
          </div>
        )}
        {result && !loading && (
          <div className="card card-padded">
            <PredictionResult result={result} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Predictions() {
  const [tab, setTab]       = useState('dashboard')
  const [prefill, setPrefill] = useState(null)

  function handlePredict(data) {
    setPrefill(data)
    setTab('predict')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pitch Predict</h1>
          <p className="page-subtitle">Probabilidade de troca de agência por marca e escopo</p>
        </div>
        <div style={{ display:'flex', gap:4, alignSelf:'center' }}>
          {[['dashboard','◷ Dashboard'],['predict','◈ Gerar predição']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`btn ${tab===key ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize:12 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab onPredict={handlePredict} />}
      {tab === 'predict'   && <PredictTab prefill={prefill} />}
    </div>
  )
}
