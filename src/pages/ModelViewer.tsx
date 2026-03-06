import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as THREE from 'three'
import { IFCLoader } from 'web-ifc-three'
import {
  IFCPROJECT,
  IFCSITE,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCRELAGGREGATES,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
} from 'web-ifc'
import { getDesignModelFileUrl, getDesignModelsApi, type DesignModel } from '../api/designModel'

type IFCModelLike = THREE.Mesh & {
  modelID?: number
  ifcManager?: {
    getExpressId: (geometry: THREE.BufferGeometry, faceIndex: number) => number
    getItemProperties: (modelID: number, id: number, recursive?: boolean) => Promise<Record<string, unknown>>
    getSpatialStructure: (modelID: number, includeProperties?: boolean) => Promise<SpatialStructureNode>
    getIfcType?: (modelID: number, id: number) => string | Promise<string>
    getAllItemsOfType?: (modelID: number, type: number, verbose?: boolean) => Promise<number[]>
  }
  getAllItemsOfType?: (type: number, verbose?: boolean) => Promise<number[]>
  getExpressId?: (geometry: THREE.BufferGeometry, faceIndex: number) => number
  getItemProperties?: (id: number) => Promise<Record<string, unknown>>
  getSpatialStructure?: () => Promise<SpatialStructureNode>
}

/** getSpatialStructure() 반환 노드: expressID, type, children. name 등은 includeProperties 시 포함될 수 있음 */
export interface SpatialStructureNode {
  expressID: number
  type: string
  name?: string
  Name?: { value: string }
  children?: SpatialStructureNode[]
  aggregates?: SpatialStructureNode[]
  spatial?: SpatialStructureNode[]
  /** append 모드에서 여러 모델일 때, 이 노드가 속한 모델 인덱스 (0-based) */
  modelIndex?: number
  /** 계측구조용: 타입별 그룹 등 합성 노드의 expressID 목록 */
  ids?: number[]
}

/** 노드의 자식 목록 (children / aggregates+spatial 모두 처리) */
function getChildNodes(node: SpatialStructureNode): SpatialStructureNode[] {
  if (node.children && node.children.length > 0) return node.children
  const a = node.aggregates ?? []
  const s = node.spatial ?? []
  return a.length || s.length ? [...a, ...s] : []
}

/** 계층 노드를 깊은 복사. 라이브러리가 반환한 객체를 나중에 변경해도 state가 바뀌지 않도록 함 */
function cloneSpatialNode(node: SpatialStructureNode, modelIndex?: number): SpatialStructureNode {
  const children = getChildNodes(node)
  const out: SpatialStructureNode = {
    expressID: node.expressID,
    type: node.type,
    ...(node.name != null ? { name: node.name } : {}),
    ...(node.Name != null ? { Name: node.Name } : {}),
    ...(modelIndex !== undefined ? { modelIndex } : node.modelIndex !== undefined ? { modelIndex: node.modelIndex } : {}),
    children: children.length > 0 ? children.map((c) => cloneSpatialNode(c, modelIndex ?? node.modelIndex)) : [],
  }
  return out
}

/** 단일 값에서 expressID 숫자 추출 (.value, .expressID, 또는 숫자) */
function toExpressId(item: unknown): number | null {
  if (typeof item === 'number') return item
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    if (typeof o.value === 'number') return o.value
    if (typeof o.expressID === 'number') return o.expressID
  }
  return null
}

/** getAllItemsOfType 반환값을 number[]로 정규화 (배열 또는 web-ifc Vector 대응) */
function toIdArray(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'number' ? x : toExpressId(x))).filter((n): n is number => n != null)
  const v = raw as { size?: number; get?: (i: number) => number } | null
  if (v && typeof v.size === 'number' && typeof v.get === 'function') {
    const arr: number[] = []
    for (let i = 0; i < v.size; i++) arr.push(v.get!(i))
    return arr
  }
  return []
}

/** 속성에서 관계 참조 값(expressID) 배열 추출. 여러 키 이름과 중첩 구조 지원 */
function getRefIds(props: Record<string, unknown>, keys: string[]): number[] {
  const ids: number[] = []
  const tryKey = (key: string) => {
    const v = props[key]
    if (v == null) return
    const arr = Array.isArray(v) ? v : [v]
    for (const item of arr) {
      const id = toExpressId(item)
      if (id != null) ids.push(id)
    }
  }
  for (const key of keys) {
    tryKey(key)
    const lower = key.charAt(0).toLowerCase() + key.slice(1)
    if (lower !== key) tryKey(lower)
  }
  return ids
}

/** 관계 객체에서 RelatedObjects / RelatedElements 등 자식 ID 배열 추출 */
function getRelatedIds(relProps: Record<string, unknown>): number[] {
  const ids: number[] = []
  const keys = ['RelatedObjects', 'RelatedElements', 'relatedObjects', 'relatedElements', 'RelatedProducts', 'relatedProducts']
  for (const key of keys) {
    const v = relProps[key]
    if (v == null) continue
    const arr = Array.isArray(v) ? v : [v]
    for (const item of arr) {
      const id = toExpressId(item)
      if (id != null) ids.push(id)
    }
  }
  if (ids.length === 0) {
    for (const k of Object.keys(relProps)) {
      if (/related|elements|objects|products/i.test(k)) {
        const v = relProps[k]
        const arr = Array.isArray(v) ? v : [v]
        for (const item of arr) {
          const id = toExpressId(item)
          if (id != null) ids.push(id)
        }
      }
    }
  }
  return ids
}

/** 객체의 모든 키 중 관계 참조처럼 보이는 값에서 ID 수집 (키 이름 무관) */
function getRefIdsFromAnyKeys(props: Record<string, unknown>, relationLikeKeys: string[]): number[] {
  const ids: number[] = []
  for (const key of Object.keys(props)) {
    if (!relationLikeKeys.some((r) => key.includes(r) || r.includes(key))) continue
    const v = props[key]
    if (v == null) continue
    const arr = Array.isArray(v) ? v : [v]
    for (const item of arr) {
      const id = toExpressId(item)
      if (id != null) ids.push(id)
    }
  }
  return ids
}

/**
 * getSpatialStructure가 자식을 비울 때: getItemProperties로 IsDecomposedBy / ContainsElements 관계를 따라 계층 구성
 */
async function buildSpatialTreeFromProps(
  modelID: number,
  getItemProperties: (modelID: number, id: number) => Promise<Record<string, unknown>>,
  getNodeType: (modelID: number, id: number) => string | Promise<string>,
  nodeId: number,
  visited: Set<number>,
  depth: number
): Promise<SpatialStructureNode> {
  if (visited.has(nodeId) || depth > 30) {
    return { expressID: nodeId, type: 'Unknown', children: [] }
  }
  visited.add(nodeId)
  const props = await getItemProperties(modelID, nodeId).catch(() => ({} as Record<string, unknown>))
  const typeName = typeof getNodeType === 'function' ? await Promise.resolve(getNodeType(modelID, nodeId)).catch(() => '') : ''
  const name = (props.Name as { value?: string } | undefined)?.value ?? (props.name as string | undefined)
  const typeVal = props.type
  const typeStr = typeof typeVal === 'string' ? typeVal : typeName || (typeVal != null ? String(typeVal) : 'Unknown')
  const node: SpatialStructureNode = {
    expressID: nodeId,
    type: typeStr || 'Unknown',
    children: [],
  }
  if (name != null && String(name).trim()) node.name = String(name).trim()

  const relationKeys = [
    'IsDecomposedBy', 'isDecomposedBy', 'ContainsElements', 'containsElements',
    'IsNestedBy', 'isNestedBy', 'Decomposes', 'decomposes', 'ContainedInStructure', 'containedInStructure',
    'ContainedInSpatialStructure', 'containedInSpatialStructure',
  ]
  let relationIds = getRefIds(props as Record<string, unknown>, relationKeys)
  if (relationIds.length === 0) {
    relationIds = getRefIdsFromAnyKeys(props as Record<string, unknown>, ['Decomposed', 'Contains', 'Nested', 'Contained', 'Decomposes', 'Aggregate', 'Spatial'])
  }
  const childIds: number[] = []
  for (const relId of relationIds) {
    const relProps = await getItemProperties(modelID, relId).catch(() => ({} as Record<string, unknown>))
    childIds.push(...getRelatedIds(relProps as Record<string, unknown>))
  }
  const uniqueChildIds = [...new Set(childIds)]
  for (const childId of uniqueChildIds) {
    const childNode = await buildSpatialTreeFromProps(
      modelID,
      getItemProperties,
      getNodeType,
      childId,
      visited,
      depth + 1
    )
    node.children!.push(childNode)
  }
  return node
}

/**
 * getAllItemsOfType으로 IFCSITE, IFCBUILDING, IFCBUILDINGSTOREY 목록을 가져와
 * 각 요소의 Decomposes/ContainedInStructure → 관계 → RelatingObject 로 부모를 찾아 트리 구성
 */
async function buildSpatialTreeFromTypes(
  modelID: number,
  getAllItemsOfType: (modelID: number, type: number) => Promise<number[]>,
  getItemProperties: (modelID: number, id: number) => Promise<Record<string, unknown>>,
  getNodeType: (modelID: number, id: number) => string | Promise<string>,
  projectId: number
): Promise<SpatialStructureNode> {
  const typeGroups: { type: number; name: string }[] = [
    { type: IFCSITE, name: 'IFCSITE' },
    { type: IFCBUILDING, name: 'IFCBUILDING' },
    { type: IFCBUILDINGSTOREY, name: 'IFCBUILDINGSTOREY' },
  ]
  const allIds: number[] = [projectId]
  const idToParent = new Map<number, number>()
  for (const { type } of typeGroups) {
    const raw = await getAllItemsOfType(modelID, type).catch(() => [])
    const ids = toIdArray(raw)
    allIds.push(...ids)
    for (const id of ids) {
      const props = await getItemProperties(modelID, id).catch(() => ({} as Record<string, unknown>))
      const relationKeys = ['Decomposes', 'IsDecomposedBy', 'ContainedInStructure', 'ContainedInSpatialStructure']
      let relationIds = getRefIds(props as Record<string, unknown>, relationKeys)
      if (relationIds.length === 0) {
        relationIds = getRefIdsFromAnyKeys(props as Record<string, unknown>, ['Decomposes', 'Contained', 'Decomposed'])
      }
      for (const relId of relationIds) {
        const relProps = await getItemProperties(modelID, relId).catch(() => ({} as Record<string, unknown>))
        const relating =
          relProps.RelatingObject ?? relProps.relatingObject ?? relProps.RelatingStructure ?? relProps.relatingStructure
        const parentId = toExpressId(relating)
        if (parentId != null) idToParent.set(id, parentId)
      }
    }
  }
  function makeNode(id: number, visited: Set<number>): SpatialStructureNode {
    if (visited.has(id)) return { expressID: id, type: 'Unknown', children: [] }
    visited.add(id)
    const childIds = allIds.filter((cid) => idToParent.get(cid) === id)
    return {
      expressID: id,
      type: 'Unknown',
      children: childIds.map((cid) => makeNode(cid, visited)),
    }
  }
  const root = makeNode(projectId, new Set())
  async function fillTypesAndNames(node: SpatialStructureNode): Promise<void> {
    const typeName = await Promise.resolve(getNodeType(modelID, node.expressID)).catch(() => '')
    const props = await getItemProperties(modelID, node.expressID).catch(() => ({} as Record<string, unknown>))
    const name = (props.Name as { value?: string } | undefined)?.value ?? (props.name as string | undefined)
    node.type = typeName || (props.type as string) || node.type
    if (name != null && String(name).trim()) node.name = String(name).trim()
    for (const c of node.children ?? []) await fillTypesAndNames(c)
  }
  await fillTypesAndNames(root)
  return root
}

