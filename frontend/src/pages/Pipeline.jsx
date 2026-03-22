/**
 * Pipeline.jsx — Status por agente (somente leitura)
 * Mostra o estado de cada agente de extração. Polling a cada 60s para stats,
 * e a cada 5s para jobs ativos (quando algum está rodando).
 */
import { useState, useEffect, useRef } from 'react'
import api from '../services/api'

function fmtN(n) { return (n ?? 0).toLocaleString('pt-BR') }
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0 }
function fmtDur(startedAt) {
  if (!startedAt) return ''
  const s = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function Bar({ value, max, color = '#3B82F6', animated = false }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ height: 6, background: '#E5E7EB', borderRadius: 99, overflow: 'hidden', marginTop: 6 }}>
      <div style={{
        height: '100%', width: `${p}%`, background: color, borderRadius: 99,
        transition: 'width 0.6s ease',
        backgroundImage: animated && p < 100
          ? 'repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(255,255,255,0.2) 8px,rgba(255,255,255,0.2) 16px)'
          : 'none',
      }} />
    </div>
  )
}

function StatusDot({ running }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: running ? '#16A34A' : '#D1D5DB',
      animation: running ? 'pulse 1.5s infinite' : 'none',
    }} />
  )
}

function AgentCard({ title, description, color, job, children, done, total }) {
  const running = job?.status === 'running'
  const p = job?.progress || 0
  const t = job?.total || 0
  const elapsed = running ? fmtDur(job?.started_at) : null

  return (
    <div className="card card-padded" style={{ marginBottom: 12, borderLeft: `3px solid ${color}` }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <StatusDot running={running} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        {running && (
          <span style={{
            fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#16A34A',
            padding: '2px 7px', borderRadius: 99, marginLeft: 4,
          }}>
            EM EXECUÇÃO {elapsed ? `· ${elapsed}` : ''}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>{description}</div>

      {/* Stats do banco */}
      {children}

      {/* Barra de progresso geral */}
      {total > 0 && (
        <>
          <Bar value={done || 0} max={total} color={color} animated={running} />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            {fmtN(done)} / {fmtN(total)} ({pct(done, total)}%)
          </div>
        </>
      )}

      {/* Progresso do job ativo */}
      {running && t > 0 && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#F0FDF4', borderRadius: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#16A34A', fontWeight: 600 }}>⟳ {fmtN(p)} / {fmtN(t)} processados</span>
            <span style={{ color: '#16A34A', fontWeight: 700 }}>{pct(p, t)}%</span>
          </div>
          <Bar value={p} max={t} color="#16A34A" animated />
          {job.batches_done > 0 && (
            <div style={{ marginTop: 4, color: '#6B7280', fontSize: 11 }}>{job.batches_done} batches concluídos</div>
          )}
        </div>
      )}
      {running && t === 0 && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#F0FDF4', borderRadius: 8, fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
          ⟳ Em execução — calculando total…
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, highlight }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || (highlight ? '#DC2626' : 'var(--text)') }}>
        {fmtN(value)}
      </div>
    </div>
  )
}

// Tipos de job que pertencem a cada agente
const AGENT_TYPES = {
  orchestrator: ['orchestrator'],
  editorial:    ['recrawl_all', 'recrawl'],
  extractor:    ['extract_articles', 'extract_editions_all', 'extract_editions'],
  media:        ['crawl_media'],
  executives:   ['enrich_executives'],
  signals:      ['capture_signals'],
}

