import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getDesignDocumentsApi,
  createDesignDocumentApi,
  updateDesignDocumentApi,
  deleteDesignDocumentApi,
  getDesignDocFileUrl,
  type DesignDocument,
} from '../api/designDoc'
import { TrimbleConnectImportButton } from '../components/TrimbleConnectImportButton'
import DesignMgmtPageShell from '../components/DesignMgmtPageShell'
import { VirtualDataGrid } from '../components/VirtualDataGrid'

export default function DesignDoc() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const { selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision, loadingPhases } = useDesignSchedule()
  const [documents, setDocuments] = useState<DesignDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<DesignDocument | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDocNumber, setFormDocNumber] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formFiles, setFormFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [filterTitle, setFilterTitle] = useState('')
  const [filterDocNumber, setFilterDocNumber] = useState('')
  const [filterMemo, setFilterMemo] = useState('')
  const [filterFile, setFilterFile] = useState<'all' | 'has' | 'none'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const t = filterTitle.trim().toLowerCase()
      if (t && !(doc.title || '').toLowerCase().includes(t)) return false
      const n = filterDocNumber.trim().toLowerCase()
      if (n && !(doc.doc_number || '').toLowerCase().includes(n)) return false
      const m = filterMemo.trim().toLowerCase()
      if (m && !(doc.memo || '').toLowerCase().includes(m)) return false
      if (filterFile === 'has' && !doc.file_path) return false
      if (filterFile === 'none' && doc.file_path) return false
      return true
    })
  }, [documents, filterTitle, filterDocNumber, filterMemo, filterFile])

  const docKpis = useMemo(() => {
    if (!selectedProject) return []
    if (!selectedRevisionId) {
      return [
        {
          label: '등록 도서',
          value: '—',
          sub: '리비전을 선택하면 집계됩니다',
          badge: '대기',
          badgeVariant: 'neutral' as const,
        },
        {
          label: '파일 첨부',
          value: '—',
          sub: '—',
          badge: '—',
          badgeVariant: 'neutral' as const,
        },
        {
          label: '필터 일치',
          value: '—',
          sub: '—',
          badge: '—',
          badgeVariant: 'neutral' as const,
        },
      ]
    }
    const withFile = documents.filter((d) => !!d.file_path).length
    const filterOn =
      !!filterTitle.trim() ||
      !!filterDocNumber.trim() ||
      !!filterMemo.trim() ||
      filterFile !== 'all'
    return [
      {
        label: '등록 도서',
        value: documents.length,
        sub: '현재 리비전',
        badge: 'Total',
        badgeVariant: 'info' as const,
      },
      {
        label: '파일 첨부',
        value: withFile,
        sub: '다운로드 가능',
        badge: withFile ? '첨부' : '—',
        badgeVariant: withFile ? ('success' as const) : ('neutral' as const),
      },
      {
        label: '필터 일치',
        value: filteredDocuments.length,
        sub: filterOn ? '필터 적용 중' : '전체 표시',
        badge: filterOn ? 'Filtered' : 'All',
        badgeVariant: filterOn ? ('warning' as const) : ('neutral' as const),
      },
    ]
  }, [
    selectedProject,
    selectedRevisionId,
    documents,
    filteredDocuments,
    filterTitle,
    filterDocNumber,
    filterMemo,
    filterFile,
  ])

  const fetchDocuments = useCallback(() => {
    if (!selectedRevisionId) {
      setDocuments([])
      return
    }
    setLoadingDocs(true)
    getDesignDocumentsApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.documents) setDocuments(res.documents)
        else setDocuments([])
      })
      .catch(() => setDocuments([]))
      .finally(() => setLoadingDocs(false))
  }, [selectedRevisionId])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedRevisionId, documents])

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredDocuments.map((d) => d.id)))
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
    if (!window.confirm(`선택한 ${selectedIds.size}건의 설계도서를 삭제하시겠습니까?`)) return
    setBulkDeleting(true)
    setError('')
    const ids = Array.from(selectedIds)
    let failed = false
    for (const id of ids) {
      try {
        const res = await deleteDesignDocumentApi(user.email, id)
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
      fetchDocuments()
    }
  }

  const openCreate = () => {
    setEditingDoc(null)
    setFormTitle('')
    setFormDocNumber('')
    setFormMemo('')
    setFormFiles([])
    setError('')
    setModalOpen(true)
  }

  const openEdit = (doc: DesignDocument) => {
    setEditingDoc(doc)
    setFormTitle(doc.title)
    setFormDocNumber(doc.doc_number ?? '')
    setFormMemo(doc.memo ?? '')
    setError('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    const title = formTitle.trim()
    if (formFiles.length === 0 && !title) {
      setError('도서명을 입력하세요.')
      return
    }
    if (!user?.email) return
    setSaving(true)
    setError('')

    if (editingDoc) {
      updateDesignDocumentApi(user.email, editingDoc.id, title, formDocNumber.trim() || undefined, formMemo.trim() || undefined)
        .then((res) => {
          if (res.success) {
            setModalOpen(false)
            fetchDocuments()
          } else {
            setError(res.error || '저장에 실패했습니다.')
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : '저장에 실패했습니다.'))
        .finally(() => setSaving(false))
      return
    }

    const docNumber = formDocNumber.trim() || undefined
    const memo = formMemo.trim() || undefined
    if (formFiles.length === 0) {
      createDesignDocumentApi(user.email, selectedRevisionId, title, docNumber, memo, undefined)
        .then((res) => {
          if (res.success) {
            setModalOpen(false)
            fetchDocuments()
          } else {
            setError(res.error || '저장에 실패했습니다.')
          }
        })
        .catch((err) => setError(err instanceof Error ? err.message : '저장에 실패했습니다.'))
        .finally(() => setSaving(false))
      return
    }

    let failed = false
    let lastError = ''
    for (let i = 0; i < formFiles.length; i++) {
      const file = formFiles[i]
      const docTitle = formFiles.length === 1 ? (title || file.name) : file.name
      try {
        const res = await createDesignDocumentApi(user.email, selectedRevisionId, docTitle, docNumber, memo, file)
        if (!res.success) {
          failed = true
          lastError = res.error || '저장에 실패했습니다.'
          break
        }
      } catch (err) {
        failed = true
        lastError = err instanceof Error ? err.message : '저장에 실패했습니다.'
        break
      }
    }
    setSaving(false)
    if (failed) {
      setError(lastError)
    } else {
      setModalOpen(false)
      fetchDocuments()
      setError('')
    }
  }

  if (!selectedProject) {
    return (
      <DesignMgmtPageShell
        title="설계도서 관리"
        titleEn="Design Documents"
        description="리비전별로 설계도서를 등록하고, 파일을 첨부·다운로드할 수 있습니다."
        kpis={[]}
      >
        <section className="card" style={{ margin: 0 }}>
          <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
            설계도서·설계일정·물량 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
          </p>
          <p style={{ marginTop: '1rem' }}>
            <Link to="/projects" className="btn btn--primary">
              프로젝트 관리에서 선택하기
            </Link>
          </p>
        </section>
      </DesignMgmtPageShell>
    )
  }

  const toolbar =
    selectedRevisionId ? (
      <div className="design-doc__toolbar dm-shell__toolbar-inner">
        <span className="design-doc__revision-label">
          선택: {selectedPhase?.name} — {selectedRevision?.revision_name}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {canManage && (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={handleBulkDelete}
              disabled={bulkDeleting || selectedIds.size === 0}
              title={selectedIds.size === 0 ? '목록에서 삭제할 항목을 선택하세요' : undefined}
            >
              {bulkDeleting ? '삭제 중…' : `선택 항목 삭제${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
            </button>
          )}
          {canManage && user?.email && selectedProject && (
            <TrimbleConnectImportButton
              projectId={selectedProject.id}
              trimbleProjectLinked={!!selectedProject.trimble_connect_project_id}
              designRevisionId={selectedRevisionId}
              userEmail={user.email}
              canManage={canManage}
              onImported={() => void fetchDocuments()}
              label="Connect에서 가져오기"
              defaultImportModels
              defaultImportDocuments
              defaultImportQuantity={false}
            />
          )}
          {canManage && (
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
              설계도서 추가
            </button>
          )}
        </div>
      </div>
    ) : null

  return (
    <>
      <DesignMgmtPageShell
        title="설계도서 관리"
        titleEn="Design Documents"
        description="리비전별로 설계도서를 등록하고, 파일을 첨부·다운로드할 수 있습니다."
        kpis={docKpis}
        projectTag={
          <p className="dm-shell__project-line">
            프로젝트: {selectedProject.name}
            {selectedPhase && selectedRevision
              ? ` · ${selectedPhase.name} / ${selectedRevision.revision_name}`
              : ''}
          </p>
        }
        toolbar={toolbar}
        error={error || undefined}
        loading={!!selectedRevisionId && loadingDocs}
        loadingText="설계도서 목록을 불러오는 중…"
        onRefresh={selectedRevisionId ? () => void fetchDocuments() : undefined}
        refreshDisabled={loadingDocs}
      >
        {selectedRevisionId ? (
          <div className="dm-shell__panel">
            <div className="dm-shell__panel-head">
              <h2 className="dm-shell__panel-title">도서 목록</h2>
            </div>
            <div className="design-doc__table-wrap project-mgmt__table-wrap dm-shell__table-bleed">
              <table className="project-mgmt__table design-doc__table">
                <thead>
                  <tr>
                    {canManage && (
                      <th style={{ width: '2.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filteredDocuments.length > 0 && selectedIds.size === filteredDocuments.length}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          aria-label="전체 선택"
                        />
                      </th>
                    )}
                    <th>도서명</th>
                    <th>도서 번호</th>
                    <th>파일</th>
                    <th>비고</th>
                    {canManage && <th>수정</th>}
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
                        aria-label="도서명 필터"
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="project-mgmt__input design-doc__filter-input"
                        placeholder="필터…"
                        value={filterDocNumber}
                        onChange={(e) => setFilterDocNumber(e.target.value)}
                        aria-label="도서 번호 필터"
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
              </table>
              {filteredDocuments.length === 0 ? (
                <div className="project-mgmt__empty" style={{ padding: '1rem' }}>
                  {documents.length === 0
                    ? '등록된 설계도서가 없습니다. ' + (canManage ? '설계도서 추가로 등록하세요.' : '')
                    : '필터 조건에 맞는 항목이 없습니다.'}
                </div>
              ) : (
                <VirtualDataGrid
                  wrapClassName="virtual-data-grid virtual-data-grid--dm"
                  gridTemplateColumns={
                    canManage
                      ? '40px minmax(100px,1.4fr) minmax(88px,1.1fr) minmax(100px,1fr) minmax(88px,1fr) minmax(88px,0.9fr)'
                      : 'minmax(100px,1.5fr) minmax(88px,1.2fr) minmax(100px,1.1fr) minmax(88px,1.1fr)'
                  }
                  rowHeight={44}
                  scrollResetKey={`${filterTitle}|${filterDocNumber}|${filterMemo}|${filterFile}|${filteredDocuments.length}`}
                  getKey={(doc) => doc.id}
                  renderRow={(doc) => (
                    <>
                      {canManage && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(doc.id)}
                            onChange={(e) => toggleSelect(doc.id, e.target.checked)}
                            aria-label={`${doc.title} 선택`}
                          />
                        </span>
                      )}
                      <span>{doc.title}</span>
                      <span>{doc.doc_number ?? '—'}</span>
                      <span>
                        {doc.file_path ? (
                          <a href={getDesignDocFileUrl(doc.id)} download target="_blank" rel="noopener noreferrer">
                            {doc.title || doc.file_name || '다운로드'}
                          </a>
                        ) : (
                          '—'
                        )}
                      </span>
                      <span>{doc.memo ?? '—'}</span>
                      {canManage && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="btn btn--sm btn--secondary" onClick={() => openEdit(doc)}>
                            수정
                          </button>
                        </span>
                      )}
                    </>
                  )}
                  items={filteredDocuments}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="dm-shell__panel">
            <div className="dm-shell__panel-head">
              <h2 className="dm-shell__panel-title">도서 목록</h2>
            </div>
            <div className="dm-shell__panel-body">
              {!selectedRevisionId && selectedPhaseId && (
                <p style={{ color: 'var(--main-text-muted)', margin: 0 }}>
                  리비전을 선택하면 해당 리비전의 설계도서 목록이 표시됩니다.
                </p>
              )}
              {!selectedPhaseId && !loadingPhases && (
                <p style={{ color: 'var(--main-text-muted)', margin: 0 }}>
                  설계 차수와 리비전을 선택하세요. 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
                </p>
              )}
              {loadingPhases && !selectedPhaseId && (
                <p style={{ color: 'var(--main-text-muted)', margin: 0 }}>설계 일정 정보를 불러오는 중…</p>
              )}
            </div>
          </div>
        )}
      </DesignMgmtPageShell>

      {modalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="design-doc-modal-title">
          <div className="modal">
            <div className="modal__header">
              <h2 id="design-doc-modal-title" className="modal__title">
                {editingDoc ? '설계도서 수정' : '설계도서 등록'}
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
              {error && <div className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
              <div className="project-mgmt__field">
                <label htmlFor="design-doc-form-title" className="project-mgmt__label">
                  도서명 <span className="project-mgmt__required">*</span>
                </label>
                <input
                  id="design-doc-form-title"
                  type="text"
                  className="project-mgmt__input"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="도서명 입력"
                />
              </div>
              <div className="project-mgmt__field">
                <label htmlFor="design-doc-form-docnumber" className="project-mgmt__label">
                  도서 번호
                </label>
                <input
                  id="design-doc-form-docnumber"
                  type="text"
                  className="project-mgmt__input"
                  value={formDocNumber}
                  onChange={(e) => setFormDocNumber(e.target.value)}
                  placeholder="도서 번호 (선택)"
                />
              </div>
              <div className="project-mgmt__field">
                <label htmlFor="design-doc-form-memo" className="project-mgmt__label">
                  비고
                </label>
                <input
                  id="design-doc-form-memo"
                  type="text"
                  className="project-mgmt__input"
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="비고 (선택)"
                />
              </div>
              {!editingDoc && (
                <div className="project-mgmt__field">
                  <label htmlFor="design-doc-form-file" className="project-mgmt__label">
                    파일 (복수 선택 가능)
                  </label>
                  <input
                    id="design-doc-form-file"
                    type="file"
                    multiple
                    className="project-mgmt__input"
                    onChange={(e) => setFormFiles(Array.from(e.target.files ?? []))}
                    aria-label="설계도서 파일 선택 (복수 선택 가능)"
                  />
                  {formFiles.length > 0 && (
                    <div className="design-doc__file-names" style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginTop: '0.5rem' }}>
                      {formFiles.length === 1
                        ? formFiles[0].name
                        : `${formFiles.length}개 파일: ${formFiles.map((f) => f.name).join(', ')}`}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