/**
 * 관계 타입(IfcRelAggregates, IfcRelContainedInSpatialStructure)을 직접 조회해
 * RelatingObject/RelatingStructure → RelatedObjects/RelatedElements 로 부모-자식 맵을 만들고 트리 구성.
 * 라이브러리 getSpatialStructure가 자식을 비우는 경우에 유효.
 */
async function buildSpatialTreeFromRelations(
  modelID: number,
  getAllItemsOfType: (modelID: number, type: number) => Promise<number[]>,
  getItemProperties: (modelID: number, id: number, recursive?: boolean) => Promise<Record<string, unknown>>,
  getNodeType: (modelID: number, id: number) => string | Promise<string>,
  projectId: number
): Promise<SpatialStructureNode> {
  const parentToChildren = new Map<number, number[]>()
  const relationTypes = [IFCRELAGGREGATES, IFCRELCONTAINEDINSPATIALSTRUCTURE]
  for (const relType of relationTypes) {
    const relIds = await getAllItemsOfType(modelID, relType).catch(() => [])
    const ids = toIdArray(relIds)
    for (const relId of ids) {
      const rel = await getItemProperties(modelID, relId, false).catch(() => ({} as Record<string, unknown>))
      const relating =
        toExpressId(rel.RelatingObject) ??
        toExpressId(rel.RelatingStructure) ??
        (rel.RelatingObject as { value?: number } | undefined)?.value ??
        (rel.RelatingStructure as { value?: number } | undefined)?.value ??
        (rel.relatingObject as { value?: number } | undefined)?.value ??
        (rel.relatingStructure as { value?: number } | undefined)?.value
      const relatedRaw = rel.RelatedObjects ?? rel.RelatedElements ?? rel.relatedObjects ?? rel.relatedElements
      const relatedArr = Array.isArray(relatedRaw) ? relatedRaw : relatedRaw != null ? [relatedRaw] : []
      const relatedIds = relatedArr
        .map((r: unknown) => (typeof r === 'number' ? r : toExpressId(r)) as number)
        .filter((n): n is number => n != null)
      if (relating != null && relatedIds.length > 0) {
        const existing = parentToChildren.get(relating) ?? []
        parentToChildren.set(relating, [...existing, ...relatedIds])
      }
    }
  }
  function makeNode(id: number, visited: Set<number>): SpatialStructureNode {
    if (visited.has(id)) return { expressID: id, type: 'Unknown', children: [] }
    visited.add(id)
    const childIds = parentToChildren.get(id) ?? []
    const uniqueChildIds = [...new Set(childIds)]
    return {
      expressID: id,
      type: 'Unknown',
      children: uniqueChildIds.map((cid) => makeNode(cid, visited)),
    }
  }
  const root = makeNode(projectId, new Set())
  async function fillTypesAndNames(node: SpatialStructureNode): Promise<void> {
    const typeName = await Promise.resolve(getNodeType(modelID, node.expressID)).catch(() => '')
    const props = await getItemProperties(modelID, node.expressID).catch(() => ({} as Record<string, unknown>))
    const name = (props.Name as { value?: string } | undefined)?.value ?? (props.name as string | undefined)
    node.type = typeName || (props.type as string) || node.type
    if (name != null && String(name).trim()) node.name = String(name).trim()
    for (const c of node.children ?? []) await fillTypesAndNames(c)
  }
  await fillTypesAndNames(root)
  return root
}

/** geometry에서 faceIndex에 해당하는 expressID를 읽음. 숨김 필터와 동일 규칙으로 getExpressIdAtFace 사용 */
function getExpressIdFromGeometry(geometry: THREE.BufferGeometry, faceIndex: number): number | null {
  return getExpressIdAtFace(geometry, faceIndex)
}

/** faceIndex에 해당하는 expressID 읽기. per-vertex / per-face / per-index 모두 지원 */
function getExpressIdAtFace(geometry: THREE.BufferGeometry, faceIndex: number): number | null {
  const index = geometry.index
  const attr = geometry.attributes?.expressID ?? geometry.attributes?.expressId
  if (!index || !attr) return null
  const bufAttr = attr as THREE.BufferAttribute
  const arr = bufAttr.array as ArrayLike<number>
  const numFaces = index.count / 3
  const indexCount = index.count
  const exprCount = bufAttr.count ?? Math.floor(arr.length / (bufAttr.itemSize ?? 1))
  const itemSize = bufAttr.itemSize ?? 1
  const readAt = (i: number): number => {
    if (typeof bufAttr.getX === 'function') return bufAttr.getX(i)
    const idx = i * itemSize
    return idx < arr.length ? (arr as number[])[idx] : NaN
  }
  if (faceIndex < 0 || faceIndex >= numFaces) return null
  if (exprCount === numFaces) return readAt(faceIndex)
  if (exprCount === indexCount) return readAt(3 * faceIndex)
  const geoIndex = index.array as ArrayLike<number>
  const vi = 3 * faceIndex
  if (vi >= geoIndex.length) return null
  const vertexIndex = geoIndex[vi]
  if (vertexIndex < 0) return null
  if (vertexIndex >= exprCount) return null
  return readAt(vertexIndex)
}

/** 지오메트리에서 숨김 키(modelID-expressId) 집합에 해당하는 면만 제거한 새 BufferGeometry 반환. 선택된 expressID 면만 숨김 */
function createFilteredGeometry(
  geometry: THREE.BufferGeometry,
  hiddenKeys: Set<string>,
  modelID: number
): THREE.BufferGeometry {
  const index = geometry.index
  const expressAttr = geometry.attributes?.expressID ?? geometry.attributes?.expressId
  if (!index || !expressAttr) return geometry.clone()
  const indexArr = index.array as ArrayLike<number>
  const numFaces = index.count / 3
  const uniqueIds = new Set<number>()
  for (let f = 0; f < numFaces; f++) {
    const expr = getExpressIdAtFace(geometry, f)
    if (expr != null && Number.isFinite(Number(expr))) uniqueIds.add(Math.floor(Number(expr)))
  }
  if (uniqueIds.size <= 1) return geometry.clone()
  const newIndices: number[] = []
  for (let f = 0; f < numFaces; f++) {
    const expr = getExpressIdAtFace(geometry, f)
    const exprInt = expr != null && Number.isFinite(Number(expr)) ? Math.floor(Number(expr)) : NaN
    const key = Number.isFinite(exprInt) ? `${modelID}-${exprInt}` : `${modelID}-invalid`
    if (hiddenKeys.has(key)) continue
    newIndices.push(indexArr[3 * f], indexArr[3 * f + 1], indexArr[3 * f + 2])
  }
  if (newIndices.length === 0) {
    const empty = new THREE.BufferGeometry()
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    return empty
  }
  const out = new THREE.BufferGeometry()
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1))
  for (const name of Object.keys(geometry.attributes)) {
    out.setAttribute(name, (geometry.attributes[name] as THREE.BufferAttribute).clone())
  }
  return out
}

/** 선택된 expressID에 해당하는 면들의 바운딩 박스 중심(월드 좌표) 반환 */
function getBoundingBoxCenterForExpressId(model: IFCModelLike, expressIdInt: number): THREE.Vector3 | null {
  const box = new THREE.Box3()
  let hasAny = false
  model.updateMatrixWorld(true)
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geom = mesh.geometry as THREE.BufferGeometry
    const index = geom.index
    const posAttr = geom.attributes?.position
    const expressAttr = geom.attributes?.expressID ?? geom.attributes?.expressId
    if (!index || !posAttr || !expressAttr) return
    const posArr = posAttr.array as ArrayLike<number>
    const itemSize = posAttr.itemSize || 3
    const indexArr = index.array as ArrayLike<number>
    const exprArr = expressAttr.array as ArrayLike<number>
    const bufExpr = expressAttr as THREE.BufferAttribute
    const getExpr = (vertexIndex: number): number => {
      if (typeof bufExpr.getX === 'function') return bufExpr.getX(vertexIndex)
      return exprArr[vertexIndex]
    }
    const numFaces = index.count / 3
    for (let f = 0; f < numFaces; f++) {
      const vi0 = indexArr[3 * f]
      const vi1 = indexArr[3 * f + 1]
      const vi2 = indexArr[3 * f + 2]
      const expr = getExpr(vi0)
      if (expr !== expressIdInt) continue
      const v0 = new THREE.Vector3(posArr[vi0 * itemSize], posArr[vi0 * itemSize + 1], posArr[vi0 * itemSize + 2])
      const v1 = new THREE.Vector3(posArr[vi1 * itemSize], posArr[vi1 * itemSize + 1], posArr[vi1 * itemSize + 2])
      const v2 = new THREE.Vector3(posArr[vi2 * itemSize], posArr[vi2 * itemSize + 1], posArr[vi2 * itemSize + 2])
      v0.applyMatrix4(mesh.matrixWorld)
      v1.applyMatrix4(mesh.matrixWorld)
      v2.applyMatrix4(mesh.matrixWorld)
      box.expandByPoint(v0)
      box.expandByPoint(v1)
      box.expandByPoint(v2)
      hasAny = true
    }
  })
  if (!hasAny) return null
  const center = new THREE.Vector3()
  box.getCenter(center)
  return center
}

/** 객체 속성을 키-값 목록으로 평탄화 (중첩 객체/배열 포함) */
function flattenProps(obj: unknown, prefix = ''): { key: string; value: string }[] {
  if (obj === null || obj === undefined) return []
  const list: { key: string; value: string }[] = []
  const o = obj as Record<string, unknown>
  for (const k of Object.keys(o)) {
    const v = o[k]
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).value !== 'undefined') {
      const val = (v as { value?: unknown }).value
      list.push({ key, value: String(val ?? '') })
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      list.push(...flattenProps(v, key))
    } else {
      list.push({ key, value: Array.isArray(v) ? JSON.stringify(v) : String(v ?? '') })
    }
  }
  return list
}

/** 속성값에서 표시용 값과 단위 추출 — IFC의 { value, unit? } 또는 { value } 형태 */
function getPropDisplay(v: unknown): { value: string; unit: string } {
  if (v === null || v === undefined) return { value: '', unit: '' }
  if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
    const o = v as Record<string, unknown>
    if (typeof o.value !== 'undefined') {
      const val = o.value === null || o.value === undefined ? '' : String(o.value)
      const unit = typeof o.unit === 'string' ? o.unit : ''
      return { value: val, unit }
    }
  }
  if (Array.isArray(v)) return { value: JSON.stringify(v), unit: '' }
  return { value: String(v), unit: '' }
}

const tdStyleBase: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid rgba(64, 64, 64, 0.5)',
  wordBreak: 'break-word',
  verticalAlign: 'top',
}
const categoryHeaderStyleBase: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid rgba(64, 64, 64, 0.8)',
  background: 'rgba(48, 48, 48, 0.95)',
  fontWeight: 600,
  color: '#e0e0e0',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

/** path가 최상위일 때만 representations/Representation 제외 */
function filterTopLevelKeys(keys: string[], pathPrefix: string): string[] {
  if (pathPrefix !== '') return keys
  return keys.filter((k) => k !== 'representations' && k !== 'Representation')
}

/** 단일 값(원시 또는 { value } 형태)인지 */
function isSingleValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v !== 'object' || Array.isArray(v)) return true
  return typeof (v as Record<string, unknown>).value !== 'undefined'
}

