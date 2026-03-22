import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const CONFIDENCE_COLORS = { alta: '#16A34A', média: '#F59E0B', baixa: '#EF4444' }

function NewsTag({ found }) {
  return found
    ? <span style={{ fontSize: 11, background: '#DCFCE7', color: '#16A34A', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>✦ notícia 2026</span>
    : <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '2px 6px' }}>sem notícia 2026</span>
}

function ProgressBar({ progress, total }) {
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 4 }}>
        <span>Lote {progress} de {total} processado</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 4, background: '#E5E7EB', borderRadius: 9999 }}>
        <div style={{ height: 4, width: `${pct}%`, background: '#1D4ED8', borderRadius: 9999, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

export default function Validation() {
  const { isSuperadmin } = useAuth()
  const [queue, setQueue]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [running, setRunning]     = useState(false)
  const [job, setJob]             = useState(null)   // { job_id, status, progress, total, result }
  const [lastResult, setLastResult] = useState(null)
  const [error, setError]         = useState(null)
  const [expanded, setExpanded]   = useState(null)
  const pollRef                   = useRef(null)

  useEffect(() => { loadQueue() }, [])

  // Cleanup polling ao desmontar
  useEffect(() => () => clearInterval(pollRef.current), [])

  async function loadQueue() {
    setLoading(true)
    try {
      const { data } = await api.get('/agent/queue')
      setQueue(data)
    } catch {
      setError('Erro ao carregar fila')
    }
    setLoading(false)
  }

  function startPolling(jobId) {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/agent/jobs/${jobId}`)
        setJob(data)

        if (data.status === 'done') {
          clearInterval(pollRef.current)
          setRunning(false)
          setLastResult(data.result)
          await loadQueue()
        } else if (data.status === 'error') {
          clearInterval(pollRef.current)
          setRunning(false)
          setError(data.error)
        }
      } catch (e) {
        clearInterval(pollRef.current)
        setRunning(false)
        setError('Erro ao verificar status do agente')
      }
    }, 3000)  // poll a cada 3s
  }

  async function runAgent() {
    setRunning(true)
    setError(null)
    setLastResult(null)
    setJob(null)
    try {
      const { data } = await api.post('/agent/validate-agencies')
      setJob({ job_id: data.job_id, status: 'running', progress: 0, total: 0 })
      startPolling(data.job_id)
    } catch (e) {
      setRunning(false)
      setError(e.response?.data?.error || e.message)
    }
  }

  async function approve(id) {
    await api.post(`/agent/queue/${id}/approve`)
    setQueue(q => q.map(i => i.id === id ? { ...i, status: 'aprovado' } : i))
  }

  async function reject(id) {
    await api.post(`/agent/queue/${id}/reject`)
    setQueue(q => q.map(i => i.id === id ? { ...i, status: 'rejeitado' } : i))
  }

  async function approveAll() {
    const pending = queue.filter(i => i.status === 'pendente')
    await Promise.all(pending.map(i => api.post(`/agent/queue/${i.id}/approve`)))
    await loadQueue()
  }

  async function clearResolved() {
    await api.delete('/agent/queue')
    await loadQueue()
  }

  const pending   = queue.filter(i => i.status === 'pendente')
  const resolved  = queue.filter(i => i.status !== 'pendente')
  const withNews  = pending.filter(i => i.news_found).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agente Validador</h1>
          <p className="page-subtitle">Busca notícias jan–mar 2026 antes de sugerir qualquer mudança</p>
        </div>
        {isSuperadmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            {resolved.length > 0 && !running && (
              <button className="btn btn-ghost" onClick={clearResolved}>Limpar resolvidos</button>
            )}
            <button className="btn btn-primary" onClick={runAgent} disabled={running}>
              {running ? '⟳ Analisando…' : '▶ Executar agente'}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Pendentes</div>
          <div className="stat-value" style={{ color: pending.length > 0 ? '#F59E0B' : 'var(--text)' }}>{pending.length}</div>
          <div className="stat-sub">aguardando revisão</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Com evidência 2026</div>
          <div className="stat-value" style={{ color: '#16A34A' }}>{withNews}</div>
          <div className="stat-sub">suportadas por notícia</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ativas confirmadas</div>
          <div className="stat-value">{lastResult?.confirmed_active ?? '—'}</div>
          <div className="stat-sub">notícia 2026 encontrada</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Aprovadas</div>
          <div className="stat-value" style={{ color: '#16A34A' }}>{queue.filter(i => i.status === 'aprovado').length}</div>
          <div className="stat-sub">aplicadas ao banco</div>
        </div>
      </div>

      {/* Progresso do job */}
      {running && job && (
        <div className="card card-padded" style={{ marginBottom: '1rem', background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1D4ED8' }}>
                ⟳ Agente buscando notícias de 2026…
              </div>
              <div style={{ fontSize: 12, color: '#3B82F6', marginTop: 2 }}>
                Para cada agência é feita ao menos uma busca na web — pode levar 3–5 min para 72 agências
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#6B7280', background: '#DBEAFE', padding: '2px 8px', borderRadius: 99 }}>
              job {job.job_id}
            </span>
          </div>
          {(job.total > 0) && <ProgressBar progress={job.progress} total={job.total} />}
        </div>
      )}

      {/* Resultado */}
      {lastResult && (
        <div className="card card-padded" style={{ marginBottom: '1rem', background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            ✦ Agente v2 concluído — web search ativo
          </div>
          <div style={{ fontSize: 13.5, color: '#111', marginBottom: 8 }}>{lastResult.summary}</div>
          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6B7280', flexWrap: 'wrap' }}>
            <span><strong style={{ color: '#111' }}>{lastResult.agencies_analyzed}</strong> analisadas</span>
            <span><strong style={{ color: '#16A34A' }}>{lastResult.confirmed_active}</strong> ativas por notícia</span>
            <span><strong style={{ color: '#111' }}>{lastResult.suggestions_found}</strong> sugestões</span>
            <span><strong style={{ color: '#16A34A' }}>{lastResult.news_backed}</strong> com evidência</span>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="card card-padded" style={{ marginBottom: '1rem', background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <div style={{ fontSize: 13, color: '#EF4444' }}>⚠ {error}</div>
        </div>
      )}

      {/* Fila pendente */}
      {loading ? (
        <p className="loading">Carregando…</p>
      ) : pending.length > 0 ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="section-header">
            <span className="section-title">Pendentes ({pending.length})</span>
            {isSuperadmin && <button className="btn btn-primary btn-sm" onClick={approveAll}>Aprovar todos</button>}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Agência</th>
                <th>Campo</th>
                <th>Atual → Sugerido</th>
                <th>Evidência de busca</th>
                <th>Conf.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map(item => {
                const isExpanded = expanded === item.id
                return [
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : item.id)}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.entity_name}</div>
                      <div style={{ marginTop: 3 }}><NewsTag found={item.news_found} /></div>
                    </td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{item.field_name}</td>
                    <td>
                      <span style={{ color: '#EF4444', fontSize: 12, textDecoration: 'line-through' }}>{item.current_value || '—'}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>→</span>
                      <span style={{ color: '#16A34A', fontSize: 13, fontWeight: 500 }}>{item.suggested_value || '—'}</span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 240 }}>
                      {item.evidence
                        ? <span title={item.evidence}>{item.evidence.slice(0, 70)}{item.evidence.length > 70 ? '…' : ''}</span>
                        : <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>sem evidência direta</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, color: CONFIDENCE_COLORS[item.confidence] || '#6B7280' }}>
                        {item.confidence || '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isSuperadmin && <>
                        <button className="btn btn-sm" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#16A34A', marginRight: 4 }}
                          onClick={e => { e.stopPropagation(); approve(item.id) }}>✓ Aplicar</button>
                        <button className="btn btn-danger btn-sm"
                          onClick={e => { e.stopPropagation(); reject(item.id) }}>✕</button>
                      </>}
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${item.id}-exp`} style={{ background: '#FAFAFA' }}>
                      <td colSpan={6} style={{ padding: '12px 16px', borderTop: '1px solid #F3F4F6' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                          <strong>Motivo:</strong> {item.reason}
                        </div>
                        {item.evidence && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                            <strong>Evidência encontrada:</strong> {item.evidence}
                          </div>
                        )}
                        {item.search_queries?.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                            <strong>Queries usadas:</strong> {item.search_queries.join(' · ')}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                          <strong>Fonte:</strong> {item.source}
                        </div>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      ) : !running && !error && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="empty-state" style={{ padding: '3rem' }}>
            <span className="icon">✓</span>
            <p>{queue.length === 0
              ? 'Execute o agente para validar agências com busca de notícias de 2026'
              : 'Nenhuma sugestão pendente — tudo revisado'}
            </p>
          </div>
        </div>
      )}

      {/* Histórico */}
      {resolved.length > 0 && (
        <div className="card">
          <div className="section-header">
            <span className="section-title">Histórico ({resolved.length})</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Agência</th><th>Campo</th><th>Anterior → Novo</th><th>Notícia</th><th>Status</th><th>Data</th></tr>
            </thead>
            <tbody>
              {resolved.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.entity_name}</strong></td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{item.field_name}</td>
                  <td style={{ fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{item.current_value || '—'}</span>
                    <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>→</span>
                    {item.suggested_value || '—'}
                  </td>
                  <td><NewsTag found={item.news_found} /></td>
                  <td><span className={`badge ${item.status === 'aprovado' ? 'badge-green' : 'badge-gray'}`}>{item.status}</span></td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    {item.reviewed_at ? new Date(item.reviewed_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
