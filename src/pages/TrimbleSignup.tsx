import { useState, FormEvent, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { trimbleRegisterApi } from '../api/auth'
import {
  saveTrimbleSignupPayload,
  loadTrimbleSignupPayload,
  clearTrimbleSignupPayload,
  type TrimbleSignupUserPayload,
} from '../lib/trimble-signup-storage'

export default function TrimbleSignup() {
  const navigate = useNavigate()
  const location = useLocation()
  const fromState = (location.state as { trimbleUser?: TrimbleSignupUserPayload })?.trimbleUser

  /** state(첫 진입) 또는 새로고침 후 sessionStorage */
  const [trimbleUser, setTrimbleUser] = useState<TrimbleSignupUserPayload | null>(() => {
    if (fromState?.email) return fromState
    return loadTrimbleSignupPayload()
  })

  const [name, setName] = useState(trimbleUser?.name ?? '')
  const [company, setCompany] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (fromState?.email) {
      saveTrimbleSignupPayload(fromState)
      setTrimbleUser(fromState)
    }
  }, [fromState])

  useEffect(() => {
    if (trimbleUser?.name) setName(trimbleUser.name)
  }, [trimbleUser?.name])

  useEffect(() => {
    if (!trimbleUser?.email) {
      navigate('/login', { replace: true })
    }
  }, [trimbleUser, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!trimbleUser) return
    setError('')
    setLoading(true)
    try {
      const result = await trimbleRegisterApi({
        email: trimbleUser.email,
        name: name.trim(),
        company: company.trim(),
        trimbleId: trimbleUser.id,
      })
      if (result.success) {
        clearTrimbleSignupPayload()
        setDone(true)
      } else {
        const msg = result.error ?? '가입 신청에 실패했습니다.'
        setError(
          msg +
            (msg.includes('경로') || msg.includes('찾을 수 없')
              ? '\n\n터미널에서 API 서버를 종료한 뒤, 프로젝트 폴더에서 "npm run server" 로 다시 실행하세요.'
              : '')
        )
      }
    } finally {
      setLoading(false)
    }
  }

  if (!trimbleUser?.email) {
    return null
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">가입 신청 완료</h1>
          <p className="auth-card__desc">
            회원정보가 접수되었습니다. 관리자 승인 후 Trimble Connect로 로그인할 수 있습니다.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              clearTrimbleSignupPayload()
              navigate('/login', { replace: true })
            }}
          >
            로그인 화면으로
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Trimble Connect 회원정보 입력</h1>
        <p className="auth-card__desc">
          이름과 회사를 입력한 뒤 <strong>가입 신청</strong>을 누르면 서버 데이터베이스에 <strong>승인대기</strong> 회원으로
          저장됩니다. 관리자가 활성 처리한 뒤 같은 이메일로 Trimble 로그인할 수 있습니다. (페이지를 새로고침해도 이어서
          작성할 수 있도록 브라우저에 임시 저장됩니다.)
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-form__error">{error}</div>}
          <div className="form-group">
            <label htmlFor="trimble-signup-email" className="form-label">
              이메일 (Trimble)
            </label>
            <input
              id="trimble-signup-email"
              type="email"
              className="form-input"
              value={trimbleUser.email}
              readOnly
              disabled
              style={{ opacity: 0.8 }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="trimble-signup-name" className="form-label">
              이름 <span className="form-required">*</span>
            </label>
            <input
              id="trimble-signup-name"
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
            <label htmlFor="trimble-signup-company" className="form-label">
              회사
            </label>
            <input
              id="trimble-signup-company"
              type="text"
              className="form-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="회사명"
            />
          </div>
          <button type="submit" className="btn btn--primary auth-form__submit" disabled={loading}>
            {loading ? '처리 중…' : '가입 신청'}
          </button>
        </form>
        <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--main-text-muted)' }}>
          <button
            type="button"
            className="btn btn--secondary"
            style={{ fontSize: 'inherit' }}
            onClick={() => {
              clearTrimbleSignupPayload()
              navigate('/login', { replace: true })
            }}
          >
            로그인 화면으로
          </button>
        </p>
      </div>
    </div>
  )
}
