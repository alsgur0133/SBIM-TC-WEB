import { API_BASE } from './config'

export interface DesignPhase {
  id: string
  name: string
  sort_order: number
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface DesignRevision {
  id: string
  design_phase_id: string
  revision_name: string
  planned_date: string | null
  actual_date: string | null
  status: string
  memo: string | null
  created_at: string
  updated_at: string
}

interface PhasesResponse {
  success: boolean
  error?: string
  phases?: DesignPhase[]
}

/** 설계일정 저장 후 Trimble Connect 폴더 동기화 결과(선택) */
export type TrimbleScheduleFolderSync =
  | { skipped: true; reason: string; hint?: string }
  | {
      ok: true
      path: string
      phaseFolderId?: string
      revisionFolderId?: string
      phaseExisted?: boolean
      revisionExisted?: boolean
      renamed?: boolean
    }
  | { ok: true; note?: string }
  | { ok: false; error: string; status?: number; hint?: string }

interface ScheduleDeleteResponse {
  success: boolean
  error?: string
  message?: string
  trimbleFolders?: TrimbleScheduleFolderSync | null
}

interface PhaseMutateResponse {
  success: boolean
  error?: string
  phase?: DesignPhase
  message?: string
  trimbleFolders?: TrimbleScheduleFolderSync | null
}

interface RevisionsResponse {
  success: boolean
  error?: string
  revisions?: DesignRevision[]
}

interface RevisionMutateResponse {
  success: boolean
  error?: string
  revision?: DesignRevision
  message?: string
  trimbleFolders?: TrimbleScheduleFolderSync | null
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

async function post<T>(path: string, body: object): Promise<T> {
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

async function del<T extends { success: boolean; error?: string; message?: string } = { success: boolean; error?: string; message?: string }>(
  path: string
): Promise<T> {
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
  return data as T
}

export async function getPhasesApi(projectId?: string): Promise<PhasesResponse> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return get<PhasesResponse>(`/api/design-schedule/phases${q}`)
}

/** sort_order는 서버에서 프로젝트별로 자동 부여합니다. */
export async function createPhaseApi(
  userEmail: string,
  name: string,
  projectId?: string,
  trimbleAccessToken?: string
): Promise<PhaseMutateResponse> {
  return post<PhaseMutateResponse>('/api/design-schedule/phases', {
    userEmail,
    name,
    project_id: projectId || null,
    ...(trimbleAccessToken ? { trimbleAccessToken } : {}),
  })
}

export async function updatePhaseApi(
  userEmail: string,
  phaseId: string,
  name: string,
  sortOrder?: number,
  projectId?: string,
  trimbleAccessToken?: string
): Promise<PhaseMutateResponse> {
  return put<PhaseMutateResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}`, {
    userEmail,
    name,
    sort_order: sortOrder ?? 0,
    project_id: projectId ?? null,
    ...(trimbleAccessToken ? { trimbleAccessToken } : {}),
  })
}

export async function deletePhaseApi(
  userEmail: string,
  phaseId: string,
  trimbleAccessToken?: string
): Promise<ScheduleDeleteResponse> {
  const q = new URLSearchParams({ userEmail })
  if (trimbleAccessToken) q.set('trimbleAccessToken', trimbleAccessToken)
  return del<ScheduleDeleteResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}?${q.toString()}`)
}

export async function getRevisionsApi(phaseId: string): Promise<RevisionsResponse> {
  return get<RevisionsResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}/revisions`)
}

export async function createRevisionApi(
  userEmail: string,
  phaseId: string,
  revisionName: string,
  plannedDate?: string,
  actualDate?: string,
  status?: string,
  memo?: string,
  trimbleAccessToken?: string
): Promise<RevisionMutateResponse> {
  return post<RevisionMutateResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}/revisions`, {
    userEmail,
    revision_name: revisionName,
    planned_date: plannedDate || null,
    actual_date: actualDate || null,
    status: status || '예정',
    memo: memo || null,
    ...(trimbleAccessToken ? { trimbleAccessToken } : {}),
  })
}

export async function updateRevisionApi(
  userEmail: string,
  revisionId: string,
  revisionName: string,
  plannedDate?: string,
  actualDate?: string,
  status?: string,
  memo?: string,
  trimbleAccessToken?: string
): Promise<RevisionMutateResponse> {
  return put<RevisionMutateResponse>(`/api/design-schedule/revisions/${encodeURIComponent(revisionId)}`, {
    userEmail,
    revision_name: revisionName,
    planned_date: plannedDate || null,
    actual_date: actualDate || null,
    status: status || '예정',
    memo: memo || null,
    ...(trimbleAccessToken ? { trimbleAccessToken } : {}),
  })
}

export async function deleteRevisionApi(
  userEmail: string,
  revisionId: string,
  trimbleAccessToken?: string
): Promise<ScheduleDeleteResponse> {
  const q = new URLSearchParams({ userEmail })
  if (trimbleAccessToken) q.set('trimbleAccessToken', trimbleAccessToken)
  return del<ScheduleDeleteResponse>(`/api/design-schedule/revisions/${encodeURIComponent(revisionId)}?${q.toString()}`)
}