export default function Pipeline() {
  const [orchStatus, setOrchStatus]           = useState(null)
  const [articleStats, setArticleStats]       = useState(null)
  const [editionStats, setEditionStats]       = useState(null)
  const [mediaStats, setMediaStats]           = useState(null)
  const [intelligenceStats, setIntelligence]  = useState(null)
  const [executiveStats, setExecutiveStats]   = useState(null)
  const [signalStats, setSignalStats]         = useState(null)
  const [activeJobs, setActiveJobs]     = useState([])
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [refreshing, setRefreshing]     = useState(false)
  const statsRef = useRef(null)
  const jobsRef  = useRef(null)

  async function loadStats() {
    setRefreshing(true)
    try {
      const [orchRes, artRes, edRes, medRes, intRes, execRes, sigRes] = await Promise.all([
        api.get('/agent/orchestrator/status'),
        api.get('/agent/extract-articles/stats'),
        api.get('/agent/extract-editions/stats'),
        api.get('/agent/crawl-media/stats'),
        api.get('/agent/intelligence-stats'),
        api.get('/agent/enrich-executives/stats'),
        api.get('/agent/capture-signals/stats'),
      ])
      setOrchStatus(orchRes.data)
      setArticleStats(artRes.data)
      setEditionStats(edRes.data)
      setMediaStats(medRes.data)
      setIntelligence(intRes.data)
      setExecutiveStats(execRes.data)
      setSignalStats(sigRes.data)
      setLastUpdated(new Date())
    } catch {}
    setRefreshing(false)
  }

  async function pollJobs() {
    try {
      const { data } = await api.get('/agent/active-jobs')
      setActiveJobs(data || [])
      if (data?.length > 0) loadStats()
    } catch {}
  }

  useEffect(() => {
    loadStats()
    pollJobs()
    statsRef.current = setInterval(loadStats, 60000)
    jobsRef.current  = setInterval(pollJobs, 5000)
    return () => { clearInterval(statsRef.current); clearInterval(jobsRef.current) }
  }, [])

  const propmark = articleStats?.by_source?.propmark || {}
  const editions = editionStats || {}

  function agentJob(types) {
    return activeJobs.find(j => types.includes(j.type)) || null
  }

  // Orquestrador
  const orchJob     = agentJob(AGENT_TYPES.orchestrator)
  const orch        = orchStatus || {}
  const orchHealthy = orch.pipeline_healthy === true
  const orchGaps    = orch.gaps || []
  const orchPlan    = orch.plan || []

  // Agente 1 — Editoriais (crawler)
  const editorialJob = agentJob(AGENT_TYPES.editorial)
  const noContent    = propmark.no_content || 0
  const withContent  = (propmark.total || 0) - noContent - (propmark.crawl_failed || 0)
  const propmarkDone = (propmark.ok || 0) + (propmark.skipped || 0)

  // Agente 2 — Extrator de Inteligência
  const extractorJob      = agentJob(AGENT_TYPES.extractor)
  const intel             = intelligenceStats || {}
  const propmarkPending   = Math.max(0, withContent - ((propmark.ok || 0) + (propmark.skipped || 0)))

  // Agente 3 — Mídia
  const mediaJob   = agentJob(AGENT_TYPES.media)
  const exame      = mediaStats?.exame || {}
  const valor      = mediaStats?.valor || {}
  const mediaTotal = (exame.total || 0) + (valor.total || 0)
  const mediaOk    = (exame.ok   || 0) + (valor.ok   || 0)

  // Agente 4 — Executivos
  const execJob   = agentJob(AGENT_TYPES.executives)
  const exec      = executiveStats || {}

  // Agente 6 — Sinais
  const signalsJob   = agentJob(AGENT_TYPES.signals)
  const sigData      = signalStats || {}

  return (
    <div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

      <div className="page-header">
        <div>
          <h1 className="page-title">Status do Pipeline</h1>
          <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <StatusDot running={!refreshing} />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {refreshing
                ? 'Atualizando…'
                : lastUpdated
                  ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR')} · polling a cada 60s`
                  : 'Carregando…'}
            </span>
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => { loadStats(); pollJobs() }} style={{ fontSize: 12 }}>
          ↺ Atualizar
        </button>
      </div>

      {/* Orquestrador */}
      <div className="card card-padded" style={{ marginBottom: 12, borderLeft: `3px solid ${orchHealthy ? '#16A34A' : '#F59E0B'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <StatusDot running={orchJob?.status === 'running'} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>Agente Orquestrador — Controle de Fluxo</span>
          {orchJob?.status === 'running' && (
            <span style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#16A34A', padding: '2px 7px', borderRadius: 99, marginLeft: 4 }}>
              EM EXECUÇÃO · {fmtDur(orchJob?.started_at)}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
            background: orchHealthy ? '#DCFCE7' : '#FEF3C7',
            color: orchHealthy ? '#16A34A' : '#D97706' }}>
            {orchHealthy ? '✓ Pipeline saudável' : '⚠ Ação necessária'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
          Verifica o estado de cada etapa a cada hora e executa o que estiver pendente. Garante que nenhuma etapa seja pulada.
        </div>

        {/* Estado do pipeline */}
        {orch.state && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Artigos pendentes"  value={orch.state.articles_pending}  highlight={orch.state.articles_pending > 0} />
            <Stat label="Edições pendentes"  value={orch.state.editions_pending}  highlight={orch.state.editions_pending > 0} />
            <Stat label="Propmark sem content" value={orch.state.propmark_backlog} highlight={orch.state.propmark_backlog > 0} />
            <Stat label="Sinais (6h)"        value={orch.state.signal_events_fresh} color={orch.state.signal_events_fresh > 0 ? '#16A34A' : undefined} highlight={orch.state.signal_events_fresh === 0} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Último crawl de mídia</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: (orch.state.media_crawl_age_h || 0) > 4 ? '#DC2626' : '#16A34A' }}>
                {orch.state.media_crawl_age_h === undefined || orch.state.media_crawl_age_h === null ? '—' :
                 orch.state.media_crawl_age_h > 999 ? 'Nunca' : `${orch.state.media_crawl_age_h}h atrás`}
              </div>
            </div>
          </div>
        )}

        {/* Gaps */}
        {orchGaps.length > 0 && (
          <>
            <div style={{ height: 1, background: '#E5E7EB', marginBottom: 10 }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Gaps identificados
            </div>
            {orchGaps.map((g, i) => (
              <div key={i} style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', padding: '5px 10px', borderRadius: 6, marginBottom: 4 }}>
                ⚠ {g}
              </div>
            ))}
          </>
        )}

        {/* Plano de execução */}
        {orchPlan.length > 0 && (
          <>
            <div style={{ height: 1, background: '#E5E7EB', marginBottom: 10, marginTop: orchGaps.length > 0 ? 10 : 0 }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Plano de execução
            </div>
            {orchPlan.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: '#1E3A5F', background: '#EFF6FF', padding: '5px 10px', borderRadius: 6, marginBottom: 4 }}>
                {i + 1}. {typeof p === 'string' ? p : p.label}
              </div>
            ))}
          </>
        )}

        {orchHealthy && orchGaps.length === 0 && orchPlan.length === 0 && (
          <div style={{ fontSize: 12, color: '#16A34A', fontStyle: 'italic' }}>
            Pipeline em dia — nenhuma ação necessária agora.
          </div>
        )}

        {orch.checked_at && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
            Verificado em {new Date(orch.checked_at).toLocaleString('pt-BR')} · próxima verificação automática a cada hora
          </div>
        )}
      </div>

      {/* Agente 1: Editoriais de Marketing */}
      <AgentCard
        title="Agente 1 — Editoriais de Marketing"
        description="Crawler de Propmark e M&M Website (edições após 2017). Coleta artigos e edições com conteúdo completo."
        color="#2563EB"
        job={editorialJob}
      >
        {/* Propmark */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Propmark
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
            <Stat label="Com content" value={withContent} color="#16A34A" />
            <Stat label="Sem content" value={noContent} highlight={noContent > 0} />
            <Stat label="Irrecup." value={propmark.crawl_failed} color={propmark.crawl_failed > 0 ? '#DC2626' : 'var(--text-dim)'} />
            <Stat label="Total" value={propmark.total} color="var(--text-dim)" />
          </div>
          <Bar value={withContent} max={propmark.total || 0} color="#2563EB" animated={!!editorialJob} />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
            {fmtN(withContent)} / {fmtN(propmark.total)} artigos com conteúdo ({pct(withContent, propmark.total || 0)}%)
          </div>
        </div>

        <div style={{ height: 1, background: '#E5E7EB', marginBottom: 14 }} />

        {/* M&M Website */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            M&M Website (pós-2017)
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
            <Stat label="Coletadas" value={editions.total} color="#16A34A" />
            <Stat label="Pendentes extração" value={editions.pending} highlight={editions.pending > 0} />
          </div>
          <Bar value={editions.total || 0} max={editions.total || 0} color="#7C3AED" animated={!!editorialJob} />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
            {fmtN(editions.total)} edições coletadas com text_content
          </div>
        </div>
      </AgentCard>

      {/* Agente 2: Extrator de Inteligência */}
      <AgentCard
        title="Agente 2 — Extrator de Inteligência"
        description="Lê o conteúdo do Agente 1 e extrai marcas, agências, executivos e pitches via Claude Haiku."
        color="#16A34A"
        job={extractorJob}
        done={intel.total_extracted || 0}
        total={(withContent || 0) + (editions.total || 0)}
      >
        {/* Volume extraído vs match */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
            <Stat label="Processados" value={intel.total_extracted} color="var(--text)" />
            <Stat label="Com match" value={intel.total_with_match} color="#16A34A" />
            <Stat label="Sem dados relevantes" value={(intel.articles_skipped || 0) + (intel.editions_empty || 0)} color="var(--text-dim)" />
            <Stat label="Pendentes" value={Math.max(0, (withContent || 0) + (editions.total || 0) - (intel.total_extracted || 0))} highlight />
          </div>
          <Bar
            value={intel.total_with_match || 0}
            max={intel.total_extracted || 1}
            color="#16A34A"
            animated={!!extractorJob}
          />
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
            {fmtN(intel.total_with_match)} de {fmtN(intel.total_extracted)} processados tiveram match ({pct(intel.total_with_match, intel.total_extracted || 1)}%)
          </div>
        </div>

        <div style={{ height: 1, background: '#E5E7EB', marginBottom: 14 }} />

        {/* Registros gerados */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Registros gerados
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Stat label="Relações marca↔agência" value={intel.agency_history} color="#2563EB" />
            <Stat label="Executivos de marketing" value={intel.marketing_leaders} color="#7C3AED" />
          </div>
        </div>

        <div style={{ height: 1, background: '#E5E7EB', marginBottom: 14 }} />

        {/* Por fonte — pendentes */}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Propmark</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat label="OK" value={propmark.ok} color="#16A34A" />
              <Stat label="Skipped" value={propmark.skipped} color="var(--text-dim)" />
              <Stat label="Pendentes" value={propmarkPending} highlight={propmarkPending > 0} />
            </div>
          </div>
          <div style={{ width: 1, background: '#E5E7EB', alignSelf: 'stretch' }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>M&M Website</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat label="Extraídas" value={editions.extracted} color="#16A34A" />
              <Stat label="Pendentes" value={editions.pending} highlight={editions.pending > 0} />
            </div>
          </div>
        </div>
      </AgentCard>

      {/* Agente 3: Busca em mídia de negócios */}
      <AgentCard
        title="Agente 3 — Busca em Mídia de Negócios"
        description="Crawla RSS de Exame e Valor Econômico. Salva apenas artigos que mencionam marcas ou agências da base. Extrai via Claude Haiku."
        color="#0891B2"
        job={mediaJob}
        done={mediaOk}
        total={mediaTotal || undefined}
      >
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0891B2', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Exame</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat label="Salvos" value={exame.total} color="var(--text)" />
              <Stat label="Extraídos" value={exame.ok} color="#16A34A" />
              <Stat label="Pendentes" value={exame.pending} highlight={exame.pending > 0} />
            </div>
          </div>
          <div style={{ width: 1, background: '#E5E7EB', alignSelf: 'stretch', margin: '0 4px' }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#0891B2', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Valor Econômico</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat label="Salvos" value={valor.total} color="var(--text)" />
              <Stat label="Extraídos" value={valor.ok} color="#16A34A" />
              <Stat label="Pendentes" value={valor.pending} highlight={valor.pending > 0} />
            </div>
          </div>
        </div>
        {mediaTotal === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Nenhum artigo coletado ainda — aguardando primeira execução do cron job
          </div>
        )}
      </AgentCard>

      {/* Agente 4: Enriquecimento de Executivos (PDL) */}
      <AgentCard
        title="Agente 4 — Enriquecimento de Executivos"
        description="Busca executivos de marketing das marcas no PeopleDataLabs. Preenche a timeline de líderes com cargos atuais e histórico."
        color="#7C3AED"
        job={execJob}
        done={exec.total || 0}
        total={exec.total || undefined}
      >
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
          <Stat label="Total executivos" value={exec.total} color="var(--text)" />
          <Stat label="Cargos atuais"    value={exec.current} color="#16A34A" />
          <Stat label="Via PDL"          value={exec.pdl} color="#7C3AED" />
          <Stat label="Manual / Artigos" value={Math.max(0, (exec.total || 0) - (exec.pdl || 0))} color="var(--text-dim)" />
        </div>
        {(exec.total || 0) === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Nenhum executivo enriquecido via PDL ainda — execução diária às 3h
          </div>
        )}
      </AgentCard>

      {/* Agente 5 — Signal Auditor não tem card próprio: é consultado via /api/agent/signal-audit */}

      {/* Agente 6: Captura de Sinais */}
      <AgentCard
        title="Agente 6 — Captura de Sinais"
        description="Varre artigos, executivos e histórico de agências e detecta sinais de troca para cada marca. Alimenta diretamente o modelo preditivo."
        color="#D97706"
        job={signalsJob}
        done={sigData.active || 0}
        total={sigData.total || undefined}
      >
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
          <Stat label="Eventos totais" value={sigData.total}  color="var(--text)" />
          <Stat label="Ativos (válidos)" value={sigData.active} color="#16A34A" />
        </div>

        {/* Top sinais */}
        {(sigData.top_signals?.length > 0) && (
          <>
            <div style={{ height: 1, background: '#E5E7EB', margin: '10px 0' }} />
            <div style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Sinais mais capturados
            </div>
            {sigData.top_signals.map(s => (
              <div key={s.signal_key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text)' }}>{s.signal_name}</span>
                <span style={{ fontWeight: 700, color: '#D97706' }}>{fmtN(s.count)}</span>
              </div>
            ))}
          </>
        )}

        {(sigData.total || 0) === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Nenhum sinal capturado ainda — execução a cada 4h (offset 2h)
          </div>
        )}
      </AgentCard>
    </div>
  )
}
