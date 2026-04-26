import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import JSZip from 'jszip'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getDesignModelsApi,
  createDesignModelApi,
  updateDesignModelApi,
  deleteDesignModelApi,
  convertDesignModelToDxfApi,
  getDesignModelFileUrl,
  type DesignModel,
} from '../api/designModel'
import { TrimbleConnectImportButton } from '../components/TrimbleConnectImportButton'
import { getTrimbleLoginUrl } from '../api/trimble'
import DesignMgmtPageShell from '../components/DesignMgmtPageShell'
import { VirtualDataGrid } from '../components/VirtualDataGrid'

function getApiErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/failed to fetch|network error|load failed|connection refused|networkrequestfailed/i.test(msg))
    return '서버에 연결할 수 없습니다. 터미널에서 "npm run server"를 실행했는지 확인해 주세요.'
  if (/경로를 찾을 수 없습니다|404/i.test(msg))
    return '요청한 API 경로를 찾을 수 없습니다. 터미널에서 "npm run server"를 실행 중인지, 개발 시 "npm run dev:all" 사용을 권장합니다.'
  return msg || fallback
}

export default function ModelManagement() {
  const { user, trimbleTokens, refreshTrimbleAccessToken } = useAuth()
  const { selectedProject } = useProject()
  const { selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision, loadingPhases } = useDesignSchedule()
  const [models, setModels] = useState<DesignModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<DesignModel | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formFiles, setFormFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [filterTitle, setFilterTitle] = useState('')
  const [filterMemo, setFilterMemo] = useState('')
  const [filterFile, setFilterFile] = useState<'all' | 'has' | 'none'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  /** 저장은 됐으나 Trimble 업로드가 스킵/실패했을 때 안내 */
  const [uploadNotice, setUploadNotice] = useState('')

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const tcLinked = Boolean(selectedProject?.trimble_connect_project_id?.trim())
  const hasTrimbleAccess = Boolean(trimbleTokens?.accessToken)

  const trimbleConnectCell = (model: DesignModel) => {
    if (!tcLinked) return '—'
    if (!model.file_path) return '—'
    if (model.trimble_file_id) {
      return (
        <span style={{ color: 'var(--main-text-muted)' }} title="Trimble Connect에 파일이 반영되었습니다.">
          연동됨
        </span>
      )
    }
    if (model.trimble_sync_error) {
      return (
        <span className="auth-form__error" style={{ cursor: 'help' }} title={model.trimble_sync_error}>
          실패
        </span>
      )
    }
    return (
      <span style={{ color: 'var(--main-text-muted)' }} title="Connect 업로드 대기 또는 진행 중입니다. 잠시 후 새로고침하세요.">
        대기
      </span>
    )
  }

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const t = filterTitle.trim().toLowerCase()
      if (t && !(m.title || '').toLowerCase().includes(t)) return false
      const mem = filterMemo.trim().toLowerCase()
      if (mem && !(m.memo || '').toLowerCase().includes(mem)) return false
      if (filterFile === 'has' && !m.file_path) return false
      if (filterFile === 'none' && m.file_path) return false
      return true
    })
  }, [models, filterTitle, filterMemo, filterFile])

  const modelKpis = useMemo(() => {
    if (!selectedProject) return []
    if (!selectedRevisionId) {
      return [
        { label: '등록 모델', value: '—', sub: '리비전 선택 후 집계', badge: '대기', badgeVariant: 'neutral' as const },
        { label: '파일 첨부', value: '—', sub: '—', badge: '—', badgeVariant: 'neutral' as const },
        { label: '필터 일치', value: '—', sub: '—', badge: '—', badgeVariant: 'neutral' as const },
      ]
    }
    const withFile = models.filter((m) => !!m.file_path).length
    const filterOn = !!filterTitle.trim() || !!filterMemo.trim() || filterFile !== 'all'
    return [
      { label: '등록 모델', value: models.length, sub: '현재 리비전', badge: 'Total', badgeVariant: 'info' as const },
      { label: '파일 첨부', value: withFile, sub: '다운로드 가능', badge: withFile ? '첨부' : '—', badgeVariant: withFile ? ('success' as const) : ('neutral' as const) },
      {
        label: '필터 일치',
        value: filteredModels.length,
        sub: filterOn ? '필터 적용 중' : '전체 표시',
        badge: filterOn ? 'Filtered' : 'All',
        badgeVariant: filterOn ? ('warning' as const) : ('neutral' as const),
      },
    ]
  }, [selectedProject, selectedRevisionId, models, filteredModels, filterTitle, filterMemo, filterFile])

  const fetchModels = useCallback(() => {
    if (!selectedRevisionId) {
      setModels([])
      return
    }
    setLoadingModels(true)
    getDesignModelsApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.models) setModels(res.models)
        else setModels([])
      })
      .catch((err) => {
        setModels([])
        setError(getApiErrorMessage(err, '모델 목록을 불러올 수 없습니다.'))
      })
      .finally(() => setLoadingModels(false))
  }, [selectedRevisionId])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedRevisionId, models])

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredModels.map((m) => m.id)))
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
    if (!window.confirm(`선택한 ${selectedIds.size}건의 모델을 삭제하시겠습니까?`)) return
    setBulkDeleting(true)
    setError('')
    let failed = false
    for (const id of Array.from(selectedIds)) {
      try {
        const res = await deleteDesignModelApi(user.email, id)
        if (!res.success) {
          setError(res.error || '일부 삭제에 실패했습니다.')
          failed = true
          break
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '삭제에 실패했습니다.'))
        failed = true
        break
      }
    }
    setBulkDeleting(false)
    if (!failed) {
      setSelectedIds(new Set())
      fetchModels()
    }
  }

  /** 선택된 항목 중 파일이 있는 모델만 골라 zip으로 압축 후 한 번에 다운로드 */
  const downloadableSelected = useMemo(
    () => filteredModels.filter((m) => selectedIds.has(m.id) && m.file_path),
    [filteredModels, selectedIds]
  )

  const handleBulkDownload = async () => {
    if (downloadableSelected.length === 0) return
    setBulkDownloading(true)
    setError('')
    const zip = new JSZip()
    const usedNames = new Set<string>()
    const safeZipName = (name: string) => {
      const base = (name || 'file').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'file'
      let final = base
      let n = 0
      while (usedNames.has(final)) {
        const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''
        const noExt = ext ? base.slice(0, base.lastIndexOf('.')) : base
        final = `${noExt}_${++n}${ext}`
      }
      usedNames.add(final)
      return final
    }
    let failed = 0
    for (const model of downloadableSelected) {
      try {
        const url = getDesignModelFileUrl(model.id)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const filename = safeZipName(model.file_name || model.title || model.id || 'model')
        zip.file(filename, blob)
      } catch (err) {
        failed++
        console.warn('모델 다운로드 실패:', model.id, err)
      }
    }
    if (failed > 0) {
      setError(`${failed}개 파일을 zip에 포함하지 못했습니다. 나머지만 압축해 다운로드합니다.`)
    }
    try {
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const objectUrl = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `models_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(getApiErrorMessage(err, '압축 파일 생성에 실패했습니다.'))
    } finally {
      setBulkDownloading(false)
    }
  }

  const openCreate = () => {
    setEditingModel(null)
    setFormTitle('')
    setFormMemo('')
    setFormFiles([])
    setError('')
    setUploadNotice('')
    setModalOpen(true)
  }

  const openEdit = (model: DesignModel) => {
    setEditingModel(model)
    setFormTitle(model.title)
    setFormMemo(model.memo ?? '')
    setError('')
    setUploadNotice('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    const title = formTitle.trim()
    if (!user?.email) return
    if (editingModel) {
      if (!title) {
        setError('모델명을 입력하세요.')
        return
      }
      setSaving(true)
      setError('')
      try {
        const res = await updateDesignModelApi(user.email, editingModel.id, title, formMemo.trim() || undefined)
        if (res.success) {
          setModalOpen(false)
          fetchModels()
        } else {
          setError(res.error || '저장에 실패했습니다.')
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '저장에 실패했습니다.'))
      } finally {
        setSaving(false)
      }
      return
    }
    if (formFiles.length === 0) {
      setError('모델 파일을 1개 이상 선택하세요.')
      return
    }
    setSaving(true)
    setError('')
    setUploadNotice('')
    const memo = formMemo.trim() || undefined
    let trimbleToken: string | undefined
    if (tcLinked) {
      let session = await refreshTrimbleAccessToken()
      if (!session?.accessToken) {
        session = await refreshTrimbleAccessToken({ force: true })
      }
      trimbleToken = session?.accessToken ?? trimbleTokens?.accessToken ?? undefined
    }
    let failed = false
    const trimbleNotices: string[] = []
    for (let i = 0; i < formFiles.length; i++) {
      const file = formFiles[i]
      const modelTitle = formFiles.length === 1 ? (title || file.name) : file.name
      try {
        const res = await createDesignModelApi(user.email, selectedRevisionId, modelTitle, memo, file, {
          trimbleAccessToken: trimbleToken,
        })
        if (!res.success) {
          setError(res.error || '저장에 실패했습니다.')
          failed = true
          break
        }
        if (tcLinked && res.trimbleUpload) {
          const tu = res.trimbleUpload
          if (tu.status === 'uploaded') {
            /* ok */
          } else if (tu.status === 'queued') {
            trimbleNotices.push(`「${modelTitle}」: ${tu.message || 'Connect 업로드는 백그라운드에서 진행됩니다. 잠시 후 목록을 새로고침하세요.'}`)
          } else if (tu.status === 'failed') {
            trimbleNotices.push(`「${modelTitle}」: ${tu.message || 'Trimble 업로드에 실패했습니다.'}`)
          } else if (tu.status === 'skipped' && tu.reason !== 'no_trimble_project') {
            trimbleNotices.push(
              `「${modelTitle}」: ${tu.message || (tu.reason === 'no_token' ? 'Trimble 로그인이 필요합니다. 서버에만 저장되었습니다.' : 'Trimble 업로드가 건너뛰어졌습니다.')}`
            )
          }
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '저장에 실패했습니다.'))
        failed = true
        break
      }
    }
    setSaving(false)
    if (!failed) {
      if (trimbleNotices.length > 0) {
        setUploadNotice(trimbleNotices.join('\n'))
      }
      setModalOpen(false)
      fetchModels()
    }
  }

  const handleDelete = (model: DesignModel) => {
    if (!user?.email || !window.confirm(`"${model.title}" 모델을 삭제하시겠습니까?`)) return
    setDeletingId(model.id)
    deleteDesignModelApi(user.email, model.id)
      .then((res) => {
        if (res.success) fetchModels()
        else setError(res.error || '삭제에 실패했습니다.')
      })
      .catch((err) => setError(getApiErrorMessage(err, '삭제에 실패했습니다.')))
      .finally(() => setDeletingId(null))
  }

  if (!selectedProject) {
    return (
      <DesignMgmtPageShell
        title="모델 관리"
        titleEn="Model management"
        description="리비전별로 설계 모델(IFC·DWG 등)을 등록하고, Trimble Connect와 연동할 수 있습니다."
        kpis={[]}
      >
        <section className="card" style={{ margin: 0 }}>
          <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
            모델 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
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
          {downloadableSelected.length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleBulkDownload}
              disabled={bulkDownloading}
              title="선택한 모델 파일을 zip으로 압축해 다운로드합니다."
            >
              {bulkDownloading ? '압축 중…' : `선택 항목 다운로드 (${downloadableSelected.length})`}
            </button>
          )}
          {canManage && selectedIds.size > 0 && (
            <button type="button" className="btn btn--danger btn--sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? '삭제 중…' : `선택 항목 삭제 (${selectedIds.size})`}
            </button>
          )}
          {canManage && user?.email && selectedProject && (
            <TrimbleConnectImportButton
              projectId={selectedProject.id}
              trimbleProjectLinked={!!selectedProject.trimble_connect_project_id}
              designRevisionId={selectedRevisionId}
              userEmail={user.email}
              canManage={canManage}
              onImported={() => void fetchModels()}
              label="Connect에서 가져오기"
              defaultImportModels
              defaultImportDocuments
              defaultImportQuantity={false}
            />
          )}
          {canManage && (
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
              모델 추가
            </button>
          )}
        </div>
      </div>
    ) : null

  return (
    <>
      <DesignMgmtPageShell
        title="모델 관리"
        titleEn="Model management"
        description="리비전별로 설계 모델(IFC·DWG 등)을 등록하고, Trimble Connect와 연동할 수 있습니다."
        kpis={modelKpis}
        projectTag={
          <p className="dm-shell__project-line">
            프로젝트: {selectedProject.name}
            {selectedPhase && selectedRevision ? ` · ${selectedPhase.name} / ${selectedRevision.revision_name}` : ''}
          </p>
        }
        toolbar={toolbar}
        error={error || undefined}
        loading={!!selectedRevisionId && loadingModels}
        loadingText="모델 목록을 불러오는 중…"
        onRefresh={selectedRevisionId ? () => void fetchModels() : undefined}
        refreshDisabled={loadingModels}
      >
        {uploadNotice ? (
          <div className="dm-shell__notice" role="status">
            <strong>Connect 업로드 안내</strong>
            <div style={{ marginTop: '0.35rem' }}>{uploadNotice}</div>
          </div>
        ) : null}

        {selectedRevisionId ? (
          <div className="dm-shell__panel">
            <div className="dm-shell__panel-head">
              <h2 className="dm-shell__panel-title">모델 목록</h2>
            </div>
            <div className="design-doc__table-wrap project-mgmt__table-wrap dm-shell__table-bleed model-mgmt-list">
              <table className="project-mgmt__table design-doc__table model-mgmt-list__table">
                <colgroup>
                  <col className="model-mgmt-list__col-check" />
                  {canManage ? (
                    <>
                      <col style={{ width: '24%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '21%' }} />
                    </>
                  ) : (
                    <>
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '24%' }} />
                      <col style={{ width: '24%' }} />
                      <col style={{ width: '22%' }} />
                    </>
                  )}
                </colgroup>
                <thead>
                    <tr>
                      <th className="model-mgmt-list__th-check">
                        <input
                          type="checkbox"
                          checked={filteredModels.length > 0 && selectedIds.size === filteredModels.length}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          aria-label="전체 선택"
                        />
                      </th>
                      <th>모델명</th>
                      <th>파일</th>
                      <th>Connect</th>
                      <th>비고</th>
                      {canManage && <th>작업</th>}
                    </tr>
                    <tr className="design-doc__filter-row">
                      <th />
                      <th>
                        <input
                          type="text"
                          className="project-mgmt__input design-doc__filter-input"
                          placeholder="필터…"
                          value={filterTitle}
                          onChange={(e) => setFilterTitle(e.target.value)}
                          aria-label="모델명 필터"
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
                      <th />
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
                {filteredModels.length === 0 ? (
                  <div className="project-mgmt__empty model-mgmt-list__empty">
                    {models.length === 0
                      ? '등록된 모델이 없습니다. ' + (canManage ? '모델 추가로 파일을 등록하세요.' : '')
                      : '필터 조건에 맞는 항목이 없습니다.'}
                  </div>
                ) : (
                  <VirtualDataGrid
                    wrapClassName="virtual-data-grid virtual-data-grid--dm model-mgmt-list__grid"
                    gridTemplateColumns={
                      canManage
                        ? '40px minmax(100px,1.4fr) minmax(88px,1.1fr) minmax(100px,1fr) minmax(80px,1fr) minmax(130px,1.2fr)'
                        : '40px minmax(100px,1.5fr) minmax(88px,1.2fr) minmax(100px,1.1fr) minmax(80px,1fr)'
                    }
                    rowHeight={44}
                    scrollResetKey={`${filterTitle}|${filterMemo}|${filterFile}|${filteredModels.length}`}
                    getKey={(model) => model.id}
                    renderRow={(model) => (
                      <>
                        <span onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(model.id)}
                            onChange={(e) => toggleSelect(model.id, e.target.checked)}
                            aria-label={`${model.title} 선택`}
                          />
                        </span>
                        <span>{model.title}</span>
                        <span>
                          {model.file_path ? (
                            <a href={getDesignModelFileUrl(model.id)} download target="_blank" rel="noopener noreferrer">
                              {model.title || model.file_name || '다운로드'}
                            </a>
                          ) : (
                            '—'
                          )}
                        </span>
                        <span>{trimbleConnectCell(model)}</span>
                        <span>{model.memo ?? '—'}</span>
                        {canManage && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <button type="button" className="btn btn--sm btn--secondary" onClick={() => openEdit(model)}>
                              수정
                            </button>{' '}
                            <button
                              type="button"
                              className="btn btn--sm btn--danger"
                              onClick={() => handleDelete(model)}
                              disabled={deletingId === model.id}
                            >
                              {deletingId === model.id ? '처리 중…' : '삭제'}
                            </button>
                          </span>
                        )}
                      </>
                    )}
                    items={filteredModels}
                  />
                )}
            </div>
          </div>
        ) : (
          <div className="dm-shell__panel">
            <div className="dm-shell__panel-head">
              <h2 className="dm-shell__panel-title">모델 목록</h2>
            </div>
            <div className="dm-shell__panel-body">
              {!selectedRevisionId && selectedPhaseId && (
                <p style={{ color: 'var(--main-text-muted)', margin: 0 }}>
                  리비전을 선택하면 해당 리비전의 모델 목록이 표시됩니다.
                </p>
              )}
              {!selectedPhaseId && (
                <p style={{ color: 'var(--main-text-muted)', margin: 0 }}>
                  상단 헤더에서 설계 차수와 리비전을 선택하세요. 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
                </p>
              )}
            </div>
          </div>
        )}
      </DesignMgmtPageShell>

      {modalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="design-model-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="design-model-modal-title" className="modal__title">
                  {editingModel ? '모델 수정' : '모델 등록'}
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
                  <label htmlFor="design-model-form-title" className="project-mgmt__label">
                    모델명 <span className="project-mgmt__required">*</span>
                  </label>
                  <input
                    id="design-model-form-title"
                    type="text"
                    className="project-mgmt__input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="모델명 입력"
                  />
                </div>
                <div className="project-mgmt__field">
                  <label htmlFor="design-model-form-memo" className="project-mgmt__label">
                    비고
                  </label>
                  <input
                    id="design-model-form-memo"
                    type="text"
                    className="project-mgmt__input"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    placeholder="비고 (선택)"
                  />
                </div>
                {!editingModel && (
                  <div className="project-mgmt__field">
                    <label htmlFor="design-model-form-file" className="project-mgmt__label">
                      모델 파일 (IFC, DWG 등 · 복수 선택 가능) <span className="project-mgmt__required">*</span>
                    </label>
                    <input
                      id="design-model-form-file"
                      type="file"
                      accept=".ifc,.dwg"
                      multiple
                      className="project-mgmt__input"
                      onChange={(e) => setFormFiles(Array.from(e.target.files ?? []))}
                      aria-label="모델 파일 선택 (복수 선택 가능)"
                    />
                    {formFiles.length > 0 && (
                      <div style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginTop: '0.5rem' }}>
                        {formFiles.length === 1
                          ? formFiles[0].name
                          : `${formFiles.length}개 파일: ${formFiles.map((f) => f.name).join(', ')}`}
                      </div>
                    )}
                    {tcLinked && (
                      <div style={{ marginTop: '0.65rem' }}>
                        <p style={{ fontSize: '0.8125rem', color: 'var(--main-text-muted)', marginBottom: '0.5rem' }}>
                          이 프로젝트는 Trimble Connect와 연동되어 있습니다. 저장 시 같은 파일이 Connect 프로젝트 루트에도
                          업로드됩니다. (로그인 세션이 있어야 합니다.)
                        </p>
                        {!hasTrimbleAccess && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={async () => {
                              setError('')
                              try {
                                window.location.href = await getTrimbleLoginUrl()
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'Trimble 로그인 URL을 만들 수 없습니다.')
                              }
                            }}
                          >
                            Trimble Connect로 로그인
                          </button>
                        )}
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
