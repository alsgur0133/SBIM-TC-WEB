import { useState, useEffect, useMemo } from 'react'
import { getUsersApi, type ApiUserRow } from '../api/auth'
import { addProjectParticipantsApi } from '../api/projects'

interface ParticipantPickerModalProps {
  open: boolean
  projectId: string
  projectName: string
  userEmail: string
  /** 이미 참여 중인 user_id 목록 (선택 목록에서 제외) */
  existingParticipantIds: Set<string>
  onClose: () => void
  onAdded: () => void
}

const PROJECT_ROLES = ['참여자', '프로젝트 관리자'] as const

export default function ParticipantPickerModal({
  open,
  projectId,
  projectName,
  userEmail,
  existingParticipantIds,
  onClose,
  onAdded,
}: ParticipantPickerModalProps) {
  const [users, setUsers] = useState<ApiUserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({ name: '', email: '', company: '', role: '' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [roleInProject, setRoleInProject] = useState<string>(PROJECT_ROLES[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !userEmail) return
    setError('')
    setSearch('')
    setColumnFilters({ name: '', email: '', company: '', role: '' })
    setSelectedIds(new Set())
    setLoading(true)
    getUsersApi(userEmail)
      .then((res) => {
        if (res.success && res.users) setUsers(res.users)
        else setError(res.error || '사용자 목록을 불러올 수 없습니다.')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '사용자 목록을 불러올 수 없습니다.'))
      .finally(() => setLoading(false))
  }, [open, userEmail])

  const selectableUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const f = columnFilters
    const match = (val: string | null | undefined, filterVal: string) => {
      if (!filterVal.trim()) return true
      return (val ?? '').toLowerCase().includes(filterVal.trim().toLowerCase())
    }
    return users.filter((u) => {
      if (u.status !== '활성' || existingParticipantIds.has(u.id)) return false
      if (q && !u.name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q) && !(u.company ?? '').toLowerCase().includes(q)) return false
      if (!match(u.name, f.name)) return false
      if (!match(u.email, f.email)) return false
      if (!match(u.company, f.company)) return false
      if (!match(u.role ?? '일반 사용자', f.role)) return false
      return true
    })
  }, [users, existingParticipantIds, search, columnFilters])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectableUsers.every((u) => selectedIds.has(u.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        selectableUsers.forEach((u) => next.delete(u.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        selectableUsers.forEach((u) => next.add(u.id))
        return next
      })
    }
  }

  const handleComplete = () => {
    if (selectedIds.size === 0) {
      setError('추가할 사용자를 선택하세요.')
      return
    }
    setError('')
    setSaving(true)
    addProjectParticipantsApi(projectId, userEmail, Array.from(selectedIds), roleInProject)
      .then((res) => {
        if (res.success) {
          onAdded()
          onClose()
        } else {
          setError(res.error || '참여자 추가에 실패했습니다.')
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '참여자 추가에 실패했습니다.'))
      .finally(() => setSaving(false))
  }

  if (!open) return null

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="participant-picker-title">
      <div className="modal modal--participant-picker">
        <div className="modal__header">
          <h2 id="participant-picker-title" className="modal__title">
            참여자 선택 — {projectName}
          </h2>
          <button type="button" className="modal__close" onClick={onClose} disabled={saving} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="modal__body">
          {error && <div className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
          <div className="participant-picker__search-row">
            <input
              type="search"
              className="user-mgmt__search participant-picker__search"
              placeholder="이름, 이메일, 업체명으로 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="참여자 검색"
            />
          </div>
          <div className="participant-picker__role-row">
            <label className="participant-picker__label">프로젝트 내 역할</label>
            <select
              className="participant-picker__select"
              value={roleInProject}
              onChange={(e) => setRoleInProject(e.target.value)}
              aria-label="선택한 사용자의 프로젝트 내 역할"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="participant-picker__table-wrap">
            {loading ? (
              <p className="participant-picker__loading">사용자 목록을 불러오는 중...</p>
            ) : (
              <table className="user-mgmt__table participant-picker__table">
                <thead>
                  <tr>
                    <th className="user-mgmt__th-check">
                      {selectableUsers.length > 0 && (
                        <input
                          type="checkbox"
                          checked={selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.has(u.id))}
                          onChange={toggleSelectAll}
                          aria-label="전체 선택"
                        />
                      )}
                    </th>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>업체명</th>
                    <th>역할</th>
                  </tr>
                  <tr className="participant-picker__filter-row">
                    <th className="user-mgmt__th-check" />
                    <th className="participant-picker__th-filter">
                      <input
                        type="text"
                        className="participant-picker__filter-input"
                        value={columnFilters.name}
                        onChange={(e) => setColumnFilters((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="필터"
                        aria-label="이름 필터"
                      />
                    </th>
                    <th className="participant-picker__th-filter">
                      <input
                        type="text"
                        className="participant-picker__filter-input"
                        value={columnFilters.email}
                        onChange={(e) => setColumnFilters((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="필터"
                        aria-label="이메일 필터"
                      />
                    </th>
                    <th className="participant-picker__th-filter">
                      <input
                        type="text"
                        className="participant-picker__filter-input"
                        value={columnFilters.company}
                        onChange={(e) => setColumnFilters((prev) => ({ ...prev, company: e.target.value }))}
                        placeholder="필터"
                        aria-label="업체명 필터"
                      />
                    </th>
                    <th className="participant-picker__th-filter">
                      <input
                        type="text"
                        className="participant-picker__filter-input"
                        value={columnFilters.role}
                        onChange={(e) => setColumnFilters((prev) => ({ ...prev, role: e.target.value }))}
                        placeholder="필터"
                        aria-label="역할 필터"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectableUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="user-mgmt__empty">
                        {search.trim()
                          ? '검색 결과가 없거나 이미 참여 중인 사용자만 있습니다.'
                          : '추가할 수 있는 사용자가 없습니다. (이미 참여 중이거나 비활성 사용자는 제외됩니다)'}
                      </td>
                    </tr>
                  ) : (
                    selectableUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="user-mgmt__td-check">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleSelect(u.id)}
                            aria-label={`${u.name} 선택`}
                          />
                        </td>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td>{u.company ?? '—'}</td>
                        <td>{u.role ?? '일반 사용자'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleComplete}
            disabled={saving || selectedIds.size === 0}
          >
            {saving ? '처리 중...' : '선택 완료'}
          </button>
        </div>
      </div>
    </div>
  )
}
