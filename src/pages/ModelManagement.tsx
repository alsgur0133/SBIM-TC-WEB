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

function getApiErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/failed to fetch|network error|load failed|connection refused|networkrequestfailed/i.test(msg))
    return '서버에 연결할 수 없습니다. 터미널에서 "npm run server"를 실행했는지 확인해 주세요.'
  if (/경로를 찾을 수 없습니다|404/i.test(msg))
    return '요청한 API 경로를 찾을 수 없습니다. 터미널에서 "npm run server"를 실행 중인지, 개발 시 "npm run dev:all" 사용을 권장합니다.'
  return msg || fallback
}

export default function ModelManagement() {
  const { user } = useAuth()
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

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

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
    setModalOpen(true)
  }

  const openEdit = (model: DesignModel) => {
    setEditingModel(model)
    setFormTitle(model.title)
    setFormMemo(model.memo ?? '')
    setError('')
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
      setError('IFC 파일을 1개 이상 선택하세요.')
      return
    }
    setSaving(true)
    setError('')
    const memo = formMemo.trim() || undefined
    let failed = false
    for (let i = 0; i < formFiles.length; i++) {
      const file = formFiles[i]
      const modelTitle = formFiles.length === 1 ? (title || file.name) : file.name
      try {
        const res = await createDesignModelApi(user.email, selectedRevisionId, modelTitle, memo, file)
        if (!res.success) {
          setError(res.error || '저장에 실패했습니다.')
          failed = true
          break
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '저장에 실패했습니다.'))
        failed = true
        break
      }
    }
    setSaving(false)
    if (!failed) {
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
      <section className="card">
        <h2>모델 관리</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          모델 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
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
    <>
    <section className="card">
      <h2>모델 관리</h2>

        {error && (
          <div className="auth-form__error" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
            {error}
          </div>
        )}

        {selectedRevisionId && (
          <>
            <div className="design-doc__toolbar" style={{ marginTop: '0.5rem' }}>
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
                    모델 추가
                  </button>
                )}
              </div>
            </div>

            {loadingModels ? (
              <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>목록을 불러오는 중…</p>
            ) : (
              <div className="design-doc__table-wrap" style={{ marginTop: '0.5rem' }}>
                <table className="project-mgmt__table design-doc__table">
                  <thead>
                    <tr>
                      <th style={{ width: '2.5rem' }}>
                        <input
                          type="checkbox"
                          checked={filteredModels.length > 0 && selectedIds.size === filteredModels.length}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          aria-label="전체 선택"
                        />
                      </th>
                      <th>모델명</th>
                      <th>파일 (IFC)</th>
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 5 : 4} className="project-mgmt__empty">
                          {models.length === 0
                            ? '등록된 모델이 없습니다. ' + (canManage ? '모델 추가로 IFC 파일을 등록하세요.' : '')
                            : '필터 조건에 맞는 항목이 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      filteredModels.map((model) => (
                        <tr key={model.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(model.id)}
                              onChange={(e) => toggleSelect(model.id, e.target.checked)}
                              aria-label={`${model.title} 선택`}
                            />
                          </td>
                          <td>{model.title}</td>
                          <td>
                            {model.file_path ? (
                              <a href={getDesignModelFileUrl(model.id)} download target="_blank" rel="noopener noreferrer">
                                {model.title || model.file_name || '다운로드'}
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>{model.memo ?? '—'}</td>
                          {canManage && (
                            <td>
                              <button
                                type="button"
                                className="btn btn--sm btn--secondary"
                                onClick={() => openEdit(model)}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm btn--danger"
                                onClick={() => handleDelete(model)}
                                disabled={deletingId === model.id}
                              >
                                {deletingId === model.id ? '처리 중…' : '삭제'}
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
            리비전을 선택하면 해당 리비전의 모델 목록이 표시됩니다.
          </p>
        )}

        {!selectedPhaseId && (
          <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
            상단 헤더에서 설계 차수와 리비전을 선택하세요. 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
          </p>
        )}

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
                      IFC 파일 (복수 선택 가능) <span className="project-mgmt__required">*</span>
                    </label>
                    <input
                      id="design-model-form-file"
                      type="file"
                      accept=".ifc"
                      multiple
                      className="project-mgmt__input"
                      onChange={(e) => setFormFiles(Array.from(e.target.files ?? []))}
                      aria-label="IFC 파일 선택 (복수 선택 가능)"
                    />
                    {formFiles.length > 0 && (
                      <div style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginTop: '0.5rem' }}>
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
    </section>
    </>
  )
}