/** 객체 속성 테이블: 모든 속성 재귀 표시, 카테고리별 접기/펼치기 */
function ObjectPropertiesTable({
  obj,
  expanded,
  onToggle,
}: {
  obj: Record<string, unknown>
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    color: '#e0e0e0',
  }
  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: '1px solid rgba(64, 64, 64, 0.8)',
    background: 'rgba(56, 56, 56, 0.9)',
    fontWeight: 600,
    color: '#d0d0d0',
  }

  function renderRows(o: Record<string, unknown>, pathPrefix: string): React.ReactNode {
    const keys = filterTopLevelKeys(Object.keys(o), pathPrefix)
    if (keys.length === 0) return null
    return keys.map((key) => {
      const val = o[key]
      const path = pathPrefix ? `${pathPrefix}.${key}` : key
      const isObj =
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val) &&
        typeof (val as Record<string, unknown>).value === 'undefined'
      const childObj = isObj ? (val as Record<string, unknown>) : null
      const isExpanded = expanded.has(path)

      if (isSingleValue(val)) {
        const { value, unit } = getPropDisplay(val)
        return (
          <tr key={path}>
            <td style={tdStyleBase}>{key}</td>
            <td style={{ ...tdStyleBase, color: '#9ca3af' }}>{value || '—'}</td>
            <td style={{ ...tdStyleBase, color: '#94a3b8', fontSize: 12 }}>{unit || '—'}</td>
          </tr>
        )
      }
      if (Array.isArray(val)) {
        const { value } = getPropDisplay(val)
        return (
          <tr key={path}>
            <td style={tdStyleBase}>{key}</td>
            <td style={{ ...tdStyleBase, color: '#9ca3af' }}>{value || '—'}</td>
            <td style={tdStyleBase}>—</td>
          </tr>
        )
      }
      if (childObj) {
        const childKeys = Object.keys(childObj)
        return (
          <React.Fragment key={path}>
            <tr>
              <td colSpan={3} style={{ padding: 0, borderBottom: '1px solid rgba(64, 64, 64, 0.6)', verticalAlign: 'middle' }}>
                <button
                  type="button"
                  style={{ ...categoryHeaderStyleBase, paddingLeft: pathPrefix ? 12 + (pathPrefix.split('.').length - 1) * 12 : 8 }}
                  onClick={() => onToggle(path)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? '접기' : '펼치기'}
                >
                  <span style={{ width: 16, textAlign: 'center', color: '#9ca3af', flexShrink: 0 }}>
                    {isExpanded ? '−' : '+'}
                  </span>
                  <span>{key}</span>
                </button>
              </td>
            </tr>
            {isExpanded && renderRows(childObj, path)}
          </React.Fragment>
        )
      }
      const { value, unit } = getPropDisplay(val)
      return (
        <tr key={path}>
          <td style={tdStyleBase}>{key}</td>
          <td style={{ ...tdStyleBase, color: '#9ca3af' }}>{value || '—'}</td>
          <td style={{ ...tdStyleBase, color: '#94a3b8', fontSize: 12 }}>{unit || '—'}</td>
        </tr>
      )
    })
  }

  const keys = filterTopLevelKeys(Object.keys(obj), '')
  if (keys.length === 0) return <p style={{ margin: 0, color: '#9ca3af', fontSize: 12 }}>속성 없음</p>

  return (
    <table style={tableStyle} role="grid" aria-label="객체 속성">
      <thead>
        <tr>
          <th style={{ ...thStyle, width: '36%' }}>이름</th>
          <th style={{ ...thStyle, width: '42%' }}>값</th>
          <th style={{ ...thStyle, width: '22%' }}>단위</th>
        </tr>
      </thead>
      <tbody>{renderRows(obj, '')}</tbody>
    </table>
  )
}

const WASM_PATH = '/wasm/'

/**
 * IFC 파일 URL을 fetch 후 web-ifc로 열어 계층 구조만 읽기 (Node 스크립트와 동일 방식).
 * 라이브러리 getSpatialStructure가 자식을 비울 때 사용.
 */
async function loadSpatialStructureFromFile(
  fileUrl: string
): Promise<SpatialStructureNode | null> {
  try {
    const { IfcAPI } = await import('web-ifc')
    const api = new IfcAPI() as {
      Init: (locate?: (path: string, prefix: string) => string) => Promise<void>
      OpenModel: (data: Uint8Array, settings?: object) => number
      CloseModel: (modelID: number) => void
      properties: { getSpatialStructure: (modelID: number, include: boolean) => Promise<SpatialStructureNode> }
    }
    await api.Init((path: string, prefix: string) =>
      path.endsWith('.wasm') ? `${WASM_PATH}web-ifc.wasm` : prefix + path
    )
    const res = await fetch(fileUrl)
    if (!res.ok) return null
    const buffer = new Uint8Array(await res.arrayBuffer())
    const modelID = api.OpenModel(buffer)
    try {
      const structure = await api.properties.getSpatialStructure(modelID, true)
      return structure
    } finally {
      api.CloseModel(modelID)
    }
  } catch {
    return null
  }
}

const SPATIAL_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE',
])

/** 마지막 계층(요소들)을 타입별로 그룹화. 자식이 모두 비공간 요소이고 개수가 많으면 타입별 그룹 노드 반환 */
function groupChildrenByType(children: SpatialStructureNode[], groupThreshold = 6): SpatialStructureNode[] {
  if (children.length < groupThreshold) return children
  const allElement = children.every((c) => !SPATIAL_TYPES.has(c.type))
  if (!allElement) return children
  const byType = new Map<string, SpatialStructureNode[]>()
  for (const c of children) {
    const t = c.type || 'Unknown'
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(c)
  }
  if (byType.size <= 1) return children
  let idx = 0
  return Array.from(byType.entries()).map(([type, nodes]) => ({
    expressID: -(++idx),
    type,
    name: `${type} (${nodes.length})`,
    children: nodes,
  }))
}

/** 노드 표시 이름 (Name 속성 또는 type 기반) */
function getNodeLabel(node: SpatialStructureNode): string {
  const name = node.name ?? (node.Name as { value?: string } | undefined)?.value
  if (name && String(name).trim()) return String(name).trim()
  return node.type || `#${node.expressID}`
}

/** 노드와 모든 자손의 expressID 수집 (그룹 노드(expressID<0)는 자신은 제외하고 자식만) */
function collectExpressIds(node: SpatialStructureNode): number[] {
  const ids: number[] = []
  if (node.ids && node.ids.length > 0) ids.push(...node.ids)
  else if (node.expressID > 0) ids.push(node.expressID)
  for (const c of getChildNodes(node)) ids.push(...collectExpressIds(c))
  return ids
}

/** nodeKey에 해당하는 노드를 트리에서 찾기 (nodeKey는 SpatialTreeRow와 동일한 규칙) */
function findNodeByKey(root: SpatialStructureNode, targetKey: string, currentKey = 'root'): SpatialStructureNode | null {
  if (currentKey === targetKey) return root
  const children = getChildNodes(root)
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const childKey = `${currentKey}-${child.expressID}-${i}`
    if (childKey === targetKey) return child
    const found = findNodeByKey(child, targetKey, childKey)
    if (found) return found
  }
  return null
}

