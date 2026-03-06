import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getDesignReviewsApi,
  createDesignReviewApi,
  updateDesignReviewApi,
  deleteDesignReviewApi,
  getDesignReviewFileUrl,
  type DesignReview,
} from '../api/designReview'

const EXCEL_ACCEPT = '.xlsx,.xls'
const EXCEL_EXT = /\.(xlsx|xls)$/i

export default function DesignReviewPage() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const {
    selectedPhaseId,
    selectedRevisionId,
    selectedPhase,
    selectedRevision,
    loadingPhases,
  } = useDesignSchedule()
  const [reviews, setReviews] = useState<DesignReview[]>([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingReview, setEditingReview] = useState<DesignReview | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formFile, setFormFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterTitle, setFilterTitle] = useState('')
  const [filterMemo, setFilterMemo] = useState('')
  const [filterFile, setFilterFile] = useState<'all' | 'has' | 'none'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      const t = filterTitle.trim().toLowerCase()
      if (t && !(r.title || '').toLowerCase().includes(t)) return false
      const m = filterMemo.trim().toLowerCase()
      if (m && !(r.memo || '').toLowerCase().includes(m)) return false
      if (filterFile === 'has' && !r.file_path) return false
      if (filterFile === 'none' && r.file_path) return false
      return true
    })
  }, [reviews, filterTitle, filterMemo, filterFile])

  const fetchReviews = useCallback(() => {
    if (!selectedRevisionId) {
      setReviews([])
      return
    }
    setLoadingReviews(true)
    getDesignReviewsApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.reviews) setReviews(res.reviews)
        else setReviews([])
      })
      .catch(() => setReviews([]))
      .finally(() => setLoadingReviews(false))
  }, [selectedRevisionId])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedRevisionId, reviews])

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredReviews.map((r) => r.id)))
    else setSelectedIds(new Set())
  }

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (!user?.email || selectedIds.size === 0) return
    if (!window.confirm(`선택한 ${selectedIds.size}건의 설계검토를 삭제하시겠습니까?`)) return
    setBulkDeleting(true)
    setError('')
    let failed = false
    for (const id of Array.from(selectedIds)) {
      try {
        const res = await deleteDesignReviewApi(user.email, id)
        if (!res.success) {
          setError(res.error || '일부 삭제에 실패했습니다.')
          failed = true
          break
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
        failed = true
        break
      }
    }
    setBulkDeleting(false)
    if (!failed) {
      setSelectedIds(new Set())
      fetchReviews()
    }
  }

  const openCreate = () => {
    setEditingReview(null)
    setFormTitle('')
    setFormMemo('')
    setFormFile(null)
    setError('')
    setModalOpen(true)
  }

  const openEdit = (review: DesignReview) => {
    setEditingReview(review)
    setFormTitle(review.title)
    setFormMemo(review.memo ?? '')
    setFormFile(null)
    setError('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    const title = formTitle.trim()
    if (!user?.email || !selectedRevisionId) return

    if (editingReview) {
      if (!title) {
        setError('제목을 입력하세요.')
        return
      }
      setSaving(true)
      setError('')
      updateDesignReviewApi(user.email, editingReview.id, title, formMemo.trim() || undefined)
        .then((res) => {
          if (res.success) {
            setModalOpen(false)
            fetchReviews()
          } else {
            setError(res.error || '저장에 실패했습니다.')
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : '저장에 실패했습니다.'))
        .finally(() => setSaving(false))
      return
    }

    if (!formFile) {
      setError('엑셀 파일을 선택하세요.')
      return
    }
    if (!EXCEL_EXT.test(formFile.name)) {
      setError('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.')
      return
    }

    const titleToUse = title || formFile.name.replace(/\.(xlsx|xls)$/i, '') || formFile.name
    setSaving(true)
    setError('')
    createDesignReviewApi(user.email, selectedRevisionId, titleToUse, formFile, formMemo.trim() || undefined)
      .then((res) => {
        if (res.success) {
          setModalOpen(false)
          fetchReviews()
        } else {
          setError(res.error || '등록에 실패했습니다.')
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : '등록에 실패했습니다.'))
      .finally(() => setSaving(false))
  }

  const handleDelete = (review: DesignReview) => {
    if (!user?.email || !window.confirm(`"${review.title}" 설계검토를 삭제하시겠습니까?`)) return
    setDeletingId(review.id)
    deleteDesignReviewApi(user.email, review.id)
      .then((res) => {
        if (res.success) fetchReviews()
        else setError(res.error || '삭제에 실패했습니다.')
      })
      .catch((err) => setError(err instanceof Error ? err.message : '삭제에 실패했습니다.'))
      .finally(() => setDeletingId(null))
  }

  if (!selectedProject) {
    return (
      <section className="card">
        <h2>설계검토 관리</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          설계검토 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/projects" className="btn btn--primary">
            프로젝트 관리에서 선택하기
          </Link>
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>설계검토 관리</h2>
      <p style={{ marginTop: '0.25rem', color: 'var(--main-text-muted)', fontSize: '0.9rem' }}>
        설계검토는 엑셀 파일로 수행합니다.
      </p>

      {error && (
        <div className="auth-form__error" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
          {error}
        </div>
      )}

      {selectedRevisionId && (
        <>
          <div className="design-doc__toolbar">
            <span className="design-doc__revision-label">
              선택: {selectedPhase?.name} — {selectedRevision?.revision_name}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {canManage && selectedIds.size > 0 && (
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? '삭제 중…' : `선택 항목 삭제 (${selectedIds.size})`}
                </button>
              )}
              {canManage && (
                <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
                  설계검토 추가
                </button>
              )}
            </div>
          </div>

          {loadingReviews ? (
            <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>목록을 불러오는 중…</p>
          ) : (
            <div className="design-doc__table-wrap">
              <table className="project-mgmt__table design-doc__table">
                <thead>
                  <tr>
                    {canManage && (
                      <th style={{ width: '2.5rem' }}>
                        <input
                          type="checkbox"
                          checked={
                            filteredReviews.length > 0 && selectedIds.size === filteredReviews.length
                          }
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          aria-label="전체 선택"
                        />
                      </th>
                    )}
                    <th>제목</th>
                    <th>파일</th>
                    <th>비고</th>
                    {canManage && <th>작업</th>}
                  </tr>
                  <tr className="design-doc__filter-row">
                    {canManage && <th />}
                    <th>
                      <input
                        type="text"
                        className="project-mgmt__input design-doc__filter-input"
                        placeholder="필터…"
                        value={filterTitle}
                        onChange={(e) => setFilterTitle(e.target.value)}
                        aria-label="제목 필터"
                      />
                    </th>
                    <th>
                      <select
                        className="project-mgmt__input design-doc__filter-input"
                        value={filterFile}
                        onChange={(e) => setFilterFile(e.target.value as 'all' | 'has' | 'none')}
                        aria-label="파일 필터"
                      >
                        <option value="all">전체</option>
                        <option value="has">파일 있음</option>
                        <option value="none">파일 없음</option>
                      </select>
                    </th>
                    <th>
                      <input
                        type="text"
                        className="project-mgmt__input design-doc__filter-input"
                        placeholder="필터…"
                        value={filterMemo}
                        onChange={(e) => setFilterMemo(e.target.value)}
                        aria-label="비고 필터"
                      />
                    </th>
                    {canManage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {filteredReviews.length === 0 ? (
                    <tr>
                      <td
                        colSpan={canManage ? 5 : 4}
                        className="project-mgmt__empty"
                      >
                        {reviews.length === 0
                          ? '등록된 설계검토가 없습니다. ' +
                            (canManage ? '설계검토 추가로 엑셀 파일을 등록하세요.' : '')
                          : '필터 조건에 맞는 항목이 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredReviews.map((review) => (
                      <tr key={review.id}>
                        {canManage && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(review.id)}
                              onChange={(e) => toggleSelect(review.id, e.target.checked)}
                              aria-label={`${review.title} 선택`}
                            />
                          </td>
                        )}
                        <td>{review.title}</td>
                        <td>
                          {review.file_path ? (
                            <a
                              href={getDesignReviewFileUrl(review.id)}
                              download={review.file_name ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {review.file_name || '다운로드'}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{review.memo ?? '—'}</td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="btn btn--sm btn--secondary"
                              onClick={() => openEdit(review)}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => handleDelete(review)}
                              disabled={deletingId === review.id}
                            >
                              {deletingId === review.id ? '처리 중…' : '삭제'}
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

      {!selectedRevisionId && selectedPhaseId && (
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          리비전을 선택하면 해당 리비전의 설계검토 목록이 표시됩니다.
        </p>
      )}

      {!selectedPhaseId && !loadingPhases && (
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          설계 차수와 리비전을 선택하세요. 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
        </p>
      )}

      {/* 추가/수정 모달 */}
      {modalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="design-review-modal-title"
        >
          <div className="modal">
            <div className="modal__header">
              <h2 id="design-review-modal-title" className="modal__title">
                {editingReview ? '설계검토 수정' : '설계검토 등록'}
              </h2>
              <button
                type="button"
                className="modal__close"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal__body">
              {error && (
                <div className="auth-form__error" style={{ marginBottom: '0.75rem' }}>
                  {error}
                </div>
              )}
              <div className="project-mgmt__field">
                <label htmlFor="design-review-form-title" className="project-mgmt__label">
                  제목 <span className="project-mgmt__required">*</span>
                </label>
                <input
                  id="design-review-form-title"
                  type="text"
                  className="project-mgmt__input"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="설계검토 제목"
                />
              </div>
              <div className="project-mgmt__field">
                <label htmlFor="design-review-form-memo" className="project-mgmt__label">
                  비고
                </label>
                <input
                  id="design-review-form-memo"
                  type="text"
                  className="project-mgmt__input"
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="비고 (선택)"
                />
              </div>
              {!editingReview && (
                <div className="project-mgmt__field">
                  <label htmlFor="design-review-form-file" className="project-mgmt__label">
                    엑셀 파일 <span className="project-mgmt__required">*</span>
                  </label>
                  <input
                    id="design-review-form-file"
                    type="file"
                    accept={EXCEL_ACCEPT}
                    className="project-mgmt__input"
                    onChange={(e) => setFormFile(e.target.files?.[0] ?? null)}
                    aria-label="엑셀 파일 선택"
                  />
                  {formFile && (
                    <div
                      style={{
                        fontSize: '0.875rem',
                        color: 'var(--main-text-muted)',
                        marginTop: '0.5rem',
                      }}
                    >
                      {formFile.name}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
