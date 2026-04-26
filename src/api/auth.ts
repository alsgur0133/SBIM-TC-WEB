import { API_BASE } from './config'

export interface AuthUser {
  id: string
  name: string
  email: string
  isAdmin?: boolean
  role?: string
}

interface ApiResult<T> {
  success: boolean
  error?: string
  message?: string
  user?: T
}

interface PendingUsersResponse {
  success: boolean
  error?: string
  users?: { id: string; name: string; email: string; company?: string | null; created_at: string }[]
}

export interface ApiUserRow {
  id: string
  name: string
  email: string
  status: string
  is_admin: number
  role?: string
  company?: string | null
  /** Trimble Identity subject (OAuth `sub`) — 가입 시 저장 */
  trimble_subject_id?: string | null
  created_at: string
}

interface UsersListResponse {
  success: boolean
  error?: string
  users?: ApiUserRow[]
}

async function request<T>(
  path: string,
  options: { method: string; body?: string }
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
    })
    const text = await res.text()
    let data: Partial<ApiResult<T>> = {}
    try {
      data = text ? (JSON.parse(text) as Partial<ApiResult<T>>) : {}
    } catch {
      // 서버가 HTML 등 비-JSON으로 응답한 경우
    }
    if (!res.ok) {
      return {
        success: false,
        error: data.error || `요청에 실패했습니다. (${res.status})`,
      }
    }
    return data as ApiResult<T>
  } catch (err) {
    // 네트워크 오류 (서버 미실행, CORS, 연결 거부 등)
    const message =
      err instanceof TypeError && err.message === 'Failed to fetch'
        ? '서버에 연결할 수 없습니다. API 서버가 실행 중인지 확인하세요. (터미널에서 npm run server)'
        : '요청에 실패했습니다.'
    return { success: false, error: message }
  }
}

async function post<T>(path: string, body: object): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
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

export async function signUpApi(
  name: string,
  email: string,
  password: string
): Promise<ApiResult<AuthUser>> {
  return post<AuthUser>('/api/auth/signup', { name, email, password })
}

export async function loginApi(
  email: string,
  password: string
): Promise<ApiResult<AuthUser>> {
  return post<AuthUser>('/api/auth/login', { email, password })
}

export async function updateProfileApi(
  email: string,
  name: string,
  currentPassword: string,
  newPassword?: string,
  company?: string
): Promise<ApiResult<AuthUser>> {
  // POST: IIS 등에서 PUT이 405로 막힐 때 대비 (서버에 동일 핸들러 마운트)
  return post<AuthUser>('/api/auth/profile/update', {
    email,
    name,
    currentPassword,
    newPassword: newPassword || undefined,
    company: company ?? undefined,
  })
}

export async function getUsersApi(adminEmail: string): Promise<UsersListResponse> {
  const encoded = encodeURIComponent(adminEmail)
  return get<UsersListResponse>(`/api/auth/users?adminEmail=${encoded}`)
}

export async function getPendingUsersApi(adminEmail: string): Promise<PendingUsersResponse> {
  const encoded = encodeURIComponent(adminEmail)
  return get<PendingUsersResponse>(`/api/auth/pending-users?adminEmail=${encoded}`)
}

export async function approveUserApi(
  adminEmail: string,
  userId: string
): Promise<ApiResult<unknown>> {
  return post<unknown>('/api/auth/approve-user', { adminEmail, userId })
}

export async function updateUserApi(
  adminEmail: string,
  userId: string,
  data: { name: string; email: string; role: string; status: string; company?: string }
): Promise<ApiResult<unknown>> {
  return post<unknown>(`/api/auth/users/${encodeURIComponent(userId)}/update`, {
    adminEmail,
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status,
    company: data.company ?? undefined,
  })
}

export interface CheckTrimbleUserResponse {
  success: boolean
  exists?: boolean
  status?: '활성' | '승인대기'
  user?: { id: string; name: string; email: string; role?: string; company?: string }
  error?: string
}

export async function checkTrimbleUserApi(body: {
  email: string
  name: string
  trimbleId: string
}): Promise<CheckTrimbleUserResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/trimble/check-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        res.status === 404
          ? '회원 확인 API를 찾을 수 없습니다. 터미널에서 API 서버(npm run server)를 재시작한 뒤 다시 Trimble 로그인해 주세요.'
          : (data as { error?: string }).error || '확인에 실패했습니다.'
      return { success: false, error: msg }
    }
    return data as CheckTrimbleUserResponse
  } catch (err) {
    const message =
      err instanceof TypeError && err.message === 'Failed to fetch'
        ? 'API 서버에 연결할 수 없습니다. 터미널에서 npm run server 를 실행한 뒤 다시 시도하세요.'
        : err instanceof Error
          ? err.message
          : '확인에 실패했습니다.'
    return { success: false, error: message }
  }
}

export async function trimbleRegisterApi(body: {
  email: string
  name: string
  company: string
  trimbleId: string
}): Promise<ApiResult<unknown>> {
  return post<unknown>('/api/auth/trimble/register', body)
}

export async function deleteUserApi(
  adminEmail: string,
  userId: string
): Promise<ApiResult<unknown>> {
  const encoded = encodeURIComponent(adminEmail)
  try {
    const res = await fetch(
      `${API_BASE}/api/auth/users/${encodeURIComponent(userId)}?adminEmail=${encoded}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
    )
    const text = await res.text()
    let data: Partial<ApiResult<unknown>> = {}
    try {
      data = text ? (JSON.parse(text) as Partial<ApiResult<unknown>>) : {}
    } catch {
      // ignore
    }
    if (!res.ok) {
      return {
        success: false,
        error: (data as { error?: string }).error || `요청에 실패했습니다. (${res.status})`,
      }
    }
    return data as ApiResult<unknown>
  } catch (err) {
    const message =
      err instanceof TypeError && err.message === 'Failed to fetch'
        ? '서버에 연결할 수 없습니다.'
        : '요청에 실패했습니다.'
    return { success: false, error: message }
  }
}
