import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  CODE_MGMT_SYSTEMS,
  parseCodeMgmtSystemQuery,
  CODE_MGMT_SYSTEM_LABELS,
  type CodeMgmtSystem,
} from '../lib/code-mgmt-systems'
import DesignMgmtPageShell from '../components/DesignMgmtPageShell'
import {
  getCodeMgmtParametersApi,
  createCodeMgmtParameterApi,
  updateCodeMgmtParameterApi,
  deleteCodeMgmtParameterApi,
  getCodeMgmtCompositionsApi,
  addCodeMgmtCompositionApi,
  deleteCodeMgmtCompositionApi,
  resetCodeMgmtCompositionsApi,
  type CodeMgmtParameter,
  type CodeMgmtCompositionRow,
} from '../api/codeManagement'

function PreviewTree({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return <p className="project-mgmt__hint" style={{ margin: 0 }}>구성코드 목록에 항목을 추가하면 계층 미리보기가 표시됩니다.</p>
  }
  function Chain({ i }: { i: number }) {
    if (i >= labels.length) return null
    return (
      <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem', listStyle: 'disc' }}>
        <li>
          <span>{labels[i]}</span>
          <Chain i={i + 1} />
        </li>
      </ul>
    )
  }
  return (
    <div className="code-mgmt-preview-tree">
      <div className="code-mgmt-preview-root">코드</div>
      <Chain i={0} />
    </div>
  )
}

