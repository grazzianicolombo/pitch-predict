/**
 * AuthCallback — página de destino para links de email
 *
 * Suporta dois flows:
 *  - type=invite  → convite de novo usuário (define senha pela 1ª vez)
 *  - type=recovery → reset de senha
 *
 * O Supabase redireciona para esta página com o token no hash da URL:
 * /auth/callback#access_token=xxx&type=invite
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

function parseHash() {
  const hash = window.location.hash.slice(1)
  const params = new URLSearchParams(hash)
  return {
    access_token: params.get('access_token'),
    type: params.get('type'),        // 'invite' | 'recovery'
    error: params.get('error_description'),
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const [step, setStep]       = useState('loading')  // loading | form | success | error
  const [type, setType]       = useState(null)
  const [token, setToken]     = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')

  useEffect(() => {
    const { access_token, type: t, error } = parseHash()
    if (error) { setMsg(error); setStep('error'); return }
    if (!access_token || !['invite', 'recovery'].includes(t)) {
      setMsg('Link inválido ou expirado.')
      setStep('error')
      return
    }
    setToken(access_token)
    setType(t)
    setStep('form')
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 8) { setMsg('Senha deve ter mínimo 8 caracteres.'); return }
    if (password !== confirm) { setMsg('As senhas não coincidem.'); return }
    setMsg('')
    setSaving(true)
    try {
      await api.post('/auth/set-password', { token, password })
      setStep('success')
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Erro ao definir senha. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const isInvite = type === 'invite'

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 400, padding: '40px 36px', background: 'var(--card)',
        borderRadius: 16, border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, color: '#fff', fontWeight: 800,
            }}>P</div>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
              Pitch Predict
            </span>
          </div>
        </div>

        {step === 'loading' && (
          <p style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Verificando link…</p>
        )}

        {step === 'form' && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, textAlign: 'center' }}>
              {isInvite ? 'Bem-vindo ao Pitch Predict' : 'Redefinir senha'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 24 }}>
              {isInvite
                ? 'Defina sua senha para ativar o acesso'
                : 'Escolha uma nova senha para sua conta'}
            </p>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                  NOVA SENHA
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                  required
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                  CONFIRMAR SENHA
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="repita a senha"
                  required
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>

              {msg && (
                <div style={{
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                  fontSize: 13, color: '#DC2626',
                }}>
                  {msg}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                style={{
                  width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                  background: saving ? '#93C5FD' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Salvando…' : isInvite ? 'Ativar minha conta' : 'Redefinir senha'}
              </button>
            </form>
          </>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {isInvite ? 'Conta ativada!' : 'Senha redefinida!'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>
              {isInvite
                ? 'Sua conta está pronta. Faça login para continuar.'
                : 'Sua senha foi alterada. Faça login com a nova senha.'}
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Ir para o login
            </button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Link inválido</h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24 }}>
              {msg || 'Este link expirou ou já foi utilizado.'}
            </p>
            <button
              onClick={() => navigate('/login')}
              style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                background: 'var(--border)', color: 'var(--text)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Voltar ao login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
