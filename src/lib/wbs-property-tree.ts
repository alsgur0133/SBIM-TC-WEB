import type { CodeMgmtCompositionRow } from '../api/codeManagement'
import type { ObjectProperties, ModelObjects } from 'trimble-connect-workspace-api'

export type WbsTreeNode = {
  id: string
  /** 표시 값 (해당 단계 매개변수 값) */
  segment: string
  /** 0-based WBS 단계 인덱스 */
  level: number
  children: WbsTreeNode[]
  /** 이 경로에 해당하는 객체(리프) — modelId → runtime id */
  objectsByModel: Map<string, number[]>
  /** true면 wbsLabels[level] 숨기고 segment만 표시(최상위 "모두" 폴더용) */
  suppressWbsLabel?: boolean
}

function unwrapIfcPropValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    const inner = (v as { value: unknown }).value
    return inner === null || inner === undefined ? '—' : String(inner)
  }
  return String(v)
}

/**
 * Trimble ObjectProperties에서 코드관리 param_key에 대응하는 값 찾기.
 * - 뷰어 상단 "객체 유형" / IFC 클래스 등은 속성 세트가 아니라 product·class 필드에 올 때가 많음 → 예약 키 지원.
 * - 그 외에는 Trimble이 주는 p.name(또는 `속성세트명.속성명`)과 부분 일치.
 */
export function findPropertyDisplayValue(obj: ObjectProperties, paramKey: string): string {
  const pk = paramKey.trim()
  if (!pk) return '—'
  const pl = pk.toLowerCase()

  const compactKey = pl.replace(/\s+/g, '')
  if (
    pl === 'product.objecttype' ||
    pl === '@objecttype' ||
    pl === 'objecttype' ||
    compactKey === '객체유형'
  ) {
    const v = obj.product?.objectType?.trim()
    return v || '(없음)'
  }
  if (pl === 'product.name' || pl === '@name') {
    const v = obj.product?.name?.trim()
    return v || '(없음)'
  }
  if (pl === 'ifc.class' || pl === 'obj.class' || pl === '@class' || pl === 'ifcclass') {
    const v = obj.class?.trim()
    return v || '(없음)'
  }

  const sets = obj.properties ?? []
  for (const ps of sets) {
    const pset = (ps.name ?? '').trim()
    for (const p of ps.properties ?? []) {
      const name = (p.name ?? '').trim()
      const qualified = pset && name ? `${pset}.${name}` : name
      if (
        name === pk ||
        qualified === pk ||
        name.endsWith(`.${pk}`) ||
        name.includes(pk) ||
        qualified.includes(pk)
      ) {
        return unwrapIfcPropValue(p.value)
      }
    }
  }
  return '(없음)'
}

/** 최상위·1단에서 값 없음 → 한 덩어리 "모두" */
const WBS_TREE_EMPTY_SEGMENT = '모두'

let idSeq = 0
function nextNodeId(): string {
  idSeq += 1
  return `wbs-${idSeq}`
}

function sortTree(n: WbsTreeNode): void {
  n.children.sort((a, b) => a.segment.localeCompare(b.segment, 'ko'))
  for (const c of n.children) sortTree(c)
}

function mergeWbsNodesInto(target: WbsTreeNode, src: WbsTreeNode): void {
  for (const [mid, ids] of src.objectsByModel) {
    const arr = target.objectsByModel.get(mid) ?? []
    arr.push(...ids)
    target.objectsByModel.set(mid, arr)
  }
  for (const sc of src.children) {
    const tc = target.children.find((x) => x.segment === sc.segment)
    if (!tc) target.children.push(sc)
    else mergeWbsNodesInto(tc, sc)
  }
}

/** 같은 부모 아래 동일 segment 노드 병합 → "모두" 등 중복 가지 제거 */
function mergeDuplicateChildrenBySegment(node: WbsTreeNode): void {
  for (const c of node.children) mergeDuplicateChildrenBySegment(c)
  if (node.children.length <= 1) return
  const map = new Map<string, WbsTreeNode>()
  for (const c of node.children) {
    const ex = map.get(c.segment)
    if (!ex) map.set(c.segment, c)
    else mergeWbsNodesInto(ex, c)
  }
  node.children = Array.from(map.values())
  node.children.sort((a, b) => a.segment.localeCompare(b.segment, 'ko'))
  for (const c of node.children) mergeDuplicateChildrenBySegment(c)
}

function bumpNodeLevels(node: WbsTreeNode, delta: number): void {
  node.level += delta
  for (const c of node.children) bumpNodeLevels(c, delta)
}

function aggregateObjectsInto(node: WbsTreeNode): void {
  node.objectsByModel = new Map()
  const walk = (n: WbsTreeNode) => {
    for (const [mid, ids] of n.objectsByModel) {
      const arr = node.objectsByModel.get(mid) ?? []
      arr.push(...ids)
      node.objectsByModel.set(mid, arr)
    }
    for (const c of n.children) walk(c)
  }
  for (const c of node.children) walk(c)
}

