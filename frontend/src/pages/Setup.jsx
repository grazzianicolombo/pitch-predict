import { useState, useEffect } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const API_META = {
  anthropic: {
    logo: '✦',
    color: '#D97706',
    bg: '#FFF7ED',
    border: '#FDE68A',
    hint: 'Começa com sk-ant-api03-',
    link: 'https://console.anthropic.com/settings/keys',
    linkLabel: 'Console Anthropic',
  },
  tavily: {
    logo: '⌖',
    color: '#7C3AED',
    bg: '#F5F3FF',
    border: '#DDD6FE',
    hint: 'Começa com tvly-',
    link: 'https://app.tavily.com',
    linkLabel: 'Dashboard Tavily',
  },
  pdl: {
    logo: '◈',
    color: '#0369A1',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    hint: '64 caracteres hexadecimais',
    link: 'https://dashboard.peopledatalabs.com',
    linkLabel: 'Dashboard PDL',
  },
}

function UsageBar({ label, value, max, unit }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const color = pct > 80 ? '#EF4444' : pct > 50 ? '#F59E0B' : '#16A34A'
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: '#111' }}>{value?.toLocaleString('pt-BR')} {unit}</span>
      </div>
      {max > 0 && (
        <div style={{ height: 3, background: '#E5E7EB', borderRadius: 99 }}>
          <div style={{ height: 3, width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.4s' }} />
        </div>
      )}
    </div>
  )
}

