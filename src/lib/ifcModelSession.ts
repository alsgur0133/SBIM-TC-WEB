/**
 * 브라우저에서 IFC 파일을 열고 IFCPRODUCT(및 하위 타입) 목록·속성을 읽습니다.
 * 모델 뷰어와 동일하게 public/wasm/web-ifc.wasm 을 사용합니다.
 */

declare global {
  interface Window {
    __BASE_PATH__?: string
  }
}

export type IfcProductSummary = {
  expressID: number
  typeName: string
  name: string
  globalId: string
  objectType: string
}

export type IfcSession = {
  api: import('web-ifc').IfcAPI
  modelID: number
  close: () => void
}

function wasmLocate(path: string, prefix: string): string {
  const base =
    typeof window !== 'undefined' && window.__BASE_PATH__
      ? String(window.__BASE_PATH__).replace(/\/$/, '') + '/wasm/'
      : '/wasm/'
  return path.endsWith('.wasm') ? `${base}web-ifc.wasm` : prefix + path
}

function unwrapIfcValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object' && 'value' in v) return unwrapIfcValue((v as { value: unknown }).value)
  return ''
}

export async function createIfcSession(fileUrl: string): Promise<IfcSession> {
  const { IfcAPI } = await import('web-ifc')
  const api = new IfcAPI()
  await api.Init(wasmLocate)
  const res = await fetch(fileUrl, { credentials: 'include' })
  if (!res.ok) throw new Error(`IFC 파일을 가져올 수 없습니다. (${res.status})`)
  const buffer = new Uint8Array(await res.arrayBuffer())
  const modelID = api.OpenModel(buffer)
  return {
    api,
    modelID,
    close: () => {
      try {
        if (api.IsModelOpen(modelID)) api.CloseModel(modelID)
      } catch {
        /* ignore */
      }
    },
  }
}

const CHUNK = 200

export async function listIfcProductsInSession(
  api: import('web-ifc').IfcAPI,
  modelID: number,
  options?: { maxItems?: number; onProgress?: (done: number, total: number) => void }
): Promise<{ rows: IfcProductSummary[]; total: number; truncated: boolean }> {
  const { IFCPRODUCT } = await import('web-ifc')
  const cap = options?.maxItems
  const maxItems =
    cap != null && Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : Number.POSITIVE_INFINITY
  const vec = api.GetLineIDsWithType(modelID, IFCPRODUCT, true)
  const total = vec.size()
  const n = Number.isFinite(maxItems) ? Math.min(total, maxItems) : total
  const rows: IfcProductSummary[] = []
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(start + CHUNK, n)
    for (let i = start; i < end; i++) {
      const expressID = vec.get(i)
      let typeName = 'IFCPRODUCT'
      try {
        const tc = api.GetLineType(modelID, expressID)
        const nm = api.GetNameFromTypeCode(tc)
        if (nm) typeName = nm
      } catch {
        /* ignore */
      }
      let name = ''
      let globalId = ''
      let objectType = ''
      try {
        const line = api.GetLine(modelID, expressID, true) as Record<string, unknown> | null
        if (line && typeof line === 'object') {
          name = unwrapIfcValue(line.Name)
          globalId = unwrapIfcValue(line.GlobalId)
          objectType = unwrapIfcValue(line.ObjectType)
        }
      } catch {
        /* ignore */
      }
      rows.push({ expressID, typeName, name, globalId, objectType })
    }
    options?.onProgress?.(end, total)
    await new Promise<void>((r) => setTimeout(r, 0))
  }
  return { rows, total, truncated: Number.isFinite(maxItems) && total > maxItems }
}

export async function getIfcItemProperties(
  api: import('web-ifc').IfcAPI,
  modelID: number,
  expressID: number
): Promise<Record<string, unknown>> {
  const raw = await api.properties.getItemProperties(modelID, expressID, true)
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
}

/** IFC/web-ifc 속성 객체를 표시용 키·값 목록으로 평탄화 */
export function flattenIfcProps(obj: unknown, prefix = ''): { key: string; value: string }[] {
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
      list.push(...flattenIfcProps(v, key))
    } else {
      list.push({ key, value: Array.isArray(v) ? JSON.stringify(v) : String(v ?? '') })
    }
  }
  return list
}
