import { useState, FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function SignUp() {
  const { user, signUp } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    setLoading(true)
    try {
      const result = await signUp(name, email, password)
      if (result.success) {
        navigate('/login', { replace: true, state: { message: result.message || '가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' } })
      } else {
        setError(result.error ?? '가입에 실패했습니다.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">회원가입</h1>
        <p className="auth-card__desc">정보를 입력하여 계정을 만드세요.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-form__error">{error}</div>}
          <div className="form-group">
            <label htmlFor="signup-name" className="form-label">
              이름 <span className="form-required">*</span>
            </label>
            <input
              id="signup-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-email" className="form-label">
              이메일 <span className="form-required">*</span>
            </label>
            <input
              id="signup-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-password" className="form-label">
              비밀번호 <span className="form-required">*</span>
            </label>
            <input
              id="signup-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="4자 이상"
              required
              minLength={4}
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-confirm" className="form-label">
              비밀번호 확인 <span className="form-required">*</span>
            </label>
            <input
              id="signup-confirm"
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 다시 입력"
              required
              minLength={4}
            />
          </div>
          <button type="submit" className="btn btn--primary auth-form__submit" disabled={loading}>
            {loading ? '처리 중...' : '가입하기'}
          </button>
        </form>
        <p className="auth-card__footer">
          이미 계정이 있으신가요? <Link to="/login">로그인</Link>
        </p>
      </div>
    </div>
  )
}
