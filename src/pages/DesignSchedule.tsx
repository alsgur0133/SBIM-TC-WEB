import { useState, useEffect, useCallback, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import {
  getPhasesApi,
  createPhaseApi,
  updatePhaseApi,
  deletePhaseApi,
  getRevisionsApi,
  createRevisionApi,
  updateRevisionApi,
  deleteRevisionApi,
  type DesignPhase,
  type DesignRevision,
} from '../api/designSchedule'

function formatDate(s: string | null) {
  if (!s) return '-'
  return s.slice(0, 10)
}

const REVISION_STATUS_OPTIONS = ['예정', '진행중', '완료', '보류']

export default function DesignSchedule() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const [phases, setPhases] = useState<DesignPhase[]>([])
  const [revisionsByPhase, setRevisionsByPhase] = useState<Record<string, DesignRevision[]>>({})
  const [expandedPhaseIds, setExpandedPhaseIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phaseModalOpen, setPhaseModalOpen] = useState(false)
  const [editingPhase, setEditingPhase] = useState<DesignPhase | null>(null)
  const [phaseFormName, setPhaseFormName] = useState('')
  const [phaseFormOrder, setPhaseFormOrder] = useState(0)
  const [revisionModalOpen, setRevisionModalOpen] = useState(false)
  const [editingRevision, setEditingRevision] = useState<DesignRevision | null>(null)
  const [revisionPhaseId, setRevisionPhaseId] = useState<string | null>(null)
  const [revFormName, setRevFormName] = useState('')
  const [revFormPlanned, setRevFormPlanned] = useState('')
  const [revFormActual, setRevFormActual] = useState('')
  const [revFormStatus, setRevFormStatus] = useState('예정')
  const [revFormMemo, setRevFormMemo] = useState('')
  const [pendingDeletePhase, setPendingDeletePhase] = useState<DesignPhase | null>(null)
  const [pendingDeleteRevision, setPendingDeleteRevision] = useState<DesignRevision | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<Set<string>>(new Set())
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'
  const totalSelected = selectedPhaseIds.size + selectedRevisionIds.size

  function normalizeError(msg: string): string {
    if (!msg) return '요청을 처리할 수 없습니다.'
    if (msg.includes('404')) return 'API를 사용할 수 없습니다. 서버를 재시작한 뒤 새로고침해 보세요.'
    if (msg.includes('Failed to fetch')) return '서버에 연결할 수 없습니다. (npm run server)'
    return msg
  }

  const fetchPhases = useCallback(() => {
    if (!selectedProject) {
      setPhases([])
      setLoading(false)
      return
    }
    setError('')
    setLoading(true)
    getPhasesApi(selectedProject.id)
      .then((res) => {
        if (res.success && res.phases) {
          setPhases(res.phases)
          const phaseIds = new Set((res.phases || []).map((p: DesignPhase) => p.id))
          setExpandedPhaseIds((prev) => new Set([...prev].filter((id) => phaseIds.has(id))))
        } else setError(normalizeError(res.error || '목록을 불러올 수 없습니다.'))
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '목록을 불러올 수 없습니다.')))
      .finally(() => setLoading(false))
  }, [selectedProject?.id])

  const fetchRevisions = useCallback((phaseId: string) => {
    getRevisionsApi(phaseId)
      .then((res) => {
        if (res.success && res.revisions) {
          setRevisionsByPhase((prev) => ({ ...prev, [phaseId]: res.revisions! }))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchPhases()
  }, [fetchPhases])

  useEffect(() => {
    expandedPhaseIds.forEach((phaseId) => fetchRevisions(phaseId))
  }, [expandedPhaseIds, fetchRevisions])

  function openPhaseCreate() {
    setError('')
    setEditingPhase(null)
    setPhaseFormName('')
    setPhaseFormOrder(phases.length)
    setPhaseModalOpen(true)
  }

  function openPhaseEdit(p: DesignPhase) {
    setError('')
    setEditingPhase(p)
    setPhaseFormName(p.name)
    setPhaseFormOrder(p.sort_order)
    setPhaseModalOpen(true)
  }

  function closePhaseModal() {
    setPhaseModalOpen(false)
    setEditingPhase(null)
  }

  function handlePhaseSave() {
    const name = phaseFormName.trim()
    if (!name) {
      setError('설계차수명을 입력하세요.')
      return
    }
    if (!user?.email) return
    if (!selectedProject?.id) {
      setError('프로젝트를 선택하세요.')
      return
    }
    setError('')
    setSaving(true)
    const promise = editingPhase
      ? updatePhaseApi(user.email, editingPhase.id, name, phaseFormOrder, selectedProject.id)
      : createPhaseApi(user.email, name, phaseFormOrder, selectedProject.id)
    promise
      .then((res) => {
        if (res.success && res.phase) {
          if (editingPhase) {
            setPhases((prev) => prev.map((p) => (p.id === res.phase!.id ? res.phase! : p)))
          } else {
            setPhases((prev) => [res.phase!, ...prev])
          }
          closePhaseModal()
        } else {
          setError(normalizeError(res.error || '저장에 실패했습니다.'))
        }
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '저장에 실패했습니다.')))
      .finally(() => setSaving(false))
  }

  function confirmDeletePhase() {
    if (!pendingDeletePhase || !user?.email) return
    const p = pendingDeletePhase
    setPendingDeletePhase(null)
    setError('')
    setDeletingId(p.id)
    deletePhaseApi(user.email, p.id)
      .then((res) => {
        if (res.success) {
          setPhases((prev) => prev.filter((x) => x.id !== p.id))
          setRevisionsByPhase((prev) => {
            const next = { ...prev }
            delete next[p.id]
            return next
          })
          setExpandedPhaseIds((prev) => {
            const next = new Set(prev)
            next.delete(p.id)
            return next
          })
        } else setError(normalizeError(res.error || '삭제에 실패했습니다.'))
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '삭제에 실패했습니다.')))
      .finally(() => setDeletingId(null))
  }

  function openRevisionCreate(phaseId: string) {
    setError('')
    setRevisionPhaseId(phaseId)
    setEditingRevision(null)
    setRevFormName('')
    setRevFormPlanned('')
    setRevFormActual('')
    setRevFormStatus('예정')
    setRevFormMemo('')
    setRevisionModalOpen(true)
  }

  function openRevisionEdit(r: DesignRevision) {
    setError('')
    setRevisionPhaseId(r.design_phase_id)
    setEditingRevision(r)
    setRevFormName(r.revision_name)
    setRevFormPlanned(r.planned_date ? r.planned_date.slice(0, 10) : '')
    setRevFormActual(r.actual_date ? r.actual_date.slice(0, 10) : '')
    setRevFormStatus(r.status || '예정')
    setRevFormMemo(r.memo || '')
    setRevisionModalOpen(true)
  }

  function closeRevisionModal() {
    setRevisionModalOpen(false)
    setEditingRevision(null)
    setRevisionPhaseId(null)
  }

  function handleRevisionSave() {
    const name = revFormName.trim()
    if (!name) {
      setError('리비전명을 입력하세요.')
      return
    }
    if (!user?.email || !revisionPhaseId) return
    setError('')
    setSaving(true)
    const promise = editingRevision
      ? updateRevisionApi(user.email, editingRevision.id, name, revFormPlanned || undefined, revFormActual || undefined, revFormStatus, revFormMemo || undefined)
      : createRevisionApi(user.email, revisionPhaseId, name, revFormPlanned || undefined, revFormActual || undefined, revFormStatus, revFormMemo || undefined)
    promise
      .then((res) => {
        if (res.success && res.revision) {
          if (editingRevision) {
            setRevisionsByPhase((prev) => ({
              ...prev,
              [revisionPhaseId]: (prev[revisionPhaseId] || []).map((r) =>
                r.id === res.revision!.id ? res.revision! : r
              ),
            }))
          } else {
            setRevisionsByPhase((prev) => ({
              ...prev,
              [revisionPhaseId]: [res.revision!, ...(prev[revisionPhaseId] || [])],
            }))
          }
          closeRevisionModal()
        } else setError(normalizeError(res.error || '저장에 실패했습니다.'))
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '저장에 실패했습니다.')))
      .finally(() => setSaving(false))
  }

  function confirmDeleteRevision() {
    if (!pendingDeleteRevision || !user?.email) return
    const r = pendingDeleteRevision
    setPendingDeleteRevision(null)
    setError('')
    setDeletingId(r.id)
    deleteRevisionApi(user.email, r.id)
      .then((res) => {
        if (res.success) {
          setRevisionsByPhase((prev) => ({
            ...prev,
            [r.design_phase_id]: (prev[r.design_phase_id] || []).filter((x) => x.id !== r.id),
          }))
        } else setError(normalizeError(res.error || '삭제에 실패했습니다.'))
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '삭제에 실패했습니다.')))
      .finally(() => setDeletingId(null))
  }

  function toggleExpand(phaseId: string) {
    setExpandedPhaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  function togglePhaseSelect(phaseId: string) {
    const revs = revisionsByPhase[phaseId] || []
    const revIds = revs.map((r) => r.id)
    setSelectedPhaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
    setSelectedRevisionIds((prev) => {
      const next = new Set(prev)
      const phaseNowSelected = !selectedPhaseIds.has(phaseId)
      if (phaseNowSelected) revIds.forEach((id) => next.add(id))
      else revIds.forEach((id) => next.delete(id))
      return next
    })
  }

  function toggleAllPhases() {
    if (phases.length === 0) return
    const allSelected = phases.every((p) => selectedPhaseIds.has(p.id))
    setSelectedPhaseIds(allSelected ? new Set() : new Set(phases.map((p) => p.id)))
    setSelectedRevisionIds((prev) => {
      if (allSelected) return new Set()
      const next = new Set(prev)
      phases.forEach((p) => {
        (revisionsByPhase[p.id] || []).forEach((r) => next.add(r.id))
      })
      return next
    })
  }

  function toggleRevisionSelect(revisionId: string) {
    setSelectedRevisionIds((prev) => {
      const next = new Set(prev)
      if (next.has(revisionId)) next.delete(revisionId)
      else next.add(revisionId)
      return next
    })
  }

  function toggleAllRevisionsForPhase(phaseId: string) {
    const revs = revisionsByPhase[phaseId] || []
    if (revs.length === 0) return
    const allSelected = revs.every((r) => selectedRevisionIds.has(r.id))
    setSelectedRevisionIds((prev) => {
      const next = new Set(prev)
      if (allSelected) revs.forEach((r) => next.delete(r.id))
      else revs.forEach((r) => next.add(r.id))
      return next
    })
  }

  async function batchDeleteSelected() {
    if (!user?.email || totalSelected === 0) return
    const phaseCount = selectedPhaseIds.size
    const revCount = selectedRevisionIds.size
    const msg = [phaseCount > 0 && `${phaseCount}개 설계차수`, revCount > 0 && `${revCount}개 리비전`]
      .filter(Boolean)
      .join(', ')
    if (!window.confirm(`선택한 항목(${msg})을 삭제하시겠습니까?`)) return
    setError('')
    setBatchDeleting(true)
    const phaseIds = Array.from(selectedPhaseIds)
    const revisionIds = Array.from(selectedRevisionIds)
    const failed: string[] = []
    for (const id of phaseIds) {
      try {
        const res = await deletePhaseApi(user.email, id)
        if (!res.success) failed.push(id)
      } catch {
        failed.push(id)
      }
    }
    for (const id of revisionIds) {
      try {
        const res = await deleteRevisionApi(user.email, id)
        if (!res.success) failed.push(id)
      } catch {
        failed.push(id)
      }
    }
    setSelectedPhaseIds(new Set())
    setSelectedRevisionIds(new Set())
    setBatchDeleting(false)
    if (failed.length > 0) setError(`일부 삭제 실패: ${failed.length}건`)
    fetchPhases()
  }

  if (!selectedProject) {
    return (
      <div className="design-schedule">
        <header className="project-mgmt__header">
          <h1 className="project-mgmt__title">설계일정 관리</h1>
          <p className="project-mgmt__desc">
            설계차수를 등록하고, 각 차수별 리비전(Rev.0, Rev.1 등)을 관리할 수 있습니다.
          </p>
        </header>
        <section className="card">
          <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
            설계일정 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link to="/projects" className="btn btn--primary">
              프로젝트 관리에서 선택하기
            </Link>
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="design-schedule">
      <header className="project-mgmt__header">
        <h1 className="project-mgmt__title">설계일정 관리</h1>
        <p className="project-mgmt__desc">
          설계차수를 등록하고, 각 차수별 리비전(Rev.0, Rev.1 등)을 관리할 수 있습니다.
        </p>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong>
        </p>
        {user && !canManage && (
          <p className="project-mgmt__hint">
            생성·수정·삭제는 관리자 또는 프로젝트 관리자만 가능합니다. 역할 반영을 위해 로그아웃 후 다시 로그인하세요.
          </p>
        )}
      </header>

      <div className="project-mgmt__toolbar">
        {canManage && (
          <>
            <button type="button" className="btn btn--primary" onClick={openPhaseCreate}>
              설계차수 추가
            </button>
            {totalSelected > 0 && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={batchDeleteSelected}
                disabled={batchDeleting}
              >
                {batchDeleting ? '삭제 중…' : `선택 항목 일괄 삭제 (${totalSelected}건)`}
              </button>
            )}
          </>
        )}
        <button type="button" className="btn btn--secondary" onClick={fetchPhases} disabled={loading}>
          새로고침
        </button>
      </div>

      {error && <div className="auth-form__error">{error}</div>}
      {loading ? (
        <p className="project-mgmt__loading">설계차수 목록을 불러오는 중...</p>
      ) : (
        <div className="project-mgmt__table-wrap">
          <table className="project-mgmt__table design-schedule__table">
            <thead>
              <tr>
                {canManage && (
                  <th className="design-schedule__th-check">
                    {phases.length > 0 && (
                      <input
                        type="checkbox"
                        checked={phases.length > 0 && phases.every((p) => selectedPhaseIds.has(p.id))}
                        onChange={toggleAllPhases}
                        aria-label="설계차수 전체 선택"
                      />
                    )}
                  </th>
                )}
                <th className="design-schedule__th-expand" />
                <th>설계차수</th>
                {canManage && <th>작업</th>}
              </tr>
            </thead>
            <tbody>
              {phases.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 4 : 2} className="project-mgmt__empty">
                    등록된 설계차수가 없습니다. 설계차수 추가로 1차, 2차 등을 등록하세요.
                  </td>
                </tr>
              ) : (
                phases.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      className={canManage ? 'design-schedule__row--clickable' : ''}
                      onDoubleClick={() => canManage && openPhaseEdit(p)}
                    >
                      {canManage && (
                        <td className="design-schedule__td-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedPhaseIds.has(p.id)}
                            onChange={() => togglePhaseSelect(p.id)}
                            aria-label={`${p.name} 선택`}
                          />
                        </td>
                      )}
                      <td className="design-schedule__td-expand" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="design-schedule__expand-btn"
                          onClick={() => toggleExpand(p.id)}
                          aria-expanded={expandedPhaseIds.has(p.id)}
                          aria-label={expandedPhaseIds.has(p.id) ? '리비전 접기' : '리비전 펼치기'}
                        >
                          {expandedPhaseIds.has(p.id) ? '▼' : '▶'}
                        </button>
                      </td>
                      <td>{p.name}</td>
                      {canManage && (
                        <td>
                          <div className="project-mgmt__actions">
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              onClick={() => openRevisionCreate(p.id)}
                            >
                              리비전 추가
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              onClick={() => openPhaseEdit(p)}
                              disabled={saving}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => setPendingDeletePhase(p)}
                              disabled={deletingId === p.id}
                            >
                              {deletingId === p.id ? '삭제 중...' : '삭제'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {expandedPhaseIds.has(p.id) && (
                      <tr key={`${p.id}-rev`}>
                        <td colSpan={canManage ? 4 : 2} className="design-schedule__revisions-cell">
                          <div className="design-schedule__revisions">
                            {(revisionsByPhase[p.id] || []).length === 0 ? (
                              <p className="design-schedule__revisions-empty">등록된 리비전이 없습니다. 리비전 추가로 Rev.0, Rev.1 등을 등록하세요.</p>
                            ) : (
                              <table className="design-schedule__revisions-table">
                                <thead>
                                  <tr>
                                    {canManage && (
                                      <th className="design-schedule__th-check">
                                        <input
                                          type="checkbox"
                                          checked={
                                            (revisionsByPhase[p.id] || []).length > 0 &&
                                            (revisionsByPhase[p.id] || []).every((r) => selectedRevisionIds.has(r.id))
                                          }
                                          onChange={() => toggleAllRevisionsForPhase(p.id)}
                                          aria-label="해당 차수 리비전 전체 선택"
                                        />
                                      </th>
                                    )}
                                    <th>리비전</th>
                                    <th>예정일</th>
                                    <th>완료일</th>
                                    <th>상태</th>
                                    <th>비고</th>
                                    {canManage && <th>작업</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(revisionsByPhase[p.id] || []).map((r) => (
                                    <tr
                                      key={r.id}
                                      className={canManage ? 'design-schedule__row--clickable' : ''}
                                      onDoubleClick={() => canManage && openRevisionEdit(r)}
                                    >
                                      {canManage && (
                                        <td className="design-schedule__td-check" onClick={(e) => e.stopPropagation()}>
                                          <input
                                            type="checkbox"
                                            checked={selectedRevisionIds.has(r.id)}
                                            onChange={() => toggleRevisionSelect(r.id)}
                                            aria-label={`${r.revision_name} 선택`}
                                          />
                                        </td>
                                      )}
                                      <td>{r.revision_name}</td>
                                      <td>{formatDate(r.planned_date)}</td>
                                      <td>{formatDate(r.actual_date)}</td>
                                      <td>{r.status}</td>
                                      <td className="project-mgmt__desc-cell">{r.memo || '-'}</td>
                                      {canManage && (
                                        <td>
                                          <div className="project-mgmt__actions">
                                            <button
                                              type="button"
                                              className="btn btn--sm btn--secondary"
                                              onClick={() => openRevisionEdit(r)}
                                            >
                                              수정
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn--sm btn--danger"
                                              onClick={() => setPendingDeleteRevision(r)}
                                              disabled={deletingId === r.id}
                                            >
                                              {deletingId === r.id ? '삭제 중...' : '삭제'}
                                            </button>
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 설계차수 추가/수정 모달 */}
      {phaseModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="phase-modal-title">
          <div className="modal">
            <h2 id="phase-modal-title" className="modal__title">
              {editingPhase ? '설계차수 수정' : '설계차수 추가'}
            </h2>
            <div className="modal__body">
              <label className="project-mgmt__label">설계차수명 <span className="project-mgmt__required">*</span></label>
              <input
                type="text"
                className="project-mgmt__input"
                value={phaseFormName}
                onChange={(e) => setPhaseFormName(e.target.value)}
                placeholder="예: 1차 설계, 2차 설계"
              />
              <label className="project-mgmt__label">표시 순서</label>
              <input
                type="number"
                className="project-mgmt__input"
                min={0}
                value={phaseFormOrder}
                onChange={(e) => setPhaseFormOrder(Number(e.target.value) || 0)}
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={closePhaseModal} disabled={saving}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={handlePhaseSave} disabled={saving}>
                {saving ? '처리 중...' : editingPhase ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 리비전 추가/수정 모달 */}
      {revisionModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="revision-modal-title">
          <div className="modal">
            <h2 id="revision-modal-title" className="modal__title">
              {editingRevision ? '리비전 수정' : '리비전 추가'}
            </h2>
            <div className="modal__body">
              <label className="project-mgmt__label">리비전명 <span className="project-mgmt__required">*</span></label>
              <input
                type="text"
                className="project-mgmt__input"
                value={revFormName}
                onChange={(e) => setRevFormName(e.target.value)}
                placeholder="예: Rev.0, Rev.1"
              />
              <label className="project-mgmt__label">예정일</label>
              <input
                type="date"
                className="project-mgmt__input"
                value={revFormPlanned}
                onChange={(e) => setRevFormPlanned(e.target.value)}
              />
              <label className="project-mgmt__label">완료일</label>
              <input
                type="date"
                className="project-mgmt__input"
                value={revFormActual}
                onChange={(e) => setRevFormActual(e.target.value)}
              />
              <label className="project-mgmt__label">상태</label>
              <select
                className="project-mgmt__input"
                value={revFormStatus}
                onChange={(e) => setRevFormStatus(e.target.value)}
              >
                {REVISION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <label className="project-mgmt__label">비고</label>
              <textarea
                className="project-mgmt__input project-mgmt__textarea"
                value={revFormMemo}
                onChange={(e) => setRevFormMemo(e.target.value)}
                placeholder="비고 (선택)"
                rows={2}
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={closeRevisionModal} disabled={saving}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={handleRevisionSave} disabled={saving}>
                {saving ? '처리 중...' : editingRevision ? '저장' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 설계차수 삭제 확인 */}
      {pendingDeletePhase && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="phase-delete-title">
          <div className="modal">
            <h2 id="phase-delete-title" className="modal__title">설계차수 삭제</h2>
            <div className="modal__body">
              <p>
                정말 <strong>"{pendingDeletePhase.name}"</strong> 설계차수를 삭제하시겠습니까? 해당 차수의 모든 리비전도 함께 삭제되며 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setPendingDeletePhase(null)}>아니오</button>
              <button type="button" className="btn btn--danger" onClick={confirmDeletePhase}>예</button>
            </div>
          </div>
        </div>
      )}

      {/* 리비전 삭제 확인 */}
      {pendingDeleteRevision && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="revision-delete-title">
          <div className="modal">
            <h2 id="revision-delete-title" className="modal__title">리비전 삭제</h2>
            <div className="modal__body">
              <p>
                정말 <strong>"{pendingDeleteRevision.revision_name}"</strong> 리비전을 삭제하시겠습니까?
              </p>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setPendingDeleteRevision(null)}>아니오</button>
              <button type="button" className="btn btn--danger" onClick={confirmDeleteRevision}>예</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
