import { useState, useEffect, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Profile() {
  const { user, updateProfile, logout } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [company, setCompany] = useState(user?.company ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setName(user.name)
      setCompany(user.company ?? '')
    }
  }, [user?.name, user?.company])

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (newPassword && newPassword !== confirmNewPassword) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    if (newPassword && newPassword.length < 4) {
      setError('새 비밀번호는 4자 이상 입력하세요.')
      return
    }
    setLoading(true)
    try {
      const result = await updateProfile(name, currentPassword, newPassword || undefined, company.trim() || undefined)
      if (result.success) {
        setSuccess('저장되었습니다.')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
      } else {
        setError(result.error ?? '저장에 실패했습니다.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="user-mgmt">
      <header className="user-mgmt__header">
        <h1 className="user-mgmt__title">내 정보</h1>
        <p className="user-mgmt__desc">이름, 업체, 비밀번호를 수정할 수 있습니다.</p>
      </header>

      <div className="card" style={{ maxWidth: '420px' }}>
        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-form__error">{error}</div>}
          {success && <div className="auth-form__success">{success}</div>}
          <div className="form-group">
            <label htmlFor="profile-email" className="form-label">
              이메일
            </label>
            <input
              id="profile-email"
              type="email"
              className="form-input"
              value={user.email}
              disabled
            />
            <span className="form-hint">이메일은 변경할 수 없습니다.</span>
          </div>
          <div className="form-group">
            <label htmlFor="profile-name" className="form-label">
              이름 <span className="form-required">*</span>
            </label>
            <input
              id="profile-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="profile-company" className="form-label">
              업체
            </label>
            <input
              id="profile-company"
              type="text"
              className="form-input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="업체명 (선택)"
            />
          </div>
          <div className="form-group">
            <label htmlFor="profile-current-pw" className="form-label">
              현재 비밀번호 <span className="form-required">*</span>
            </label>
            <input
              id="profile-current-pw"
              type="password"
              className="form-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="변경을 위해 입력"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="profile-new-pw" className="form-label">
              새 비밀번호
            </label>
            <input
              id="profile-new-pw"
              type="password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="변경 시에만 입력 (4자 이상)"
              minLength={4}
            />
          </div>
          <div className="form-group">
            <label htmlFor="profile-confirm-pw" className="form-label">
              새 비밀번호 확인
            </label>
            <input
              id="profile-confirm-pw"
              type="password"
              className="form-input"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="새 비밀번호 다시 입력"
              minLength={4}
            />
          </div>
          <div className="auth-form__actions">
            <button type="button" className="btn btn--secondary" onClick={handleLogout}>
              로그아웃
            </button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? '처리 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
