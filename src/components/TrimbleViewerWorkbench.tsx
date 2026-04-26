import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type ReactElement,
  type RefObject,
} from 'react'
import type { ModelId, ModelObjects, ObjectProperties, ObjectRuntimeId, WorkspaceAPI } from 'trimble-connect-workspace-api'
import { getCodeMgmtCompositionsApi, type CodeMgmtCompositionRow } from '../api/codeManagement'
import {
  CODE_MGMT_SYSTEMS,
  CODE_MGMT_SYSTEM_LABELS,
  type CodeMgmtSystem,
} from '../lib/code-mgmt-systems'
import {
  buildWbsPropertyTree,
  collectModelObjectIdsForNode,
  findPropertyDisplayValue,
  type WbsTreeNode,
} from '../lib/wbs-property-tree'
import IfcPropertyPanel from './IfcPropertyPanel'
import { getDesignModelIfcProductsApi, getDesignModelsApi } from '../api/designModel'
import { getQuantityRevisionItemsApi, type QuantityRevisionItem } from '../api/quantityFile'
import {
  findGlobalIdInTrimbleObject,
  findIfcElementIdInTrimbleObject,
  flattenTrimblePropertyLines,
  normalizeIfcGuid,
  trimbleObjectDisplayName,
  trimbleRowMatchesExpressId,
} from '../lib/trimble-object-utils'
import {
  effectiveDesignRevisionIdForSync,
  postIfcViewerSync,
  subscribeIfcViewerSync,
  type IfcViewerSyncPayload,
} from '../lib/ifcViewerSync'
import { useProject } from '../contexts/ProjectContext'
import {
  isSpatialOrAssemblyDisplayClass,
  loadObjectListScope,
  saveObjectListScope,
  TRIMBLE_OBJECT_SCOPE_KEY,
  type ObjectListScopeMode,
} from '../lib/ifc-object-list-scope'

const WBS_PANEL_KEY = 'sbim-tc-trimble-wbs-open'
const INFO_PANEL_KEY = 'sbim-tc-trimble-info-open'
const BOTTOM_OBJECTS_KEY = 'sbim-tc-trimble-bottom-objects-open'
const BOTTOM_PANE_KEY = 'sbim-tc-trimble-bottom-pane'

type BottomPane = 'objects' | 'quantity'

function loadBottomPane(): BottomPane {
  try {
    if (sessionStorage.getItem(BOTTOM_PANE_KEY) === 'quantity') return 'quantity'
  } catch {
    /* ignore */
  }
  return 'objects'
}

function loadPanelOpen(key: string, defaultOpen: boolean): boolean {
  try {
    const v = sessionStorage.getItem(key)
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* ignore */
  }
  return defaultOpen
}

type InfoPanelTab = 'IFC' | CodeMgmtSystem

const INFO_TABS: InfoPanelTab[] = ['IFC', ...CODE_MGMT_SYSTEMS]

const INFO_TAB_LABELS: Record<InfoPanelTab, string> = {
  IFC: 'IFC 속성',
  ...CODE_MGMT_SYSTEM_LABELS,
}

type BraceIfcListMeta = {
  expressID: number
  typeName: string
  name: string
  objectType: string
  globalId: string
}

type TrimbleFlatRow = {
  key: string
  modelId: ModelId
  runtimeId: ObjectRuntimeId
  /** IFC ElementId (= STEP express 번호, 모델 정보 열과 동일). 서버 GlobalId 매칭·Trimble 속성에서 추출 */
  ifcElementId: number | null
  /** 서버 IFC 제품 캐시 한 줄(모델 정보 표와 동일). GlobalId로 매칭될 때만 */
  serverIfcMeta: Pick<BraceIfcListMeta, 'typeName' | 'name' | 'objectType' | 'globalId'> | null
  obj: ObjectProperties
  guid: string | null
}

/** 하단 표를 서버 IFC(모델 정보) 기준으로 쓸 때의 한 행 */
type ServerPaneRow = { key: string; meta: BraceIfcListMeta; linked: TrimbleFlatRow | null }

/** 캐시된 row.guid가 비어 있어도 obj 속성에서 GlobalId를 다시 집어 매칭 */
function findTrimbleRowByNormalizedGuid(rows: TrimbleFlatRow[], ng: string): TrimbleFlatRow | null {
  for (const row of rows) {
    const raw = row.guid ?? findGlobalIdInTrimbleObject(row.obj)
    if (raw && normalizeIfcGuid(raw) === ng) return row
  }
  return null
}

/** 모델 정보에서 온 IFC express(ElementId)로 Trimble 행 찾기 — 서버 IFC 캐시의 모델별 express→Guid 우선 */
function findTrimbleRowByIfcExpressId(
  rows: TrimbleFlatRow[],
  expressId: number,
  opts?: {
    designModelId?: string
    expressToNormGuidByModelId?: Map<string, Map<number, string>>
  }
): TrimbleFlatRow | null {
  if (!Number.isFinite(expressId)) return null
  const target = Math.floor(expressId)
  const dm = opts?.designModelId?.trim()
  const byModel = opts?.expressToNormGuidByModelId
  if (dm && byModel?.size) {
    const inner = byModel.get(dm)
    const ng = inner?.get(target)
    if (ng) {
      const hit = findTrimbleRowByNormalizedGuid(rows, ng)
      if (hit) return hit
    }
  }
  for (const row of rows) {
    if (trimbleRowMatchesExpressId(row, target)) return row
  }
  return null
}

function propsPreview(obj: ObjectProperties, maxLen = 100): string {
  const lines = flattenTrimblePropertyLines(obj, 6)
  const s = lines
    .map((l) => {
      const short = l.name.includes('·') ? (l.name.split('·').pop() ?? l.name).trim() : l.name
      return `${short}:${l.value}`
    })
    .join(' · ')
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

function parseObjectPropBatch(): number {
  const raw = import.meta.env.VITE_TRIMBLE_OBJECT_PROP_BATCH
  if (raw == null || raw === '') return 56
  const n = Number(raw)
  return Number.isFinite(n) && n >= 8 && n <= 200 ? Math.floor(n) : 56
}

const ENRICH_PARALLEL_SLICES = 4

/** 하단 객체·물량 테이블·WBS 트리 행(고정 높이) 가상 스크롤 */
const OBJ_LIST_ROW_PX = 32
const QTY_LIST_ROW_PX = 30
const WBS_ROW_PX = 36
const VIRTUAL_OVERSCAN = 16

function useVirtualListWindow(
  itemCount: number,
  rowHeight: number,
  scrollRef: RefObject<HTMLDivElement | null>,
  resetScrollKey: string,
  options?: { resetOnKeyChange?: boolean }
) {
  const resetOnKeyChange = options?.resetOnKeyChange !== false
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    setViewportH(el.clientHeight || 400)
  }, [scrollRef])

  useLayoutEffect(() => {
    if (!resetOnKeyChange) return
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [resetScrollKey, scrollRef, resetOnKeyChange])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [scrollRef, measure, itemCount])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN)
  const end = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportH) / rowHeight) + VIRTUAL_OVERSCAN
  )
  const totalHeight = Math.max(0, itemCount * rowHeight)

  return { start, end, totalHeight, rowHeight }
}

/**
 * getObjects()는 런타임 ID 위주라 GlobalId·IFC 클래스·속성이 비는 경우가 많음.
 * 배치로 getObjectProperties를 호출해 목록·WBS·검색에 쓸 데이터를 채움.
 */
async function enrichModelObjectsWithProperties(
  viewer: NonNullable<WorkspaceAPI['viewer']>,
  blocks: ModelObjects[],
  batchSize: number
): Promise<ModelObjects[]> {
  const out: ModelObjects[] = []
  for (const b of blocks) {
    const objs = b.objects ?? []
    if (objs.length === 0) {
      out.push(b)
      continue
    }
    const merged: ObjectProperties[] = objs.slice()
    for (let i = 0; i < objs.length; i += batchSize * ENRICH_PARALLEL_SLICES) {
      const tasks: Promise<void>[] = []
      for (let g = 0; g < ENRICH_PARALLEL_SLICES; g++) {
        const start = i + g * batchSize
        if (start >= objs.length) break
        const slice = objs.slice(start, start + batchSize)
        tasks.push(
          (async () => {
            const rids = slice.map((o) => o.id)
            try {
              const full = await viewer.getObjectProperties(b.modelId, rids)
              for (let j = 0; j < slice.length; j++) {
                merged[start + j] = full[j] ?? slice[j]
              }
            } catch {
              for (let j = 0; j < slice.length; j++) {
                merged[start + j] = slice[j]
              }
            }
          })()
        )
      }
      await Promise.all(tasks)
    }
    out.push({ ...b, objects: merged })
  }
  return out
}

