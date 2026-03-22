import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'

const ROLE_LABEL = { superadmin: 'Superadmin', user: 'Usuário' }
const ROLE_COLOR = { superadmin: '#7C3AED', user: '#2563EB' }

export default function Users() {
  const { isSuperadmin } = useAuth()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ name: '', email: '', role: 'user' })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  if (!isSuperadmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        Acesso restrito a Superadmins.
      </div>
    )
  }

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/auth/users')
      setUsers(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createUser(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post('/auth/users', form)
      setForm({ name: '', email: '', role: 'user' })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Erro ao criar usuário')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user) {
    await api.patch(`/auth/users/${user.id}`, { active: !user.active })
    load()
  }

  async function changeRole(user, role) {
    await api.patch(`/auth/users/${user.id}`, { role })
    load()
  }

  async function removeUser(user) {
    if (!window.confirm(`Remover permanentemente "${user.name}" (${user.email})? Esta ação não pode ser desfeita.`)) return
    await api.delete(`/auth/users/${user.id}`)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestão de Usuários</h1>
          <p className="page-subtitle">Controle de acesso ao Pitch Predict</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + Novo usuário
        </button>
      </div>

      {/* Formulário novo usuário */}
      {showForm && (
        <div className="card card-padded" style={{ marginBottom: 20, borderLeft: '3px solid #7C3AED' }}>
          <div style={{ fontWeight: 700, marginBottom: 16 }}>Criar novo usuário</div>
          <form onSubmit={createUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>NOME</label>
              <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Nome completo" style={{ width: '100%', marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>EMAIL</label>
              <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder="email@empresa.com" style={{ width: '100%', marginTop: 4 }} />
            </div>
            <div style={{ gridColumn: '1/-1', padding: '10px 14px', background: '#F0F9FF', borderRadius: 8, border: '1px solid #BAE6FD', fontSize: 12, color: '#0369A1' }}>
              📧 Um email de convite será enviado para o usuário definir sua própria senha.
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>NÍVEL DE ACESSO</label>
              <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={{ width: '100%', marginTop: 4 }}>
                <option value="user">Usuário (somente leitura)</option>
                <option value="superadmin">Superadmin (controle total)</option>
              </select>
            </div>
            {error && <div style={{ gridColumn: '1/-1', color: '#DC2626', fontSize: 13 }}>{error}</div>}
            <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Criando…' : 'Criar usuário'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowForm(false); setError('') }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Lista */}
      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nome', 'Email', 'Nível', 'Status', 'Último acesso', 'Ações'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>Carregando…</td></tr>
            ) : users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: u.active ? 1 : 0.5 }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14 }}>{u.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-dim)' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: ROLE_COLOR[u.role] + '20', color: ROLE_COLOR[u.role],
                  }}>
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: u.active ? '#DCFCE7' : '#F3F4F6',
                    color: u.active ? '#16A34A' : '#6B7280',
                  }}>
                    {u.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
                  {u.last_login ? new Date(u.last_login).toLocaleString('pt-BR') : '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={u.role}
                      onChange={e => changeRole(u, e.target.value)}
                      style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                    >
                      <option value="user">Usuário</option>
                      <option value="superadmin">Superadmin</option>
                    </select>
                    <button
                      onClick={() => toggleActive(u)}
                      style={{
                        fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                        background: 'var(--bg)', color: u.active ? '#DC2626' : '#16A34A', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {u.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      onClick={() => removeUser(u)}
                      style={{
                        fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #FECACA',
                        background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
