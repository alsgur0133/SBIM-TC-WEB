import { API_BASE } from './config'

export interface QuantityFile {
  id: string
  design_revision_id: string
  title: string
  memo: string | null
  file_name: string | null
  file_path: string | null
  created_at: string
  updated_at: string
}

export interface QuantityFileItem {
  id: number
  quantity_file_id: string
  sort_order: number
  dong: string | null
  floor: string | null
  sign: string | null
  name: string | null
  spec: string | null
  formula: string | null
  result_value: string | null
  item_type: string | null
  guid: string | null
}

/** GET /api/quantity-revision/items — 소속 물량파일 제목 포함 */
export interface QuantityRevisionItem extends QuantityFileItem {
  file_title: string
}

interface FileItemsResponse {
  success: boolean
  error?: string
  fileTitle?: string
  items?: QuantityFileItem[]
  total?: number
}

interface FilesResponse {
  success: boolean
  error?: string
  files?: QuantityFile[]
}

interface FileMutateResponse {
  success: boolean
  error?: string
  file?: QuantityFile
  message?: string
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

async function postJson<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
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

export function getQuantityFileDownloadUrl(fileId: string): string {
  return `${API_BASE}/api/quantity-files/${encodeURIComponent(fileId)}/file`
}

export async function getQuantityFilesApi(designRevisionId: string): Promise<FilesResponse> {
  return get<FilesResponse>(
    `/api/quantity-files?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export interface QuantityRevisionStats {
  success: boolean
  fileCount: number
  itemCount: number
  byFile: { id: string; title: string; itemCount: number }[]
}

export async function getQuantityRevisionStatsApi(designRevisionId: string): Promise<QuantityRevisionStats> {
  return get<QuantityRevisionStats>(
    `/api/quantity-revision/stats?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function getQuantityRevisionItemsApi(
  designRevisionId: string,
  options?: {
    quantityFileId?: string
    search?: string
    limit?: number
    offset?: number
  }
): Promise<{ success: boolean; items: QuantityRevisionItem[]; total: number }> {
  const q = new URLSearchParams({ designRevisionId })
  if (options?.quantityFileId) q.set('quantityFileId', options.quantityFileId)
  if (options?.search?.trim()) q.set('search', options.search.trim())
  q.set('limit', String(options?.limit ?? 100))
  q.set('offset', String(options?.offset ?? 0))
  return get<{ success: boolean; items: QuantityRevisionItem[]; total: number }>(
    `/api/quantity-revision/items?${q.toString()}`
  )
}

/** 단일 물량파일 B.O.M 보기용: 페이지를 넘겨 전체 행 수집 */
export async function getAllQuantityRevisionItemsApi(
  designRevisionId: string,
  quantityFileId: string,
  options?: { search?: string }
): Promise<{ items: QuantityRevisionItem[]; total: number }> {
  const batch = 2000
  let offset = 0
  const items: QuantityRevisionItem[] = []
  let total = 0
  const search = options?.search?.trim()
  for (;;) {
    const res = await getQuantityRevisionItemsApi(designRevisionId, {
      quantityFileId,
      search,
      limit: batch,
      offset,
    })
    total = res.total
    const chunk = res.items ?? []
    items.push(...chunk)
    if (chunk.length < batch || items.length >= total) break
    offset += batch
  }
  return { items, total }
}

/** 구버전 API 전용: 파일별 items 전체 (file_title 주입) */
export async function getAllQuantityFileItemsAsRevisionApi(
  fileId: string,
  fileTitle: string
): Promise<QuantityRevisionItem[]> {
  const batch = 2000
  let offset = 0
  const out: QuantityRevisionItem[] = []
  let total = 0
  for (;;) {
    const res = await getQuantityFileItemsApi(fileId, { limit: batch, offset })
    total = res.total ?? 0
    const chunk = res.items ?? []
    for (const it of chunk) {
      out.push({ ...it, file_title: fileTitle })
    }
    if (chunk.length < batch || out.length >= total) break
    offset += batch
  }
  return out
}

const DEFAULT_ITEMS_PAGE_SIZE = 200

export async function getQuantityFileItemsApi(
  fileId: string,
  options?: {
    limit?: number
    offset?: number
    dong?: string
    floor?: string
    signType?: string
    signCode?: string
    search?: string
  }
): Promise<FileItemsResponse> {
  const limit = options?.limit ?? DEFAULT_ITEMS_PAGE_SIZE
  const offset = options?.offset ?? 0
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (options?.dong?.trim()) q.set('dong', options.dong.trim())
  if (options?.floor?.trim()) q.set('floor', options.floor.trim())
  if (options?.signType?.trim()) q.set('signType', options.signType.trim())
  if (options?.signCode?.trim()) q.set('signCode', options.signCode.trim())
  if (options?.search?.trim()) q.set('search', options.search.trim())
  return get<FileItemsResponse>(
    `/api/quantity-files/${encodeURIComponent(fileId)}/items?${q.toString()}`
  )
}

export async function reparseQuantityFileApi(
  userEmail: string,
  fileId: string
): Promise<{ success: boolean; error?: string; items?: QuantityFileItem[]; message?: string }> {
  const res = await fetch(
    `${API_BASE}/api/quantity-files/${encodeURIComponent(fileId)}/reparse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail }),
    }
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
  return data as { success: boolean; error?: string; items?: QuantityFileItem[]; message?: string }
}

export type QuantityFileItemInput = {
  dong?: string | null
  floor?: string | null
  sign?: string | null
  name?: string | null
  spec?: string | null
  formula?: string | null
  result_value?: string | null
  item_type?: string | null
  guid?: string | null
}

export async function updateQuantityFileItemApi(
  userEmail: string,
  itemId: number,
  fields: QuantityFileItemInput
): Promise<{ success: boolean; item?: QuantityFileItem; error?: string }> {
  return put<{ success: boolean; item?: QuantityFileItem; error?: string }>(
    `/api/quantity-file-items/${encodeURIComponent(String(itemId))}`,
    { userEmail, ...fields }
  )
}

export async function deleteQuantityFileItemApi(
  userEmail: string,
  itemId: number
): Promise<{ success: boolean; message?: string }> {
  return del(
    `/api/quantity-file-items/${encodeURIComponent(String(itemId))}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

export async function bulkDeleteQuantityFileItemsApi(
  userEmail: string,
  ids: number[]
): Promise<{ success: boolean; deleted?: number; message?: string }> {
  return postJson<{ success: boolean; deleted?: number; message?: string }>(
    '/api/quantity-file-items/bulk-delete',
    { userEmail, ids }
  )
}

export async function createQuantityFileItemApi(
  userEmail: string,
  fileId: string,
  fields: QuantityFileItemInput
): Promise<{ success: boolean; item?: QuantityFileItem; error?: string }> {
  return postJson<{ success: boolean; item?: QuantityFileItem; error?: string }>(
    `/api/quantity-files/${encodeURIComponent(fileId)}/items`,
    { userEmail, ...fields }
  )
}

export async function createQuantityFileApi(
  userEmail: string,
  designRevisionId: string,
  title: string,
  file: File,
  memo?: string
): Promise<FileMutateResponse> {
  const form = new FormData()
  form.append('userEmail', userEmail)
  form.append('designRevisionId', designRevisionId)
  form.append('title', title.trim())
  if (memo?.trim()) form.append('memo', memo.trim())
  form.append('file', file)
  form.append('fileName', file.name)
  try {
    form.append('fileNameB64', toBase64Utf8(file.name))
  } catch {
    form.append('fileNameB64', btoa(unescape(encodeURIComponent(file.name))))
  }
  const res = await fetch(`${API_BASE}/api/quantity-files`, {
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
  return data as FileMutateResponse
}

export async function updateQuantityFileApi(
  userEmail: string,
  fileId: string,
  title: string,
  memo?: string
): Promise<FileMutateResponse> {
  return put<FileMutateResponse>(`/api/quantity-files/${encodeURIComponent(fileId)}`, {
    userEmail,
    title: title.trim(),
    memo: memo?.trim() || null,
  })
}

export async function deleteQuantityFileApi(
  userEmail: string,
  fileId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/quantity-files/${encodeURIComponent(fileId)}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

// -----------------------------------------------------------------------------
// 명칭 매핑 (명칭 → 콘크리트/거푸집/철근)
// -----------------------------------------------------------------------------
export const NAME_CATEGORIES = ['콘크리트', '거푸집', '철근'] as const
export type NameCategory = (typeof NAME_CATEGORIES)[number]

export interface QuantityNameMapping {
  id: number
  name_pattern: string
  category: string
  sort_order: number
  created_at: string
}

export async function getQuantityDistinctNamesApi(
  designRevisionId: string
): Promise<{ success: boolean; names?: string[]; error?: string }> {
  return get<{ success: boolean; names?: string[]; error?: string }>(
    `/api/quantity-files/distinct-names?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function getQuantityNameMappingsApi(): Promise<{
  success: boolean
  items?: QuantityNameMapping[]
  error?: string
}> {
  return get<{ success: boolean; items?: QuantityNameMapping[]; error?: string }>(
    '/api/quantity-name-mappings'
  )
}

export async function createQuantityNameMappingApi(
  userEmail: string,
  name_pattern: string,
  category: string
): Promise<{ success: boolean; item?: QuantityNameMapping; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-name-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, name_pattern: name_pattern.trim(), category }),
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
  return data as { success: boolean; item?: QuantityNameMapping; error?: string }
}

export async function deleteQuantityNameMappingApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/quantity-name-mappings/${id}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

// -----------------------------------------------------------------------------
// 규격 매핑 (규격 → 콘크리트/거푸집/철근)
// -----------------------------------------------------------------------------
export interface QuantitySpec {
  id: number
  spec_value: string
  category: string
  sort_order: number
  created_at: string
}

export async function getQuantityDistinctSpecsApi(
  designRevisionId: string
): Promise<{ success: boolean; specs?: string[]; error?: string }> {
  return get<{ success: boolean; specs?: string[]; error?: string }>(
    `/api/quantity-files/distinct-specs?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function getQuantityDistinctDongsApi(
  designRevisionId: string
): Promise<{ success: boolean; dongs?: string[]; error?: string }> {
  return get<{ success: boolean; dongs?: string[]; error?: string }>(
    `/api/quantity-files/distinct-dongs?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function getQuantityDistinctFloorsApi(
  designRevisionId: string
): Promise<{ success: boolean; floors?: string[]; error?: string }> {
  return get<{ success: boolean; floors?: string[]; error?: string }>(
    `/api/quantity-files/distinct-floors?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

/** 부재별산출서 필터용: 리비전 전체 물량 데이터 기준 동/층/부재유형/부호 목록 */
export async function getQuantityDataModalFiltersApi(designRevisionId: string): Promise<{
  success: boolean
  dongs?: string[]
  floors?: string[]
  signTypes?: string[]
  signCodes?: string[]
  error?: string
}> {
  return get<{
    success: boolean
    dongs?: string[]
    floors?: string[]
    signTypes?: string[]
    signCodes?: string[]
    error?: string
  }>(`/api/quantity-files/data-modal-filters?designRevisionId=${encodeURIComponent(designRevisionId)}`)
}

/** 부재별산출서 모달 필터용: 해당 물량파일 내에 존재하는 동/층/부재유형/부호 목록 (선택한 파일에만 있는 값만 노출) */
export async function getQuantityFileDataModalFiltersApi(quantityFileId: string): Promise<{
  success: boolean
  dongs?: string[]
  floors?: string[]
  signTypes?: string[]
  signCodes?: string[]
  error?: string
}> {
  return get<{
    success: boolean
    dongs?: string[]
    floors?: string[]
    signTypes?: string[]
    signCodes?: string[]
    error?: string
  }>(`/api/quantity-files/${encodeURIComponent(quantityFileId)}/data-modal-filters`)
}

// -----------------------------------------------------------------------------
// 동 목록 (quantity_dongs)
// -----------------------------------------------------------------------------
export interface QuantityDong {
  id: number
  dong_value: string
  sort_order: number
  gross_area?: number | null
  created_at: string
}

export async function getQuantityDongsApi(): Promise<{
  success: boolean
  items?: QuantityDong[]
  error?: string
}> {
  return get<{ success: boolean; items?: QuantityDong[]; error?: string }>(
    '/api/quantity-dongs'
  )
}

export async function createQuantityDongApi(
  userEmail: string,
  dong_value: string
): Promise<{ success: boolean; item?: QuantityDong; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-dongs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, dong_value: dong_value.trim() }),
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
  return data as { success: boolean; item?: QuantityDong; error?: string }
}

export async function updateQuantityDongApi(
  userEmail: string,
  id: number,
  body: { dong_value?: string; gross_area?: number | null }
): Promise<{ success: boolean; item?: QuantityDong; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-dongs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, ...body }),
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
  return data as { success: boolean; item?: QuantityDong; error?: string }
}

export async function deleteQuantityDongApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/quantity-dongs/${id}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

export async function updateQuantityDongsOrderApi(
  userEmail: string,
  order: number[]
): Promise<{ success: boolean; error?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-dongs/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, order }),
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
  return data as { success: boolean; error?: string; message?: string }
}

// -----------------------------------------------------------------------------
// 층 목록 (quantity_floors)
// -----------------------------------------------------------------------------
export interface QuantityFloor {
  id: number
  floor_value: string
  sort_order: number
  created_at: string
}

export async function getQuantityFloorsApi(): Promise<{
  success: boolean
  items?: QuantityFloor[]
  error?: string
}> {
  return get<{ success: boolean; items?: QuantityFloor[]; error?: string }>(
    '/api/quantity-floors'
  )
}

export async function createQuantityFloorApi(
  userEmail: string,
  floor_value: string
): Promise<{ success: boolean; item?: QuantityFloor; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-floors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, floor_value: floor_value.trim() }),
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
  return data as { success: boolean; item?: QuantityFloor; error?: string }
}

export async function updateQuantityFloorApi(
  userEmail: string,
  id: number,
  body: { floor_value: string }
): Promise<{ success: boolean; item?: QuantityFloor; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-floors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, floor_value: body.floor_value.trim() }),
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
  return data as { success: boolean; item?: QuantityFloor; error?: string }
}

export async function deleteQuantityFloorApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/quantity-floors/${id}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

export async function updateQuantityFloorsOrderApi(
  userEmail: string,
  order: number[]
): Promise<{ success: boolean; error?: string; message?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-floors/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, order }),
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
  return data as { success: boolean; error?: string; message?: string }
}

