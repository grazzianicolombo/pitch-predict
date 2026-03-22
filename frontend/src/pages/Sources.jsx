import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

// ─── Configuração estática das fontes ──────────────────────────────────────
const SOURCES_META = {
  mm_archive: {
    name: 'M&M — Acervo SQLite (1978–2017)', url: 'acervo.meioemensagem.com.br',
    via: 'SQLite CDN', category: 'Contas & Agências', status: 'ativo', coverage: 'Primária',
    fields: ['mudanças de agência', 'pitchs', 'nomeações executivas', 'texto completo'],
    highlight: '697 edições extraídas · acervo histórico fechado — sem novas atualizações',
    canPdf: false,
    noCron: true,   // acervo fechado, sem cronjob
  },
  mm_website: {
    name: 'M&M — Site Web (2018–hoje)', url: 'meioemensagem.com.br',
    via: 'WordPress API', category: 'Contas & Agências', status: 'ativo', coverage: 'Primária',
    fields: ['mudanças de agência', 'nomeações', 'pitchs', 'artigos completos'],
    highlight: '81k artigos disponíveis · API REST sem autenticação',
    canPdf: false,
  },
  propmark: {
    name: 'Propmark', url: 'propmark.com.br',
    via: 'Tavily', category: 'Contas & Agências', status: 'ativo', coverage: 'Secundária',
    fields: ['pitchs', 'novos negócios', 'encerramento de contas'],
    highlight: 'Cobertura complementar ao M&M — foco em novos negócios',
    canPdf: false,
  },
  pdl: {
    name: 'People Data Labs', url: 'peopledatalabs.com',
    via: 'API direta', category: 'Executivos & Empresa', status: 'ativo', coverage: 'Primária',
    fields: ['nome executivo', 'cargo', 'LinkedIn', 'nº de funcionários', 'setor'],
    highlight: '33+ diretores de marketing mapeados só na Ambev · $0,001/registro',
    canPdf: false,
  },
  exame: {
    name: 'Exame', url: 'exame.com',
    via: 'Tavily', category: 'Dados da Empresa', status: 'ativo', coverage: 'Complementar',
    fields: ['receita', 'fusões', 'nomeações C-level'],
    canPdf: false,
  },
  valor: {
    name: 'Valor Econômico', url: 'valor.globo.com',
    via: 'Tavily', category: 'Dados da Empresa', status: 'ativo', coverage: 'Complementar',
    fields: ['resultados financeiros', 'investimento em marketing'],
    canPdf: false,
  },
  scopen: {
    name: 'Scopen Brasil', url: 'scopen.com',
    via: 'Upload PDF', category: 'Dados de Mercado', status: 'ativo', coverage: 'Primária',
    fields: ['satisfação cliente-agência', 'remuneração por escopo', 'ranking agências'],
    highlight: 'Pesquisa anual mais precisa do mercado BR — upload manual do relatório PDF',
    canPdf: true,
  },
  apollo: {
    name: 'Apollo.io', url: 'apollo.io',
    via: 'API direta', category: 'Em Avaliação', status: 'pendente', coverage: 'Futura',
    fields: ['email executivo', 'tecnologias usadas', 'tamanho equipe mkt'],
    highlight: '50 exports gratuitos/mês',
    canPdf: false,
  },
  kantar: {
    name: 'Kantar IBOPE Media', url: 'kantaribopemedia.com',
    via: 'Manual (ranking anual)', category: 'Dados de Mercado', status: 'ativo', coverage: 'Primária',
    fields: ['ranking maiores anunciantes', 'investimento em mídia (R$M)', 'posição no ranking'],
    highlight: 'Ranking dos 100 maiores anunciantes do Brasil 2024 — 99 marcas seedadas com posição e investimento',
    canPdf: false,
    noCron: true,
    editUrl: 'https://www.kantaribopemedia.com/ranking-anunciantes/',
  },
  mapa_agencias: {
    name: 'Mapa das Agências · Meio & Mensagem', url: 'meioemensagem.com.br',
    via: 'Manual (PDF/planilha anual)', category: 'Contas & Agências', status: 'ativo', coverage: 'Primária',
    fields: ['agências por holding/grupo', 'categoria (int/nac/ind)', 'liderança', 'especialidades'],
    highlight: 'Mapa 2025 — 270 agências em 30 grupos (14 internacionais, 16 nacionais, 6 independentes)',
    canPdf: false,
    noCron: true,
    editUrl: 'https://www.meioemensagem.com.br/comunicacao/mapa-das-agencias',
  },
}

