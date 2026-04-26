import type { ObjectProperties } from 'trimble-connect-workspace-api'

export function normalizeIfcGuid(s: string): string {
  return String(s)
    .trim()
    .replace(/[{}]/g, '')
    .replace(/-/g, '')
    .replace(/#/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

function propNameLooksLikeGlobalId(name: string): boolean {
  const compact = name.replace(/\s+/g, '').toLowerCase()
  if (compact.includes('globalid')) return true
  if (compact.includes('globaluniqueid')) return true
  if (compact.includes('globallyunique')) return true
  if (compact.includes('global') && compact.includes('id')) return true
  if (compact === 'guid' || compact.endsWith('.guid')) return true
  return false
}

/** IFC 2x3 GlobalId 문자열(22자 Base64 변형) 또는 UUID 형태 */
function looksLikeIfcGlobalIdValue(raw: string): boolean {
  const s = String(raw).trim().replace(/[{}#]/g, '')
  if (!s) return false
  if (/^[0-9A-Za-z_$]{22}$/.test(s)) return true
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return true
  return false
}

/** Trimble getObjects/getObjectProperties 의 속성에서 IFC GlobalId 추출 */
export function findGlobalIdInTrimbleObject(obj: ObjectProperties): string | null {
  const sets = obj.properties ?? []
  for (const ps of sets) {
    for (const p of ps.properties ?? []) {
      if (!propNameLooksLikeGlobalId(p.name ?? '')) continue
      const v = p.value
      if (v == null) continue
      if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
        const val = (v as { value: unknown }).value
        if (val != null) return String(val)
        continue
      }
      const s = String(v).trim()
      if (s) return s
    }
  }
  /** 이름이 덜 명확해도 값이 IFC GlobalId 패턴이면 채택 (Trimble은 키 이름이 제각각인 경우가 많음) */
  const hints: string[] = []
  const any: string[] = []
  for (const { name, value } of flattenTrimblePropertyLines(obj, 2000)) {
    const v = value.trim()
    if (!looksLikeIfcGlobalIdValue(v)) continue
    if (propNameLooksLikeGlobalId(name) || /guid|global|unique/i.test(name)) hints.push(v)
    else any.push(v)
  }
  if (hints.length === 1) return hints[0]
  if (hints.length > 1) {
    const norm = hints.map((g) => normalizeIfcGuid(g))
    const uniq = new Set(norm)
    if (uniq.size === 1) return hints[0]
  }
  if (any.length === 1) return any[0]
  const uniqNorm = new Set(any.map((g) => normalizeIfcGuid(g)))
  if (uniqNorm.size === 1 && any[0]) return any[0]
  return null
}

function formatPropVal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    const o = (v as { value: unknown }).value
    return o == null ? '—' : String(o)
  }
  return String(v)
}

/** 목록·상세용: 모든 속성을 평탄화 */
export function flattenTrimblePropertyLines(
  obj: ObjectProperties,
  maxLines = 500
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  const sets = obj.properties ?? []
  for (const ps of sets) {
    const psetName = ps.name ?? ''
    for (const p of ps.properties ?? []) {
      if (out.length >= maxLines) return out
      const name = psetName ? `${psetName} · ${p.name ?? ''}` : (p.name ?? '')
      out.push({ name, value: formatPropVal(p.value) })
    }
  }
  return out
}

export function trimbleObjectDisplayName(obj: ObjectProperties): string {
  const n = obj.product?.name?.trim()
  if (n) return n
  const t = obj.product?.objectType?.trim()
  if (t) return t
  return ''
}

function parsePositiveIntFromIfcPropValue(raw: string): number | null {
  const s = String(raw).trim()
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const hashEnd = s.match(/#(\d+)\s*$/)
  if (hashEnd) {
    const n = parseInt(hashEnd[1], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const paren = s.match(/\((\d+)\)\s*$/)
  if (paren) {
    const n = parseInt(paren[1], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

function propNameScoreForIfcElementId(name: string): number {
  const n = name.replace(/\s+/g, '').toLowerCase()
  if (n.includes('globalid')) return 0
  /** 뷰어 내부 인덱스(0,1,2…)를 STEP express와 혼동하지 않음 */
  if (n === 'id' || n.endsWith('·id')) return 0
  if (n.includes('runtime')) return 0
  if (n.includes('elementid') && !n.includes('material')) return 100
  if (n.includes('expressid') || (n.includes('express') && n.includes('id'))) return 92
  if (n.includes('entitylabel')) return 75
  if (n === 'tag' || n.endsWith('·tag')) return 55
  if (n.includes('lineid') || n.includes('line_id')) return 45
  if (n.includes('ifc') && n.includes('id') && !n.includes('global')) return 35
  return 0
}

/**
 * Trimble getObjectProperties 결과에서 IFC ElementId(STEP express 번호)에 해당하는 정수 추출.
 * 모델 정보 화면의 ElementId 열과 맞추기 위함.
 */
export function findIfcElementIdInTrimbleObject(obj: ObjectProperties): number | null {
  let best: { score: number; id: number } | null = null
  for (const { name, value } of flattenTrimblePropertyLines(obj, 900)) {
    const score = propNameScoreForIfcElementId(name)
    if (score <= 0) continue
    const id = parsePositiveIntFromIfcPropValue(value)
    if (id == null) continue
    if (!best || score > best.score) best = { score, id }
  }
  return best?.id ?? null
}

/**
 * 모델 정보(서버/웹-ifc)의 expressID와 Trimble getObjects 행을 연결할 때 사용.
 * GlobalId가 없거나 뷰어 속성과 형식이 다를 때 보조 매칭.
 */
export function trimbleRowMatchesExpressId(
  row: { obj: ObjectProperties; runtimeId: number; ifcElementId?: number | null },
  expressId: number
): boolean {
  if (!Number.isFinite(expressId)) return false
  const target = Math.floor(expressId)
  if (row.ifcElementId != null && Number.isFinite(row.ifcElementId) && row.ifcElementId === target) return true
  /** IFC STEP express 번호는 Trimble `objectRuntimeIds`와 다름 — runtimeId 동등 비교는 오매칭만 유발 */
  const needle = String(target)
  const lines = flattenTrimblePropertyLines(row.obj, 400)
  for (const { name, value } of lines) {
    const n = (name || '').toLowerCase()
    if (!/(express\s*id|entity\s*id|element\s*id|ifc\s*#|step\s*id|line\s*id|tag|object\s*id)/i.test(n)) continue
    const v = value.trim()
    if (v === needle || v === `#${needle}` || v.endsWith(needle)) return true
  }
  return false
}