export async function getQuantitySpecsApi(): Promise<{
  success: boolean
  items?: QuantitySpec[]
  error?: string
}> {
  return get<{ success: boolean; items?: QuantitySpec[]; error?: string }>(
    '/api/quantity-specs'
  )
}

export async function createQuantitySpecApi(
  userEmail: string,
  spec_value: string,
  category: string
): Promise<{ success: boolean; item?: QuantitySpec; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-specs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, spec_value: spec_value.trim(), category }),
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
  return data as { success: boolean; item?: QuantitySpec; error?: string }
}

export async function updateQuantitySpecApi(
  userEmail: string,
  id: number,
  body: { spec_value?: string; category?: string }
): Promise<{ success: boolean; item?: QuantitySpec; error?: string }> {
  const res = await fetch(`${API_BASE}/api/quantity-specs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userEmail,
      ...(body.spec_value != null ? { spec_value: body.spec_value.trim() } : {}),
      ...(body.category != null ? { category: body.category.trim() } : {}),
    }),
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
  return data as { success: boolean; item?: QuantitySpec; error?: string }
}

export async function deleteQuantitySpecApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/quantity-specs/${id}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

// -----------------------------------------------------------------------------
// 물량집계 (동/층별 자재분류·규격 합계)
// -----------------------------------------------------------------------------
export interface QuantitySummaryRow {
  dong: string
  floor: string
}

/** 동·층·부재유형별 집계 행 (층-부재별집계표) */
export interface QuantitySummaryItemTypeRow {
  dong: string
  floor: string
  item_type: string
}

export interface QuantitySummaryData {
  concrete: Record<string, number>
  formwork: Record<string, number>
  /** 일반 철근 (부재유형에 구조/시공 미포함) */
  rebar: Record<string, number>
  /** 부재유형에「구조」포함 시 */
  rebarStructural?: Record<string, number>
  /** 부재유형에「시공」포함 시 */
  rebarConstruction?: Record<string, number>
}

export async function getQuantitySummaryApi(designRevisionId: string): Promise<{
  success: boolean
  rows?: QuantitySummaryRow[]
  concreteColumns?: string[]
  formworkColumns?: string[]
  rebarColumns?: string[]
  data?: Record<string, QuantitySummaryData>
  itemTypeRows?: QuantitySummaryItemTypeRow[]
  itemTypeData?: Record<string, QuantitySummaryData>
  error?: string
}> {
  return get<{
    success: boolean
    rows?: QuantitySummaryRow[]
    concreteColumns?: string[]
    formworkColumns?: string[]
    rebarColumns?: string[]
    data?: Record<string, QuantitySummaryData>
    itemTypeRows?: QuantitySummaryItemTypeRow[]
    itemTypeData?: Record<string, QuantitySummaryData>
    error?: string
  }>(`/api/quantity-summary?designRevisionId=${encodeURIComponent(designRevisionId)}`)
}
