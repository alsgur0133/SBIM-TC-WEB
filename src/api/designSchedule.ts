const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:5001')

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

interface PhaseMutateResponse {
  success: boolean
  error?: string
  phase?: DesignPhase
  message?: string
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

export async function getPhasesApi(projectId?: string): Promise<PhasesResponse> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return get<PhasesResponse>(`/api/design-schedule/phases${q}`)
}

export async function createPhaseApi(
  userEmail: string,
  name: string,
  sortOrder?: number,
  projectId?: string
): Promise<PhaseMutateResponse> {
  return post<PhaseMutateResponse>('/api/design-schedule/phases', {
    userEmail,
    name,
    sort_order: sortOrder ?? 0,
    project_id: projectId || null,
  })
}

export async function updatePhaseApi(
  userEmail: string,
  phaseId: string,
  name: string,
  sortOrder?: number,
  projectId?: string
): Promise<PhaseMutateResponse> {
  return put<PhaseMutateResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}`, {
    userEmail,
    name,
    sort_order: sortOrder ?? 0,
    project_id: projectId ?? null,
  })
}

export async function deletePhaseApi(userEmail: string, phaseId: string): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}?userEmail=${encodeURIComponent(userEmail)}`)
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
  memo?: string
): Promise<RevisionMutateResponse> {
  return post<RevisionMutateResponse>(`/api/design-schedule/phases/${encodeURIComponent(phaseId)}/revisions`, {
    userEmail,
    revision_name: revisionName,
    planned_date: plannedDate || null,
    actual_date: actualDate || null,
    status: status || '예정',
    memo: memo || null,
  })
}

export async function updateRevisionApi(
  userEmail: string,
  revisionId: string,
  revisionName: string,
  plannedDate?: string,
  actualDate?: string,
  status?: string,
  memo?: string
): Promise<RevisionMutateResponse> {
  return put<RevisionMutateResponse>(`/api/design-schedule/revisions/${encodeURIComponent(revisionId)}`, {
    userEmail,
    revision_name: revisionName,
    planned_date: plannedDate || null,
    actual_date: actualDate || null,
    status: status || '예정',
    memo: memo || null,
  })
}

export async function deleteRevisionApi(userEmail: string, revisionId: string): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(`/api/design-schedule/revisions/${encodeURIComponent(revisionId)}?userEmail=${encodeURIComponent(userEmail)}`)
}
