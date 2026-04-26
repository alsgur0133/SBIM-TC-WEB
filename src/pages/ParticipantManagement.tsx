import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import {
  getProjectParticipantsApi,
  removeProjectParticipantApi,
  type ProjectParticipant,
} from '../api/projects'
import ParticipantPickerModal from '../components/ParticipantPickerModal'
import './ParticipantManagement.css'

const PAGE_SIZE = 12

function initialsFromName(name: string) {
  const t = (name || '').trim()
  if (!t) return '?'
  if (t.includes('@')) return t.slice(0, 2).toUpperCase()
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

function roleDotClass(role: string): 'participant-page__role-dot--blue' | 'participant-page__role-dot--green' | 'participant-page__role-dot--slate' {
  const r = role.toLowerCase()
  if (r.includes('관리') || r.includes('pm') || r.includes('책임')) return 'participant-page__role-dot--blue'
  if (r.includes('검토') || r.includes('승인') || r.includes('품질')) return 'participant-page__role-dot--green'
  return 'participant-page__role-dot--slate'
}

export default function ParticipantManagement() {
  const { user, trimbleTokens } = useAuth()
  const { selectedProject } = useProject()
  const [participants, setParticipants] = useState<ProjectParticipant[]>([])
  const [loadingParticipants, setLoadingParticipants] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return participants
    return participants.filter(
      (p) =>
        (p.user_name || '').toLowerCase().includes(q) ||
        (p.user_email || '').toLowerCase().includes(q) ||
        (p.user_company || '').toLowerCase().includes(q) ||
        (p.role_in_project || '').toLowerCase().includes(q)
    )
  }, [participants, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const effectivePage = Math.min(Math.max(1, page), totalPages)
  const pageRows = filtered.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== effectivePage) setPage(effectivePage)
  }, [page, effectivePage])

  useEffect(() => {
    setPage(1)
  }, [search, selectedProject?.id])

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
    if (pageRows.length === 0) return
    const allSelected = pageRows.every((p) => selectedIds.has(p.user_id))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageRows.forEach((p) => next.delete(p.user_id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageRows.forEach((p) => next.add(p.user_id))
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

  const listFrom = filtered.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1
  const listTo = Math.min(effectivePage * PAGE_SIZE, filtered.length)

  return (
    <div className="project-mgmt participant-page">
      <div className="participant-page__top">
        <div className="participant-page__top-spacer" aria-hidden />
        <div className="participant-page__search-wrap">
          <span className="participant-page__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="participant-page__search"
            placeholder="이름·이메일·업체·역할 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="참여자 검색"
          />
        </div>
        <div className="participant-page__top-actions">
          <button
            type="button"
            className="participant-page__icon-btn"
            onClick={() => fetchParticipants()}
            disabled={loadingParticipants || !selectedProject}
            title="목록 새로고침"
            aria-label="목록 새로고침"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <header className="participant-page__hero">
        <div>
          <h1 className="participant-page__title">
            프로젝트 참여자 관리
            <span className="participant-page__title-en">Participant Management</span>
          </h1>
          <p className="participant-page__lead">
            선택한 프로젝트의 참여자를 조회하고, 권한이 있으면 추가·제거할 수 있습니다.
          </p>
          {selectedProject ? (
            <p className="participant-page__project-line">
              {selectedProject.code ? `${selectedProject.code} · ` : ''}
              {selectedProject.name} — 총 {participants.length.toLocaleString()}명
            </p>
          ) : null}
        </div>
      </header>

      {selectedProject ? (
        <>
          {error ? (
            <p className="participant-page__error" role="alert">
              {error}
            </p>
          ) : null}

          {loadingParticipants ? (
            <p className="participant-page__loading">참여자 목록을 불러오는 중…</p>
          ) : (
            <div className="participant-page__panel">
              <div className="participant-page__panel-head">
                <h2 className="participant-page__panel-title">팀 디렉터리</h2>
                <div className="participant-page__panel-actions">
                  {canManage && (
                    <button
                      type="button"
                      className="participant-page__btn participant-page__btn--danger-text"
                      disabled={!someSelected || deletingIds.size > 0}
                      onClick={deleteSelected}
                      title={someSelected ? `선택 ${selectedIds.size}명 제거` : '제거할 참여자를 선택하세요'}
                    >
                      {deletingIds.size > 0 ? '제거 중…' : '선택 항목 삭제'}
                    </button>
                  )}
                  {canManage && (
                    <button type="button" className="participant-page__btn participant-page__btn--primary" onClick={() => setPickerOpen(true)}>
                      + 참여자 선택
                    </button>
                  )}
                </div>
              </div>

              <div className="participant-page__table-scroll">
                <table className="participant-page__table">
                  <thead>
                    <tr>
                      {canManage && (
                        <th style={{ width: 44 }}>
                          {pageRows.length > 0 ? (
                            <input
                              type="checkbox"
                              checked={pageRows.every((p) => selectedIds.has(p.user_id))}
                              onChange={toggleSelectAll}
                              aria-label="현재 페이지 전체 선택"
                            />
                          ) : null}
                        </th>
                      )}
                      <th>이름 · 이메일</th>
                      <th>업체명</th>
                      <th>프로젝트 내 역할</th>
                      {canManage ? <th style={{ width: 52 }}>작업</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 5 : 3} style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                          {participants.length === 0 ? '참여자가 없습니다. 참여자 선택으로 추가하세요.' : '검색 결과가 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((p) => {
                        const dot = roleDotClass(p.role_in_project || '')
                        return (
                          <tr key={p.user_id}>
                            {canManage && (
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(p.user_id)}
                                  onChange={() => toggleSelect(p.user_id)}
                                  disabled={deletingIds.has(p.user_id)}
                                  aria-label={`${p.user_name} 선택`}
                                />
                              </td>
                            )}
                            <td>
                              <div className="participant-page__name-cell">
                                <span className="participant-page__avatar-sm">{initialsFromName(p.user_name)}</span>
                                <div className="participant-page__name-block">
                                  <div className="participant-page__name">{p.user_name}</div>
                                  <div className="participant-page__email-sub">{p.user_email}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              {(p.user_company || '').trim() ? (
                                <span className="participant-page__company-pill">{(p.user_company || '').trim()}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              <span className="participant-page__role">
                                <span className={`participant-page__role-dot ${dot}`} aria-hidden />
                                {p.role_in_project}
                              </span>
                            </td>
                            {canManage && (
                              <td>
                                <details className="participant-page__details" style={{ position: 'relative' }}>
                                  <summary aria-label="작업 메뉴">⋮</summary>
                                  <div className="participant-page__menu">
                                    <button
                                      type="button"
                                      disabled={removingId === p.user_id || deletingIds.has(p.user_id)}
                                      onClick={() => {
                                        handleRemove(p.user_id)
                                        ;(document.activeElement as HTMLElement | null)?.blur()
                                      }}
                                    >
                                      {removingId === p.user_id || deletingIds.has(p.user_id) ? '처리 중…' : '제거'}
                                    </button>
                                  </div>
                                </details>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {filtered.length > 0 ? (
                <div className="participant-page__pagination">
                  <span>
                    {listFrom}–{listTo} / 총 {filtered.length.toLocaleString()}명
                  </span>
                  <div className="participant-page__pager">
                    <button
                      type="button"
                      className="participant-page__page-btn"
                      disabled={effectivePage <= 1}
                      onClick={() => setPage((x) => Math.max(1, x - 1))}
                      aria-label="이전 페이지"
                    >
                      ‹
                    </button>
                    {totalPages <= 10 ? (
                      Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`participant-page__page-btn${n === effectivePage ? ' is-active' : ''}`}
                          onClick={() => setPage(n)}
                        >
                          {n}
                        </button>
                      ))
                    ) : (
                      <span style={{ padding: '0 0.5rem', fontWeight: 600, color: '#334155' }}>
                        {effectivePage} / {totalPages}
                      </span>
                    )}
                    <button
                      type="button"
                      className="participant-page__page-btn"
                      disabled={effectivePage >= totalPages}
                      onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
                      aria-label="다음 페이지"
                    >
                      ›
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="participant-page__footer">
                <span>역할 색상: 관리·책임(파랑) · 검토·승인(초록) · 기타(회색)</span>
                <span>© SBIM TC — 참여자 콘솔</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="participant-page__empty-select">
          상단의 <strong>프로젝트 선택</strong>에서 프로젝트를 선택하면 참여자 목록이 표시됩니다.
        </p>
      )}

      {canManage && selectedProject && user?.email && (
        <ParticipantPickerModal
          open={pickerOpen}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          userEmail={user.email}
          trimbleAccessToken={trimbleTokens?.accessToken}
          existingParticipantIds={existingParticipantIds}
          onClose={() => setPickerOpen(false)}
          onAdded={fetchParticipants}
        />
      )}
    </div>
  )
}