const FREQ_OPTIONS = [
  { value: 'manual',  label: 'Manual' },
  { value: 'hourly',  label: 'A cada hora' },
  { value: 'daily',   label: 'Diária' },
  { value: 'weekly',  label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
]

const STATUS_STYLE = {
  ativo:    { label: 'Ativo',    bg: '#DCFCE7', color: '#16A34A' },
  parcial:  { label: 'Parcial', bg: '#FEF3C7', color: '#92400E' },
  pendente: { label: 'Avaliar', bg: '#F3F4F6', color: '#6B7280' },
}

const COVERAGE_STYLE = {
  'Primária':     { bg: '#EFF6FF', color: '#1D4ED8' },
  'Secundária':   { bg: '#F5F3FF', color: '#6D28D9' },
  'Complementar': { bg: '#F0FDF4', color: '#15803D' },
  'Futura':       { bg: '#F9FAFB', color: '#9CA3AF' },
}

const RUN_STATUS = {
  ok:      { icon: '✓', color: '#16A34A', label: 'Ok' },
  error:   { icon: '✗', color: '#DC2626', label: 'Erro' },
  running: { icon: '⟳', color: '#2563EB', label: 'Rodando' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ─── Componente de upload PDF ────────────────────────────────────────────────
function PdfUploadArea({ sourceId, onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const inputRef = useRef()

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.pdf')) {
      setResult({ error: 'Envie um arquivo .pdf' })
      return
    }
    setUploading(true)
    setResult(null)
    const form = new FormData()
    form.append('pdf', file)
    try {
      const { data } = await api.post('/sources/upload-scopen', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult({ success: true, ...data })
      onUploaded?.()
    } catch (e) {
      setResult({ error: e.response?.data?.error || 'Erro no upload' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#3B82F6' : '#D1D5DB'}`,
          borderRadius: 10,
          padding: '20px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? '#EFF6FF' : '#FAFAFA',
          transition: 'all 0.15s',
          marginTop: 10,
        }}
      >
        <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
        {uploading ? (
          <span style={{ color: '#2563EB', fontSize: 13 }}>⟳ Enviando...</span>
        ) : (
          <>
            <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Arraste o PDF aqui ou clique para selecionar</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
              Relatório Scopen · até 50 MB
            </div>
          </>
        )}
      </div>
      {result && (
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12,
          background: result.error ? '#FEF2F2' : '#F0FDF4',
          color: result.error ? '#991B1B' : '#15803D',
          border: `1px solid ${result.error ? '#FECACA' : '#BBF7D0'}`,
        }}>
          {result.error
            ? `✗ ${result.error}`
            : `✓ ${result.original_name || 'arquivo'} enviado (${result.size_kb} KB) — ${result.message}`
          }
        </div>
      )}
    </div>
  )
}

// ─── Card estático para fontes manuais sem job ──────────────────────────────
function StaticSourceCard({ meta, canEdit }) {
  const [enabled, setEnabled] = useState(meta.status === 'ativo')
  const st = enabled ? (STATUS_STYLE[meta.status] || STATUS_STYLE.pendente) : { label: 'Desativado', bg: '#F3F4F6', color: '#9CA3AF' }
  const cov = COVERAGE_STYLE[meta.coverage] || {}
  return (
    <div className="card" style={{ marginBottom: 10, padding: '14px 16px', opacity: enabled ? 1 : 0.55, transition: 'opacity 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{meta.name}</span>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
            {meta.coverage && enabled && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 500, background: cov.bg, color: cov.color }}>{meta.coverage}</span>
            )}
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 500, background: '#F3F4F6', color: '#6B7280' }}>Manual</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
            {meta.url} · via {meta.via}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {meta.fields?.map(f => (
              <span key={f} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 500 }}>{f}</span>
            ))}
          </div>
          {meta.highlight && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontStyle: 'italic' }}>{meta.highlight}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
          {canEdit && meta.editUrl && (
            <a href={meta.editUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text-muted)', textDecoration: 'none',
                cursor: 'pointer', fontWeight: 500, transition: 'all 0.1s' }}>
              ✎ Editar
            </a>
          )}
          {canEdit && <button
            onClick={() => setEnabled(!enabled)}
            title={enabled ? 'Desativar fonte' : 'Ativar fonte'}
            style={{
              width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: enabled ? '#16A34A' : '#D1D5DB', position: 'relative', transition: 'background 0.2s',
            }}>
            <span style={{
              position: 'absolute', top: 2, left: enabled ? 20 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
            }} />
          </button>}
        </div>
      </div>
    </div>
  )
}