/** 루트 직하위에 표시용 "모두" 폴더 1개만 두고 그 안에 기존 1단 트리를 넣음 */
function wrapRootChildrenInAllFolder(root: WbsTreeNode): void {
  if (root.children.length === 0) return
  for (const c of root.children) bumpNodeLevels(c, 1)
  const synthetic: WbsTreeNode = {
    id: nextNodeId(),
    segment: WBS_TREE_EMPTY_SEGMENT,
    level: 0,
    suppressWbsLabel: true,
    children: root.children,
    objectsByModel: new Map(),
  }
  aggregateObjectsInto(synthetic)
  root.children = [synthetic]
}

/**
 * 최상위 "모두" 폴더 바로 아래 또 "모두"(1단 값 없음)가 있으면 중복이므로 제거하고
 * 그 자식만 위로 올림. node.level은 그대로 두어 "객체 유형" 등 라벨 단계가 맞게 유지됨.
 */
function hoistInnerMoDuUnderTopAllFolder(root: WbsTreeNode): void {
  if (root.children.length !== 1) return
  const syn = root.children[0]
  if (syn.segment !== WBS_TREE_EMPTY_SEGMENT || !syn.suppressWbsLabel) return

  const idx = syn.children.findIndex((c) => c.segment === WBS_TREE_EMPTY_SEGMENT)
  if (idx < 0) return

  const inner = syn.children[idx]
  const rest = syn.children.filter((_, i) => i !== idx)

  for (const [mid, ids] of inner.objectsByModel) {
    const arr = syn.objectsByModel.get(mid) ?? []
    arr.push(...ids)
    syn.objectsByModel.set(mid, arr)
  }

  const merged: WbsTreeNode[] = [...rest]
  for (const ch of inner.children) {
    const ex = merged.find((x) => x.segment === ch.segment)
    if (!ex) merged.push(ch)
    else mergeWbsNodesInto(ex, ch)
  }
  syn.children = merged
  sortTree(syn)
  mergeDuplicateChildrenBySegment(syn)
  aggregateObjectsInto(syn)
}

/**
 * 로드된 모델 객체 목록과 WBS 구성(매개변수 순서)으로 트리 생성.
 */
export function buildWbsPropertyTree(modelObjects: ModelObjects[], wbsRows: CodeMgmtCompositionRow[]): WbsTreeNode {
  idSeq = 0
  const ordered = [...wbsRows].sort((a, b) => a.sort_index - b.sort_index)
  const keys = ordered.map((r) => r.param_key)

  const root: WbsTreeNode = {
    id: nextNodeId(),
    segment: '전체',
    level: -1,
    children: [],
    objectsByModel: new Map(),
  }

  if (keys.length === 0) {
    return root
  }

  for (const group of modelObjects) {
    const mid = group.modelId
    for (const obj of group.objects ?? []) {
      const path = keys.map((k) => findPropertyDisplayValue(obj, k))
      let parent = root
      for (let level = 0; level < keys.length; level++) {
        const raw = path[level] ?? '(없음)'
        /* 2단 이후 값 없음: "(미지정)" 노드 없이 현재 부모에만 객체를 붙임 */
        if (raw === '(없음)' && level > 0) {
          break
        }
        const seg = raw === '(없음)' ? WBS_TREE_EMPTY_SEGMENT : raw
        let child = parent.children.find((c) => c.segment === seg)
        if (!child) {
          child = {
            id: nextNodeId(),
            segment: seg,
            level,
            children: [],
            objectsByModel: new Map(),
          }
          parent.children.push(child)
        }
        parent = child
      }
      const arr = parent.objectsByModel.get(mid) ?? []
      arr.push(obj.id)
      parent.objectsByModel.set(mid, arr)
    }
  }

  sortTree(root)
  mergeDuplicateChildrenBySegment(root)

  /** 루트 바로 아래 "모두" 1개만 두고 그 안에 BEAM/COLUMN/… 계층 */
  if (keys.length >= 1 && root.children.length > 0) {
    wrapRootChildrenInAllFolder(root)
    hoistInnerMoDuUnderTopAllFolder(root)
  }

  return root
}

/** 노드 및 모든 하위에 속한 객체 id를 모델별로 합침 */
export function collectModelObjectIdsForNode(node: WbsTreeNode): { modelId: string; objectRuntimeIds: number[] }[] {
  const map = new Map<string, Set<number>>()
  const walk = (n: WbsTreeNode) => {
    for (const [mid, ids] of n.objectsByModel) {
      const set = map.get(mid) ?? new Set<number>()
      for (const id of ids) set.add(id)
      map.set(mid, set)
    }
    for (const c of n.children) walk(c)
  }
  walk(node)
  return Array.from(map.entries()).map(([modelId, set]) => ({
    modelId,
    objectRuntimeIds: Array.from(set),
  }))
}