function ApiCard({ apiConfig, onSave, canEdit }) {
  const meta = API_META[apiConfig.id] || {}
  const [editing, setEditing] = useState(false)
  const [newKey, setNewKey]   = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving]   = useState(false)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const { data } = await api.post(`/setup/test/${apiConfig.id}`)
      setTestResult({ ok: true, detail: JSON.stringify(data).slice(0, 80) })
    } catch (e) {
      setTestResult({ ok: false, detail: e.response?.data?.error || e.message })
    }
    setTesting(false)
  }

  async function handleSave() {
    if (!newKey.trim()) return
    setSaving(true)
    try {
      await api.put('/setup/key', { key_env: apiConfig.key_env, value: newKey.trim() })
      setEditing(false)
      setNewKey('')
      onSave()
    } catch (e) {
      alert('Erro ao salvar: ' + (e.response?.data?.error || e.message))
    }
    setSaving(false)
  }

  const u = apiConfig.usage || {}

  return (
    <div className="card card-padded" style={{
      marginBottom: 12,
      border: `1px solid ${meta.border || 'var(--border)'}`,
      background: apiConfig.configured ? 'white' : '#FAFAFA',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, background: meta.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: meta.color, flexShrink: 0,
          }}>
            {meta.logo}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{apiConfig.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 1 }}>{apiConfig.description}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {apiConfig.configured ? (
            <span style={{ fontSize: 11, fontWeight: 600, background: '#DCFCE7', color: '#16A34A', borderRadius: 99, padding: '3px 10px' }}>
              ● Configurada
            </span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, background: '#FEF3C7', color: '#92400E', borderRadius: 99, padding: '3px 10px' }}>
              ○ Não configurada
            </span>
          )}
        </div>
      </div>

      {/* Chave atual */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#374151', flex: 1 }}>
          {apiConfig.key_masked || '••••••••••••'}
        </span>
        {canEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(!editing); setNewKey(''); setTestResult(null) }}>
            {editing ? 'Cancelar' : '✎ Editar chave'}
          </button>
        )}
      </div>

      {/* Formulário de edição */}
      {editing && (
        <div style={{ marginBottom: 12, padding: 12, background: '#FFFBEB', borderRadius: 8, border: '1px solid #FDE68A' }}>
          <div style={{ fontSize: 11, color: '#92400E', marginBottom: 6 }}>
            ⚠ Cole a nova chave abaixo. {meta.hint}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder="Cole a nova chave aqui..."
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                border: '1px solid #D1D5DB', fontSize: 12,
                fontFamily: 'var(--font-mono)', background: 'white',
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !newKey.trim()}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          {meta.link && (
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>
              Gere uma nova chave em{' '}
              <a href={meta.link} target="_blank" rel="noreferrer" style={{ color: meta.color }}>
                {meta.linkLabel} ↗
              </a>
            </div>
          )}
        </div>
      )}

      {/* Uso das APIs */}
      <div style={{ marginBottom: 12 }}>
        {apiConfig.id === 'anthropic' && (
          <>
            <UsageBar label="Requisições totais" value={u.requests || 0} max={0} unit="chamadas" />
            <UsageBar label="Tokens de entrada" value={u.tokens_in || 0} max={0} unit="tokens" />
            <UsageBar label="Tokens de saída"   value={u.tokens_out || 0} max={0} unit="tokens" />
            {u.cost_usd > 0 && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                Custo estimado: <strong style={{ color: '#111' }}>${u.cost_usd?.toFixed(4)}</strong>
              </div>
            )}
          </>
        )}
        {apiConfig.id === 'tavily' && (
          <>
            <UsageBar label="Buscas realizadas" value={u.requests || 0} max={1000} unit="/ 1.000 free" />
            {u.cost_usd > 0 && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                Custo estimado: <strong style={{ color: '#111' }}>${u.cost_usd?.toFixed(4)}</strong>
              </div>
            )}
          </>
        )}
        {apiConfig.id === 'pdl' && (
          <>
            <UsageBar label="Enrichments realizados" value={u.requests || 0} max={100} unit="/ 100 free" />
            <UsageBar label="Créditos usados" value={u.credits || 0} max={100} unit="créditos" />
          </>
        )}
        {u.requests === 0 && (
          <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>
            Nenhuma chamada registrada ainda
          </div>
        )}
        {u.last_used && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Último uso: {new Date(u.last_used).toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      {/* Preço + Teste */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>{apiConfig.pricing}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {testResult && (
            <span style={{ fontSize: 11, color: testResult.ok ? '#16A34A' : '#EF4444' }}>
              {testResult.ok ? '✓ OK' : '✗ Erro'} — {testResult.detail}
            </span>
          )}
          {apiConfig.configured && (
            <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={testing}>
              {testing ? '⟳ Testando…' : '▷ Testar conexão'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Setup() {
  const { isSuperadmin } = useAuth()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data: d } = await api.get('/setup')
      setData(d)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const totalReqs = data?.apis?.reduce((sum, a) => sum + (a.usage?.requests || 0), 0) || 0
  const totalCost = data?.apis?.reduce((sum, a) => sum + (a.usage?.cost_usd || 0), 0) || 0
  const configured = data?.apis?.filter(a => a.configured).length || 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Chaves de API, uso e custo acumulado</p>
        </div>
        <button className="btn btn-ghost" onClick={load}>↺ Atualizar</button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">APIs configuradas</div>
          <div className="stat-value" style={{ color: configured === 3 ? '#16A34A' : '#F59E0B' }}>{configured}/3</div>
          <div className="stat-sub">integradas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total de requisições</div>
          <div className="stat-value">{totalReqs.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">todas as APIs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo estimado</div>
          <div className="stat-value">${totalCost.toFixed(4)}</div>
          <div className="stat-sub">USD acumulado</div>
        </div>
      </div>

      {loading ? (
        <p className="loading">Carregando configurações…</p>
      ) : (
        <>
          {data?.apis?.map(apiConfig => (
            <ApiCard key={apiConfig.id} apiConfig={apiConfig} onSave={load} canEdit={isSuperadmin} />
          ))}

          {/* Log recente */}
          {data?.recent_log?.length > 0 && (
            <div className="card" style={{ marginTop: 8 }}>
              <div className="section-header" style={{ cursor: 'pointer' }} onClick={() => setLogOpen(!logOpen)}>
                <span className="section-title">Log de uso recente ({data.recent_log.length})</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{logOpen ? '▲ fechar' : '▼ ver'}</span>
              </div>
              {logOpen && (
                <table className="data-table">
                  <thead>
                    <tr><th>API</th><th>Operação</th><th>Requisições</th><th>Tokens in/out</th><th>Custo</th><th>Data</th></tr>
                  </thead>
                  <tbody>
                    {data.recent_log.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.api_name}</strong></td>
                        <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{row.operation}</td>
                        <td>{row.requests}</td>
                        <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                          {row.tokens_in > 0 ? `${row.tokens_in?.toLocaleString()}/${row.tokens_out?.toLocaleString()}` : '—'}
                        </td>
                        <td style={{ fontSize: 12 }}>{row.cost_usd > 0 ? `$${Number(row.cost_usd).toFixed(4)}` : '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {new Date(row.created_at).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