// ─── Card de fonte com scheduling ────────────────────────────────────────────
function LogPanel({ sourceId }) {
  const [logs, setLogs]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/sources/jobs/${sourceId}/logs`)
      .then(r => setLogs(r.data))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [sourceId])

  function fmtBytes(n) {
    if (!n) return '—'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' MB'
    if (n >= 1_000)     return Math.round(n / 1_000) + ' KB'
    return n + ' chars'
  }
  function fmtDur(ms) {
    if (!ms) return ''
    if (ms >= 60_000) return ` · ${Math.round(ms/60000)}min`
    return ` · ${Math.round(ms/1000)}s`
  }

  if (loading) return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-dim)' }}>Carregando logs…</div>
  if (!logs?.length) return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-dim)' }}>Nenhuma coleta registrada ainda.</div>

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--text-main)' }}>
        Histórico de coletas
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
            <th style={{ paddingBottom: 4, fontWeight: 500 }}>Data</th>
            <th style={{ paddingBottom: 4, fontWeight: 500 }}>Status</th>
            <th style={{ paddingBottom: 4, fontWeight: 500 }}>Registros</th>
            <th style={{ paddingBottom: 4, fontWeight: 500 }}>Volume texto</th>
            <th style={{ paddingBottom: 4, fontWeight: 500 }}>Duração</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => {
            const s = log.status === 'ok'
              ? { icon: '✓', color: '#16A34A' }
              : log.status === 'error'
                ? { icon: '✗', color: '#DC2626' }
                : { icon: '⟳', color: '#2563EB' }
            return (
              <tr key={log.id} style={{ borderTop: '1px solid #E5E7EB' }}>
                <td style={{ padding: '5px 0', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDate(log.ran_at)}
                </td>
                <td style={{ padding: '5px 8px', color: s.color, fontWeight: 600 }}>
                  {s.icon} {log.status}
                </td>
                <td style={{ padding: '5px 8px' }}>
                  {log.records_added?.toLocaleString('pt-BR') || '—'}
                </td>
                <td style={{ padding: '5px 8px', color: '#2563EB' }}>
                  {fmtBytes(log.text_chars)}
                </td>
                <td style={{ padding: '5px 0', color: 'var(--text-dim)' }}>
                  {fmtDur(log.duration_ms) || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {logs[0]?.error_msg && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#DC2626', background: '#FEF2F2', padding: '6px 8px', borderRadius: 6 }}>
          Último erro: {logs[0].error_msg}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, meta, onSave, onUploaded, canEdit }) {
  const [open, setOpen]       = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [freq, setFreq]       = useState(job?.frequency || 'manual')
  const [enabled, setEna]     = useState(job?.enabled || false)
  const [saving, setSave]     = useState(false)
  const [fullCrawling, setFullCrawl]  = useState(false)
  const [fullCrawlMsg, setFullMsg]    = useState(null)

  const st   = STATUS_STYLE[meta?.status || 'pendente']
  const cov  = COVERAGE_STYLE[meta?.coverage || 'Futura']
  const runS = job?.last_run_status ? RUN_STATUS[job.last_run_status] : null

  async function handleFullCrawl(limit) {
    setFullCrawl(true)
    setFullMsg(null)
    try {
      await api.post('/sources/jobs/propmark/full-crawl', { limit })
      setFullMsg(`⟳ Full crawl iniciado (até ${limit.toLocaleString('pt-BR')} artigos) — pode levar horas`)
    } catch (err) {
      setFullMsg(`✗ ${err.response?.data?.error || 'Erro ao iniciar'}`)
    } finally {
      setFullCrawl(false)
    }
  }

  async function save() {
    setSave(true)
    await onSave(job.source_id, { frequency: freq, enabled })
    setSave(false)
    setOpen(false)
  }

  return (
    <div className="card card-padded" style={{ marginBottom: 8, opacity: meta?.status === 'pendente' ? 0.65 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        {/* Esquerda */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{meta?.name || job?.source_name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{meta?.url}</span>
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: meta?.highlight ? 5 : 0 }}>
            {(meta?.fields || []).map(f => (
              <span key={f} style={{ fontSize: 11, background: '#F3F4F6', color: '#374151', borderRadius: 4, padding: '2px 7px' }}>
                {f}
              </span>
            ))}
          </div>
          {meta?.highlight && (
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4, lineHeight: 1.4 }}>{meta.highlight}</div>
          )}

          {/* Expandido: config de schedule ou PDF upload */}
          {open && canEdit && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              {meta?.canPdf ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Upload do relatório PDF</div>
                  <PdfUploadArea sourceId={job.source_id} onUploaded={onUploaded} />
                </>
              ) : (
                <>
                  {/* Full crawl — apenas Propmark */}
                  {job.source_id === 'propmark' && (
                    <div style={{ marginBottom: 14, padding: '10px 12px', background: '#FFFBEB', borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#92400E' }}>Full Crawl — Backfill histórico</div>
                      <div style={{ fontSize: 11, color: '#78350F', marginBottom: 8, lineHeight: 1.5 }}>
                        Indexa todo o sitemap do Propmark (~50K URLs) sem filtro de data.<br/>
                        Executa em background — pode levar várias horas.
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[1000, 5000, 50000].map(n => (
                          <button key={n} className="btn btn-sm" disabled={fullCrawling}
                            onClick={() => handleFullCrawl(n)}
                            style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>
                            {fullCrawling ? '⟳' : `▶ ${n >= 1000 ? `${n/1000}k` : n} artigos`}
                          </button>
                        ))}
                      </div>
                      {fullCrawlMsg && (
                        <div style={{ marginTop: 6, fontSize: 11, color: fullCrawlMsg.startsWith('✗') ? '#DC2626' : '#92400E' }}>
                          {fullCrawlMsg}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10 }}>Agendamento de coleta</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Periodicidade</div>
                      <select
                        value={freq}
                        onChange={e => setFreq(e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'white' }}
                      >
                        {FREQ_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Ativo</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={enabled} onChange={e => setEna(e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: '#3B82F6' }} />
                        <span style={{ fontSize: 12 }}>{enabled ? 'Sim' : 'Não'}</span>
                      </label>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}
                      style={{ marginTop: 12, fontSize: 12 }}>
                      {saving ? '...' : '✓ Salvar'}
                    </button>
                  </div>
                  {job?.next_run_at && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#2563EB' }}>
                      ⟳ Próxima coleta: {fmtDate(job.next_run_at)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Painel de logs */}
          {logOpen && !meta?.canPdf && (
            <LogPanel sourceId={job.source_id} />
          )}
        </div>

        {/* Direita */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, borderRadius: 99, padding: '2px 10px' }}>
            {st.label}
          </span>
          {meta?.coverage && (
            <span style={{ fontSize: 11, background: cov.bg, color: cov.color, borderRadius: 99, padding: '2px 8px' }}>
              {meta.coverage}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-dim)', background: '#F9FAFB', borderRadius: 99, padding: '2px 8px' }}>
            via {meta?.via}
          </span>

          {/* Status última execução */}
          {runS && (
            <span style={{ fontSize: 10, color: runS.color }}>
              {runS.icon} {runS.label}
              {job.last_run_count ? ` · ${job.last_run_count} registros` : ''}
              {' · '}{fmtDate(job.last_run_at)}
            </span>
          )}

          {/* Frequência atual */}
          {job?.frequency && job.frequency !== 'manual' && (
            <span style={{
              fontSize: 10, color: job.enabled ? '#2563EB' : 'var(--text-dim)',
              background: job.enabled ? '#DBEAFE' : '#F3F4F6',
              borderRadius: 99, padding: '2px 7px',
            }}>
              {job.enabled ? '⟳' : '○'} {FREQ_OPTIONS.find(o => o.value === job.frequency)?.label}
            </span>
          )}

          {/* Ações */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
            {/* Toggle ativo/inativo */}
            {canEdit && !meta?.canPdf && meta?.status !== 'pendente' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                title={enabled ? 'Desativar fonte' : 'Ativar fonte'}>
                <div style={{
                  width: 32, height: 18, borderRadius: 99,
                  background: enabled ? '#3B82F6' : '#D1D5DB',
                  position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', background: 'white',
                    position: 'absolute', top: 2,
                    left: enabled ? 16 : 2, transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                  }} />
                </div>
                <input type="checkbox" checked={enabled}
                  onChange={async e => {
                    const val = e.target.checked
                    setEna(val)
                    await onSave(job.source_id, { enabled: val, frequency: freq })
                  }}
                  style={{ display: 'none' }} />
              </label>
            )}

            {/* Botão editar agendamento ou upload */}
            {canEdit && (meta?.canPdf ? (
              <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}
                style={{ fontSize: 11 }}>
                {open ? '✕ Fechar' : '📄 Upload PDF'}
              </button>
            ) : !meta?.noCron && (
              <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}
                style={{ fontSize: 11 }}>
                {open ? '✕' : '⚙ Editar'}
              </button>
            ))}

            {/* Botão de log — fontes com histórico */}
            {meta?.status !== 'pendente' && !meta?.canPdf && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { setLogOpen(!logOpen); setOpen(false) }}
                style={{ fontSize: 11 }}
              >
                {logOpen ? '✕' : '📋 Log'}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────
const CATEGORIES = ['Contas & Agências', 'Executivos & Empresa', 'Dados da Empresa', 'Dados de Mercado', 'Em Avaliação']

export default function Sources() {
  const { isSuperadmin } = useAuth()
  const [jobs, setJobs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats]     = useState(null)

  useEffect(() => {
    Promise.all([
      api.get('/sources/jobs'),
      api.get('/sources/jobs/stats').catch(() => ({ data: null })),
    ]).then(([jobsRes, statsRes]) => {
      setJobs(jobsRes.data || [])
      setStats(statsRes.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleSave(sourceId, updates) {
    await api.put(`/sources/jobs/${sourceId}`, updates)
    const { data } = await api.get('/sources/jobs')
    setJobs(data)
  }

  const jobMap = Object.fromEntries(jobs.map(j => [j.source_id, j]))
  const totalAtivo    = jobs.filter(j => SOURCES_META[j.source_id]?.status === 'ativo').length
  const totalEnabled  = jobs.filter(j => j.enabled).length
  const totalEditions = stats?.total || 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Fontes de Dados</h1>
          <p className="page-subtitle">Coleta, agendamento e gestão de todas as fontes do radar</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Fontes ativas</div>
          <div className="stat-value" style={{ color: '#16A34A' }}>{totalAtivo}</div>
          <div className="stat-sub">integradas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Agendadas</div>
          <div className="stat-value" style={{ color: '#2563EB' }}>{totalEnabled}</div>
          <div className="stat-sub">com coleta automática</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Edições indexadas</div>
          <div className="stat-value">{totalEditions.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">no Supabase</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Categorias</div>
          <div className="stat-value">{CATEGORIES.length - 1}</div>
          <div className="stat-sub">tipos de dado</div>
        </div>
      </div>

      {loading ? (
        <p className="loading">Carregando configurações…</p>
      ) : (
        CATEGORIES.map(cat => {
          const catSources = Object.entries(SOURCES_META).filter(([, m]) => m.category === cat)
          if (catSources.length === 0) return null
          return (
            <div key={cat} style={{ marginBottom: '1.75rem' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cat}</div>
                </div>
              </div>
              {catSources.map(([sourceId, meta]) => {
                const job = jobMap[sourceId]
                return job ? (
                  <JobCard
                    key={sourceId}
                    job={job}
                    meta={meta}
                    onSave={handleSave}
                    onUploaded={() => api.get('/sources/jobs').then(r => setJobs(r.data))}
                    canEdit={isSuperadmin}
                  />
                ) : (
                  <StaticSourceCard key={sourceId} meta={meta} canEdit={isSuperadmin} />
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
