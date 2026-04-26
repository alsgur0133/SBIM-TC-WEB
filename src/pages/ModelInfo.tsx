import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getDesignModelsApi,
  getDesignModelFileUrl,
  getDesignModelIfcProductsApi,
  rebuildDesignModelIfcMetaApi,
  type DesignModel,
  type IfcMetaSummary,
} from '../api/designModel'
import DesignMgmtPageShell from '../components/DesignMgmtPageShell'
import { VirtualDataGrid } from '../components/VirtualDataGrid'
import { VirtualList } from '../components/VirtualList'
import { effectiveDesignRevisionIdForSync, postIfcViewerSync } from '../lib/ifcViewerSync'
import {
  createIfcSession,
  listIfcProductsInSession,
  getIfcItemProperties,
  flattenIfcProps,
  type IfcProductSummary,
  type IfcSession,
} from '../lib/ifcModelSession'

/** 서버 ifc-products API 페이지 크기(첫 화면·진행률 반응 개선). 서버가 offset/limit로 분할 응답. */
const IFC_PRODUCTS_PAGE_SIZE = 3000
/** 가상 스크롤 행 높이(px) — VirtualList와 CSS 그리드와 맞출 것 */
const IFC_OBJECT_ROW_HEIGHT = 34
/** 등록 모델 목록(좌측) 행 높이 — 제목+파일 2줄 */
const MODEL_LIST_ROW_HEIGHT = 58
/** IFC 매개변수 행(PropRow) 가상 스크롤 */
const IFC_PROP_ROW_HEIGHT = 36

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function formatDt(s: string | null | undefined): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 19)
}

function ifcSummaryLine(meta: IfcMetaSummary | null | undefined): string {
  if (!meta) return '—'
  const parts = [meta.projectName, meta.buildingName || meta.siteName].filter(Boolean)
  return parts.length ? parts.join(' · ') : '(헤더만 추출)'
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="model-info-prop__row">
      <div className="model-info-prop__label">{label}</div>
      <div className="model-info-prop__value">{children}</div>
    </div>
  )
}

function isIfcModel(m: DesignModel | null): boolean {
  return !!(m?.file_path && /\.ifc$/i.test(m.file_path))
}

function emitViewerSyncForIfcProductRow(
  r: IfcProductSummary,
  opts: { revisionId: string; projectId?: string; designModelId: string }
) {
  const rev = opts.revisionId.trim()
  if (!rev || !opts.designModelId.trim()) return
  const g = r.globalId?.trim()
  const ex = Number.isFinite(r.expressID) ? r.expressID : undefined
  /** Trimble 임베드는 selectExpress+globalId만 처리하던 경로가 있어, GlobalId가 있으면 selectGlobalId로 통일 */
  if (g) {
    postIfcViewerSync({
      v: 1,
      action: 'selectGlobalId',
      designRevisionId: rev,
      projectId: opts.projectId,
      globalId: g,
      expressId: ex,
      designModelId: opts.designModelId,
    })
    return
  }
  postIfcViewerSync({
    v: 1,
    action: 'selectExpress',
    designRevisionId: rev,
    projectId: opts.projectId,
    expressId: r.expressID,
    designModelId: opts.designModelId,
  })
}