/** 공간 구조에서 층(IFCBUILDINGSTOREY) 노드 중 이름이 일치하는 것 반환 (빈 문자열이면 null) */
function findStoreyNodeByFloor(root: SpatialStructureNode | null, floorName: string): SpatialStructureNode | null {
  if (!root || !floorName || String(floorName).trim() === '') return null
  const want = String(floorName).trim().toUpperCase()
  function walk(node: SpatialStructureNode): SpatialStructureNode | null {
    const type = (node.type || '').toUpperCase()
    if (type === 'IFCBUILDINGSTOREY') {
      const name = getNodeLabel(node).trim().toUpperCase()
      if (name === want || name.includes(want) || want.includes(name)) return node
    }
    for (const c of getChildNodes(node)) {
      const found = walk(c)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

/** 공간 구조를 부재별산출서 형태(동-층-부재유형) 계측구조로 변환 */
function buildQuantityStyleStructure(root: SpatialStructureNode, modelIndex?: number): SpatialStructureNode {
  type Entry = { dong: string; floor: string; type: string; id: number }
  const entries: Entry[] = []

  function walk(node: SpatialStructureNode, dong: string, floor: string) {
    const nodeType = (node.type || '').toUpperCase()
    const label = getNodeLabel(node)

    if (nodeType === 'IFCBUILDING' || nodeType === 'IFCSITE') {
      const nextDong = nodeType === 'IFCBUILDING' ? label : dong || '전체'
      for (const c of getChildNodes(node)) walk(c, nextDong, floor)
      return
    }
    if (nodeType === 'IFCBUILDINGSTOREY') {
      const nextFloor = label || floor
      for (const c of getChildNodes(node)) walk(c, dong, nextFloor)
      return
    }
    if (node.expressID > 0) {
      entries.push({ dong: dong || '전체', floor: floor || '전체', type: node.type || 'Unknown', id: node.expressID })
      return
    }
    for (const c of getChildNodes(node)) walk(c, dong, floor)
  }

  walk(root, '', '')

  const dongMap = new Map<string, Map<string, Map<string, number[]>>>()
  for (const e of entries) {
    if (!dongMap.has(e.dong)) dongMap.set(e.dong, new Map())
    const floorMap = dongMap.get(e.dong)!
    if (!floorMap.has(e.floor)) floorMap.set(e.floor, new Map())
    const typeMap = floorMap.get(e.floor)!
    if (!typeMap.has(e.type)) typeMap.set(e.type, [])
    typeMap.get(e.type)!.push(e.id)
  }

  let seq = 0
  const dongNodes: SpatialStructureNode[] = []
  const dongOrder = Array.from(dongMap.keys()).sort()
  for (const dong of dongOrder) {
    const floorMap = dongMap.get(dong)!
    const floorNodes: SpatialStructureNode[] = []
    const floorOrder = Array.from(floorMap.keys()).sort()
    for (const floor of floorOrder) {
      const typeMap = floorMap.get(floor)!
      const typeNodes: SpatialStructureNode[] = []
      const typeOrder = Array.from(typeMap.keys()).sort()
      for (const typeName of typeOrder) {
        const ids = typeMap.get(typeName)!
        typeNodes.push({
          expressID: -(++seq),
          type: typeName,
          name: `${typeName} (${ids.length})`,
          ids,
          children: [],
          ...(modelIndex !== undefined ? { modelIndex } : {}),
        })
      }
      floorNodes.push({
        expressID: -(++seq),
        type: '층',
        name: floor,
        children: typeNodes,
        ...(modelIndex !== undefined ? { modelIndex } : {}),
      })
    }
    dongNodes.push({
      expressID: -(++seq),
      type: '동',
      name: dong,
      children: floorNodes,
      ...(modelIndex !== undefined ? { modelIndex } : {}),
    })
  }

  if (dongNodes.length === 0) return root

  return {
    expressID: 0,
    type: '계측구조',
    name: '동-층-부재유형',
    children: dongNodes,
    ...(modelIndex !== undefined ? { modelIndex } : {}),
  }
}

/** 구면 좌표 → 카메라 위치 (Y up, phi=0이 위) */
function sphericalToVector3(radius: number, phi: number, theta: number, target: THREE.Vector3) {
  const sinPhi = Math.sin(phi)
  target.set(
    radius * sinPhi * Math.sin(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.cos(theta)
  )
}

/** 단일 IFC 모델에 대한 계층 구조 생성 (라이브러리 + 관계/속성/타입/파일 fallback) */
async function buildSpatialStructureForModel(
  m: IFCModelLike,
  fileUrl?: string
): Promise<SpatialStructureNode | null> {
  const modelID = typeof m.modelID === 'number' ? m.modelID : 0
  const getProps = (id: number, recursive?: boolean) =>
    m.getItemProperties
      ? m.getItemProperties(id).catch(() => ({} as Record<string, unknown>))
      : m.ifcManager
        ? (m.ifcManager.getItemProperties as (mid: number, i: number, rec?: boolean) => Promise<Record<string, unknown>>)(modelID, id, recursive ?? true)
        : Promise.resolve({} as Record<string, unknown>)
  const getType = (_mid: number, id: number) =>
    m.ifcManager?.getIfcType ? m.ifcManager.getIfcType(modelID, id) : Promise.resolve('')

  const getAll = m.getAllItemsOfType
    ? (mid: number, type: number) => m.getAllItemsOfType!(type, false).catch(() => [])
    : m.ifcManager?.getAllItemsOfType
      ? (mid: number, type: number) => m.ifcManager!.getAllItemsOfType!(mid, type, false).catch(() => [])
      : null

  let root: SpatialStructureNode | null = null
  try {
    if (m.ifcManager && typeof m.modelID === 'number') {
      root = await m.ifcManager.getSpatialStructure(m.modelID, true)
    } else if (m.getSpatialStructure) {
      root = await m.getSpatialStructure()
    }
  } catch {
    root = null
  }
  if (root) {
    const merged = getChildNodes(root)
    if (merged.length > 0 && !(root.children && root.children.length) && (root.aggregates?.length || root.spatial?.length)) {
      root = { ...root, children: [...(root.aggregates ?? []), ...(root.spatial ?? [])] }
    }
  }
  if (!root && getAll) {
    const projectIds = toIdArray(await getAll(modelID, IFCPROJECT))
    if (projectIds.length > 0) {
      root = { expressID: projectIds[0], type: 'IFCPROJECT', children: [] }
    }
  }
  if (root && getChildNodes(root).length === 0 && getAll) {
    try {
      const fromRelations = await buildSpatialTreeFromRelations(
        modelID,
        getAll,
        (_mid, id, rec) => getProps(id, rec),
        getType,
        root.expressID
      )
      if (getChildNodes(fromRelations).length > 0) root = fromRelations
    } catch {
      // ignore
    }
  }
  if (root && getChildNodes(root).length === 0 && (m.ifcManager?.getItemProperties || m.getItemProperties)) {
    try {
      const fromProps = await buildSpatialTreeFromProps(
        modelID,
        (_mid, id) => getProps(id),
        getType,
        root.expressID,
        new Set(),
        0
      )
      if (getChildNodes(fromProps).length > 0) root = fromProps
    } catch {
      // ignore
    }
  }
  if (root && getChildNodes(root).length === 0 && getAll) {
    try {
      const fromTypes = await buildSpatialTreeFromTypes(
        modelID,
        getAll,
        (_mid, id) => getProps(id),
        getType,
        root.expressID
      )
      if (getChildNodes(fromTypes).length > 0) root = fromTypes
    } catch {
      // ignore
    }
  }
  if (root && getChildNodes(root).length === 0 && fileUrl) {
    const fromFile = await loadSpatialStructureFromFile(fileUrl)
    if (fromFile && getChildNodes(fromFile).length > 0) root = fromFile
  }
  return root ? cloneSpatialNode(root) : null
}

interface ModelViewerProps {
  /** 플로팅 창 등에 임베드할 때 전달. 없으면 URL searchParams 사용 */
  modelId?: string | null
  /** true일 때 툴바에 닫기 버튼 표시(onClose 호출) */
  embedded?: boolean
  onClose?: () => void
  /** 물량 테이블과 연동: 이 층 이름과 일치하는 Storey의 부재를 하이라이트 (예: "1F", "B1F") */
  highlightByFloor?: string | null
}

export default function ModelViewer({ modelId: modelIdProp, embedded, onClose, highlightByFloor }: ModelViewerProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<{ fit: () => void } | null>(null)
  const ifcModelRef = useRef<IFCModelLike | null>(null)
  const ifcModelsRef = useRef<IFCModelLike[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const designRevisionId = searchParams.get('designRevisionId') || ''
  const singleModelId = modelIdProp ?? searchParams.get('modelId')
  const modelIdsParam = searchParams.get('modelIds')
  const modelIdsList = useMemo(
    () => (modelIdsParam ? modelIdsParam.split(',').map((s) => s.trim()).filter(Boolean) : []),
    [modelIdsParam]
  )
  const appendMode = modelIdsList.length > 1
  const effectiveKey = modelIdsList.length > 0 ? modelIdsList.join(',') : (singleModelId ?? '')
  const modelId = modelIdsList.length > 0 ? modelIdsList[0] : singleModelId

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('loading')
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadProgressLabel, setLoadProgressLabel] = useState('준비 중…')
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedInfo, setSelectedInfo] = useState<Record<string, unknown> | null>(null)
  const [selectedCount, setSelectedCount] = useState(0)
  const [objectInfoExpanded, setObjectInfoExpanded] = useState<Set<string>>(new Set())
  const [rayHitCount, setRayHitCount] = useState(0)
  const [spatialStructure, setSpatialStructure] = useState<SpatialStructureNode | null>(null)
  const [floatInfoPos, setFloatInfoPos] = useState({ x: 960, y: 80 })
  const [infoPanelDock, setInfoPanelDock] = useState<'float' | 'left' | 'right'>('float')
  const [infoPanelWidth, setInfoPanelWidth] = useState(320)
  const infoPanelResizeRef = useRef<{ startX: number; startWidth: number; dock: 'float' | 'left' | 'right' } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [modelList, setModelList] = useState<DesignModel[]>([])
  const [modelListLoading, setModelListLoading] = useState(false)
  const [modelListError, setModelListError] = useState('')
  const [modelSelectPopupOpen, setModelSelectPopupOpen] = useState(false)
  const [popupSelectedIds, setPopupSelectedIds] = useState<Set<string>>(new Set())
  const floatDragRef = useRef<{ panel: 'info'; startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  const highlightMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const spatialLoadGenRef = useRef(0)
  const pendingModelIdRef = useRef<string | null>(null)
  const pendingLoadKeyRef = useRef<string | null>(null)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
  } | null>(null)
  const mouseDownRef = useRef<{ x: number; y: number; canvas: HTMLCanvasElement | null } | null>(null)
  type SelectionItem = { root: IFCModelLike; expressIdInt: number }
  const clickSelectionRef = useRef<SelectionItem[]>([])
  const hoverRef = useRef<{ model: IFCModelLike; expressID: number } | null>(null)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeEndRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeOverlayRef = useRef<HTMLDivElement | null>(null)
  const hoverMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const hiddenSelectionRef = useRef<Set<string>>(new Set())
  const originalGeometriesRef = useRef<Map<THREE.Mesh, THREE.BufferGeometry>>(new Map())
  const runUnhideAllRef = useRef<(() => void) | null>(null)
  const runHideSelectedRef = useRef<(() => void) | null>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  // 객체 정보 트리: 선택된 객체가 바뀌면 1단계만 펼친 상태로 초기화
  useEffect(() => {
    if (selectedInfo && typeof selectedInfo === 'object')
      setObjectInfoExpanded(new Set(Object.keys(selectedInfo)))
  }, [selectedInfo])

  // 우클릭 메뉴: 바깥 클릭 시 닫기
  useEffect(() => {
    if (!contextMenuOpen) return
    const onPointer = (e: MouseEvent) => {
      const el = contextMenuRef.current
      if (el && !el.contains(e.target as Node)) setContextMenuOpen(false)
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onPointer), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [contextMenuOpen])

  // 모델 목록: designRevisionId가 있으면 해당 리비전의 설계 모델 조회
  useEffect(() => {
    if (!designRevisionId) {
      setModelList([])
      setModelListError('')
      return
    }
    setModelListLoading(true)
    setModelListError('')
    getDesignModelsApi(designRevisionId)
      .then((res) => {
        if (res.success && res.models) setModelList(res.models)
        else setModelList([])
      })
      .catch((err) => {
        setModelList([])
        setModelListError(err instanceof Error ? err.message : '모델 목록을 불러올 수 없습니다.')
      })
      .finally(() => setModelListLoading(false))
  }, [designRevisionId])

  useEffect(() => {
    if (!effectiveKey) {
      setStatus('idle')
      setErrorMessage('')
      return
    }
    setStatus('loading')
    setLoadProgress(0)
    setLoadProgressLabel('준비 중…')
    setSelectedInfo(null)
    setSelectedCount(0)
    setSpatialStructure(null)
    clickSelectionRef.current = []
    hoverRef.current = null
    hiddenSelectionRef.current = new Set()
    originalGeometriesRef.current = new Map()
    ifcModelsRef.current = []
    if (appendMode) {
      pendingModelIdRef.current = null
    } else {
      pendingModelIdRef.current = modelId
    }
    pendingLoadKeyRef.current = effectiveKey
    const thisLoadKey = effectiveKey

    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1e1e1e)

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(20, 20, 20)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    container.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(30, 50, 30)
    dirLight.castShadow = true
    scene.add(dirLight)

    const pivotGroup = new THREE.Group()
    pivotGroup.name = 'pivot-point'
    pivotGroup.renderOrder = 999
    const pivotSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x00d4ff, depthTest: false, depthWrite: false })
    )
    pivotSphere.castShadow = false
    pivotSphere.receiveShadow = false
    pivotSphere.renderOrder = 999
    pivotGroup.add(pivotSphere)
    const pivotAxes = new THREE.AxesHelper(0.7)
    pivotAxes.name = 'pivot-axes'
    pivotAxes.traverse((obj) => {
      const o = obj as THREE.Line & { material?: THREE.Material }
      if (o.material) {
        o.material.depthTest = false
        o.renderOrder = 999
      }
    })
    pivotGroup.add(pivotAxes)
    scene.add(pivotGroup)

    let rafId: number
    const target = new THREE.Vector3(0, 0, 0)
    let radius = 20
    let phi = Math.PI * 0.35
    let theta = Math.PI * 0.25
    const minRadius = 0.5
    const maxRadius = 1000
    const orbitSpeed = 0.005
    const panSpeed = 0.002

    const applyCameraPosition = () => {
      sphericalToVector3(radius, phi, theta, camera.position)
      camera.position.add(target)
      camera.lookAt(target)
    }

    let isOrbit = false
    let isPan = false
    let isMarquee = false
    let prevX = 0
    let prevY = 0
    const raycaster = new THREE.Raycaster()
    const mouseNDC = new THREE.Vector2()

    /** 레이 히트 하나를 (root, expressIdInt)로 변환. 실패 시 null */
    const hitToExpress = (
      hit: THREE.Intersection,
      models: IFCModelLike[]
    ): { root: IFCModelLike; expressIdInt: number } | null => {
      const hitObj = hit.object as THREE.Mesh
      const geom = hitObj.geometry as THREE.BufferGeometry | undefined
      if (!geom || !geom.attributes) return null
      let root: IFCModelLike | null = null
      let p: THREE.Object3D | null = hitObj
      while (p) {
        if (models.includes(p as IFCModelLike)) {
          root = p as IFCModelLike
          break
        }
        p = p.parent
      }
      if (!root) return null
      const faceIndex =
        typeof hit.faceIndex === 'number'
          ? hit.faceIndex
          : typeof (hit as unknown as { index?: number }).index === 'number'
            ? Math.floor((hit as unknown as { index: number }).index / 3)
            : 0
      let expressId: number | null = null
      if (hitObj === root && root.getExpressId) {
        try {
          expressId = root.getExpressId(geom, faceIndex)
        } catch {
          expressId = getExpressIdFromGeometry(geom, faceIndex)
        }
      } else {
        expressId = getExpressIdFromGeometry(geom, faceIndex)
      }
      if (expressId == null) return null
      const expressIdInt = Math.floor(Number(expressId))
      if (!Number.isFinite(expressIdInt) || expressIdInt <= 0) return null
      return { root, expressIdInt }
    }

    /** 커서 위치에서 레이캐스트해 부재 정보 반환. 없으면 null */
    const getHitUnderCursor = (
      clientX: number,
      clientY: number,
      canvasEl: HTMLCanvasElement
    ): { root: IFCModelLike; expressIdInt: number } | null => {
      const models = ifcModelsRef.current
      const sceneState = sceneRef.current
      if (!models.length || !sceneState) return null
      const rect = canvasEl.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const x = clientX - rect.left
      const y = clientY - rect.top
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return null
      mouseNDC.x = (x / rect.width) * 2 - 1
      mouseNDC.y = -(y / rect.height) * 2 + 1
      models.forEach((m) => m.updateMatrixWorld(true))
      raycaster.setFromCamera(mouseNDC, sceneState.camera)
      const allHits = raycaster.intersectObjects(models, true)
      for (const hit of allHits) {
        const expr = hitToExpress(hit, models)
        if (expr) return expr
      }
      return null
    }

    /** 커서 위치에서 레이와 교차하는 서로 다른 객체(expressID) 개수 */
    const getRayHitObjectCount = (
      clientX: number,
      clientY: number,
      canvasEl: HTMLCanvasElement
    ): number => {
      const models = ifcModelsRef.current
      const sceneState = sceneRef.current
      if (!models.length || !sceneState) return 0
      const rect = canvasEl.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return 0
      const x = clientX - rect.left
      const y = clientY - rect.top
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) return 0
      mouseNDC.x = (x / rect.width) * 2 - 1
      mouseNDC.y = -(y / rect.height) * 2 + 1
      models.forEach((m) => m.updateMatrixWorld(true))
      raycaster.setFromCamera(mouseNDC, sceneState.camera)
      const allHits = raycaster.intersectObjects(models, true)
      const keys = new Set<string>()
      for (const h of allHits) {
        const expr = hitToExpress(h, models)
        if (expr) keys.add(`${expr.root.modelID ?? 0}-${expr.expressIdInt}`)
      }
      return keys.size
    }

    /** 사각형(client 좌표) 안에서 레이캐스트한 모든 부재(expressID) 반환. 좌표는 canvas 기준으로 변환 */
    const getHitsInRectangle = (
      clientX1: number,
      clientY1: number,
      clientX2: number,
      clientY2: number,
      canvasEl: HTMLCanvasElement
    ): SelectionItem[] => {
      const models = ifcModelsRef.current
      const sceneState = sceneRef.current
      if (!models.length || !sceneState) return []
      const rect = canvasEl.getBoundingClientRect()
      const x1 = Math.max(0, Math.min(rect.width, clientX1 - rect.left))
      const y1 = Math.max(0, Math.min(rect.height, clientY1 - rect.top))
      const x2 = Math.max(0, Math.min(rect.width, clientX2 - rect.left))
      const y2 = Math.max(0, Math.min(rect.height, clientY2 - rect.top))
      const left = Math.min(x1, x2)
      const right = Math.max(x1, x2)
      const top = Math.min(y1, y2)
      const bottom = Math.max(y1, y2)
      const step = Math.max(6, Math.min(12, (right - left) / 8, (bottom - top) / 8))
      const keys = new Set<string>()
      const result: SelectionItem[] = []
      models.forEach((m) => m.updateMatrixWorld(true))
      for (let py = top; py <= bottom; py += step) {
        for (let px = left; px <= right; px += step) {
          mouseNDC.x = (px / rect.width) * 2 - 1
          mouseNDC.y = -(py / rect.height) * 2 + 1
          raycaster.setFromCamera(mouseNDC, sceneState.camera)
          const hits = raycaster.intersectObjects(models, true)
          for (const h of hits) {
            const expr = hitToExpress(h, models)
            if (expr) {
              const k = `${expr.root.modelID ?? 0}-${expr.expressIdInt}`
              if (!keys.has(k)) {
                keys.add(k)
                result.push({ root: expr.root, expressIdInt: expr.expressIdInt })
              }
              break
            }
          }
        }
      }
      return result
    }

    /** 현재 선택 배열 기준으로 하이라이트 적용 (모델별 subset) */
    const applySelectionHighlight = () => {
      const material = highlightMaterialRef.current
      if (!material) return
      const models = ifcModelsRef.current
      const list = clickSelectionRef.current
      models.forEach((m) => {
        if (m.ifcManager && typeof m.modelID === 'number') {
          try {
            m.ifcManager.removeSubset(m.modelID, material, 'click-selection')
          } catch {
            /* ignore */
          }
        }
      })
      const byRoot = new Map<IFCModelLike, number[]>()
      for (const { root, expressIdInt } of list) {
        const ids = byRoot.get(root) ?? []
        if (!ids.includes(expressIdInt)) ids.push(expressIdInt)
        byRoot.set(root, ids)
      }
      byRoot.forEach((ids, root) => {
        if (root.ifcManager != null && typeof root.modelID === 'number' && ids.length > 0) {
          try {
            root.ifcManager.createSubset({
              scene: root,
              modelID: root.modelID,
              ids,
              removePrevious: false,
              material,
              customID: 'click-selection',
            })
          } catch (e) {
            console.warn('선택 하이라이트 실패:', e)
          }
        }
      })
    }

    /** 모델 로드 직후 호출: 각 메시의 원본 지오메트리 저장 (숨기기 복원용) */
    const storeOriginalGeometries = (model: IFCModelLike) => {
      const origMap = originalGeometriesRef.current
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry) return
        const geom = mesh.geometry as THREE.BufferGeometry
        if (!geom.attributes?.expressID && !geom.attributes?.expressId) return
        if (origMap.has(mesh)) return
        origMap.set(mesh, geom.clone())
      })
    }

    /** 숨김 집합에 따라 메시 지오메트리 필터 적용 또는 복원. 원본은 로드 시 저장된 것만 사용 */
    const applyHiddenState = () => {
      const hiddenKeys = hiddenSelectionRef.current
      const origMap = originalGeometriesRef.current
      const models = ifcModelsRef.current

      if (hiddenKeys.size === 0) {
        origMap.forEach((orig, mesh) => {
          const cur = mesh.geometry
          mesh.geometry = orig
          if (cur !== orig) cur.dispose()
        })
        origMap.clear()
        return
      }

      models.forEach((model) => {
        const modelID = typeof model.modelID === 'number' ? model.modelID : 0
        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || !mesh.geometry) return
          const geom = mesh.geometry as THREE.BufferGeometry
          if (!geom.attributes?.expressID && !geom.attributes?.expressId) return
          let baseGeo = origMap.get(mesh)
          if (baseGeo == null) {
            baseGeo = geom.clone()
            origMap.set(mesh, baseGeo)
          }
          const filtered = createFilteredGeometry(baseGeo, hiddenKeys, modelID)
          const prev = mesh.geometry
          mesh.geometry = filtered
          if (prev !== baseGeo) prev.dispose()
        })
      })
    }

    /** 현재 선택된 객체를 숨김 목록에 추가 후 적용 */
    const runHideSelected = () => {
      const list = clickSelectionRef.current
      if (list.length === 0) return
      const hidden = hiddenSelectionRef.current
      list.forEach(({ root, expressIdInt }) => {
        hidden.add(`${root.modelID ?? 0}-${expressIdInt}`)
      })
      applyHiddenState()
      clickSelectionRef.current = []
      applySelectionHighlight()
      setSelectedInfo(null)
      setSelectedCount(0)
    }

    /** 숨김 취소: 모든 숨긴 객체 복원 */
    const runUnhideAll = () => {
      hiddenSelectionRef.current = new Set()
      applyHiddenState()
    }
    runUnhideAllRef.current = runUnhideAll
    runHideSelectedRef.current = runHideSelected

    /** 부재 선택: 캔버스 위 (clientX, clientY)에서 레이캐스트로 부재 식별. addToSelection이면 기존 선택에 추가 */
    const runSelection = (
      clientX: number,
      clientY: number,
      canvasEl: HTMLCanvasElement,
      addToSelection: boolean
    ) => {
      const hit = getHitUnderCursor(clientX, clientY, canvasEl)
      if (!hit) {
        if (!addToSelection) {
          clickSelectionRef.current = []
          applySelectionHighlight()
          setSelectedInfo(null)
          setSelectedCount(0)
          target.set(0, 0, 0)
          applyCameraPosition()
        }
        return
      }
      const { root, expressIdInt } = hit
      if (!highlightMaterialRef.current) {
        highlightMaterialRef.current = new THREE.MeshBasicMaterial({
          color: 0xff9800,
          transparent: true,
          opacity: 0.82,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      }
      const key = `${root.modelID ?? 0}-${expressIdInt}`
      const prev = clickSelectionRef.current
      if (addToSelection) {
        const has = prev.some((s) => `${s.root.modelID ?? 0}-${s.expressIdInt}` === key)
        if (!has) clickSelectionRef.current = [...prev, { root, expressIdInt }]
      } else {
        clickSelectionRef.current = [{ root, expressIdInt }]
      }
      applySelectionHighlight()
      const list = clickSelectionRef.current
      setSelectedCount(list.length)
      if (list.length === 1) {
        const c = getBoundingBoxCenterForExpressId(list[0].root, list[0].expressIdInt)
        if (c) {
          target.copy(c)
          applyCameraPosition()
        }
      } else if (list.length > 1) {
        const box = new THREE.Box3()
        let hasAny = false
        for (const { root: r, expressIdInt: id } of list) {
          const c = getBoundingBoxCenterForExpressId(r, id)
          if (c) {
            box.expandByPoint(c)
            hasAny = true
          }
        }
        if (hasAny) {
          const center = new THREE.Vector3()
          box.getCenter(center)
          target.copy(center)
          applyCameraPosition()
        }
      }
      const first = list[0]
      const doLoad = (props: Record<string, unknown> | null) => {
        setSelectedInfo(props ?? null)
      }
      const modelID = typeof first.root.modelID === 'number' ? first.root.modelID : 0
      if (first.root.ifcManager != null && typeof modelID === 'number') {
        first.root.ifcManager
          .getItemProperties(modelID, first.expressIdInt, true)
          .then(doLoad)
          .catch(() => setSelectedInfo({ expressID: first.expressIdInt }))
      } else if (first.root.getItemProperties) {
        first.root
          .getItemProperties(first.expressIdInt, true)
          .then(doLoad)
          .catch(() => setSelectedInfo({ expressID: first.expressIdInt }))
      } else {
        setSelectedInfo({ expressID: first.expressIdInt })
      }
    }

    /** 시프트+드래그 영역 안의 부재들로 선택 설정 */
    const runMarqueeSelection = (
      clientX1: number,
      clientY1: number,
      clientX2: number,
      clientY2: number,
      canvasEl: HTMLCanvasElement
    ) => {
      const list = getHitsInRectangle(clientX1, clientY1, clientX2, clientY2, canvasEl)
      clickSelectionRef.current = list
      setSelectedCount(list.length)
      if (!highlightMaterialRef.current) {
        highlightMaterialRef.current = new THREE.MeshBasicMaterial({
          color: 0xff9800,
          transparent: true,
          opacity: 0.82,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      }
      applySelectionHighlight()
      if (list.length === 1) {
        const c = getBoundingBoxCenterForExpressId(list[0].root, list[0].expressIdInt)
        if (c) {
          target.copy(c)
          applyCameraPosition()
        }
      } else if (list.length > 1) {
        const box = new THREE.Box3()
        let hasAny = false
        for (const { root: r, expressIdInt: id } of list) {
          const c = getBoundingBoxCenterForExpressId(r, id)
          if (c) {
            box.expandByPoint(c)
            hasAny = true
          }
        }
        if (hasAny) {
          const center = new THREE.Vector3()
          box.getCenter(center)
          target.copy(center)
          applyCameraPosition()
        }
      }
      if (list.length === 0) {
        setSelectedInfo(null)
        setSelectedCount(0)
      } else {
        const first = list[0]
        const modelID = typeof first.root.modelID === 'number' ? first.root.modelID : 0
        if (first.root.ifcManager != null && typeof modelID === 'number') {
          first.root.ifcManager
            .getItemProperties(modelID, first.expressIdInt, true)
            .then((p) => setSelectedInfo(p ?? null))
            .catch(() => setSelectedInfo({ expressID: first.expressIdInt }))
        } else if (first.root.getItemProperties) {
          first.root
            .getItemProperties(first.expressIdInt, true)
            .then((p) => setSelectedInfo(p ?? null))
            .catch(() => setSelectedInfo({ expressID: first.expressIdInt }))
        } else {
          setSelectedInfo({ expressID: first.expressIdInt })
        }
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      prevX = e.clientX
      prevY = e.clientY
      const canvas = e.target instanceof HTMLCanvasElement ? e.target : null
      mouseDownRef.current = { x: e.clientX, y: e.clientY, canvas }
      if (e.button === 0) {
        if (e.shiftKey && canvas) {
          isMarquee = true
          const rect = canvas.getBoundingClientRect()
          marqueeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          marqueeEndRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          if (marqueeOverlayRef.current) {
            const s = marqueeStartRef.current
            const el = marqueeOverlayRef.current
            el.innerHTML = `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:0;height:0;border:2px solid rgba(0,212,255,0.9);background:rgba(0,212,255,0.12);pointer-events:none;"></div>`
          }
        } else {
          isOrbit = true
        }
      } else if (e.button === 1) {
        e.preventDefault()
        isPan = true
      }
    }
    const clearHover = () => {
      const cur = hoverRef.current
      const mat = hoverMaterialRef.current
      if (cur?.model.ifcManager && typeof cur.model.modelID === 'number' && mat) {
        try {
          cur.model.ifcManager.removeSubset(cur.model.modelID, mat, 'hover')
        } catch {
          /* ignore */
        }
      }
      hoverRef.current = null
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!sceneRef.current) return
      const dx = e.clientX - prevX
      const dy = e.clientY - prevY
      prevX = e.clientX
      prevY = e.clientY
      if (isMarquee) {
        const md = mouseDownRef.current
        if (md?.canvas) {
          const rect = md.canvas.getBoundingClientRect()
          marqueeEndRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
          updateMarqueeOverlay()
        }
      } else if (isOrbit) {
        theta -= dx * orbitSpeed
        phi -= dy * orbitSpeed
        phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi))
        sphericalToVector3(radius, phi, theta, camera.position)
        camera.position.add(target)
        camera.lookAt(target)
      } else if (isPan) {
        const factor = radius * panSpeed
        const right = new THREE.Vector3().subVectors(camera.position, target).cross(camera.up).normalize()
        const up = camera.up.clone().normalize()
        const panDelta = right.multiplyScalar(dx * factor).add(up.multiplyScalar(dy * factor))
        target.add(panDelta)
        camera.position.add(panDelta)
      } else {
        /* 마우스 이동 시 교차 객체 선택(호버 하이라이트) 기능 없음 */
      }
    }
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        const md = mouseDownRef.current
        const isClick = md && Math.abs(e.clientX - md.x) <= 8 && Math.abs(e.clientY - md.y) <= 8
        if (isMarquee) {
          const canvas = md?.canvas
          const start = marqueeStartRef.current
          const end = marqueeEndRef.current
          if (canvas && start && end) {
            const rect = canvas.getBoundingClientRect()
            runMarqueeSelection(
              rect.left + start.x,
              rect.top + start.y,
              rect.left + end.x,
              rect.top + end.y,
              canvas
            )
          }
          marqueeStartRef.current = null
          marqueeEndRef.current = null
          updateMarqueeOverlay()
          isMarquee = false
        } else if (isClick && md?.canvas) {
          runSelection(md.x, md.y, md.canvas, e.ctrlKey)
        }
        mouseDownRef.current = null
        isOrbit = false
      } else if (e.button === 1) isPan = false
    }
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      setContextMenuPos({ x: e.clientX, y: e.clientY })
      setContextMenuOpen(true)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!sceneRef.current) return
      const scale = e.deltaY > 0 ? 1.1 : 0.9
      radius = Math.max(minRadius, Math.min(maxRadius, radius * scale))
      applyCameraPosition()
    }

    const canvas = renderer.domElement
    canvas.style.touchAction = 'none'
    const overlayEl = document.createElement('div')
    overlayEl.setAttribute('aria-hidden', 'true')
    overlayEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:10;overflow:hidden'
    container.appendChild(overlayEl)
    marqueeOverlayRef.current = overlayEl

    const updateMarqueeOverlay = () => {
      const start = marqueeStartRef.current
      const end = marqueeEndRef.current
      const el = marqueeOverlayRef.current
      if (!el) return
      if (start && end) {
        const left = Math.min(start.x, end.x)
        const top = Math.min(start.y, end.y)
        const w = Math.abs(end.x - start.x)
        const h = Math.abs(end.y - start.y)
        el.innerHTML = `<div style="position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;border:2px solid rgba(0,212,255,0.9);background:rgba(0,212,255,0.12);"></div>`
      } else {
        el.innerHTML = ''
      }
    }

    const onCanvasMouseLeave = () => {
      setRayHitCount(0)
      clearHover()
    }
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseleave', onCanvasMouseLeave)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const ifcLoader = new IFCLoader()
    try {
      ifcLoader.ifcManager.setWasmPath(WASM_PATH)
    } catch {
      // some builds expose wasm differently
    }
    ifcLoader.ifcManager.setOnProgress((ev: { loaded: number; total: number }) => {
      if (pendingLoadKeyRef.current !== thisLoadKey) return
      const total = ev.total > 0 ? ev.total : 1
      const pct = Math.min(100, Math.round((ev.loaded / total) * 100))
      setLoadProgressLabel('모델 파싱 중…')
      setLoadProgress(pct)
    })

    const doFitAll = () => {
      const models = scene.children.filter((c) => (c as THREE.Object3D & { name?: string }).name === 'ifc-model')
      if (models.length === 0) return
      const box = new THREE.Box3()
      models.forEach((m) => box.expandByObject(m))
      const s = box.getSize(new THREE.Vector3())
      const maxD = Math.max(s.x, s.y, s.z, 0.1)
      const halfFovRad = (camera.fov * Math.PI) / 180 / 2
      radius = Math.max(minRadius, (maxD / 2) / Math.sin(halfFovRad) * 1.2)
      box.getCenter(target)
      phi = Math.PI * 0.35
      theta = Math.PI * 0.25
      applyCameraPosition()
    }

    /** IFC 로더에서 이미 Y-up으로 변환된 좌표계를 사용하므로 추가 회전은 적용하지 않음 */
    const applyZUpToYUp = (_model: THREE.Object3D) => {
      // no-op: 과도한 회전으로 좌표계가 틀어지는 문제 방지
    }

    const addOneModel = (model: IFCModelLike, index: number, offsetX: number) => {
      model.name = 'ifc-model'
      applyZUpToYUp(model)
      scene.add(model)
      ifcModelsRef.current.push(model)
      if (index === 0) ifcModelRef.current = model
      storeOriginalGeometries(model)
      return offsetX
    }

    if (appendMode) {
      let nextOffsetX = 0
      const loadOne = (id: string): Promise<IFCModelLike> =>
        new Promise((resolve, reject) => {
          ifcLoader.load(getDesignModelFileUrl(id), resolve as (m: unknown) => void, undefined, reject)
        })
      ;(async () => {
        for (let i = 0; i < modelIdsList.length; i++) {
          if (pendingLoadKeyRef.current !== thisLoadKey) return
          const id = modelIdsList[i]
          try {
            const model = await loadOne(id)
            if (pendingLoadKeyRef.current !== thisLoadKey) return
            nextOffsetX = addOneModel(model, i, nextOffsetX)
          } catch (err) {
            if (pendingLoadKeyRef.current !== thisLoadKey) return
            console.error(err)
            setStatus('error')
            setErrorMessage(err instanceof Error ? err.message : 'IFC 파일을 불러올 수 없습니다.')
            return
          }
        }
        if (pendingLoadKeyRef.current !== thisLoadKey) return
        doFitAll()
        controlsRef.current = { fit: doFitAll }
        setStatus('ready')
        const models = ifcModelsRef.current
        const structureRoots: SpatialStructureNode[] = []
        for (let i = 0; i < models.length; i++) {
          if (pendingLoadKeyRef.current !== thisLoadKey) return
          const fileUrl = getDesignModelFileUrl(modelIdsList[i])
          const root = await buildSpatialStructureForModel(models[i], fileUrl)
          structureRoots.push({
            expressID: -(i + 1),
            type: 'Group',
            name: `모델 ${i + 1}`,
            modelIndex: i,
            children: root ? [cloneSpatialNode(root, i)] : [],
          })
        }
        if (pendingLoadKeyRef.current !== thisLoadKey) return
        setSpatialStructure({
          expressID: 0,
          type: 'MultiModel',
          name: '선택된 모델',
          children: structureRoots.map((sr, i) => ({
            ...sr,
            children: sr.children?.length ? [buildQuantityStyleStructure(sr.children[0], i)] : [],
          })),
        })
      })()
    } else {
      const fileUrl = getDesignModelFileUrl(modelId!)
      ;(async () => {
        // Web Worker 사용 시 일부 환경에서 로드 완료 콜백이 호출되지 않아 99%에서 멈추는 현상이 있음. 메인 스레드 로드로 진행.
        if (pendingModelIdRef.current !== modelId) return
        ifcLoader.load(
          fileUrl,
          (model: IFCModelLike) => {
          if (pendingModelIdRef.current !== modelId) return
          setLoadProgress(100)
          setLoadProgressLabel('완료')
          spatialLoadGenRef.current += 1
          const thisLoadGen = spatialLoadGenRef.current
          ifcModelRef.current = model
          ifcModelsRef.current = [model]
          model.name = 'ifc-model'
          applyZUpToYUp(model)
          const box = new THREE.Box3().setFromObject(model)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          model.position.sub(center)
          target.set(0, 0, 0)
          const maxDim = Math.max(size.x, size.y, size.z, 1)
          const halfFov = (camera.fov * Math.PI) / 180 / 2
          radius = Math.max(minRadius, (maxDim / 2) / Math.sin(halfFov) * 1.2)
          phi = Math.PI * 0.35
          theta = Math.PI * 0.25
          applyCameraPosition()
          scene.add(model)
          storeOriginalGeometries(model)

          const doFit = () => {
            const m = scene.getObjectByName('ifc-model')
            if (!m) return
            const b = new THREE.Box3().setFromObject(m)
            const s = b.getSize(new THREE.Vector3())
            const maxD = Math.max(s.x, s.y, s.z, 0.1)
            const halfFovRad = (camera.fov * Math.PI) / 180 / 2
            radius = Math.max(minRadius, (maxD / 2) / Math.sin(halfFovRad) * 1.2)
            b.getCenter(target)
            applyCameraPosition()
          }
          controlsRef.current = { fit: doFit }
          doFit()
          setStatus('ready')
          setLoadProgress(0)
          setLoadProgressLabel('')
          const loadStructure = async (m: IFCModelLike) => {
          const modelID = typeof m.modelID === 'number' ? m.modelID : 0
          const getProps = (id: number, recursive?: boolean) =>
            m.getItemProperties
              ? m.getItemProperties(id, recursive)
              : m.ifcManager
                ? (m.ifcManager.getItemProperties as (mid: number, i: number, rec?: boolean) => Promise<Record<string, unknown>>)(modelID, id, recursive ?? true)
                : Promise.resolve({} as Record<string, unknown>)
          const getType = (mid: number, id: number) =>
            m.ifcManager?.getIfcType ? m.ifcManager.getIfcType(mid, id) : Promise.resolve('')

          const getAll = m.getAllItemsOfType
            ? (mid: number, type: number) => m.getAllItemsOfType!(type, false).catch(() => [])
            : m.ifcManager?.getAllItemsOfType
              ? (mid: number, type: number) => m.ifcManager!.getAllItemsOfType!(mid, type, false).catch(() => [])
              : null

          let root: SpatialStructureNode | null = null
          try {
            if (m.ifcManager && typeof m.modelID === 'number') {
              root = await m.ifcManager.getSpatialStructure(m.modelID, true)
            } else if (m.getSpatialStructure) {
              root = await m.getSpatialStructure()
            }
          } catch {
            root = null
          }
          if (root) {
            const merged = getChildNodes(root)
            if (merged.length > 0 && !(root.children && root.children.length) && (root.aggregates?.length || root.spatial?.length)) {
              root = { ...root, children: [...(root.aggregates ?? []), ...(root.spatial ?? [])] }
            }
          }
          if (!root && getAll) {
            const projectIds = toIdArray(await getAll(modelID, IFCPROJECT))
            if (projectIds.length > 0) {
              root = { expressID: projectIds[0], type: 'IFCPROJECT', children: [] }
            }
          }

          if (root && getChildNodes(root).length === 0 && getAll) {
            try {
              const fromRelations = await buildSpatialTreeFromRelations(
                modelID,
                getAll,
                (mid, id, rec) => getProps(id, rec),
                getType,
                root.expressID
              )
              if (getChildNodes(fromRelations).length > 0) root = fromRelations
            } catch (e) {
              console.warn('계층 구조(관계 기반) 실패:', e)
            }
          }
          if (root && getChildNodes(root).length === 0 && (m.ifcManager?.getItemProperties || m.getItemProperties)) {
            try {
              const fromProps = await buildSpatialTreeFromProps(
                modelID,
                (mid, id) => getProps(id),
                getType,
                root.expressID,
                new Set(),
                0
              )
              if (getChildNodes(fromProps).length > 0) root = fromProps
            } catch (e) {
              console.warn('계층 구조 fallback(속성) 실패:', e)
            }
          }
          if (root && getChildNodes(root).length === 0 && getAll) {
            try {
              const fromTypes = await buildSpatialTreeFromTypes(
                modelID,
                getAll,
                (mid, id) => getProps(id),
                getType,
                root.expressID
              )
              if (getChildNodes(fromTypes).length > 0) root = fromTypes
            } catch (e) {
              console.warn('계층 구조 fallback(타입) 실패:', e)
            }
          }
          if (root && getChildNodes(root).length === 0 && modelId) {
            const fromFile = await loadSpatialStructureFromFile(getDesignModelFileUrl(modelId))
            if (fromFile && getChildNodes(fromFile).length > 0) root = fromFile
          }

          if (thisLoadGen === spatialLoadGenRef.current) {
            setSpatialStructure(root ? buildQuantityStyleStructure(cloneSpatialNode(root)) : null)
          }
        }
        loadStructure(model)
      },
      (event: ProgressEvent) => {
        if (pendingModelIdRef.current !== modelId) return
        if (event.lengthComputable && event.total > 0) {
          setLoadProgressLabel('다운로드 중…')
          setLoadProgress(Math.min(99, Math.round((event.loaded / event.total) * 50)))
        }
      },
      (err: unknown) => {
        if (pendingModelIdRef.current !== modelId) return
        console.error(err)
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'IFC 파일을 불러올 수 없습니다.')
      }
        )
      })()
    }

    sceneRef.current = { scene, camera, renderer }

    const animate = () => {
      rafId = requestAnimationFrame(animate)
      pivotGroup.position.copy(target)
      const dist = camera.position.distanceTo(target)
      const pivotScale = Math.max(0.7, dist * 0.028)
      pivotGroup.scale.setScalar(pivotScale)
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!containerRef.current || !sceneRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      sceneRef.current.camera.aspect = w / h
      sceneRef.current.camera.updateProjectionMatrix()
      sceneRef.current.renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    const resizeObs = new ResizeObserver(onResize)
    if (container) resizeObs.observe(container)

    return () => {
      pendingModelIdRef.current = null
      pendingLoadKeyRef.current = null
      spatialLoadGenRef.current += 1
      resizeObs.disconnect()
      window.removeEventListener('resize', onResize)
      clearHover()
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseleave', onCanvasMouseLeave)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(rafId)
      const sc = sceneRef.current
      if (sc?.scene) {
        sc.scene.traverse((obj) => {
          const o = obj as THREE.Mesh
          if (o.geometry) o.geometry.dispose()
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
            else o.material.dispose()
          }
        })
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      if (overlayEl.parentNode) overlayEl.remove()
      marqueeOverlayRef.current = null
      renderer.dispose()
      sceneRef.current = null
      controlsRef.current = null
      ifcModelRef.current = null
      ifcModelsRef.current = []
    }
  }, [effectiveKey, refreshKey])

  // 물량 연동: highlightByFloor가 설정되면 해당 층(Storey) 부재 하이라이트
  useEffect(() => {
    if (status !== 'ready' || !spatialStructure) return
    const model = ifcModelsRef.current[0] ?? ifcModelRef.current
    if (!model?.ifcManager || typeof model.modelID !== 'number') return
    if (!highlightMaterialRef.current) {
      highlightMaterialRef.current = new THREE.MeshBasicMaterial({
        color: 0x1565c0,
        transparent: true,
        opacity: 0.55,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    }
    const material = highlightMaterialRef.current
    try {
      model.ifcManager.removeSubset(model.modelID, material, 'quantity-floor')
    } catch {
      /* ignore */
    }
    const floorTrim = highlightByFloor != null ? String(highlightByFloor).trim() : ''
    if (floorTrim) {
      const storeyNode = findStoreyNodeByFloor(spatialStructure, floorTrim)
      if (storeyNode) {
        const ids = collectExpressIds(storeyNode).filter((id) => id > 0)
        if (ids.length > 0) {
          try {
            model.ifcManager.createSubset({
              scene: model,
              modelID: model.modelID,
              ids,
              removePrevious: true,
              material,
              customID: 'quantity-floor',
            })
          } catch (e) {
            console.warn('물량 연동 층 하이라이트 실패:', e)
          }
        }
      }
    }
  }, [status, spatialStructure, highlightByFloor])

  const INFO_PANEL_MIN_WIDTH = 240
  const INFO_PANEL_MAX_WIDTH = 600

  const startFloatDrag = (panel: 'info', e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (infoPanelDock !== 'float') return
    const pos = floatInfoPos
    floatDragRef.current = { panel, startX: e.clientX, startY: e.clientY, startLeft: pos.x, startTop: pos.y }
    const onMove = (ev: MouseEvent) => {
      const d = floatDragRef.current
      if (!d || d.panel !== panel) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      setFloatInfoPos({ x: d.startLeft + dx, y: d.startTop + dy })
    }
    const onUp = () => {
      floatDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startInfoPanelResize = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    infoPanelResizeRef.current = { startX: e.clientX, startWidth: infoPanelWidth, dock: infoPanelDock }
    const onMove = (ev: MouseEvent) => {
      const r = infoPanelResizeRef.current
      if (!r) return
      const dx = ev.clientX - r.startX
      const delta = r.dock === 'right' || r.dock === 'float' ? -dx : dx
      setInfoPanelWidth((w) => Math.min(INFO_PANEL_MAX_WIDTH, Math.max(INFO_PANEL_MIN_WIDTH, w + delta)))
    }
    const onUp = () => {
      infoPanelResizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const loadableModels = modelList.filter((m) => m.file_path)
  const openModelSelectPopup = () => {
    const initial = modelIdsList.length > 0 ? new Set(modelIdsList) : (singleModelId ? new Set([singleModelId]) : new Set())
    setPopupSelectedIds(initial)
    setModelSelectPopupOpen(true)
  }
  const closeModelSelectPopup = () => setModelSelectPopupOpen(false)
  const handlePopupToggleModel = (id: string, checked: boolean) => {
    setPopupSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const handlePopupOpenSelected = () => {
    const ids = Array.from(popupSelectedIds).filter((id) => loadableModels.some((m) => m.id === id))
    if (ids.length === 0) return
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (designRevisionId) p.set('designRevisionId', designRevisionId)
      if (ids.length === 1) {
        p.set('modelId', ids[0])
        p.delete('modelIds')
      } else {
        p.set('modelIds', ids.join(','))
        p.delete('modelId')
      }
      return p
    })
    closeModelSelectPopup()
  }

  if (status === 'error') {
    const isServerOrNetworkError = /500|404|failed to fetch|network/i.test(errorMessage)
    const isAllocationError = /array buffer allocation failed|allocation failed/i.test(errorMessage)
    return (
      <div style={{ padding: '2rem', textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
        <p style={{ color: 'var(--error, #c00)', fontWeight: 600 }}>모델을 불러올 수 없습니다</p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', wordBreak: 'break-all' }}>{errorMessage}</p>
        {isServerOrNetworkError && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#555' }}>
            서버가 실행 중인지 확인하고, 모델 파일이 해당 리비전에 등록되어 있는지 모델 관리에서 확인해 주세요.
          </p>
        )}
        {isAllocationError && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#555' }}>
            IFC 파일이 너무 크거나 브라우저 사용 가능 메모리가 부족합니다. 용량이 작은 모델로 시도하거나, Chrome 등 다른 브라우저에서 다시 시도해 보세요.
          </p>
        )}
        {!isServerOrNetworkError && !isAllocationError && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#555' }}>
            IFC 뷰어 사용을 위해 <code>public/wasm</code> 폴더에 <code>web-ifc.wasm</code> 파일이 필요할 수 있습니다.
          </p>
        )}
      </div>
    )
  }

  const floatPanelStyle = {
    position: 'fixed' as const,
    zIndex: 1000,
    background: 'rgba(45, 45, 45, 0.88)',
    backdropFilter: 'blur(8px)',
    borderRadius: 8,
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    border: '1px solid rgba(64, 64, 64, 0.8)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    maxHeight: 'calc(100vh - 24px)',
  }
  const floatHeaderStyle = {
    padding: '0.5rem 0.75rem',
    cursor: 'grab',
    userSelect: 'none' as const,
    borderBottom: '1px solid rgba(64, 64, 64, 0.8)',
    background: 'rgba(56, 56, 56, 0.9)',
    color: '#e0e0e0',
    fontWeight: 600,
    fontSize: '0.875rem',
  }
  const floatPanelContentBg = 'rgba(37, 37, 38, 0.85)'

  const viewerToolbarStyle: CSSProperties = {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    padding: '6px 10px',
    background: 'rgba(45, 45, 45, 0.95)',
    borderRadius: 8,
    border: '1px solid #404040',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  }
  const viewerBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '6px 10px',
    background: '#3d3d3d',
    border: '1px solid #505050',
    borderRadius: 6,
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: 13,
  }
  const viewerBtnPrimaryStyle: CSSProperties = {
    ...viewerBtnStyle,
    background: '#0d7377',
    borderColor: '#0d7377',
    color: '#fff',
  }

  const loadableModelsInToolbar = modelList.filter((m) => m.file_path)
  const handleSwitchModel = (newModelId: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('modelId', newModelId)
      if (designRevisionId) p.set('designRevisionId', designRevisionId)
      return p
    })
  }

  return (
    <div style={{ width: '100%', height: embedded ? '100%' : '100vh', minHeight: 0, background: '#1e1e1e', position: 'relative' }} className="model-viewer--trimble-style">
      <div style={viewerToolbarStyle}>
        {embedded && onClose && (
          <button type="button" onClick={onClose} style={viewerBtnStyle} title="닫기" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            <span>닫기</span>
          </button>
        )}
        <button
          type="button"
          onClick={openModelSelectPopup}
          style={viewerBtnStyle}
          title="모델 목록에서 선택하여 열기"
          aria-label="모델 열기"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
          <span>모델 열기</span>
        </button>
        {designRevisionId && loadableModelsInToolbar.length > 0 && (
          <select
            value={modelId ?? ''}
            onChange={(e) => { const v = e.target.value; if (v) handleSwitchModel(v) }}
            title="다른 모델로 전환"
            style={{
              padding: '6px 8px',
              background: '#3d3d3d',
              border: '1px solid #505050',
              borderRadius: 6,
              color: '#e0e0e0',
              fontSize: 13,
              cursor: 'pointer',
              minWidth: 140,
            }}
            aria-label="모델 선택"
          >
            <option value="">모델 선택</option>
            {loadableModelsInToolbar.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title || m.file_name || m.id}
              </option>
            ))}
          </select>
        )}
        {appendMode && modelIdsList.length > 0 && (
          <span style={{ fontSize: 12, color: '#9ca3af', padding: '0 4px' }}>
            모델 {modelIdsList.length}개
          </span>
        )}
        <button
          type="button"
          onClick={() => controlsRef.current?.fit()}
          title="홈 (모델 전체가 보이도록 뷰 맞춤)"
          style={viewerBtnPrimaryStyle}
          aria-label="홈 뷰"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>홈</span>
        </button>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          title="모델 새로고침"
          style={viewerBtnStyle}
          aria-label="모델 새로고침"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 4v6h-6" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>새로고침</span>
        </button>
        <button
          type="button"
          onClick={() => runUnhideAllRef.current?.()}
          title="숨긴 객체 모두 표시"
          style={viewerBtnStyle}
          aria-label="숨기기 취소"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>숨기기 취소</span>
        </button>
        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>
          Orbit: 좌클릭 · Pan: 휠버튼 드래그 · 줌: 휠 · 선택: 클릭 / Ctrl+클릭 추가 / Shift+드래그 · 우클릭: 메뉴
        </span>
      </div>
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto' }}
        aria-busy={status === 'loading'}
        aria-label="IFC 모델 뷰어"
      />
      {contextMenuOpen && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label="컨텍스트 메뉴"
          style={{
            position: 'fixed',
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            zIndex: 10000,
            minWidth: 180,
            padding: 4,
            background: 'rgba(30, 30, 30, 0.98)',
            border: '1px solid rgba(64, 64, 64, 0.9)',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        >
          {selectedCount > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenuOpen(false)
                runHideSelectedRef.current?.()
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                color: '#e0e0e0',
                fontSize: 14,
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(13, 115, 119, 0.4)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              선택된 객체 숨기기 ({selectedCount}개)
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenuOpen(false)
              runUnhideAllRef.current?.()
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              color: '#e0e0e0',
              fontSize: 14,
              textAlign: 'left',
              cursor: 'pointer',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(13, 115, 119, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            숨기기 취소
          </button>
        </div>
      )}
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '1.25rem 1.75rem',
            background: 'rgba(45, 45, 45, 0.95)',
            color: '#e0e0e0',
            borderRadius: 8,
            border: '1px solid #404040',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            fontSize: 14,
            minWidth: 260,
          }}
        >
          <div style={{ marginBottom: 8 }}>{loadProgressLabel || 'IFC 모델 불러오는 중…'}</div>
          <div style={{ height: 6, background: '#404040', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${loadProgress}%`,
                background: '#0d7377',
                borderRadius: 3,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          {loadProgress > 0 && loadProgress < 100 && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>{loadProgress}%</div>
          )}
        </div>
      )}

      {/* 모델 선택 팝업 */}
      {modelSelectPopupOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="model-select-popup-title"
          style={{ zIndex: 1100 }}
          onClick={(e) => e.target === e.currentTarget && closeModelSelectPopup()}
        >
          <div
            className="modal"
            style={{ maxWidth: 440, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <h2 id="model-select-popup-title" className="modal__title">모델 선택</h2>
              <button type="button" className="modal__close" onClick={closeModelSelectPopup} aria-label="닫기">×</button>
            </div>
            <div className="modal__body" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
              {!designRevisionId ? (
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.875rem' }}>
                  리비전 정보가 없습니다. 메인 창에서 <strong>설계 차수·리비전</strong>을 선택한 뒤 상단 <strong>모델뷰어</strong> 버튼으로 뷰어를 열면 이 리비전의 모델 목록을 선택할 수 있습니다.
                </p>
              ) : modelListLoading ? (
                <p style={{ margin: 0, color: '#64748b' }}>모델 목록 불러오는 중…</p>
              ) : modelListError ? (
                <p style={{ margin: 0, color: 'var(--error, #dc2626)' }}>{modelListError}</p>
              ) : loadableModels.length === 0 ? (
                <p style={{ margin: 0, color: '#64748b' }}>이 리비전에 파일이 등록된 모델이 없습니다. 모델 관리에서 IFC 파일을 등록해 주세요.</p>
              ) : (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#64748b' }}>불러올 모델을 체크한 뒤 &quot;선택한 모델 열기&quot;를 누르세요.</p>
              )}
              {designRevisionId && loadableModels.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {loadableModels.map((m) => (
                    <li key={m.id} style={{ marginBottom: 6 }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '0.5rem 0',
                          cursor: 'pointer',
                          fontSize: '0.9375rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={popupSelectedIds.has(m.id)}
                          onChange={(e) => handlePopupToggleModel(m.id, e.target.checked)}
                          style={{ width: 18, height: 18, margin: 0, cursor: 'pointer' }}
                          aria-label={m.title || m.file_name || m.id}
                        />
                        <span style={{ fontWeight: 500 }}>{m.title || '(제목 없음)'}</span>
                        {m.file_name && <span style={{ fontSize: 12, color: '#94a3b8' }}>{m.file_name}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--main-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {designRevisionId && loadableModels.length > 0 ? (
                <>
                  <button type="button" className="btn btn--secondary" onClick={closeModelSelectPopup}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handlePopupOpenSelected}
                    disabled={popupSelectedIds.size === 0}
                  >
                    선택한 모델 열기
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--primary" onClick={closeModelSelectPopup}>
                  닫기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 플로팅/도킹: 객체 정보 (선택 시에만 표시) */}
      {selectedInfo != null && (
        <div
          aria-label="선택 부재 정보"
          style={{
            ...(infoPanelDock === 'float' ? floatPanelStyle : {}),
            ...(infoPanelDock === 'float'
              ? { left: floatInfoPos.x, top: floatInfoPos.y, width: infoPanelWidth, minWidth: INFO_PANEL_MIN_WIDTH, maxWidth: INFO_PANEL_MAX_WIDTH, maxHeight: floatPanelStyle.maxHeight }
              : infoPanelDock === 'left'
                ? { position: 'absolute' as const, zIndex: 1000, left: 0, top: 0, bottom: 0, width: infoPanelWidth, minWidth: INFO_PANEL_MIN_WIDTH, maxWidth: INFO_PANEL_MAX_WIDTH, borderRadius: '0 8px 8px 0', background: floatPanelStyle.background, backdropFilter: floatPanelStyle.backdropFilter, boxShadow: floatPanelStyle.boxShadow, border: floatPanelStyle.border, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const }
                : { position: 'absolute' as const, zIndex: 1000, right: 0, top: 0, bottom: 0, width: infoPanelWidth, minWidth: INFO_PANEL_MIN_WIDTH, maxWidth: INFO_PANEL_MAX_WIDTH, borderRadius: '8px 0 0 8px', background: floatPanelStyle.background, backdropFilter: floatPanelStyle.backdropFilter, boxShadow: floatPanelStyle.boxShadow, border: floatPanelStyle.border, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const }),
          }}
        >
          {infoPanelDock === 'right' && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startInfoPanelResize}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: 'ew-resize',
                zIndex: 1,
              }}
              title="너비 조절"
            />
          )}
          {infoPanelDock === 'left' && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startInfoPanelResize}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: 'ew-resize',
                zIndex: 1,
              }}
              title="너비 조절"
            />
          )}
          {infoPanelDock === 'float' && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startInfoPanelResize}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: 'ew-resize',
                zIndex: 1,
              }}
              title="너비 조절"
            />
          )}
          <div
            role="button"
            tabIndex={0}
            style={{
              ...floatHeaderStyle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              cursor: infoPanelDock === 'float' ? 'grab' : 'default',
            }}
            onMouseDown={(e) => startFloatDrag('info', e)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).click()}
          >
            <span>객체 정보</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                title="좌측에 고정"
                aria-label="좌측에 고정"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setInfoPanelDock('left')}
                style={{
                  padding: 4,
                  border: 'none',
                  background: infoPanelDock === 'left' ? '#0d7377' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: infoPanelDock === 'left' ? '#fff' : '#9ca3af',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="4" width="6" height="16" rx="1" />
                  <rect x="10" y="4" width="12" height="16" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                title="우측에 고정"
                aria-label="우측에 고정"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setInfoPanelDock('right')}
                style={{
                  padding: 4,
                  border: 'none',
                  background: infoPanelDock === 'right' ? '#0d7377' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: infoPanelDock === 'right' ? '#fff' : '#9ca3af',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="2" y="4" width="12" height="16" rx="1" />
                  <rect x="16" y="4" width="6" height="16" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                title="떠 있음 (드래그 이동)"
                aria-label="떠 있음"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setInfoPanelDock('float')}
                style={{
                  padding: 4,
                  border: 'none',
                  background: infoPanelDock === 'float' ? '#0d7377' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 4,
                  color: infoPanelDock === 'float' ? '#fff' : '#9ca3af',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 9l-3 3 3 3" />
                  <path d="M9 5l3-3 3 3" />
                  <path d="M15 19l-3 3-3-3" />
                  <path d="M19 9l3 3-3 3" />
                </svg>
              </button>
            </div>
          </div>
          <div style={{ overflow: 'auto', padding: 0, flex: 1, minHeight: 0, background: floatPanelContentBg }}>
            <ObjectPropertiesTable
              obj={selectedInfo}
              expanded={objectInfoExpanded}
              onToggle={(path) => {
                setObjectInfoExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              }}
            />
          </div>
        </div>
      )}

      {/* 좌측 하단: 레이와 교차하는 객체 수 */}
      {status === 'ready' && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            left: 12,
            bottom: 12,
            padding: '6px 12px',
            background: 'rgba(45, 45, 45, 0.9)',
            border: '1px solid rgba(64, 64, 64, 0.8)',
            borderRadius: 6,
            fontSize: 13,
            color: '#e0e0e0',
            zIndex: 500,
          }}
        >
          레이 교차 객체: {rayHitCount}개
        </div>
      )}

      {/* 우측 하단: 선택된 객체 수 */}
      {status === 'ready' && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 12,
            bottom: 12,
            padding: '6px 12px',
            background: 'rgba(45, 45, 45, 0.9)',
            border: '1px solid rgba(64, 64, 64, 0.8)',
            borderRadius: 6,
            fontSize: 13,
            color: '#e0e0e0',
            zIndex: 500,
          }}
        >
          선택된 객체: {selectedCount}개
        </div>
      )}
    </div>
  )
}