function renderCompositionRows(
  rows: CodeMgmtCompositionRow[],
  obj: ObjectProperties | null
): ReactNode {
  const ordered = [...rows].sort((a, b) => a.sort_index - b.sort_index)
  if (ordered.length === 0) {
    return <p className="trimble-workbench__muted">코드 관리에서 이 분류체계 구성을 설정하세요.</p>
  }
  if (!obj) {
    return <p className="trimble-workbench__muted">뷰어에서 객체를 선택하면 표시됩니다.</p>
  }
  return (
    <table className="trimble-workbench__prop-table">
      <thead>
        <tr>
          <th>코드</th>
          <th>매개변수</th>
          <th>값</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((r) => (
          <tr key={r.composition_id}>
            <td>{r.code}</td>
            <td title={r.param_key}>{r.param_key}</td>
            <td>{findPropertyDisplayValue(obj, r.param_key)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 펼쳐진 WBS 노드만 깊이 우선 순서로 평탄화 (가상 스크롤용) */
function flattenWbsForVirtual(
  node: WbsTreeNode,
  depth: number,
  expanded: Set<string>,
  out: { node: WbsTreeNode; depth: number }[]
) {
  if (node.level < 0) {
    for (const c of node.children) {
      flattenWbsForVirtual(c, 0, expanded, out)
    }
    return
  }
  out.push({ node, depth })
  const hasKids = node.children.length > 0
  const isOpen = !hasKids || expanded.has(node.id)
  if (hasKids && isOpen) {
    for (const c of node.children) {
      flattenWbsForVirtual(c, depth + 1, expanded, out)
    }
  }
}

function WbsVirtualRow({
  node,
  depth,
  expanded,
  toggle,
  selectedId,
  onSelect,
  wbsLabels,
  labelLevelOffset = 0,
}: {
  node: WbsTreeNode
  depth: number
  expanded: Set<string>
  toggle: (id: string) => void
  selectedId: string | null
  onSelect: (n: WbsTreeNode) => void
  wbsLabels: string[]
  labelLevelOffset?: number
}) {
  const hasKids = node.children.length > 0
  const isOpen = !hasKids || expanded.has(node.id)
  const tier = Math.max(0, node.level - labelLevelOffset)
  const showCodeLabel = !node.suppressWbsLabel && tier < wbsLabels.length
  const codeText = showCodeLabel ? wbsLabels[tier] ?? `단계 ${tier + 1}` : ''
  const pad = 8 + depth * 14
  const titleText =
    codeText && node.segment.trim()
      ? `${codeText}: ${node.segment}`
      : node.segment.trim() || codeText || 'WBS'

  return (
    <div className="trimble-workbench__tree-node trimble-workbench__tree-node--vrow">
      <div
        className={`trimble-workbench__tree-row${selectedId === node.id ? ' trimble-workbench__tree-row--selected' : ''}`}
        style={{ paddingLeft: pad, height: WBS_ROW_PX, boxSizing: 'border-box' }}
      >
        {hasKids ? (
          <button
            type="button"
            className="trimble-workbench__tree-toggle"
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.id)
            }}
          >
            {isOpen ? '▼' : '▶'}
          </button>
        ) : (
          <span className="trimble-workbench__tree-toggle trimble-workbench__tree-toggle--spacer" />
        )}
        <button
          type="button"
          className="trimble-workbench__tree-label"
          onClick={() => onSelect(node)}
          title={titleText}
        >
          {codeText ? <span className="trimble-workbench__tree-code">{codeText}</span> : null}
          {node.segment.trim() ? (
            <span className="trimble-workbench__tree-seg">{node.segment}</span>
          ) : codeText ? null : (
            <span className="trimble-workbench__tree-seg">{'\u00A0'}</span>
          )}
        </button>
      </div>
    </div>
  )
}

export default function TrimbleViewerWorkbench({
  workspace,
  selectionRev,
  onAfterProgrammaticSelect,
  center,
  designRevisionId,
  sceneReloadTick = 0,
}: {
  workspace: WorkspaceAPI | null
  selectionRev: number
  /** WBS에서 setSelection 호출 직후 뷰어 이벤트가 없을 때 패널 동기화용 */
  onAfterProgrammaticSelect?: () => void
  /** Trimble iframe 및 오버레이 */
  center: ReactElement
  /** 있으면 BRACE 물량 행을 GUID로 병합 */
  designRevisionId?: string
  /** 뷰어에서 모델 로드·파일 선택 등으로 씬이 바뀔 때마다 증가 → 객체 목록·WBS 재조회 */
  sceneReloadTick?: number
}) {
  const { selectedProject } = useProject()
  const [compositions, setCompositions] = useState<Partial<Record<CodeMgmtSystem, CodeMgmtCompositionRow[]>>>({})
  const [wbsTree, setWbsTree] = useState<WbsTreeNode | null>(null)
  const [wbsLoading, setWbsLoading] = useState(false)
  const [wbsError, setWbsError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedWbsId, setSelectedWbsId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<InfoPanelTab>('IFC')
  const [selectedObject, setSelectedObject] = useState<ObjectProperties | null>(null)
  /** 모델 정보·서버 IFC와 맞춘 STEP express (선택 객체 기준) */
  const [resolvedIfcExpressId, setResolvedIfcExpressId] = useState<number | null>(null)
  const [trimbleRuntimeIdForPanel, setTrimbleRuntimeIdForPanel] = useState<number | null>(null)
  const [selectionLabel, setSelectionLabel] = useState('')
  const [wbsPanelOpen, setWbsPanelOpen] = useState(() => loadPanelOpen(WBS_PANEL_KEY, true))
  const [infoPanelOpen, setInfoPanelOpen] = useState(() => loadPanelOpen(INFO_PANEL_KEY, true))
  const [bottomObjectsOpen, setBottomObjectsOpen] = useState(() => loadPanelOpen(BOTTOM_OBJECTS_KEY, true))
  const [bottomPane, setBottomPane] = useState<BottomPane>(() => loadBottomPane())
  /** 씬 객체: getObjects 한 번만 호출해 WBS·하단 목록이 공유 (선택 변경마다 재조회하지 않음) */
  const [sceneObjectBlocks, setSceneObjectBlocks] = useState<ModelObjects[]>([])
  const [sceneObjectsLoading, setSceneObjectsLoading] = useState(false)
  const [objectListError, setObjectListError] = useState('')
  const [listFilter, setListFilter] = useState('')
  const [objectListScope, setObjectListScope] = useState<ObjectListScopeMode>(() =>
    loadObjectListScope(TRIMBLE_OBJECT_SCOPE_KEY, 'all')
  )
  const [qtyListFilter, setQtyListFilter] = useState('')
  const [qtyItems, setQtyItems] = useState<QuantityRevisionItem[]>([])
  const [qtyLoading, setQtyLoading] = useState(false)
  const mainRowRef = useRef<HTMLDivElement>(null)
  const objListScrollRef = useRef<HTMLDivElement>(null)
  const qtyListScrollRef = useRef<HTMLDivElement>(null)
  const wbsScrollRef = useRef<HTMLDivElement>(null)

  const objectPropBatch = useMemo(() => parseObjectPropBatch(), [])

  /** 모델 정보와 동일: 서버 IFC 제품 JSON의 GlobalId→expressID 및 total 합(리비전 내 IFC 모델 전부) */
  const [braceExpressByGuid, setBraceExpressByGuid] = useState<Map<string, number>>(() => new Map())
  /** 설계 모델 id → (IFC express → 정규화 GlobalId) — 모델 정보에서 온 ElementId로 뷰어 행 역참조 */
  const [braceExpressToNormGuidByModelId, setBraceExpressToNormGuidByModelId] = useState<
    Map<string, Map<number, string>>
  >(() => new Map())
  /** GlobalId(정규화) → 모델 정보와 동일한 IFC 제품 메타(서버 캐시) */
  const [braceIfcMetaByGuid, setBraceIfcMetaByGuid] = useState<Map<string, BraceIfcListMeta>>(() => new Map())
  /** 리비전 내 모든 IFC의 제품 행(모델 정보 표와 동일 출처·순서: 모델별 API 순) */
  const [braceIfcServerRows, setBraceIfcServerRows] = useState<BraceIfcListMeta[]>([])
  const [braceServerIfcProductTotal, setBraceServerIfcProductTotal] = useState(0)
  const [braceIfcModelCount, setBraceIfcModelCount] = useState(0)
  const [objectPaneHint, setObjectPaneHint] = useState('')

  useEffect(() => {
    if (!objectPaneHint) return
    const t = window.setTimeout(() => setObjectPaneHint(''), 4500)
    return () => window.clearTimeout(t)
  }, [objectPaneHint])

  useEffect(() => {
    const rev = designRevisionId?.trim()
    if (!rev) {
      setBraceExpressByGuid(new Map())
      setBraceExpressToNormGuidByModelId(new Map())
      setBraceIfcMetaByGuid(new Map())
      setBraceIfcServerRows([])
      setBraceServerIfcProductTotal(0)
      setBraceIfcModelCount(0)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const dm = await getDesignModelsApi(rev)
        if (cancelled) return
        if (!dm.success || !dm.models?.length) {
          setBraceExpressByGuid(new Map())
          setBraceExpressToNormGuidByModelId(new Map())
          setBraceIfcMetaByGuid(new Map())
          setBraceIfcServerRows([])
          setBraceServerIfcProductTotal(0)
          setBraceIfcModelCount(0)
          return
        }
        const ifcModels = dm.models.filter((m) => m.file_path && /\.ifc$/i.test(m.file_path))
        const results = await Promise.all(
          ifcModels.map(async (m) => {
            try {
              const pr = await getDesignModelIfcProductsApi(m.id)
              if (!pr.success || !pr.cached || !pr.data) return { modelId: m.id, rows: [], total: 0 }
              const rows = Array.isArray(pr.data.rows) ? pr.data.rows : []
              const total =
                typeof pr.data.total === 'number' && Number.isFinite(pr.data.total)
                  ? pr.data.total
                  : rows.length
              return { modelId: m.id, rows, total: Math.max(0, Math.floor(total)) }
            } catch {
              return { modelId: m.id, rows: [], total: 0 }
            }
          })
        )
        if (cancelled) return
        const map = new Map<string, number>()
        const metaByGuid = new Map<string, BraceIfcListMeta>()
        const expressToGuidByModel = new Map<string, Map<number, string>>()
        const flatServerRows: BraceIfcListMeta[] = []
        let serverSum = 0
        for (const { modelId, rows, total } of results) {
          serverSum += total
          const perModel = new Map<number, string>()
          for (const row of rows) {
            const gid = String(row.globalId ?? '').trim()
            if (!gid) continue
            const ng = normalizeIfcGuid(gid)
            const ex = Number(row.expressID)
            if (!Number.isFinite(ex)) continue
            const exInt = Math.floor(ex)
            map.set(ng, exInt)
            const meta: BraceIfcListMeta = {
              expressID: exInt,
              typeName: String(row.typeName ?? ''),
              name: String(row.name ?? ''),
              objectType: String(row.objectType ?? ''),
              globalId: gid,
            }
            metaByGuid.set(ng, meta)
            flatServerRows.push(meta)
            perModel.set(exInt, ng)
          }
          if (perModel.size > 0) expressToGuidByModel.set(modelId, perModel)
        }
        setBraceExpressByGuid(map)
        setBraceIfcMetaByGuid(metaByGuid)
        setBraceIfcServerRows(flatServerRows)
        setBraceExpressToNormGuidByModelId(expressToGuidByModel)
        setBraceServerIfcProductTotal(serverSum)
        setBraceIfcModelCount(ifcModels.length)
        if (flatServerRows.length > 0) {
          setObjectPaneHint('하단 표는 모델 정보와 동일한 서버 IFC 목록입니다. 행을 클릭하면 씬에 있을 때 3D에서도 선택됩니다.')
        }
      } catch {
        if (!cancelled) {
          setBraceExpressByGuid(new Map())
          setBraceExpressToNormGuidByModelId(new Map())
          setBraceIfcMetaByGuid(new Map())
          setBraceIfcServerRows([])
          setBraceServerIfcProductTotal(0)
          setBraceIfcModelCount(0)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [designRevisionId])

  const objectListRows = useMemo(() => {
    const rows: TrimbleFlatRow[] = []
    for (const b of sceneObjectBlocks) {
      const mid = b.modelId
      for (const o of b.objects ?? []) {
        const guidStr = findGlobalIdInTrimbleObject(o)
        const gNorm = guidStr ? normalizeIfcGuid(guidStr) : ''
        const fromServer = gNorm && braceExpressByGuid.has(gNorm) ? braceExpressByGuid.get(gNorm)! : null
        const meta = gNorm && braceIfcMetaByGuid.has(gNorm) ? braceIfcMetaByGuid.get(gNorm)! : null
        rows.push({
          key: `${String(mid)}-${o.id}`,
          modelId: mid,
          runtimeId: o.id,
          ifcElementId: fromServer ?? findIfcElementIdInTrimbleObject(o),
          serverIfcMeta: meta
            ? {
                typeName: meta.typeName,
                name: meta.name,
                objectType: meta.objectType,
                globalId: meta.globalId,
              }
            : null,
          obj: o,
          guid: guidStr,
        })
      }
    }
    return rows
  }, [sceneObjectBlocks, braceExpressByGuid, braceIfcMetaByGuid])

  /** 서버 목록(모델 정보와 동일)을 쓸 때: GlobalId → Trimble 씬 행 */
  const trimbleByNormGuid = useMemo(() => {
    const m = new Map<string, TrimbleFlatRow>()
    for (const r of objectListRows) {
      const raw = r.guid ?? findGlobalIdInTrimbleObject(r.obj)
      if (!raw) continue
      const ng = normalizeIfcGuid(raw)
      if (!m.has(ng)) m.set(ng, r)
    }
    return m
  }, [objectListRows])

  const useServerPrimaryObjectTable = braceIfcServerRows.length > 0

  const serverPaneRows = useMemo((): ServerPaneRow[] => {
    if (braceIfcServerRows.length === 0) return []
    return braceIfcServerRows.map((meta) => {
      const ng = normalizeIfcGuid(meta.globalId)
      return {
        key: `srv:${ng}`,
        meta,
        linked: trimbleByNormGuid.get(ng) ?? null,
      }
    })
  }, [braceIfcServerRows, trimbleByNormGuid])

  const filteredServerPaneRows = useMemo(() => {
    const q = listFilter.trim().toLowerCase()
    if (!q) return serverPaneRows
    return serverPaneRows.filter(({ meta }) => {
      const hay = [meta.expressID, meta.typeName, meta.name, meta.objectType, meta.globalId]
        .map((x) => String(x).toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [serverPaneRows, listFilter])

  const toggleWbsPanel = useCallback(() => {
    setWbsPanelOpen((o) => {
      const n = !o
      try {
        sessionStorage.setItem(WBS_PANEL_KEY, n ? '1' : '0')
      } catch {
        /* ignore */
      }
      return n
    })
  }, [])

  const toggleInfoPanel = useCallback(() => {
    setInfoPanelOpen((o) => {
      const n = !o
      try {
        sessionStorage.setItem(INFO_PANEL_KEY, n ? '1' : '0')
      } catch {
        /* ignore */
      }
      return n
    })
  }, [])

  const toggleBottomObjectsPanel = useCallback(() => {
    setBottomObjectsOpen((o) => {
      const n = !o
      try {
        sessionStorage.setItem(BOTTOM_OBJECTS_KEY, n ? '1' : '0')
      } catch {
        /* ignore */
      }
      return n
    })
  }, [])

  const setBottomPaneTab = useCallback((p: BottomPane) => {
    setBottomPane(p)
    try {
      sessionStorage.setItem(BOTTOM_PANE_KEY, p)
    } catch {
      /* ignore */
    }
  }, [])

  const reloadSceneObjects = useCallback(async () => {
    const viewer = workspace?.viewer
    if (!viewer) {
      setSceneObjectBlocks([])
      setObjectListError('')
      return
    }
    setSceneObjectsLoading(true)
    setObjectListError('')
    try {
      const models = await viewer.getModels('loaded')
      if (!models.length) {
        setSceneObjectBlocks([])
        setObjectListError('로드된 모델이 없습니다. 뷰어에서 모델을 연 뒤 새로고침하세요.')
        return
      }
      let blocks = (await viewer.getObjects(undefined, undefined)) ?? []
      if (objectListScope === 'spatial') {
        blocks = blocks.map((bl) => {
          const objs = bl.objects ?? []
          const anyClass = objs.some((o) => typeof o.class === 'string' && o.class.trim() !== '')
          if (!anyClass) return bl
          const filtered = objs.filter((o) => isSpatialOrAssemblyDisplayClass(o.class))
          return { ...bl, objects: filtered.length > 0 ? filtered : objs }
        })
      }
      blocks = await enrichModelObjectsWithProperties(viewer, blocks, objectPropBatch)
      setSceneObjectBlocks(blocks)
    } catch (e) {
      setSceneObjectBlocks([])
      setObjectListError(e instanceof Error ? e.message : '객체 목록을 불러오지 못했습니다.')
    } finally {
      setSceneObjectsLoading(false)
    }
  }, [workspace, objectPropBatch, objectListScope])

  useEffect(() => {
    void reloadSceneObjects()
  }, [reloadSceneObjects])

  useEffect(() => {
    if (sceneReloadTick < 1) return
    const id = window.setTimeout(() => void reloadSceneObjects(), 450)
    return () => window.clearTimeout(id)
  }, [sceneReloadTick, reloadSceneObjects])

  /** 메인 행(iframe+패널) 크기 변화 시 뷰어 WebGL 레이아웃이 따라가도록 */
  useEffect(() => {
    const el = mainRowRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [workspace])

  const refreshQtyList = useCallback(() => {
    const id = designRevisionId?.trim()
    if (!id) {
      setQtyItems([])
      return
    }
    setQtyLoading(true)
    getQuantityRevisionItemsApi(id, { limit: 5000, offset: 0 })
      .then((r) => setQtyItems(r.success ? (r.items ?? []) : []))
      .catch(() => setQtyItems([]))
      .finally(() => setQtyLoading(false))
  }, [designRevisionId])

  useEffect(() => {
    void refreshQtyList()
  }, [refreshQtyList])

  const filteredObjectRows = useMemo(() => {
    const q = listFilter.trim().toLowerCase()
    if (!q) return objectListRows
    return objectListRows.filter((r) => {
      const name = trimbleObjectDisplayName(r.obj).toLowerCase()
      const cls = (r.obj.class ?? '').toLowerCase()
      const guid = (r.guid ?? '').toLowerCase()
      const mid = String(r.modelId).toLowerCase()
      const sm = r.serverIfcMeta
      const serverHay = sm
        ? `${sm.typeName} ${sm.name} ${sm.objectType} ${sm.globalId}`.toLowerCase()
        : ''
      return (
        String(r.runtimeId).includes(q) ||
        (r.ifcElementId != null && String(r.ifcElementId).includes(q)) ||
        cls.includes(q) ||
        name.includes(q) ||
        guid.includes(q) ||
        mid.includes(q) ||
        serverHay.includes(q) ||
        propsPreview(r.obj, 500).toLowerCase().includes(q)
      )
    })
  }, [objectListRows, listFilter])

  /** 모델 정보 KPI와 동일 기준: 리비전 내 서버 IFC total 합. 표는 Trimble 씬 행 수 */
  const objectBottomBarTitle = useMemo(() => {
    if (sceneObjectsLoading) return '불러오는 중…'
    const q = listFilter.trim()
    const sceneN = objectListRows.length
    const server = braceServerIfcProductTotal
    const nModels = braceIfcModelCount

    if (useServerPrimaryObjectTable) {
      const tot = braceIfcServerRows.length
      const shown = filteredServerPaneRows.length
      if (!q) {
        return `객체 ${tot.toLocaleString()}건 (모델 정보와 동일·서버 IFC · IFC ${nModels}개) · 뷰어 씬 ${sceneN.toLocaleString()}건`
      }
      return `표시 ${shown.toLocaleString()}건 (검색) / 서버 ${tot.toLocaleString()}건 · 뷰어 씬 ${sceneN.toLocaleString()}건`
    }

    const shown = filteredObjectRows.length

    if (objectListScope === 'spatial') {
      if (server > 0) {
        return `객체 ${shown.toLocaleString()}건 (공간·어셈블리) · 서버 IFC ${server.toLocaleString()}건 · IFC 모델 ${nModels}개`
      }
      return `객체 ${shown.toLocaleString()}건 (공간·어셈블리)`
    }
    if (server > 0) {
      if (!q) {
        if (sceneN === shown && shown === server) {
          return `객체 ${server.toLocaleString()}건 (모델 정보·서버 · IFC ${nModels}개)`
        }
        return `객체 ${server.toLocaleString()}건 (서버) · 뷰어 씬 ${sceneN.toLocaleString()}건 · IFC ${nModels}개`
      }
      return `표시 ${shown.toLocaleString()}건 (검색) · 서버 IFC ${server.toLocaleString()}건`
    }
    return `객체 ${shown.toLocaleString()}건 (Trimble 씬)`
  }, [
    sceneObjectsLoading,
    listFilter,
    objectListScope,
    objectListRows.length,
    filteredObjectRows.length,
    filteredServerPaneRows.length,
    braceServerIfcProductTotal,
    braceIfcModelCount,
    useServerPrimaryObjectTable,
    braceIfcServerRows.length,
  ])

  const objectPaneVirtualCount = useServerPrimaryObjectTable ? filteredServerPaneRows.length : filteredObjectRows.length

  const objListVirtual = useVirtualListWindow(
    bottomPane === 'objects' ? objectPaneVirtualCount : 0,
    OBJ_LIST_ROW_PX,
    objListScrollRef,
    `obj:${listFilter}:${useServerPrimaryObjectTable ? 'srv' : 'tr'}`
  )

  const filteredQtyItems = useMemo(() => {
    const q = qtyListFilter.trim().toLowerCase()
    if (!q) return qtyItems
    return qtyItems.filter((it) => {
      const hay = [
        it.file_title,
        it.dong,
        it.floor,
        it.name,
        it.spec,
        it.result_value,
        it.guid,
        it.formula,
        it.sign,
        it.item_type,
      ]
        .filter((x) => x != null && String(x) !== '')
        .map((x) => String(x).toLowerCase())
      return hay.some((s) => s.includes(q))
    })
  }, [qtyItems, qtyListFilter])

  const qtyListVirtual = useVirtualListWindow(
    bottomPane === 'quantity' ? filteredQtyItems.length : 0,
    QTY_LIST_ROW_PX,
    qtyListScrollRef,
    `qty:${qtyListFilter}`
  )

  const selectObjectInViewer = useCallback(
    async (r: TrimbleFlatRow, opts?: { add?: boolean }) => {
      const viewer = workspace?.viewer
      if (!viewer) return
      const add = opts?.add === true
      try {
        await viewer.setSelection(
          { modelObjectIds: [{ modelId: r.modelId, objectRuntimeIds: [r.runtimeId], recursive: false }] },
          add ? 'add' : 'set'
        )
        onAfterProgrammaticSelect?.()
      } catch {
        /* ignore */
      }
    },
    [workspace, onAfterProgrammaticSelect]
  )

  /** Shift+범위 선택용 앵커(일반 클릭에서만 갱신, Ctrl+클릭은 유지) */
  const objectListAnchorKeyRef = useRef<string | null>(null)

  const applyViewerSelectionForRows = useCallback(
    async (rows: TrimbleFlatRow[], mode: 'set' | 'add') => {
      const viewer = workspace?.viewer
      if (!viewer || rows.length === 0) return
      const byModel = new Map<string, number[]>()
      for (const row of rows) {
        const mid = String(row.modelId)
        const arr = byModel.get(mid) ?? []
        arr.push(row.runtimeId)
        byModel.set(mid, arr)
      }
      const modelObjectIds = Array.from(byModel.entries()).map(([modelId, objectRuntimeIds]) => ({
        modelId: modelId as ModelId,
        objectRuntimeIds,
        recursive: false as const,
      }))
      try {
        await viewer.setSelection({ modelObjectIds }, mode)
        onAfterProgrammaticSelect?.()
      } catch {
        /* ignore */
      }
    },
    [workspace, onAfterProgrammaticSelect]
  )

  const fitViewerToRows = useCallback(
    async (rows: TrimbleFlatRow[]) => {
      const viewer = workspace?.viewer
      if (!viewer || rows.length === 0) return
      const byModel = new Map<string, number[]>()
      for (const row of rows) {
        const mid = String(row.modelId)
        const arr = byModel.get(mid) ?? []
        arr.push(row.runtimeId)
        byModel.set(mid, arr)
      }
      const modelObjectIds = Array.from(byModel.entries()).map(([modelId, objectRuntimeIds]) => ({
        modelId: modelId as ModelId,
        objectRuntimeIds,
        recursive: false as const,
      }))
      try {
        await viewer.setCamera(
          { modelObjectIds },
          {
            animationTime: 500,
          }
        )
      } catch {
        setObjectPaneHint('선택은 되었지만 뷰어 확대를 수행하지 못했습니다.')
      }
    },
    [workspace]
  )

  type TrimbleViewerSyncBundle = {
    workspace: WorkspaceAPI | null
    objectListRows: TrimbleFlatRow[]
    designRevisionId: string
    projectId: string | null
    expressToNormGuidByModelId: Map<string, Map<number, string>>
    selectObjectInViewer: (r: TrimbleFlatRow, opts?: { add?: boolean }) => Promise<void>
    applyViewerSelectionForRows: (rows: TrimbleFlatRow[], mode: 'set' | 'add') => Promise<void>
    reloadSceneObjects: () => Promise<void>
  }
  const trimbleViewerSyncRefs = useRef<TrimbleViewerSyncBundle>({
    workspace: null,
    objectListRows: [],
    designRevisionId: '',
    projectId: null,
    expressToNormGuidByModelId: new Map(),
    selectObjectInViewer: async () => {},
    applyViewerSelectionForRows: async () => {},
    reloadSceneObjects: async () => {},
  })
  trimbleViewerSyncRefs.current = {
    workspace,
    objectListRows,
    designRevisionId: designRevisionId ?? '',
    projectId: selectedProject?.id ?? null,
    expressToNormGuidByModelId: braceExpressToNormGuidByModelId,
    selectObjectInViewer,
    applyViewerSelectionForRows,
    reloadSceneObjects,
  }

  const handleQuantityRowClickTrimble = useCallback(
    async (it: QuantityRevisionItem) => {
      const g = it.guid?.trim()
      if (!g) return
      const ng = normalizeIfcGuid(g)
      const trySelect = async (): Promise<boolean> => {
        const cur = trimbleViewerSyncRefs.current
        const hit = findTrimbleRowByNormalizedGuid(cur.objectListRows, ng)
        if (!hit) return false
        await cur.selectObjectInViewer(hit, { add: false })
        return true
      }
      if (await trySelect()) return
      for (let i = 0; i < 32; i++) {
        await new Promise<void>((r) => setTimeout(r, 120))
        if (i === 3 || i === 10 || i === 18) {
          await trimbleViewerSyncRefs.current.reloadSceneObjects()
          await new Promise<void>((r) => setTimeout(r, 160))
        }
        if (await trySelect()) return
      }
      const rev = effectiveDesignRevisionIdForSync(designRevisionId)
      if (rev) {
        postIfcViewerSync({
          v: 1,
          action: 'selectGlobalId',
          designRevisionId: rev,
          projectId: selectedProject?.id,
          globalId: g,
        })
      }
    },
    [designRevisionId, selectedProject?.id]
  )

  useEffect(() => {
    return subscribeIfcViewerSync((msg: IfcViewerSyncPayload) => {
      void (async () => {
        const r = trimbleViewerSyncRefs.current
        if (!r.workspace?.viewer) return

        const msgRev = msg.designRevisionId.trim()
        if (!msgRev) return
        const vr = (r.designRevisionId || '').trim()
        if (vr && vr !== msgRev) return
        if (msg.projectId && r.projectId && msg.projectId !== r.projectId) return

        if (msg.action === 'highlightFloor') {
          const fl = msg.floor?.trim()
          if (!fl || fl.length < 2) return
          const needle = fl.toLowerCase()
          const pickMatched = () => {
            const cur = trimbleViewerSyncRefs.current
            return cur.objectListRows.filter((row) => {
              const blob = `${trimbleObjectDisplayName(row.obj)} ${propsPreview(row.obj, 1200)}`.toLowerCase()
              return blob.includes(needle)
            })
          }
          let matched = pickMatched()
          if (matched.length > 0 && matched.length <= 120) {
            await r.applyViewerSelectionForRows(matched.slice(0, 80), 'set')
            return
          }
          for (let attempt = 0; attempt < 14; attempt++) {
            if (attempt === 2 || attempt === 7 || attempt === 11) await r.reloadSceneObjects()
            await new Promise<void>((res) => setTimeout(res, 200))
            matched = pickMatched()
            if (matched.length > 0 && matched.length <= 120) {
              await trimbleViewerSyncRefs.current.applyViewerSelectionForRows(matched.slice(0, 80), 'set')
              return
            }
          }
          return
        }

        const guidFromMsg =
          msg.action === 'selectGlobalId' && msg.globalId?.trim()
            ? msg.globalId.trim()
            : msg.action === 'selectExpress' && msg.globalId?.trim()
              ? msg.globalId.trim()
              : null

        if (guidFromMsg) {
          const ng = normalizeIfcGuid(guidFromMsg)
          for (let i = 0; i < 28; i++) {
            const cur = trimbleViewerSyncRefs.current
            const hit = findTrimbleRowByNormalizedGuid(cur.objectListRows, ng)
            if (hit) {
              await cur.selectObjectInViewer(hit, { add: false })
              return
            }
            if (i === 4 || i === 12 || i === 20) {
              await cur.reloadSceneObjects()
              await new Promise<void>((res) => setTimeout(res, 140))
            } else {
              await new Promise<void>((res) => setTimeout(res, i === 0 ? 0 : 90))
            }
          }
          return
        }

        if (msg.action === 'selectExpress' && msg.expressId != null && Number.isFinite(msg.expressId)) {
          const ex = msg.expressId
          const dm = msg.designModelId?.trim()
          for (let i = 0; i < 28; i++) {
            const cur = trimbleViewerSyncRefs.current
            const hit = findTrimbleRowByIfcExpressId(cur.objectListRows, ex, {
              designModelId: dm,
              expressToNormGuidByModelId: cur.expressToNormGuidByModelId,
            })
            if (hit) {
              await cur.selectObjectInViewer(hit, { add: false })
              return
            }
            if (i === 4 || i === 12 || i === 20) {
              await cur.reloadSceneObjects()
              await new Promise<void>((res) => setTimeout(res, 140))
            } else {
              await new Promise<void>((res) => setTimeout(res, i === 0 ? 0 : 90))
            }
          }
        }
      })()
    })
  }, [])

  const handleObjectListRowActivate = useCallback(
    async (r: TrimbleFlatRow, e: Pick<MouseEvent | KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
      if (!workspace?.viewer) return
      const idx = filteredObjectRows.findIndex((row) => row.key === r.key)
      if (idx < 0) return
      const shift = e.shiftKey
      const ctrl = e.ctrlKey || e.metaKey

      if (shift) {
        const ak = objectListAnchorKeyRef.current
        const aIdx = ak != null ? filteredObjectRows.findIndex((row) => row.key === ak) : -1
        if (aIdx < 0) {
          objectListAnchorKeyRef.current = r.key
          await selectObjectInViewer(r, { add: false })
          return
        }
        const lo = Math.min(aIdx, idx)
        const hi = Math.max(aIdx, idx)
        await applyViewerSelectionForRows(filteredObjectRows.slice(lo, hi + 1), 'set')
        return
      }

      if (ctrl) {
        await selectObjectInViewer(r, { add: true })
        return
      }

      objectListAnchorKeyRef.current = r.key
      await selectObjectInViewer(r, { add: false })
    },
    [workspace, filteredObjectRows, selectObjectInViewer, applyViewerSelectionForRows]
  )

  const handleServerPaneRowActivate = useCallback(
    async (pr: ServerPaneRow, e: Pick<MouseEvent | KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
      if (!workspace?.viewer) return
      const idx = filteredServerPaneRows.findIndex((row) => row.key === pr.key)
      if (idx < 0) return
      const shift = e.shiftKey
      const ctrl = e.ctrlKey || e.metaKey

      if (shift) {
        const ak = objectListAnchorKeyRef.current
        const aIdx = ak != null ? filteredServerPaneRows.findIndex((row) => row.key === ak) : -1
        if (aIdx < 0) {
          objectListAnchorKeyRef.current = pr.key
          if (!pr.linked) {
            setObjectPaneHint('이 객체는 뷰어 씬에 없어 3D에서 선택할 수 없습니다.')
            return
          }
          await selectObjectInViewer(pr.linked, { add: false })
          return
        }
        const lo = Math.min(aIdx, idx)
        const hi = Math.max(aIdx, idx)
        const linkedRows = filteredServerPaneRows
          .slice(lo, hi + 1)
          .map((x) => x.linked)
          .filter((x): x is TrimbleFlatRow => x != null)
        if (linkedRows.length === 0) {
          setObjectPaneHint('구간에 뷰어에서 선택 가능한 객체가 없습니다.')
          return
        }
        await applyViewerSelectionForRows(linkedRows, 'set')
        return
      }

      if (ctrl) {
        if (!pr.linked) {
          setObjectPaneHint('이 객체는 뷰어 씬에 없어 선택에 추가할 수 없습니다.')
          return
        }
        await selectObjectInViewer(pr.linked, { add: true })
        return
      }

      objectListAnchorKeyRef.current = pr.key
      if (!pr.linked) {
        setObjectPaneHint('이 객체는 뷰어 씬에 없어 3D에서 선택할 수 없습니다. 표는 모델 정보와 동일한 서버 IFC입니다.')
        return
      }
      await selectObjectInViewer(pr.linked, { add: false })
    },
    [
      workspace,
      filteredServerPaneRows,
      selectObjectInViewer,
      applyViewerSelectionForRows,
    ]
  )

  const [tableSelectionKeys, setTableSelectionKeys] = useState<Set<string>>(() => new Set())
  const tableSelectionKeysBeforePointerRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const viewer = workspace?.viewer
    if (!viewer) {
      setTableSelectionKeys(new Set())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const sel = await viewer.getSelection()
        if (cancelled) return
        const keys = new Set<string>()
        const useSrv = braceIfcServerRows.length > 0
        if (useSrv) {
          for (const s of sel ?? []) {
            const mid = String(s.modelId)
            for (const rid of s.objectRuntimeIds ?? []) {
              const row = objectListRows.find((r) => String(r.modelId) === mid && r.runtimeId === rid)
              const raw = row?.guid ?? (row ? findGlobalIdInTrimbleObject(row.obj) : null)
              if (raw) keys.add(`srv:${normalizeIfcGuid(raw)}`)
            }
          }
        } else {
          for (const s of sel ?? []) {
            const mid = String(s.modelId)
            for (const rid of s.objectRuntimeIds ?? []) {
              keys.add(`${mid}-${rid}`)
            }
          }
        }
        setTableSelectionKeys(keys)
      } catch {
        if (!cancelled) setTableSelectionKeys(new Set())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspace, selectionRev, objectListRows, braceIfcServerRows.length])

  const rowsForTableSelectionKeys = useCallback(
    (keys: Set<string>): TrimbleFlatRow[] => {
      if (keys.size === 0) return []
      if (useServerPrimaryObjectTable) {
        return filteredServerPaneRows
          .filter((row) => keys.has(row.key))
          .map((row) => row.linked)
          .filter((row): row is TrimbleFlatRow => row != null)
      }
      return filteredObjectRows.filter((row) => keys.has(row.key))
    },
    [filteredObjectRows, filteredServerPaneRows, useServerPrimaryObjectTable]
  )

  const handleObjectListRowDoubleClick = useCallback(
    async (r: TrimbleFlatRow) => {
      if (!workspace?.viewer) return
      const before = tableSelectionKeysBeforePointerRef.current
      const rows =
        before.size > 1 && before.has(r.key)
          ? rowsForTableSelectionKeys(before)
          : [r]
      if (rows.length === 0) return
      await applyViewerSelectionForRows(rows, 'set')
      await fitViewerToRows(rows)
      setObjectPaneHint(
        rows.length > 1
          ? `선택된 부재 ${rows.length.toLocaleString()}개가 화면에 들어오도록 확대했습니다.`
          : '선택한 부재가 화면에 들어오도록 확대했습니다.'
      )
    },
    [workspace, rowsForTableSelectionKeys, applyViewerSelectionForRows, fitViewerToRows]
  )

  const handleServerPaneRowDoubleClick = useCallback(
    async (pr: ServerPaneRow) => {
      if (!workspace?.viewer) return
      const before = tableSelectionKeysBeforePointerRef.current
      const rows =
        before.size > 1 && before.has(pr.key)
          ? rowsForTableSelectionKeys(before)
          : pr.linked
            ? [pr.linked]
            : []
      if (rows.length === 0) {
        setObjectPaneHint('이 객체는 뷰어 씬에 없어 확대할 수 없습니다.')
        return
      }
      await applyViewerSelectionForRows(rows, 'set')
      await fitViewerToRows(rows)
      setObjectPaneHint(
        rows.length > 1
          ? `선택된 부재 ${rows.length.toLocaleString()}개가 화면에 들어오도록 확대했습니다.`
          : '선택한 부재가 화면에 들어오도록 확대했습니다.'
      )
    },
    [workspace, rowsForTableSelectionKeys, applyViewerSelectionForRows, fitViewerToRows]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next: Partial<Record<CodeMgmtSystem, CodeMgmtCompositionRow[]>> = {}
      for (const sys of CODE_MGMT_SYSTEMS) {
        try {
          const res = await getCodeMgmtCompositionsApi(sys)
          if (res.success && res.items) next[sys] = res.items
        } catch {
          /* 한 체계 실패 시 나머지는 계속 */
        }
      }
      if (!cancelled) setCompositions(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const wbsRows = compositions.WBS ?? []
  const wbsLabels = useMemo(() => {
    const ordered = [...wbsRows].sort((a, b) => a.sort_index - b.sort_index)
    return ordered.map((r) => r.code || r.param_key)
  }, [wbsRows])

  const wbsLabelOffset = useMemo(() => {
    if (!wbsTree || wbsTree.children.length !== 1) return 0
    const c = wbsTree.children[0]
    return c.suppressWbsLabel === true && c.segment === '모두' ? 1 : 0
  }, [wbsTree])

  useEffect(() => {
    if (!workspace?.viewer || wbsRows.length === 0) {
      setWbsTree(null)
      setWbsError('')
      return
    }
    if (sceneObjectsLoading) return
    if (sceneObjectBlocks.length === 0) {
      setWbsTree(null)
      return
    }
    setWbsLoading(true)
    setWbsError('')
    try {
      const tree = buildWbsPropertyTree(sceneObjectBlocks, wbsRows)
      setWbsTree(tree)
      const ex = new Set<string>()
      ex.add(tree.id)
      for (const c of tree.children) ex.add(c.id)
      for (const c of tree.children) {
        for (const g of c.children) ex.add(g.id)
      }
      setExpanded(ex)
      setSelectedWbsId(null)
    } catch (e) {
      setWbsTree(null)
      setWbsError(e instanceof Error ? e.message : 'WBS 트리를 만들 수 없습니다.')
    } finally {
      setWbsLoading(false)
    }
  }, [workspace, wbsRows, sceneObjectBlocks, sceneObjectsLoading])

  useEffect(() => {
    const viewer = workspace?.viewer
    if (!viewer) {
      setSelectedObject(null)
      setResolvedIfcExpressId(null)
      setTrimbleRuntimeIdForPanel(null)
      setSelectionLabel('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const sel = await viewer.getSelection()
        if (cancelled) return
        if (!sel?.length) {
          setSelectedObject(null)
          setResolvedIfcExpressId(null)
          setTrimbleRuntimeIdForPanel(null)
          setSelectionLabel('')
          return
        }
        const first = sel.find((s) => (s.objectRuntimeIds?.length ?? 0) > 0)
        if (!first?.modelId || !first.objectRuntimeIds?.length) {
          setSelectedObject(null)
          setResolvedIfcExpressId(null)
          setTrimbleRuntimeIdForPanel(null)
          setSelectionLabel('')
          return
        }
        const n = sel.reduce((acc, s) => acc + (s.objectRuntimeIds?.length ?? 0), 0)
        setSelectionLabel(n > 1 ? `${n}개 객체 선택` : '1개 객체 선택')
        const rid = first.objectRuntimeIds[0]
        const mid = first.modelId
        setTrimbleRuntimeIdForPanel(typeof rid === 'number' ? rid : Number(rid))
        const props = await viewer.getObjectProperties(mid, [rid])
        if (cancelled) return
        const p0 = props[0] ?? null
        setSelectedObject(p0)

        const row = objectListRows.find((r) => String(r.modelId) === String(mid) && r.runtimeId === rid)
        let ex = row?.ifcElementId ?? null
        if (ex == null && p0) {
          const gid = findGlobalIdInTrimbleObject(p0)
          if (gid) {
            const ng = normalizeIfcGuid(gid)
            if (braceExpressByGuid.has(ng)) ex = braceExpressByGuid.get(ng)!
          }
          if (ex == null) ex = findIfcElementIdInTrimbleObject(p0)
        }
        if (!cancelled) setResolvedIfcExpressId(ex != null && Number.isFinite(ex) ? Math.floor(ex) : null)
      } catch {
        if (!cancelled) {
          setSelectedObject(null)
          setResolvedIfcExpressId(null)
          setTrimbleRuntimeIdForPanel(null)
          setSelectionLabel('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspace, selectionRev, objectListRows, braceExpressByGuid])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onSelectWbsNode = useCallback(
    async (node: WbsTreeNode) => {
      const viewer = workspace?.viewer
      if (!viewer) return
      setSelectedWbsId(node.id)
      const parts = collectModelObjectIdsForNode(node).filter((p) => p.objectRuntimeIds.length > 0)
      if (parts.length === 0) return
      try {
        await viewer.setSelection({ modelObjectIds: parts.map((p) => ({ ...p, recursive: false })) }, 'set')
        onAfterProgrammaticSelect?.()
      } catch {
        /* 선택 실패는 무시 */
      }
    },
    [workspace, onAfterProgrammaticSelect]
  )

  const onSelectRoot = useCallback(async () => {
    if (!wbsTree) return
    await onSelectWbsNode(wbsTree)
    setSelectedWbsId(wbsTree.id)
  }, [wbsTree, onSelectWbsNode])

  const wbsFlatRows = useMemo(() => {
    const o: { node: WbsTreeNode; depth: number }[] = []
    if (wbsTree) flattenWbsForVirtual(wbsTree, 0, expanded, o)
    return o
  }, [wbsTree, expanded])

  const wbsVirtual = useVirtualListWindow(
    wbsFlatRows.length,
    WBS_ROW_PX,
    wbsScrollRef,
    wbsTree?.id ?? 'none'
  )

  const wbsInner = !workspace ? (
    <>
      <h3 className="trimble-workbench__title">WBS</h3>
      <p className="trimble-workbench__muted">뷰어 연결 후 사용할 수 있습니다.</p>
    </>
  ) : (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div className="trimble-workbench__wbs-head">
          <h3 className="trimble-workbench__title">WBS (코드 관리)</h3>
          <button type="button" className="trimble-workbench__btn" onClick={() => void reloadSceneObjects()} disabled={wbsLoading || sceneObjectsLoading}>
            {wbsLoading || sceneObjectsLoading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
        {wbsError && <p className="trimble-workbench__err">{wbsError}</p>}
        {wbsRows.length === 0 && (
          <p className="trimble-workbench__muted">코드 관리에서 작업분류체계(WBS) 구성을 추가하세요.</p>
        )}
      </div>
      {wbsRows.length > 0 && wbsTree && (
        <div
          className="trimble-workbench__wbs-tree-wrap"
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          <button
            type="button"
            className={`trimble-workbench__root-btn${selectedWbsId === wbsTree.id ? ' trimble-workbench__root-btn--selected' : ''}`}
            onClick={() => void onSelectRoot()}
            style={{ flexShrink: 0 }}
          >
            전체 선택
          </button>
          <div ref={wbsScrollRef} className="trimble-workbench__wbs-tree-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div style={{ height: Math.max(wbsVirtual.totalHeight, 1), position: 'relative' }}>
              <div
                className="trimble-workbench__tree trimble-workbench__tree--virtual"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: wbsVirtual.start * wbsVirtual.rowHeight,
                }}
              >
                {wbsFlatRows.slice(wbsVirtual.start, wbsVirtual.end).map(({ node, depth }) => (
                  <WbsVirtualRow
                    key={node.id}
                    node={node}
                    depth={depth}
                    expanded={expanded}
                    toggle={toggle}
                    selectedId={selectedWbsId}
                    onSelect={(n) => void onSelectWbsNode(n)}
                    wbsLabels={wbsLabels}
                    labelLevelOffset={wbsLabelOffset}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const infoInner = !workspace ? (
    <>
      <h3 className="trimble-workbench__title">모델 정보</h3>
      <p className="trimble-workbench__muted">뷰어 연결 후 사용할 수 있습니다.</p>
    </>
  ) : (
    <>
      <h3 className="trimble-workbench__title">모델 정보</h3>
      {selectionLabel && <p className="trimble-workbench__sel-hint">{selectionLabel}</p>}
      <div className="trimble-workbench__tabs trimble-workbench__tabs--wrap" role="tablist">
        {INFO_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`trimble-workbench__tab${activeTab === tab ? ' trimble-workbench__tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'IFC' ? 'IFC' : tab}
          </button>
        ))}
      </div>
      <p className="trimble-workbench__tab-desc">{INFO_TAB_LABELS[activeTab]}</p>
      {activeTab === 'IFC' ? (
        <IfcPropertyPanel
          obj={selectedObject}
          resolvedIfcExpressId={resolvedIfcExpressId}
          trimbleRuntimeId={trimbleRuntimeIdForPanel}
        />
      ) : (
        renderCompositionRows(compositions[activeTab] ?? [], selectedObject)
      )}
    </>
  )

  return (
    <div className="trimble-workbench">
      <div ref={mainRowRef} className="trimble-workbench__main-row">
        <aside
          className={`trimble-workbench__wbs trimble-workbench__panel${!wbsPanelOpen ? ' trimble-workbench__panel--collapsed' : ''}`}
          aria-label="WBS 패널"
        >
          <button
            type="button"
            className="trimble-workbench__panel-fold trimble-workbench__panel-fold--start"
            onClick={toggleWbsPanel}
            title={wbsPanelOpen ? 'WBS 패널 접기' : 'WBS 패널 펼치기'}
            aria-expanded={wbsPanelOpen}
          >
            {wbsPanelOpen ? '◀' : 'WBS ▶'}
          </button>
          {wbsPanelOpen && (
            <div className={`trimble-workbench__panel-scroll${workspace ? ' trimble-workbench__panel-scroll--wbs' : ''}`}>
              {wbsInner}
            </div>
          )}
        </aside>
        <div className="trimble-workbench__iframe-wrap">{center}</div>
        <aside
          className={`trimble-workbench__info trimble-workbench__panel${!infoPanelOpen ? ' trimble-workbench__panel--collapsed' : ''}`}
          aria-label="모델 정보 패널"
        >
          <button
            type="button"
            className="trimble-workbench__panel-fold trimble-workbench__panel-fold--end"
            onClick={toggleInfoPanel}
            title={infoPanelOpen ? '모델 정보 패널 접기' : '모델 정보 패널 펼치기'}
            aria-expanded={infoPanelOpen}
          >
            {infoPanelOpen ? '▶' : '◀ 정보'}
          </button>
          {infoPanelOpen && <div className="trimble-workbench__panel-scroll">{infoInner}</div>}
        </aside>
      </div>

      <section
        className={`trimble-workbench__bottom${!bottomObjectsOpen ? ' trimble-workbench__bottom--collapsed' : ''}`}
        aria-label="하단 패널"
      >
        <div className="trimble-workbench__bottom-bar">
          <button
            type="button"
            className="trimble-workbench__bottom-fold"
            onClick={toggleBottomObjectsPanel}
            title={bottomObjectsOpen ? '하단 패널 접기' : '하단 패널 펼치기'}
            aria-expanded={bottomObjectsOpen}
          >
            {bottomObjectsOpen ? '▼' : '▲'} 하단 패널
          </button>
          {bottomObjectsOpen && (
            <>
              <div className="trimble-workbench__bottom-tabs" role="tablist" aria-label="하단 패널 구분">
                <button
                  type="button"
                  role="tab"
                  aria-selected={bottomPane === 'objects'}
                  className={`trimble-workbench__bottom-tab${bottomPane === 'objects' ? ' trimble-workbench__bottom-tab--active' : ''}`}
                  onClick={() => setBottomPaneTab('objects')}
                >
                  객체 정보
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bottomPane === 'quantity'}
                  className={`trimble-workbench__bottom-tab${bottomPane === 'quantity' ? ' trimble-workbench__bottom-tab--active' : ''}`}
                  onClick={() => setBottomPaneTab('quantity')}
                >
                  물량 목록
                </button>
              </div>
              {bottomPane === 'objects' && braceIfcServerRows.length === 0 && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.75rem',
                    color: 'var(--main-text-muted, #9ca3af)',
                    whiteSpace: 'nowrap',
                    marginRight: 6,
                  }}
                  title="클래스 정보가 있을 때만: 층·공간·어셈블리 등만 속성 조회해 목록이 빨라집니다."
                >
                  <input
                    type="checkbox"
                    checked={objectListScope === 'spatial'}
                    onChange={(e) => {
                      const m: ObjectListScopeMode = e.target.checked ? 'spatial' : 'all'
                      setObjectListScope(m)
                      saveObjectListScope(TRIMBLE_OBJECT_SCOPE_KEY, m)
                    }}
                  />
                  공간·어셈블리만
                </label>
              )}
              <h3 className="trimble-workbench__bottom-bar-title">
                {bottomPane === 'objects' ? (
                  <>{objectBottomBarTitle}</>
                ) : qtyLoading ? (
                  '물량 불러오는 중…'
                ) : (
                  `물량 ${filteredQtyItems.length.toLocaleString()}건`
                )}
              </h3>
              <input
                type="search"
                className="trimble-workbench__bottom-filter"
                placeholder={
                  bottomPane === 'objects'
                    ? useServerPrimaryObjectTable
                      ? 'ElementId·IFC 타입·이름·ObjectType·Guid 검색…'
                      : 'ElementId·IFC 타입·이름·ObjectType·Guid·속성 검색…'
                    : '파일·동·층·항목·규격·값·GUID 검색…'
                }
                value={bottomPane === 'objects' ? listFilter : qtyListFilter}
                onChange={(e) =>
                  bottomPane === 'objects' ? setListFilter(e.target.value) : setQtyListFilter(e.target.value)
                }
                aria-label={bottomPane === 'objects' ? '객체 목록 필터' : '물량 목록 필터'}
              />
              <button
                type="button"
                className="trimble-workbench__btn"
                onClick={() =>
                  bottomPane === 'objects' ? void reloadSceneObjects() : void refreshQtyList()
                }
                disabled={
                  bottomPane === 'objects' ? sceneObjectsLoading || !workspace : qtyLoading || !designRevisionId?.trim()
                }
              >
                {bottomPane === 'objects' ? '목록 새로고침' : '물량 새로고침'}
              </button>
              {bottomPane === 'objects' && (
                <span className="trimble-workbench__muted" style={{ fontSize: '0.75rem', marginLeft: '0.35rem' }}>
                  클릭: 한 건 · Ctrl+클릭: 추가 · Shift+클릭: 앵커~현재 행 구간
                </span>
              )}
            </>
          )}
        </div>
        {bottomObjectsOpen && (
          <div className="trimble-workbench__bottom-body">
            {bottomPane === 'objects' ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {objectListError && (
                  <p className="trimble-workbench__err" style={{ margin: '0.25rem 0.5rem', flexShrink: 0 }}>
                    {objectListError}
                  </p>
                )}
                {objectPaneHint && (
                  <p
                    className="trimble-workbench__muted"
                    style={{
                      margin: '0.2rem 0.5rem',
                      flexShrink: 0,
                      fontSize: '0.78rem',
                      lineHeight: 1.45,
                      padding: '0.25rem 0.4rem',
                      borderRadius: 6,
                      background: 'var(--main-surface-2, rgba(255,255,255,0.04))',
                    }}
                  >
                    {objectPaneHint}
                  </p>
                )}
                <div
                  className="trimble-workbench__bottom-virtual-wrap"
                  style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
                >
                  <table
                    className="trimble-workbench__prop-table trimble-workbench__obj-table trimble-workbench__obj-table--list trimble-workbench__obj-table--header-only"
                    style={{ width: '100%', tableLayout: 'fixed', flexShrink: 0 }}
                  >
                    <colgroup>
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '39%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th title="모델 정보 화면과 동일: IFC STEP express">ElementId</th>
                        <th
                          title={
                            useServerPrimaryObjectTable
                              ? '모델 정보와 동일한 서버 IFC 타입명'
                              : '서버 IFC 캐시와 동일한 타입명(매칭 시). 없으면 뷰어 IFC 클래스'
                          }
                        >
                          IFC 타입
                        </th>
                        <th
                          title={
                            useServerPrimaryObjectTable
                              ? '모델 정보와 동일한 서버 IFC 제품 이름'
                              : '서버 IFC 제품 이름(매칭 시). 없으면 뷰어 표시 이름'
                          }
                        >
                          이름
                        </th>
                        <th
                          title={
                            useServerPrimaryObjectTable
                              ? '모델 정보와 동일한 서버 IFC ObjectType'
                              : '서버 IFC ObjectType(매칭 시). 없으면 뷰어 객체 유형'
                          }
                        >
                          ObjectType
                        </th>
                        <th
                          title={
                            useServerPrimaryObjectTable
                              ? '모델 정보와 동일한 서버 IFC GlobalId'
                              : '서버 GlobalId(매칭 시). 없으면 뷰어에서 읽은 Guid'
                          }
                        >
                          Guid
                        </th>
                      </tr>
                    </thead>
                  </table>
                  <div ref={objListScrollRef} className="trimble-workbench__bottom-scroll trimble-workbench__bottom-scroll--virtual">
                    <div
                      style={{
                        height: Math.max(objListVirtual.totalHeight, 1),
                        position: 'relative',
                        boxSizing: 'border-box',
                      }}
                    >
                      <table
                        className="trimble-workbench__prop-table trimble-workbench__obj-table trimble-workbench__obj-table--list"
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: objListVirtual.start * objListVirtual.rowHeight,
                          width: '100%',
                          tableLayout: 'fixed',
                        }}
                      >
                        <colgroup>
                          <col style={{ width: '9%' }} />
                          <col style={{ width: '16%' }} />
                          <col style={{ width: '20%' }} />
                          <col style={{ width: '16%' }} />
                          <col style={{ width: '39%' }} />
                        </colgroup>
                        <tbody>
                          {useServerPrimaryObjectTable
                            ? filteredServerPaneRows.slice(objListVirtual.start, objListVirtual.end).map((pr) => {
                                const m = pr.meta
                                const tn = m.typeName.trim() || '—'
                                const nm = m.name.trim() || '—'
                                const ot = m.objectType.trim() || '—'
                                const gid = m.globalId.trim() || '—'
                                return (
                                  <tr
                                    key={pr.key}
                                    className={`trimble-workbench__obj-table-row${
                                      tableSelectionKeys.has(pr.key) ? ' trimble-workbench__obj-row--active' : ''
                                    }`}
                                    style={{ height: OBJ_LIST_ROW_PX }}
                                    onMouseDown={() => {
                                      tableSelectionKeysBeforePointerRef.current = new Set(tableSelectionKeys)
                                    }}
                                    onClick={(e) => void handleServerPaneRowActivate(pr, e)}
                                    onDoubleClick={() => void handleServerPaneRowDoubleClick(pr)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        void handleServerPaneRowActivate(pr, e)
                                      }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    title={
                                      pr.linked
                                        ? '클릭: 선택. 더블클릭: 선택 부재 확대. 여러 부재가 선택된 상태에서 더블클릭하면 선택 묶음 전체를 확대합니다.'
                                        : '뷰어 씬에 없는 행입니다. 표는 모델 정보와 동일한 서버 IFC입니다. 클릭 시 안내만 표시됩니다.'
                                    }
                                  >
                                    <td className="model-info-prop__mono" title={`IFC ElementId(STEP) · 서버 IFC`}>
                                      {String(m.expressID)}
                                    </td>
                                    <td>{tn}</td>
                                    <td>{nm}</td>
                                    <td>{ot}</td>
                                    <td className="model-info-objects__guid" title={gid}>
                                      {gid}
                                    </td>
                                  </tr>
                                )
                              })
                            : filteredObjectRows.slice(objListVirtual.start, objListVirtual.end).map((r) => {
                                const sm = r.serverIfcMeta
                                const ifcType = (sm?.typeName && sm.typeName.trim()) || r.obj.class || '—'
                                const dispName =
                                  (sm?.name && sm.name.trim()) || trimbleObjectDisplayName(r.obj) || '—'
                                const objType =
                                  (sm?.objectType && sm.objectType.trim()) || r.obj.product?.objectType || '—'
                                const guidCell = (sm?.globalId && sm.globalId.trim()) || r.guid || '—'
                                return (
                                  <tr
                                    key={r.key}
                                    className={`trimble-workbench__obj-table-row${
                                      tableSelectionKeys.has(r.key) ? ' trimble-workbench__obj-row--active' : ''
                                    }`}
                                    style={{ height: OBJ_LIST_ROW_PX }}
                                    onMouseDown={() => {
                                      tableSelectionKeysBeforePointerRef.current = new Set(tableSelectionKeys)
                                    }}
                                    onClick={(e) => void handleObjectListRowActivate(r, e)}
                                    onDoubleClick={() => void handleObjectListRowDoubleClick(r)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        void handleObjectListRowActivate(r, e)
                                      }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    title="클릭: 선택. 더블클릭: 선택 부재 확대. 여러 부재가 선택된 상태에서 더블클릭하면 선택 묶음 전체를 확대합니다."
                                  >
                                    <td
                                      className="model-info-prop__mono"
                                      title={
                                        r.ifcElementId != null
                                          ? `IFC ElementId(STEP) · 뷰어 런타임 ID: ${String(r.runtimeId)}`
                                          : `IFC ElementId 미확인 — Trimble 런타임 ID: ${String(r.runtimeId)}`
                                      }
                                    >
                                      {r.ifcElementId != null ? String(r.ifcElementId) : '—'}
                                    </td>
                                    <td title={!sm ? '서버 IFC와 GlobalId가 맞지 않아 뷰어 클래스만 표시' : undefined}>
                                      {ifcType}
                                    </td>
                                    <td>{dispName}</td>
                                    <td>{objType}</td>
                                    <td className="model-info-objects__guid" title={guidCell}>
                                      {guidCell}
                                    </td>
                                  </tr>
                                )
                              })}
                        </tbody>
                      </table>
                    </div>
                    {!sceneObjectsLoading &&
                      (useServerPrimaryObjectTable
                        ? filteredServerPaneRows.length === 0
                        : filteredObjectRows.length === 0) &&
                      !objectListError && (
                        <p className="trimble-workbench__muted" style={{ margin: '0.35rem 0.5rem' }}>
                          표시할 객체가 없습니다.
                        </p>
                      )}
                  </div>
                  {!sceneObjectsLoading && (
                    <div
                      className="trimble-workbench__muted"
                      style={{
                        fontSize: '0.7rem',
                        padding: '4px 8px 6px',
                        flexShrink: 0,
                        borderTop: '1px solid var(--main-border)',
                        lineHeight: 1.45,
                      }}
                    >
                      {braceServerIfcProductTotal > 0 ? (
                        useServerPrimaryObjectTable ? (
                          <>
                            하단 표는 모델 정보와 동일 출처의 서버 IFC 제품 행{' '}
                            <strong>{braceIfcServerRows.length.toLocaleString()}</strong>건입니다. GlobalId로 뷰어 씬과
                            맞는 행은 <strong>{serverPaneRows.filter((x) => x.linked).length.toLocaleString()}</strong>건
                            (3D 선택 가능). Trimble 씬 객체 <strong>{objectListRows.length.toLocaleString()}</strong>건.
                            {listFilter.trim() ? ' 검색 적용 중.' : ''}
                          </>
                        ) : (
                          <>
                            집계(모델 정보와 동일·서버 IFC): <strong>{braceServerIfcProductTotal.toLocaleString()}</strong>건
                            {braceIfcModelCount > 0 ? ` · 등록 IFC 모델 ${braceIfcModelCount}개` : ''}. 표 열은 모델 정보와
                            동일하며, GlobalId가 맞는 행은 서버 캐시 값으로 채워집니다. Trimble 씬{' '}
                            <strong>{objectListRows.length.toLocaleString()}</strong>건 중 표시{' '}
                            <strong>{filteredObjectRows.length.toLocaleString()}</strong>건
                            {listFilter.trim() ? ' (검색 적용)' : ''}.
                          </>
                        )
                      ) : (
                        <>
                          서버 IFC 메타가 없어 모델 정보와 건수를 맞출 수 없습니다. 모델 정보에서「서버 IFC 요약·객체 목록
                          갱신」후 새로고침하세요. 표: Trimble <strong>{filteredObjectRows.length.toLocaleString()}</strong>건.
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  padding: '0.35rem 0.45rem 0.5rem',
                }}
              >
                {!designRevisionId?.trim() ? (
                  <p className="trimble-workbench__muted" style={{ margin: '0.35rem 0.5rem', fontSize: '0.8rem' }}>
                    설계 리비전 ID가 없으면 물량을 불러올 수 없습니다. URL에 <code>designRevisionId</code>를 넣거나 물량·모델
                    화면에서 뷰어를 여세요.
                  </p>
                ) : (
                  <>
                    <div
                      className="trimble-workbench__bottom-virtual-wrap"
                      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
                    >
                      <table
                        className="trimble-workbench__prop-table trimble-workbench__obj-table trimble-workbench__obj-table--header-only"
                        style={{ width: '100%', tableLayout: 'fixed', flexShrink: 0 }}
                      >
                        <colgroup>
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '6%' }} />
                          <col style={{ width: '6%' }} />
                          <col style={{ width: '18%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '18%' }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>물량 파일</th>
                            <th>동</th>
                            <th>층</th>
                            <th>항목</th>
                            <th>규격</th>
                            <th>값</th>
                            <th>부호</th>
                            <th>GUID</th>
                          </tr>
                        </thead>
                      </table>
                      <div ref={qtyListScrollRef} className="trimble-workbench__bottom-scroll trimble-workbench__bottom-scroll--virtual">
                        <div
                          style={{
                            height: Math.max(qtyListVirtual.totalHeight, 1),
                            position: 'relative',
                            boxSizing: 'border-box',
                          }}
                        >
                          <table
                            className="trimble-workbench__prop-table trimble-workbench__obj-table"
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: qtyListVirtual.start * qtyListVirtual.rowHeight,
                              width: '100%',
                              tableLayout: 'fixed',
                            }}
                          >
                            <colgroup>
                              <col style={{ width: '14%' }} />
                              <col style={{ width: '6%' }} />
                              <col style={{ width: '6%' }} />
                              <col style={{ width: '18%' }} />
                              <col style={{ width: '14%' }} />
                              <col style={{ width: '10%' }} />
                              <col style={{ width: '14%' }} />
                              <col style={{ width: '18%' }} />
                            </colgroup>
                            <tbody>
                              {filteredQtyItems.slice(qtyListVirtual.start, qtyListVirtual.end).map((it) => (
                                <tr
                                  key={it.id}
                                  style={{
                                    height: QTY_LIST_ROW_PX,
                                    cursor: it.guid?.trim() ? 'pointer' : undefined,
                                  }}
                                  title={it.guid?.trim() ? '클릭하여 뷰어에서 동일 GUID 객체 선택' : undefined}
                                  onClick={() => void handleQuantityRowClickTrimble(it)}
                                >
                                  <td>{it.file_title}</td>
                                  <td>{it.dong ?? '—'}</td>
                                  <td>{it.floor ?? '—'}</td>
                                  <td>{it.name ?? '—'}</td>
                                  <td>{it.spec ?? '—'}</td>
                                  <td>{it.result_value ?? '—'}</td>
                                  <td>{it.sign ?? '—'}</td>
                                  <td title={it.guid ?? ''}>{it.guid ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!qtyLoading && filteredQtyItems.length === 0 && (
                          <p className="trimble-workbench__muted" style={{ margin: '0.35rem 0.5rem' }}>
                            표시할 물량 행이 없습니다.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