export default function CodeManagementWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const canManage =
    user?.role === '프로젝트 관리자' ||
    user?.role === '관리자' ||
    user?.isAdmin === true ||
    (user?.email || '').toLowerCase() === 'sa'

  const activeSystem: CodeMgmtSystem = useMemo(
    () => parseCodeMgmtSystemQuery(searchParams.get('system')),
    [searchParams]
  )

  useEffect(() => {
    const raw = searchParams.get('system')
    if (raw == null || raw.trim() === '') {
      setSearchParams({ system: 'OBS' }, { replace: true })
      return
    }
    const u = raw.trim().toUpperCase()
    if (!(CODE_MGMT_SYSTEMS as readonly string[]).includes(u)) {
      setSearchParams({ system: 'OBS' }, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const [parameters, setParameters] = useState<CodeMgmtParameter[]>([])
  const [compositions, setCompositions] = useState<CodeMgmtCompositionRow[]>([])
  const [loadingP, setLoadingP] = useState(true)
  const [loadingC, setLoadingC] = useState(true)
  const [error, setError] = useState('')
  const [selectedParamId, setSelectedParamId] = useState<string | null>(null)
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null)

  const [paramModal, setParamModal] = useState(false)
  const [editingParam, setEditingParam] = useState<CodeMgmtParameter | null>(null)
  const [formCode, setFormCode] = useState('')
  const [formGroup, setFormGroup] = useState('HITBIM')
  const [formKey, setFormKey] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formSort, setFormSort] = useState('0')
  const [saving, setSaving] = useState(false)
  const [paramModalError, setParamModalError] = useState('')

  const loadParameters = useCallback(() => {
    setLoadingP(true)
    setError('')
    return getCodeMgmtParametersApi()
      .then((r) => {
        if (r.success && r.items) setParameters(r.items)
        else setParameters([])
      })
      .catch((e) => {
        setParameters([])
        setError(e instanceof Error ? e.message : '매개변수 목록을 불러오지 못했습니다.')
      })
      .finally(() => setLoadingP(false))
  }, [])

  const loadCompositions = useCallback(() => {
    setLoadingC(true)
    setError('')
    getCodeMgmtCompositionsApi(activeSystem)
      .then((r) => {
        if (r.success && r.items) setCompositions(r.items)
        else setCompositions([])
      })
      .catch((e) => {
        setCompositions([])
        setError(e instanceof Error ? e.message : '구성 목록을 불러오지 못했습니다.')
      })
      .finally(() => setLoadingC(false))
  }, [activeSystem])

  useEffect(() => {
    loadParameters()
  }, [loadParameters])

  useEffect(() => {
    loadCompositions()
    setSelectedCompId(null)
  }, [loadCompositions])

  function openCreateParam() {
    setEditingParam(null)
    setFormCode('')
    setFormGroup('HITBIM')
    setFormKey('')
    setFormMemo('')
    setFormSort('0')
    setParamModal(true)
  }

  function openEditParam(p: CodeMgmtParameter) {
    setEditingParam(p)
    setFormCode(p.code)
    setFormGroup(p.param_group || 'HITBIM')
    setFormKey(p.param_key)
    setFormMemo(p.memo ?? '')
    setFormSort(String(p.sort_order ?? 0))
    setParamModal(true)
  }

  async function saveParam() {
    if (!user?.email || !canManage) return
    const code = formCode.trim()
    const param_key = formKey.trim()
    if (!code || !param_key) {
      setError('코드와 매개변수를 입력하세요.')
      return
    }
    const sort_order = parseInt(formSort, 10)
    setSaving(true)
    setError('')
    try {
      if (editingParam) {
        await updateCodeMgmtParameterApi(user.email, editingParam.id, {
          code,
          param_group: formGroup.trim() || 'HITBIM',
          param_key,
          memo: formMemo.trim() || undefined,
          sort_order: Number.isFinite(sort_order) ? sort_order : 0,
        })
      } else {
        await createCodeMgmtParameterApi(user.email, {
          code,
          param_group: formGroup.trim() || 'HITBIM',
          param_key,
          memo: formMemo.trim() || undefined,
          sort_order: Number.isFinite(sort_order) ? sort_order : 0,
        })
      }
      setParamModal(false)
      setParamModalError('')
      loadParameters()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.'
      setParamModalError(msg)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  function deleteSelectedParam() {
    if (!selectedParamId || !user?.email || !canManage) return
    if (!window.confirm('선택한 매개변수를 삭제할까요? 분류체계 구성에서도 제거됩니다.')) return
    deleteCodeMgmtParameterApi(user.email, selectedParamId)
      .then(() => {
        setSelectedParamId(null)
        loadParameters()
        loadCompositions()
      })
      .catch((e) => setError(e instanceof Error ? e.message : '삭제에 실패했습니다.'))
  }

  function addToComposition() {
    if (!selectedParamId || !user?.email || !canManage) return
    addCodeMgmtCompositionApi(user.email, activeSystem, selectedParamId)
      .then(() => {
        loadCompositions()
      })
      .catch((e) => setError(e instanceof Error ? e.message : '추가에 실패했습니다.'))
  }

  function deleteCompositionRow() {
    if (!selectedCompId || !user?.email || !canManage) return
    deleteCodeMgmtCompositionApi(user.email, selectedCompId)
      .then(() => {
        setSelectedCompId(null)
        loadCompositions()
      })
      .catch((e) => setError(e instanceof Error ? e.message : '삭제에 실패했습니다.'))
  }

  function resetComposition() {
    if (!user?.email || !canManage) return
    if (!window.confirm(`${CODE_MGMT_SYSTEM_LABELS[activeSystem]} 구성을 모두 비울까요?`)) return
    resetCodeMgmtCompositionsApi(user.email, activeSystem)
      .then(() => {
        setSelectedCompId(null)
        loadCompositions()
      })
      .catch((e) => setError(e instanceof Error ? e.message : '초기화에 실패했습니다.'))
  }

  const previewLabels = compositions.map((c) => c.code)

  const codeKpis = useMemo(
    () => [
      {
        label: '매개변수',
        value: parameters.length,
        sub: '전역 목록',
        badge: 'Parameters',
        badgeVariant: 'info' as const,
      },
      {
        label: `${CODE_MGMT_SYSTEM_LABELS[activeSystem]} 구성`,
        value: compositions.length,
        sub: '현재 분류체계 탭',
        badge: activeSystem,
        badgeVariant: compositions.length ? ('success' as const) : ('neutral' as const),
      },
      {
        label: '미리보기',
        value: previewLabels.length,
        sub: '계층 단계 수',
        badge: previewLabels.length ? 'Tree' : '—',
        badgeVariant: previewLabels.length ? ('success' as const) : ('neutral' as const),
      },
    ],
    [parameters.length, compositions.length, activeSystem, previewLabels.length]
  )

  return (
    <>
    <DesignMgmtPageShell
      title="코드 관리"
      titleEn="Code management"
      description="매개변수 목록을 등록한 뒤, OBS·MBS·WBS·CBS·UBS 분류체계별로 구성코드 순서를 지정합니다. 오른쪽 미리보기는 구성 순서대로 계층을 표시합니다."
      kpis={codeKpis}
      error={error || undefined}
      loading={loadingP && parameters.length === 0}
      loadingText="코드 데이터를 불러오는 중…"
      onRefresh={() => {
        void loadParameters()
        void loadCompositions()
      }}
      refreshDisabled={loadingP}
    >
      <div className="code-mgmt-workspace code-mgmt-workspace--docked">
      <div className="code-mgmt-workspace__grid">
        {/* 매개변수 목록 */}
        <section className="code-mgmt-pane" aria-labelledby="code-mgmt-param-title">
          <h2 id="code-mgmt-param-title" className="code-mgmt-pane__title">
            매개변수 목록
          </h2>
          <div className="code-mgmt-toolbar">
            {canManage && (
              <>
                <button type="button" className="btn btn--primary btn--sm" onClick={openCreateParam}>
                  추가
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={!selectedParamId}
                  onClick={deleteSelectedParam}
                >
                  삭제
                </button>
              </>
            )}
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadParameters} disabled={loadingP}>
              새로고침
            </button>
          </div>
          <div className="user-mgmt__table-wrap code-mgmt-table-wrap">
            <table className="user-mgmt__table user-mgmt__table--compact">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>매개변수 그룹</th>
                  <th>매개변수</th>
                  <th>비고</th>
                  {canManage && <th>편집</th>}
                </tr>
              </thead>
              <tbody>
                {loadingP && parameters.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="user-mgmt__empty">
                      불러오는 중…
                    </td>
                  </tr>
                ) : parameters.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="user-mgmt__empty">
                      등록된 매개변수가 없습니다.
                    </td>
                  </tr>
                ) : (
                  parameters.map((p) => (
                    <tr
                      key={p.id}
                      className={selectedParamId === p.id ? 'code-mgmt-row--selected' : undefined}
                      onClick={() => setSelectedParamId(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{p.code}</td>
                      <td>{p.param_group}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{p.param_key}</td>
                      <td style={{ maxWidth: '6rem', wordBreak: 'break-word' }}>{p.memo || '—'}</td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditParam(p)
                            }}
                          >
                            수정
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 분류체계 + 구성코드 */}
        <section className="code-mgmt-pane" aria-labelledby="code-mgmt-comp-title">
          <h2 id="code-mgmt-comp-title" className="code-mgmt-pane__title">
            분류체계 목록 · 구성코드
          </h2>
          <div className="code-mgmt-system-tabs" role="tablist" aria-label="분류체계 종류">
            {CODE_MGMT_SYSTEMS.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === activeSystem}
                className={`code-mgmt-system-tab ${s === activeSystem ? 'code-mgmt-system-tab--active' : ''}`}
                onClick={() => setSearchParams({ system: s }, { replace: true })}
              >
                {CODE_MGMT_SYSTEM_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="code-mgmt-toolbar">
            <button type="button" className="btn btn--secondary btn--sm" onClick={resetComposition} disabled={!canManage}>
              초기화
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadCompositions} disabled={loadingC}>
              새로고침
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!canManage || !selectedParamId}
              onClick={addToComposition}
              title="왼쪽에서 매개변수 행을 선택한 뒤 추가"
            >
              선택 항목 구성에 추가
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!canManage || !selectedCompId}
              onClick={deleteCompositionRow}
            >
              구성에서 삭제
            </button>
          </div>
          <p className="project-mgmt__hint" style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            현재: <strong>{CODE_MGMT_SYSTEM_LABELS[activeSystem]}</strong>
          </p>
          <div className="user-mgmt__table-wrap code-mgmt-table-wrap">
            <table className="user-mgmt__table user-mgmt__table--compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>코드</th>
                  <th>매개변수 그룹</th>
                  <th>매개변수</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {loadingC && compositions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="user-mgmt__empty">
                      불러오는 중…
                    </td>
                  </tr>
                ) : compositions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="user-mgmt__empty">
                      구성코드가 없습니다. 왼쪽에서 매개변수를 선택 후 &quot;선택 항목 구성에 추가&quot;를 누르세요.
                    </td>
                  </tr>
                ) : (
                  compositions.map((c) => (
                    <tr
                      key={c.composition_id}
                      className={selectedCompId === c.composition_id ? 'code-mgmt-row--selected' : undefined}
                      onClick={() => setSelectedCompId(c.composition_id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{c.sort_index + 1}</td>
                      <td>{c.code}</td>
                      <td>{c.param_group}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{c.param_key}</td>
                      <td style={{ maxWidth: '6rem', wordBreak: 'break-word' }}>{c.memo || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 미리보기 */}
        <section className="code-mgmt-pane code-mgmt-pane--preview" aria-labelledby="code-mgmt-preview-title">
          <h2 id="code-mgmt-preview-title" className="code-mgmt-pane__title">
            미리보기
          </h2>
          <PreviewTree labels={previewLabels} />
        </section>
      </div>
      </div>
    </DesignMgmtPageShell>

      {paramModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="code-mgmt-param-modal-title">
          <div className="modal">
            <div className="modal__header">
              <h2 id="code-mgmt-param-modal-title" className="modal__title">
                {editingParam ? '매개변수 수정' : '매개변수 등록'}
              </h2>
              <button
                type="button"
                className="modal__close"
                onClick={() => {
                  setParamModal(false)
                  setParamModalError('')
                }}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal__body">
              {paramModalError && (
                <p className="user-mgmt__error" role="alert" style={{ marginBottom: '0.75rem' }}>
                  {paramModalError}
                </p>
              )}
              <label className="project-mgmt__label" htmlFor="cmp-code">
                코드
              </label>
              <input
                id="cmp-code"
                className="project-mgmt__input"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                disabled={saving}
                placeholder="예: 프로젝트"
              />
              <label className="project-mgmt__label" htmlFor="cmp-grp">
                매개변수 그룹
              </label>
              <input
                id="cmp-grp"
                className="project-mgmt__input"
                value={formGroup}
                onChange={(e) => setFormGroup(e.target.value)}
                disabled={saving}
                placeholder="HITBIM"
              />
              <label className="project-mgmt__label" htmlFor="cmp-key">
                매개변수
              </label>
              <input
                id="cmp-key"
                className="project-mgmt__input"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                disabled={saving}
                placeholder="예: product.objectType / ifc.class / 속성세트.속성명"
              />
              <label className="project-mgmt__label" htmlFor="cmp-sort">
                정렬 순서
              </label>
              <input
                id="cmp-sort"
                type="number"
                className="project-mgmt__input"
                value={formSort}
                onChange={(e) => setFormSort(e.target.value)}
                disabled={saving}
              />
              <label className="project-mgmt__label" htmlFor="cmp-memo">
                비고
              </label>
              <textarea
                id="cmp-memo"
                className="project-mgmt__input"
                rows={2}
                value={formMemo}
                onChange={(e) => setFormMemo(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setParamModal(false)
                  setParamModalError('')
                }}
                disabled={saving}
              >
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void saveParam()} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