export default function ModelInfo() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const { selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision, loadingPhases } = useDesignSchedule()
  const [models, setModels] = useState<DesignModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rebuildingId, setRebuildingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [productRows, setProductRows] = useState<IfcProductSummary[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [productsProgress, setProductsProgress] = useState<{ done: number; total: number } | null>(null)
  const [productsError, setProductsError] = useState('')
  const [productsLoading, setProductsLoading] = useState(false)
  /** 객체 목록을 표시할 준비됨 (DB API 또는 브라우저 web-ifc) */
  const [productsUiReady, setProductsUiReady] = useState(false)
  const [objectFilter, setObjectFilter] = useState('')

  const [selectedExpressId, setSelectedExpressId] = useState<number | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailProps, setDetailProps] = useState<Record<string, unknown> | null>(null)

  const sessionRef = useRef<IfcSession | null>(null)

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const load = useCallback(() => {
    if (!selectedRevisionId) {
      setModels([])
      return
    }
    setLoading(true)
    setError('')
    getDesignModelsApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.models) setModels(res.models)
        else setModels([])
      })
      .catch((e) => {
        setModels([])
        setError(e instanceof Error ? e.message : '모델 정보를 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
  }, [selectedRevisionId])

  useEffect(() => {
    load()
  }, [load])

  const sorted = useMemo(() => {
    return [...models].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'))
  }, [models])

  const ifcModelCount = useMemo(() => sorted.filter((m) => isIfcModel(m)).length, [sorted])

  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((prev) => (prev && sorted.some((m) => m.id === prev) ? prev : sorted[0].id))
  }, [sorted])

  const selected = useMemo(() => sorted.find((m) => m.id === selectedId) ?? null, [sorted, selectedId])

  const infoKpis = useMemo(() => {
    if (!selectedProject) return []
    if (!selectedRevisionId) {
      return [
        { label: '등록 모델', value: '—', sub: '리비전 선택 후', badge: '대기', badgeVariant: 'neutral' as const },
        { label: 'IFC 모델', value: '—', sub: '—', badge: '—', badgeVariant: 'neutral' as const },
        { label: '객체 수', value: '—', sub: 'IFC 선택 시', badge: '—', badgeVariant: 'neutral' as const },
      ]
    }
    const objShown =
      selected && isIfcModel(selected) && productsUiReady && !productsLoading
        ? productTotal.toLocaleString()
        : '—'
    return [
      { label: '등록 모델', value: models.length, sub: '현재 리비전', badge: 'Models', badgeVariant: 'info' as const },
      { label: 'IFC 모델', value: ifcModelCount, sub: '속성·객체 조회 가능', badge: ifcModelCount ? 'IFC' : '—', badgeVariant: ifcModelCount ? ('success' as const) : ('neutral' as const) },
      {
        label: '객체(전체)',
        value: objShown,
        sub: selected && isIfcModel(selected) ? (selected.title || '').slice(0, 24) : '모델 선택',
        badge: productsLoading ? '…' : 'DB/브라우저',
        badgeVariant: 'neutral' as const,
      },
    ]
  }, [
    selectedProject,
    selectedRevisionId,
    models.length,
    ifcModelCount,
    selected,
    productsUiReady,
    productsLoading,
    productTotal,
  ])

  /** 객체 목록: 서버 DB 캐시 우선, 없으면 브라우저 web-ifc */
  useEffect(() => {
    setProductsError('')
    setProductRows([])
    setProductTotal(0)
    setProductsProgress(null)
    setSelectedExpressId(null)
    setDetailProps(null)
    setProductsUiReady(false)
    setObjectFilter('')

    if (sessionRef.current) {
      sessionRef.current.close()
      sessionRef.current = null
    }

    if (!selected || !isIfcModel(selected)) {
      setProductsLoading(false)
      return
    }

    const fileUrl = getDesignModelFileUrl(selected.id)
    let cancelled = false
    setProductsLoading(true)

    ;(async () => {
      try {
        try {
          const mapRow = (r: {
            expressID: number
            typeName?: string
            name?: string
            globalId?: string
            objectType?: string
          }) => ({
            expressID: Number(r.expressID),
            typeName: String(r.typeName || ''),
            name: String(r.name || ''),
            globalId: String(r.globalId || ''),
            objectType: String(r.objectType || ''),
          })

          const first = await getDesignModelIfcProductsApi(selected.id, {
            offset: 0,
            limit: IFC_PRODUCTS_PAGE_SIZE,
          })
          if (cancelled) return
          if (first.success && first.cached && first.data && Array.isArray(first.data.rows)) {
            let merged = first.data.rows.map(mapRow)
            let total =
              typeof first.data.total === 'number' && Number.isFinite(first.data.total)
                ? first.data.total
                : first.pagination?.total ?? merged.length
            setProductsProgress({ done: merged.length, total })
            setProductRows([...merged])

            if (first.pagination?.hasMore) {
              let offset = first.pagination.nextOffset ?? merged.length
              while (!cancelled) {
                const next = await getDesignModelIfcProductsApi(selected.id, {
                  offset,
                  limit: IFC_PRODUCTS_PAGE_SIZE,
                })
                if (cancelled) return
                if (!next.success || !next.data || !Array.isArray(next.data.rows) || next.data.rows.length === 0) break
                merged = merged.concat(next.data.rows.map(mapRow))
                total =
                  typeof next.data.total === 'number' && Number.isFinite(next.data.total)
                    ? next.data.total
                    : next.pagination?.total ?? total
                setProductRows([...merged])
                setProductsProgress({ done: merged.length, total })
                if (!next.pagination?.hasMore) break
                offset = next.pagination.nextOffset ?? offset + next.data.rows.length
                if (merged.length >= total) break
              }
            }

            setProductRows(merged)
            setProductTotal(total)
            setProductsProgress(null)
            setProductsUiReady(true)
            return
          }
        } catch {
          /* 브라우저 파싱으로 폴백 */
        }
        if (cancelled) return
        const session = await createIfcSession(fileUrl)
        if (cancelled) {
          session.close()
          return
        }
        sessionRef.current = session
        const { rows, total } = await listIfcProductsInSession(session.api, session.modelID, {
          onProgress: (done, tot) => {
            if (!cancelled) setProductsProgress({ done, total: tot })
          },
        })
        if (cancelled) {
          session.close()
          sessionRef.current = null
          return
        }
        setProductRows(rows)
        setProductTotal(total)
        setProductsProgress(null)
        setProductsUiReady(true)
      } catch (e) {
        if (!cancelled) {
          setProductsError(e instanceof Error ? e.message : 'IFC를 열 수 없습니다.')
          setProductsUiReady(false)
        }
      } finally {
        if (!cancelled) setProductsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (sessionRef.current) {
        sessionRef.current.close()
        sessionRef.current = null
      }
    }
  }, [selected?.id, selected?.file_path, selected?.updated_at, selected?.ifc_products_updated_at])

  /** 선택 객체 속성: 목록이 DB여도 web-ifc 세션은 여기서 필요 시 1회 연다 */
  useEffect(() => {
    if (selectedExpressId == null || !selected || !isIfcModel(selected)) {
      setDetailProps(null)
      setDetailLoading(false)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailProps(null)
    const fileUrl = getDesignModelFileUrl(selected.id)
    ;(async () => {
      try {
        let s = sessionRef.current
        if (!s) {
          s = await createIfcSession(fileUrl)
          if (cancelled) {
            s.close()
            return
          }
          sessionRef.current = s
        }
        const p = await getIfcItemProperties(s.api, s.modelID, selectedExpressId)
        if (!cancelled) setDetailProps(p)
      } catch {
        if (!cancelled) setDetailProps(null)
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedExpressId, selected?.id])

  const selectedProduct = useMemo(
    () => (selectedExpressId != null ? productRows.find((r) => r.expressID === selectedExpressId) ?? null : null),
    [productRows, selectedExpressId]
  )

  const filteredProducts = useMemo(() => {
    const q = objectFilter.trim().toLowerCase()
    if (!q) return productRows
    return productRows.filter(
      (r) =>
        String(r.expressID).includes(q) ||
        r.typeName.toLowerCase().includes(q) ||
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.globalId && r.globalId.toLowerCase().includes(q)) ||
        (r.objectType && r.objectType.toLowerCase().includes(q))
    )
  }, [productRows, objectFilter])

  const flatDetailRows = useMemo(() => {
    if (!detailProps) return []
    return flattenIfcProps(detailProps)
  }, [detailProps])

  async function handleRebuildIfc(m: DesignModel) {
    if (!user?.email || !m.file_path || !/\.ifc$/i.test(m.file_path)) return
    setRebuildingId(m.id)
    setError('')
    try {
      await rebuildDesignModelIfcMetaApi(user.email, m.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'IFC 정보 갱신에 실패했습니다.')
    } finally {
      setRebuildingId(null)
    }
  }

  return (
    <DesignMgmtPageShell
      title="모델 정보"
      titleEn="Model information"
      description="등록된 설계 모델 중 .ifc가 있으면 서버에 저장된 객체 목록을 페이지 단위로 불러와 빠르게 표시하고, 캐시가 없을 때만 브라우저에서 IFC를 읽습니다. 선택 객체의 상세 속성은 web-ifc로 표시합니다."
      kpis={infoKpis}
      projectTag={
        selectedProject ? (
          <p className="dm-shell__project-line">
            프로젝트: {selectedProject.name}
            {selectedPhase && selectedRevision ? ` · ${selectedPhase.name} / ${selectedRevision.revision_name}` : ''}
          </p>
        ) : null
      }
      error={error || undefined}
      loading={!!selectedRevisionId && loading && models.length === 0}
      loadingText="모델 정보를 불러오는 중…"
      onRefresh={selectedRevisionId ? () => void load() : undefined}
      refreshDisabled={loading}
    >
      <div className="model-info-page model-info-page--in-shell">
        <div className="model-info-page__meta">
          {!selectedProject && <p className="project-mgmt__hint">왼쪽에서 프로젝트를 선택한 뒤 이용하세요.</p>}
          {selectedProject && !selectedPhaseId && !loadingPhases && (
            <p className="project-mgmt__hint">상단에서 설계 차수를 선택하세요.</p>
          )}
          {selectedProject && selectedPhaseId && !selectedRevisionId && (
            <p className="project-mgmt__hint">상단에서 리비전을 선택하세요.</p>
          )}

          {selectedRevision && (
            <p className="project-mgmt__hint" style={{ marginBottom: '0.35rem' }}>
              <strong>{selectedPhase?.name}</strong> / <strong>{selectedRevision.revision_name}</strong> 기준 · 모델{' '}
              {models.length}건
            </p>
          )}
        </div>

        <div className="model-info-split model-info-split--three model-info-split--fill">
        <div className="model-info-split__list">
          <div className="model-info-split__list-head">등록 모델</div>
          <div className="user-mgmt__table-wrap model-info-split__table-wrap model-info-split__table-wrap--virtual">
            {loading && models.length === 0 ? (
              <p className="user-mgmt__empty" style={{ padding: '1rem' }}>
                불러오는 중…
              </p>
            ) : sorted.length === 0 ? (
              <p className="user-mgmt__empty" style={{ padding: '1rem' }}>
                등록된 모델이 없습니다.
              </p>
            ) : (
              <VirtualDataGrid
                wrapClassName="virtual-data-grid model-info-model-virtual"
                gridTemplateColumns="minmax(0, 1fr) minmax(0, 1.6fr)"
                rowHeight={MODEL_LIST_ROW_HEIGHT}
                scrollResetKey={`${selectedRevisionId ?? ''}|${sorted.length}`}
                getKey={(m) => m.id}
                getRowProps={(m) => ({
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => setSelectedId(m.id),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedId(m.id)
                    }
                  },
                  className: m.id === selectedId ? 'model-info-model-virtual__row--selected' : undefined,
                })}
                header={
                  <>
                    <span>제목</span>
                    <span>파일 / 요약</span>
                  </>
                }
                renderRow={(m) => (
                  <>
                    <span className="model-info-list__title">{m.title}</span>
                    <span className="model-info-model-virtual__cell-file">
                      <span className="model-info-list__fname">{m.file_name || '—'}</span>
                      <span className="model-info-list__ifc-sum">{ifcSummaryLine(m.ifc_meta ?? null)}</span>
                      {!isIfcModel(m) && <span className="model-info-list__badge">IFC 아님</span>}
                    </span>
                  </>
                )}
                items={sorted}
              />
            )}
          </div>
          {selected && (
            <div className="model-info-split__list-foot">
              <div className="model-info-split__list-foot-meta">
                <span>{formatBytes(selected.file_size_bytes)}</span>
                {selected.file_path && (
                  <a className="btn btn--sm btn--secondary" href={getDesignModelFileUrl(selected.id)} target="_blank" rel="noreferrer">
                    파일 열기
                  </a>
                )}
                {canManage && isIfcModel(selected) && (
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    disabled={rebuildingId === selected.id}
                    onClick={() => void handleRebuildIfc(selected)}
                  >
                    {rebuildingId === selected.id ? '서버 갱신 중…' : '서버 IFC 요약·객체 목록 갱신'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="model-info-split__panel model-info-split__objects" aria-label="IFC 객체 목록">
          <div className="model-info-split__list-head">IFC 객체</div>
          <div className="model-info-split__panel-body">
            {!selected && <p className="model-info-objects__hint">모델을 선택하세요.</p>}
            {selected && !isIfcModel(selected) && (
              <p className="model-info-objects__hint">
                이 모델은 .ifc 파일이 없어 객체 목록을 만들 수 없습니다. IFC를 업로드하거나 Trimble에서 IFC가 포함된 버전을 연결하세요.
              </p>
            )}
            {selected && isIfcModel(selected) && productsLoading && (
              <p className="model-info-objects__hint">
                IFC를 불러오는 중…
                {productsProgress ? (
                  <>
                    {' '}
                    ({productsProgress.done.toLocaleString()} / {productsProgress.total.toLocaleString()}건 스캔)
                  </>
                ) : null}
              </p>
            )}
            {selected && isIfcModel(selected) && productsError && (
              <p className="model-info-objects__error" role="alert">
                {productsError}
              </p>
            )}
            {selected && isIfcModel(selected) && !productsLoading && !productsError && productsUiReady && (
              <>
                <div className="model-info-objects__toolbar">
                  <input
                    type="search"
                    className="model-info-objects__filter"
                    placeholder="ElementId, 타입, 이름, Guid 검색…"
                    value={objectFilter}
                    onChange={(e) => setObjectFilter(e.target.value)}
                    aria-label="객체 검색"
                  />
                </div>
                <div className="user-mgmt__table-wrap model-info-objects__table-wrap model-info-objects__table-wrap--virtual">
                  <div className="model-info-objects-virtual">
                    <div className="model-info-objects-virtual-head" role="row">
                      <span>ElementId</span>
                      <span>IFC 타입</span>
                      <span>이름</span>
                      <span>ObjectType</span>
                      <span>Guid</span>
                    </div>
                    {filteredProducts.length === 0 ? (
                      <div className="model-info-objects__virtual-empty user-mgmt__empty">
                        {productRows.length === 0 ? 'IFCPRODUCT 계열 객체가 없습니다.' : '검색 결과가 없습니다.'}
                      </div>
                    ) : (
                      <VirtualList
                        className="model-info-objects-virtual-scroll"
                        items={filteredProducts}
                        rowHeight={IFC_OBJECT_ROW_HEIGHT}
                        overscan={12}
                        scrollResetKey={`${selected?.id ?? ''}|${objectFilter}`}
                        getKey={(r) => r.expressID}
                        renderRow={(r) => {
                          const sel = r.expressID === selectedExpressId
                          return (
                            <div
                              role="button"
                              tabIndex={0}
                              className={
                                sel
                                  ? 'model-info-virtual-row model-info-virtual-row--selected'
                                  : 'model-info-virtual-row'
                              }
                              onClick={() => {
                                setSelectedExpressId(r.expressID)
                                if (!selected?.id) return
                                emitViewerSyncForIfcProductRow(r, {
                                  revisionId: effectiveDesignRevisionIdForSync(selectedRevisionId),
                                  projectId: selectedProject?.id,
                                  designModelId: selected.id,
                                })
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setSelectedExpressId(r.expressID)
                                  if (!selected?.id) return
                                  emitViewerSyncForIfcProductRow(r, {
                                    revisionId: effectiveDesignRevisionIdForSync(selectedRevisionId),
                                    projectId: selectedProject?.id,
                                    designModelId: selected.id,
                                  })
                                }
                              }}
                            >
                              <span className="model-info-prop__mono">{r.expressID}</span>
                              <span title={r.typeName}>{r.typeName}</span>
                              <span title={r.name}>{r.name || '—'}</span>
                              <span title={r.objectType}>{r.objectType || '—'}</span>
                              <span className="model-info-objects__guid" title={r.globalId}>
                                {r.globalId || '—'}
                              </span>
                            </div>
                          )
                        }}
                      />
                    )}
                  </div>
                </div>
                <div className="model-info-objects__foot">
                  <span>
                    COUNT = {filteredProducts.length}
                    {objectFilter.trim() ? ` (전체 ${productTotal.toLocaleString()}건 중 필터)` : ` / 전체 ${productTotal.toLocaleString()}건`}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="model-info-split__props" aria-label="선택 객체 속성">
          <div className="model-info-prop__title">속성</div>
          <div className="model-info-prop__scroll">
            {!selected && <p className="model-info-prop__muted">등록 모델을 선택하세요.</p>}
            {selected && !isIfcModel(selected) && (
              <p className="model-info-prop__muted">IFC 모델을 선택하면 객체 속성을 볼 수 있습니다.</p>
            )}
            {selected && isIfcModel(selected) && selectedExpressId == null && (
              <p className="model-info-prop__muted">중간 목록에서 객체 한 줄을 선택하세요.</p>
            )}
            {selected && isIfcModel(selected) && selectedExpressId != null && (
              <>
                <section className="model-info-prop__section">
                  <h3 className="model-info-prop__section-title">객체 정보</h3>
                  <PropRow label="Guid">{selectedProduct?.globalId || '—'}</PropRow>
                  <PropRow label="ElementId">
                    <span className="model-info-prop__mono">{selectedExpressId}</span>
                  </PropRow>
                  <PropRow label="IFC 타입">{selectedProduct?.typeName || '—'}</PropRow>
                  <PropRow label="이름">{selectedProduct?.name || '—'}</PropRow>
                  <PropRow label="ObjectType">{selectedProduct?.objectType || '—'}</PropRow>
                </section>
                <section className="model-info-prop__section">
                  <h3 className="model-info-prop__section-title">매개변수 (IFC 속성)</h3>
                  {detailLoading && <p className="model-info-prop__muted">속성을 읽는 중…</p>}
                  {!detailLoading && flatDetailRows.length === 0 && (
                    <p className="model-info-prop__muted">표시할 속성이 없습니다.</p>
                  )}
                  {!detailLoading && flatDetailRows.length > 0 && (
                    <VirtualList
                      className="model-info-prop-virtual-list"
                      items={flatDetailRows}
                      rowHeight={IFC_PROP_ROW_HEIGHT}
                      overscan={16}
                      scrollResetKey={selectedExpressId ?? 0}
                      getKey={(row, idx) => `${row.key}-${idx}`}
                      renderRow={(row) => (
                        <PropRow label={row.key}>{row.value || '—'}</PropRow>
                      )}
                    />
                  )}
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
      </div>
    </DesignMgmtPageShell>
  )
}
