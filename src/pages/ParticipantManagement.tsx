import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import {
  getProjectParticipantsApi,
  removeProjectParticipantApi,
  type ProjectParticipant,
} from '../api/projects'
import ParticipantPickerModal from '../components/ParticipantPickerModal'

export default function ParticipantManagement() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const [participants, setParticipants] = useState<ProjectParticipant[]>([])
  const [loadingParticipants, setLoadingParticipants] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const fetchParticipants = useCallback(() => {
    if (!selectedProject?.id || !user?.email) return
    setLoadingParticipants(true)
    getProjectParticipantsApi(selectedProject.id, user.email)
      .then((res) => {
        if (res.success && Array.isArray(res.participants)) {
          setParticipants(res.participants)
        } else {
          setParticipants([])
        }
      })
      .catch(() => setParticipants([]))
      .finally(() => setLoadingParticipants(false))
  }, [selectedProject?.id, user?.email])

  useEffect(() => {
    fetchParticipants()
  }, [fetchParticipants])

  const existingParticipantIds = new Set(participants.map((p) => p.user_id))

  const handleRemove = (userId: string) => {
    if (!selectedProject?.id || !user?.email) return
    if (!window.confirm('이 사용자를 프로젝트 참여자에서 제거하시겠습니까?')) return
    setRemovingId(userId)
    removeProjectParticipantApi(selectedProject.id, userId, user.email)
      .then((res) => {
        if (res.success) fetchParticipants()
        else setError(res.error || '제거에 실패했습니다.')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '제거에 실패했습니다.'))
      .finally(() => setRemovingId(null))
  }

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (participants.length === 0) return
    const allSelected = participants.every((p) => selectedIds.has(p.user_id))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        participants.forEach((p) => next.delete(p.user_id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        participants.forEach((p) => next.add(p.user_id))
        return next
      })
    }
  }

  const deleteSelected = async () => {
    if (!selectedProject?.id || !user?.email || selectedIds.size === 0) return
    if (!window.confirm(`선택한 ${selectedIds.size}명의 참여자를 제거하시겠습니까?`)) return
    setError('')
    const toRemove = Array.from(selectedIds)
    setDeletingIds(new Set(toRemove))
    const failed: string[] = []
    for (const userId of toRemove) {
      const res = await removeProjectParticipantApi(selectedProject.id, userId, user.email)
      if (!res.success) failed.push(userId)
    }
    setDeletingIds(new Set())
    setSelectedIds(new Set())
    if (failed.length > 0) {
      setError(`일부 제거 실패: ${failed.length}명`)
    }
    fetchParticipants()
  }

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'
  const someSelected = selectedIds.size > 0

  return (
    <div className="project-mgmt">
      <header className="project-mgmt__header">
        <h1 className="project-mgmt__title">프로젝트 참여자 관리</h1>
        <p className="project-mgmt__desc">
          상단의 <strong>프로젝트 선택</strong>에서 선택한 프로젝트의 참여자를 조회·추가·제거할 수 있습니다. 관리자 또는 프로젝트 관리자만 참여자를 관리할 수 있습니다.
        </p>
      </header>

      {error && <div className="auth-form__error">{error}</div>}

      {!selectedProject ? (
        <p className="user-mgmt__empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--main-text-muted)' }}>
          상단 헤더의 <strong>프로젝트 선택</strong> 버튼에서 프로젝트를 선택해 주세요.
        </p>
      ) : (
        <>
          <div className="user-mgmt__toolbar project-mgmt__toolbar" style={{ marginBottom: '1rem' }}>
            {canManage && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setPickerOpen(true)}
              >
                참여자 선택
              </button>
            )}
            {canManage && (
              <button
                type="button"
                className="btn btn--danger"
                disabled={!someSelected || deletingIds.size > 0}
                onClick={deleteSelected}
                title={someSelected ? `선택한 ${selectedIds.size}명 제거` : '제거할 참여자를 선택하세요'}
              >
                {deletingIds.size > 0 ? '제거 중...' : '선택 항목 삭제'}
              </button>
            )}
          </div>
          <h2 className="project-mgmt__title" style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
            참여자 목록 — {selectedProject.code ?? ''} {selectedProject.name}
          </h2>
          {loadingParticipants ? (
            <p className="user-mgmt__loading">참여자 목록을 불러오는 중...</p>
          ) : (
            <div className="user-mgmt__table-wrap">
              <table className="user-mgmt__table">
                <thead>
                  <tr>
                    {canManage && (
                      <th className="user-mgmt__th-check">
                        {participants.length > 0 && (
                          <input
                            type="checkbox"
                            checked={participants.length > 0 && participants.every((p) => selectedIds.has(p.user_id))}
                            onChange={toggleSelectAll}
                            aria-label="전체 선택"
                          />
                        )}
                      </th>
                    )}
                    <th>이름</th>
                    <th>이메일</th>
                    <th>업체명</th>
                    <th>프로젝트 내 역할</th>
                    {canManage && <th>작업</th>}
                  </tr>
                </thead>
                <tbody>
                  {participants.length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 6 : 4} className="user-mgmt__empty">
                        참여자가 없습니다. 참여자 선택으로 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    participants.map((p) => (
                      <tr key={p.user_id}>
                        {canManage && (
                          <td className="user-mgmt__td-check">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(p.user_id)}
                              onChange={() => toggleSelect(p.user_id)}
                              disabled={deletingIds.has(p.user_id)}
                              aria-label={`${p.user_name} 선택`}
                            />
                          </td>
                        )}
                        <td>{p.user_name}</td>
                        <td>{p.user_email}</td>
                        <td>{(p.user_company ?? '').trim() || '—'}</td>
                        <td>{p.role_in_project}</td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => handleRemove(p.user_id)}
                              disabled={removingId === p.user_id || deletingIds.has(p.user_id)}
                            >
                              {removingId === p.user_id || deletingIds.has(p.user_id) ? '처리 중...' : '제거'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {canManage && selectedProject && user?.email && (
        <ParticipantPickerModal
          open={pickerOpen}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          userEmail={user.email}
          existingParticipantIds={existingParticipantIds}
          onClose={() => setPickerOpen(false)}
          onAdded={fetchParticipants}
        />
      )}
    </div>
  )
}
