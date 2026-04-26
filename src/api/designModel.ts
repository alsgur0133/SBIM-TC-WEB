import { API_BASE } from './config'

/** 서버 ifc-extract-summary.js 가 파일에서 추출해 DB에 저장한 요약 */
export interface IfcMetaSummary {
  version?: number
  projectName?: string | null
  siteName?: string | null
  buildingName?: string | null
  fileSchema?: string[] | null
  fileDescription?: string | null
  fileName?: {
    name?: string | null
    timeStamp?: string | null
    author?: string | null
    organization?: string | null
    preprocessorVersion?: string | null
    originatingSystem?: string | null
    authorization?: string | null
  } | null
  applicationName?: string | null
  applicationVersion?: string | null
  entityCounts?: Record<string, number>
  /** IFC 엔티티 유형별 개수(부재·요소 참고용, 파일 앞부분 기준) */
  bujeByType?: Record<string, number>
  bytesRead?: number
  fileSizeBytes?: number
  truncated?: boolean
}

export interface DesignModel {
  id: string
  design_revision_id: string
  title: string
  memo: string | null
  file_name: string | null
  file_path: string | null
  file_path_dxf?: string | null
  trimble_file_id?: string | null
  trimble_version_id?: string | null
  /** Connect 백그라운드 업로드 실패 시 서버가 저장한 메시지 */
  trimble_sync_error?: string | null
  /** 서버가 .ifc 파일에서 추출해 저장 (JSON 파싱됨) */
  ifc_meta?: IfcMetaSummary | null
  ifc_meta_updated_at?: string | null
  /** 서버 STEP 스캔으로 객체 목록을 DB에 넣은 시각(있으면 모델 정보 화면이 API로 목록 로드) */
  ifc_products_updated_at?: string | null
  /** 서버가 스토리지 기준으로 채움 (목록 API) */
  file_size_bytes?: number | null
  created_at: string
  updated_at: string
}

interface ModelsResponse {
  success: boolean
  error?: string
  models?: DesignModel[]
}

/** POST /api/design-models — Trimble Connect 업로드 결과(있을 때만 의미 있음) */
export interface TrimbleUploadResult {
  status: 'uploaded' | 'skipped' | 'failed' | 'queued'
  reason?: string
  message?: string
  trimble_file_id?: string
  trimble_version_id?: string | null
}

interface ModelMutateResponse {
  success: boolean
  error?: string
  model?: DesignModel
  message?: string
  trimbleUpload?: TrimbleUploadResult | null
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET' })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as T
}

async function put<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as T
}

async function del(path: string): Promise<{ success: boolean; error?: string; message?: string }> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as { success: boolean; error?: string; message?: string }
}

export function getDesignModelFileUrl(modelId: string): string {
  return `${API_BASE}/api/design-models/${encodeURIComponent(modelId)}/file`
}

/** 서버가 .ifc에서 추출해 저장한 IfcProduct 계열 목록 (모델 정보·뷰어 최적화용) */
export interface IfcProductsDbPayload {
  version: number
  rows: Array<{
    expressID: number
    typeName: string
    name: string
    globalId: string
    objectType: string
  }>
  total: number
  truncated: boolean
  storedCount: number
}

export interface IfcProductsPagination {
  total: number
  offset: number
  limit: number
  hasMore: boolean
  nextOffset: number | null
}

export async function getDesignModelIfcProductsApi(
  modelId: string,
  page?: { offset?: number; limit?: number }
): Promise<{
  success: boolean
  cached: boolean
  updated_at?: string | null
  data?: IfcProductsDbPayload | null
  pagination?: IfcProductsPagination
  error?: string
}> {
  const qs = new URLSearchParams()
  if (page && (page.offset != null || page.limit != null)) {
    if (page.offset != null) qs.set('offset', String(page.offset))
    if (page.limit != null) qs.set('limit', String(page.limit))
  }
  const q = qs.toString()
  const res = await fetch(
    `${API_BASE}/api/design-models/${encodeURIComponent(modelId)}/ifc-products${q ? `?${q}` : ''}`
  )
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as {
    success: boolean
    cached: boolean
    updated_at?: string | null
    data?: IfcProductsDbPayload | null
    error?: string
  }
}

export async function getDesignModelsApi(designRevisionId: string): Promise<ModelsResponse> {
  return get<ModelsResponse>(
    `/api/design-models?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

function toBase64Utf8(s: string): string {
  try {
    const bytes = new TextEncoder().encode(s)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  } catch {
    return btoa(unescape(encodeURIComponent(s)))
  }
}

export async function createDesignModelApi(
  userEmail: string,
  designRevisionId: string,
  title: string,
  memo?: string,
  file?: File | null,
  options?: { trimbleAccessToken?: string }
): Promise<ModelMutateResponse> {
  const form = new FormData()
  if (file) {
    form.append('file', file)
    form.append('fileName', file.name)
    try {
      form.append('fileNameB64', btoa(unescape(encodeURIComponent(file.name))))
    } catch {
      form.append('fileNameB64', toBase64Utf8(file.name))
    }
  }
  form.append('userEmail', userEmail)
  form.append('designRevisionId', designRevisionId)
  form.append('title', title.trim())
  if (memo?.trim()) form.append('memo', memo.trim())
  const tc = options?.trimbleAccessToken?.trim()
  if (tc) form.append('trimbleAccessToken', tc)
  const res = await fetch(`${API_BASE}/api/design-models`, {
    method: 'POST',
    body: form,
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as ModelMutateResponse
}

export async function updateDesignModelApi(
  userEmail: string,
  modelId: string,
  title: string,
  memo?: string
): Promise<ModelMutateResponse> {
  return put<ModelMutateResponse>(`/api/design-models/${encodeURIComponent(modelId)}`, {
    userEmail,
    title: title.trim(),
    memo: memo?.trim() || null,
  })
}

export async function deleteDesignModelApi(
  userEmail: string,
  modelId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/design-models/${encodeURIComponent(modelId)}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

/** 등록된 DWG 모델을 DXF로 변환 (고정 경로 POST /api/design-models/convert-to-dxf) */
export async function convertDesignModelToDxfApi(
  userEmail: string,
  modelId: string
): Promise<{ success: boolean; error?: string; message?: string; model?: DesignModel }> {
  const res = await fetch(`${API_BASE}/api/design-models/convert-to-dxf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, modelId }),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `DXF 변환에 실패했습니다. (${res.status})`)
  }
  return data as { success: boolean; error?: string; message?: string; model?: DesignModel }
}

/** 서버에 저장된 IFC 파일에서 헤더·프로젝트명 등을 다시 읽어 DB 갱신 */
export async function rebuildDesignModelIfcMetaApi(
  userEmail: string,
  modelId: string
): Promise<ModelMutateResponse> {
  const res = await fetch(`${API_BASE}/api/design-models/${encodeURIComponent(modelId)}/extract-ifc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail }),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `IFC 추출에 실패했습니다. (${res.status})`)
  }
  return data as ModelMutateResponse
}
