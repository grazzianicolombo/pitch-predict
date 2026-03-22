import { useState, useEffect } from 'react'
import api from '../services/api'

const DECADES = [
  { label: '1970s', years: [1978, 1979] },
  { label: '1980s', years: Array.from({ length: 10 }, (_, i) => 1980 + i) },
  { label: '1990s', years: Array.from({ length: 10 }, (_, i) => 1990 + i) },
  { label: '2000s', years: Array.from({ length: 10 }, (_, i) => 2000 + i) },
  { label: '2010s', years: Array.from({ length: 10 }, (_, i) => 2010 + i) },
  { label: '2020s', years: Array.from({ length: 7 }, (_, i) => 2020 + i) },
]

function YearBar({ year, total, extracted, drm }) {
  const pct = total > 0 ? (extracted / total) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ width: 36, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        {year}
      </span>
      <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden' }}>
        {drm ? (
          <div style={{ height: '100%', width: '100%', background: '#FDE68A', borderRadius: 99 }} />
        ) : (
          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 90 ? '#16A34A' : pct > 0 ? '#60A5FA' : '#E5E7EB', borderRadius: 99, transition: 'width 0.6s' }} />
        )}
      </div>
      <span style={{ width: 60, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right' }}>
        {drm ? '🔒 DRM' : `${extracted}/${total}`}
      </span>
    </div>
  )
}

export default function Archive() {
  const [stats, setStats]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [decade, setDecade]     = useState('2010s')

  useEffect(() => {
    api.get('/agent/archive/stats').then(({ data }) => {
      setStats(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const currentDecade = DECADES.find(d => d.label === decade)

  const totalOpen      = stats?.open_editions  || 0
  const totalDrm       = stats?.drm_editions   || 0
  const totalExtracted = stats?.extracted_text || 0
  const totalEditions  = stats?.total_editions || 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Arquivo M&M</h1>
          <p className="page-subtitle">
            {totalEditions.toLocaleString('pt-BR')} edições desde 1978 · acervo histórico completo
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="https://acervo.meioemensagem.com.br/#biblioteca/users/188519"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
          >
            ↗ Acervo online
          </a>
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total de edições</div>
          <div className="stat-value">{totalEditions.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">1978 → 2026</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Texto extraído</div>
          <div className="stat-value" style={{ color: '#16A34A' }}>{totalExtracted.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">de {totalOpen.toLocaleString('pt-BR')} acessíveis</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Acesso aberto</div>
          <div className="stat-value" style={{ color: '#3B82F6' }}>{totalOpen.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">1978–2017</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Protegido (DRM)</div>
          <div className="stat-value" style={{ color: '#F59E0B' }}>{totalDrm.toLocaleString('pt-BR')}</div>
          <div className="stat-sub">2018–2026 · via Tavily</div>
        </div>
      </div>

      {loading ? (
        <p className="loading">Carregando estatísticas do arquivo…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>

          {/* Left: decade selector + year bars */}
          <div className="card card-padded" style={{ alignSelf: 'start' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--text-main)' }}>
              Cobertura por ano
            </div>

            {/* Decade pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
              {DECADES.map(d => (
                <button
                  key={d.label}
                  onClick={() => setDecade(d.label)}
                  className={`btn btn-sm ${decade === d.label ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '2px 10px', fontSize: 11 }}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {/* Year bars */}
            {currentDecade?.years.map(yr => {
              const yearStr = String(yr)
              const info = stats?.by_year?.[yearStr]
              const drm  = info?.drm || yr >= 2018
              return (
                <YearBar
                  key={yr}
                  year={yr}
                  total={info?.total || 0}
                  extracted={0}
                  drm={drm}
                />
              )
            })}

            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)' }}>
              <span style={{ marginRight: 8 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#16A34A', marginRight: 3 }} />
                Completo
              </span>
              <span style={{ marginRight: 8 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#60A5FA', marginRight: 3 }} />
                Parcial
              </span>
              <span>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#FDE68A', marginRight: 3 }} />
                DRM
              </span>
            </div>
          </div>

          {/* Right: content info */}
          <div>
            {/* Extraction progress */}
            <div className="card card-padded" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Extração de texto em andamento</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {totalExtracted.toLocaleString('pt-BR')} / {totalOpen.toLocaleString('pt-BR')} edições
                </span>
              </div>
              <div style={{ height: 8, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  height: '100%',
                  width: `${totalOpen > 0 ? (totalExtracted / totalOpen) * 100 : 0}%`,
                  background: 'linear-gradient(90deg, #3B82F6, #16A34A)',
                  borderRadius: 99,
                  transition: 'width 1s',
                }} />
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-dim)' }}>
                <span>⟳ Script rodando em background</span>
                <span>📄 SQLite search index → text.txt</span>
                <span>🚫 Sem dados pessoais no código</span>
              </div>
            </div>

            {/* Format & pipeline info */}
            <div className="card card-padded" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Pipeline de extração</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  {
                    step: '1',
                    title: 'Catálogo',
                    desc: '2.381 edições via API rdplibrary · meta.json por edição',
                    status: 'done',
                    color: '#16A34A',
                  },
                  {
                    step: '2',
                    title: 'Texto (SQLite)',
                    desc: 'search.sqlite do sunflower CDN · tabela word com coordenadas',
                    status: totalExtracted > 0 ? 'running' : 'pending',
                    color: '#3B82F6',
                  },
                  {
                    step: '3',
                    title: 'Sinais (Claude)',
                    desc: 'claude-haiku extrai mudanças de agência, pitchs, nomeações',
                    status: 'pending',
                    color: '#D97706',
                  },
                  {
                    step: '4',
                    title: 'Base histórica',
                    desc: 'Popula brands + agency_history + marketing_leaders no Supabase',
                    status: 'pending',
                    color: '#7C3AED',
                  },
                ].map(({ step, title, desc, status, color }) => (
                  <div key={step} style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${status === 'done' ? '#BBF7D0' : status === 'running' ? '#BFDBFE' : '#E5E7EB'}`,
                    background: status === 'done' ? '#F0FDF4' : status === 'running' ? '#EFF6FF' : '#FAFAFA',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: color, color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, flexShrink: 0,
                      }}>{step}</span>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{title}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: status === 'done' ? '#16A34A' : status === 'running' ? '#2563EB' : '#9CA3AF' }}>
                        {status === 'done' ? '✓ Pronto' : status === 'running' ? '⟳ Rodando' : '○ Aguarda'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 26, lineHeight: 1.4 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* DRM info */}
            <div className="card card-padded" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>🔒</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                    Edições 2018–2026: proteção DRM
                  </div>
                  <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                    As {totalDrm.toLocaleString('pt-BR')} edições recentes usam DRM (.s encryption).
                    Para conteúdo deste período, o pipeline usa <strong>busca Tavily</strong> no site
                    meioemensagem.com.br e <strong>Claude com web_search</strong> para encontrar
                    mudanças de agência, pitchs e nomeações recentes.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
