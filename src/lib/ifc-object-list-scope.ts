/**
 * 모델 뷰어·Trimble 하단 객체 목록: "공간·어셈블리만" 모드용 IFC/표시 타입 판별
 * (벽·보 등 부재 전부를 색인하지 않아 GUID 매칭·속성 로딩이 빨라짐)
 */
export type ObjectListScopeMode = 'all' | 'spatial'

export const MODELVIEWER_OBJECT_SCOPE_KEY = 'sbim-modelviewer-object-scope'
export const TRIMBLE_OBJECT_SCOPE_KEY = 'sbim-trimble-object-scope'

const SPATIAL_IFC_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE',
  'IFCELEMENTASSEMBLY',
  'IFCSPATIALZONE',
  'IFCZONE',
  'IFCFACILITY',
  'IFCFACILITYPART',
  'IFCGRID',
])

function normalizeIfcTypeKey(t: string): string {
  return String(t || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

/** web-ifc / 공간 트리 노드의 type 문자열 (예: IFCBUILDINGSTOREY) */
export function isSpatialOrAssemblyIfcType(type: string): boolean {
  const u = normalizeIfcTypeKey(type)
  if (!u) return false
  if (SPATIAL_IFC_TYPES.has(u)) return true
  if (u.includes('ASSEMBLY')) return true
  if (u.includes('STOREY') || u.includes('BUILDINGSTOREY')) return true
  return false
}

/** Trimble ObjectProperties.class 등 (예: IfcBuildingStorey, IFCWALL) */
export function isSpatialOrAssemblyDisplayClass(cls: string | undefined | null): boolean {
  if (cls == null || String(cls).trim() === '') return false
  const u = normalizeIfcTypeKey(cls)
  if (SPATIAL_IFC_TYPES.has(u)) return true
  if (u.includes('ASSEMBLY')) return true
  if (u.includes('STOREY')) return true
  return false
}

export function loadObjectListScope(storageKey: string, fallback: ObjectListScopeMode): ObjectListScopeMode {
  try {
    const v = sessionStorage.getItem(storageKey)
    if (v === 'spatial' || v === 'all') return v
  } catch {
    /* ignore */
  }
  return fallback
}

export function saveObjectListScope(storageKey: string, mode: ObjectListScopeMode) {
  try {
    sessionStorage.setItem(storageKey, mode)
  } catch {
    /* ignore */
  }
}
