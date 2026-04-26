import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getTrimbleLoginUrl } from '../api/trimble'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'
  const successMessage = (location.state as { message?: string })?.message ?? ''
  useEffect(() => {
    if (user) navigate(from || '/', { replace: true })
  }, [user, navigate, from])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [trimbleLoading, setTrimbleLoading] = useState(false)

  async function handleTrimbleLogin() {
    setTrimbleLoading(true)
    setError('')
    try {
      const url = await getTrimbleLoginUrl()
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trimble 로그인을 시작할 수 없습니다.')
      setTrimbleLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result.success) {
        navigate(from || '/', { replace: true })
      } else {
        setError(result.error ?? '로그인에 실패했습니다.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">로그인</h1>
        <p className="auth-card__desc">이메일 또는 아이디와 비밀번호를 입력하세요.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          {successMessage && <div className="auth-form__success">{successMessage}</div>}
          {error && <div className="auth-form__error">{error}</div>}
          <div className="form-group">
            <label htmlFor="login-email" className="form-label">
              이메일 또는 아이디
            </label>
            <input
              id="login-email"
              type="text"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sa 또는 email@example.com"
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password" className="form-label">
              비밀번호
            </label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              required
            />
          </div>
          <button type="submit" className="btn btn--primary auth-form__submit" disabled={loading}>
            {loading ? '처리 중...' : '로그인'}
          </button>
          <div className="auth-form__divider">
            <span>또는</span>
          </div>
          <button
            type="button"
            className="btn btn--secondary auth-form__trimble"
            onClick={handleTrimbleLogin}
            disabled={trimbleLoading}
          >
            {trimbleLoading ? '이동 중...' : 'Trimble Connect로 로그인'}
          </button>
        </form>
        <p className="auth-card__footer">
          계정이 없으신가요? <Link to="/signup">회원가입</Link>
        </p>
      </div>
    </div>
  )
}
