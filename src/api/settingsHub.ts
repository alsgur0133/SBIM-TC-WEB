import { API_BASE } from './config'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'GET' })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as T
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
    /* ignore */
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as T
}

async function putJson<T>(path: string, body: object): Promise<T> {
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
    /* ignore */
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
    /* ignore */
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `요청에 실패했습니다. (${res.status})`)
  }
  return data as { success: boolean; error?: string; message?: string }
}

// -----------------------------------------------------------------------------
// 부재 매핑
// -----------------------------------------------------------------------------
export interface QuantityItemTypeMapping {
  id: number
  item_label: string
  model_property: string
  segment: string | null
  sort_order: number
  created_at: string
}

export async function getQuantityItemTypeMappingsApi(): Promise<{
  success: boolean
  items?: QuantityItemTypeMapping[]
}> {
  return get('/api/quantity-item-type-mappings')
}

export async function createQuantityItemTypeMappingApi(
  userEmail: string,
  body: { item_label: string; model_property: string; segment?: string }
): Promise<{ success: boolean; item?: QuantityItemTypeMapping; error?: string }> {
  return postJson('/api/quantity-item-type-mappings', { userEmail, ...body })
}

export async function updateQuantityItemTypeMappingApi(
  userEmail: string,
  id: number,
  body: Partial<Pick<QuantityItemTypeMapping, 'item_label' | 'model_property' | 'sort_order'>> & {
    segment?: string | null
  }
): Promise<{ success: boolean; item?: QuantityItemTypeMapping; error?: string }> {
  return putJson(`/api/quantity-item-type-mappings/${id}`, { userEmail, ...body })
}

export async function deleteQuantityItemTypeMappingApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; message?: string }> {
  return del(`/api/quantity-item-type-mappings/${id}?userEmail=${encodeURIComponent(userEmail)}`)
}

// -----------------------------------------------------------------------------
// 철근 데이터베이스 (프로젝트별)
// -----------------------------------------------------------------------------
export type RebarDbSection =
  | 'schedule_wall'
  | 'schedule_lintel'
  | 'schedule_column'
  | 'length_stock'
  | 'length_lap'
  | 'common_wall'
  | 'common_lintel'
  | 'common_column'

export interface RebarDatabaseRow {
  id: number
  project_id: string
  section: string
  sort_order: number
  data: Record<string, string>
  created_at: string
  updated_at: string
}

export async function getRebarDatabaseRowsApi(
  projectId: string,
  section: RebarDbSection
): Promise<{ success: boolean; items?: RebarDatabaseRow[] }> {
  const q = new URLSearchParams({ projectId, section })
  return get(`/api/rebar-database-rows?${q}`)
}

export async function createRebarDatabaseRowApi(
  userEmail: string,
  projectId: string,
  section: RebarDbSection,
  data: Record<string, string>
): Promise<{ success: boolean; item?: RebarDatabaseRow }> {
  return postJson('/api/rebar-database-rows', { userEmail, projectId, section, data })
}

export async function updateRebarDatabaseRowApi(
  userEmail: string,
  id: number,
  body: { data?: Record<string, string>; sort_order?: number }
): Promise<{ success: boolean; item?: RebarDatabaseRow }> {
  return putJson(`/api/rebar-database-rows/${id}`, { userEmail, ...body })
}

export async function deleteRebarDatabaseRowApi(
  userEmail: string,
  id: number
): Promise<{ success: boolean; message?: string }> {
  return del(`/api/rebar-database-rows/${id}?userEmail=${encodeURIComponent(userEmail)}`)
}
