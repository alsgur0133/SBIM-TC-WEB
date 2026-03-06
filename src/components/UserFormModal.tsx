import { useState, useEffect } from 'react'
import type { User, UserFormInput, UserRole, UserStatus } from '../types/user'
import { USER_ROLES, USER_STATUSES } from '../types/user'

interface UserFormModalProps {
  open: boolean
  user: User | null
  onClose: () => void
  onSave: (data: UserFormInput, id?: string) => void | Promise<unknown>
  saving?: boolean
  /** 저장 실패 시 페이지에서 전달하는 오류 메시지 (모달 내 표시용) */
  saveError?: string
}

const emptyForm: UserFormInput = {
  name: '',
  email: '',
  role: '일반 사용자',
  status: '활성',
  company: '',
}

export default function UserFormModal({ open, user, onClose, onSave, saving = false, saveError }: UserFormModalProps) {
  const [form, setForm] = useState<UserFormInput>(emptyForm)
  const [errors, setErrors] = useState<Partial<Record<keyof UserFormInput, string>>>({})

  const isEdit = user !== null

  useEffect(() => {
    if (open) {
      setForm(
        user
          ? { name: user.name, email: user.email, role: user.role, status: user.status, company: user.company ?? '' }
          : emptyForm
      )
      setErrors({})
    }
  }, [open, user])

  function validate(): boolean {
    const next: Partial<Record<keyof UserFormInput, string>> = {}
    if (!form.name.trim()) next.name = '이름을 입력하세요.'
    if (!form.email.trim()) next.email = '이메일을 입력하세요.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = '올바른 이메일 형식이 아닙니다.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate() || saving) return
    const result = onSave(
      { name: form.name.trim(), email: form.email.trim(), role: form.role, status: form.status, company: form.company?.trim() ?? '' },
      user?.id
    )
    const promise = result && typeof (result as Promise<unknown>)?.then === 'function' ? (result as Promise<unknown>) : null
    if (promise) {
      promise.then(() => onClose()).catch(() => {})
    } else {
      onClose()
    }
  }

  function handleChange(field: keyof UserFormInput, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{isEdit ? '사용자 수정' : '사용자 추가'}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="modal__body">
          <div className="form-group">
            <label htmlFor="user-name" className="form-label">
              이름 <span className="form-required">*</span>
            </label>
            <input
              id="user-name"
              type="text"
              className={`form-input ${errors.name ? 'form-input--error' : ''}`}
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="이름 입력"
              autoFocus
            />
            {errors.name && <span className="form-error">{errors.name}</span>}
          </div>
          <div className="form-group">
            <label htmlFor="user-email" className="form-label">
              이메일 <span className="form-required">*</span>
            </label>
            <input
              id="user-email"
              type="email"
              className={`form-input ${errors.email ? 'form-input--error' : ''}`}
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="email@example.com"
              disabled={isEdit}
            />
            {isEdit && (
              <span className="form-hint">이메일은 수정할 수 없습니다.</span>
            )}
            {errors.email && <span className="form-error">{errors.email}</span>}
          </div>
          <div className="form-group">
            <label htmlFor="user-company" className="form-label">
              업체
            </label>
            <input
              id="user-company"
              type="text"
              className="form-input"
              value={form.company ?? ''}
              onChange={(e) => handleChange('company', e.target.value)}
              placeholder="업체명 (선택)"
            />
          </div>
          <div className="form-group">
            <label htmlFor="user-role" className="form-label">
              역할
            </label>
            <select
              id="user-role"
              className="form-input form-select"
              value={form.role}
              onChange={(e) => handleChange('role', e.target.value as UserRole)}
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="user-status" className="form-label">
              상태
            </label>
            <select
              id="user-status"
              className="form-input form-select"
              value={form.status}
              onChange={(e) => handleChange('status', e.target.value as UserStatus)}
            >
              {USER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {saveError && (
            <div className="auth-form__error" style={{ marginTop: '0.75rem' }}>
              {saveError}
            </div>
          )}
          <div className="modal__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? '저장 중...' : isEdit ? '저장' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
