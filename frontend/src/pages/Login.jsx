import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'

export default function Login() {
  const { login }              = useAuth()
  const navigate               = useNavigate()
  const [email, setEmail]      = useState('')
  const [pass, setPass]        = useState('')
  const [error, setError]      = useState('')
  const [loading, setLoad]     = useState(false)
  const [forgotMode, setForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg]     = useState('')
  const [forgotSending, setForgotSending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoad(true)
    try {
      await login(email, pass)
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.error || 'Email ou senha incorretos')
    } finally {
      setLoad(false)
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setForgotSending(true)
    setForgotMsg('')
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail })
      setForgotMsg('Se este email estiver cadastrado, você receberá um link em breve. Verifique sua caixa de entrada.')
    } catch {
      setForgotMsg('Erro ao enviar. Tente novamente.')
    } finally {
      setForgotSending(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 380, padding: '40px 36px', background: 'var(--card)',
        borderRadius: 16, border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            marginBottom: 8,
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
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
            Inteligência preditiva para pitchs de agências
          </p>
        </div>

        {/* Modo: esqueci minha senha */}
        {forgotMode ? (
          <form onSubmit={handleForgot}>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, textAlign: 'center' }}>
              Informe seu email e enviaremos um link para redefinir sua senha.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
                EMAIL
              </label>
              <input
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                }}
              />
            </div>
            {forgotMsg && (
              <div style={{
                background: forgotMsg.startsWith('Erro') ? '#FEF2F2' : '#F0FDF4',
                border: `1px solid ${forgotMsg.startsWith('Erro') ? '#FECACA' : '#BBF7D0'}`,
                borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                fontSize: 13, color: forgotMsg.startsWith('Erro') ? '#DC2626' : '#16A34A',
              }}>
                {forgotMsg}
              </div>
            )}
            <button type="submit" disabled={forgotSending} style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none',
              background: forgotSending ? '#93C5FD' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: forgotSending ? 'not-allowed' : 'pointer',
              marginBottom: 12,
            }}>
              {forgotSending ? 'Enviando…' : 'Enviar link de acesso'}
            </button>
            <button type="button" onClick={() => { setForgot(false); setForgotMsg('') }} style={{
              width: '100%', padding: '10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer',
            }}>
              ← Voltar ao login
            </button>
          </form>
        ) : (
        /* Form */
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}>
              SENHA
            </label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg)',
                color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '10px 14px', marginBottom: 16,
              fontSize: 13, color: '#DC2626',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none',
              background: loading ? '#93C5FD' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              type="button"
              onClick={() => { setForgot(true); setForgotEmail(email); setError('') }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--text-dim)',
                textDecoration: 'underline',
              }}
            >
              Esqueci minha senha
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
