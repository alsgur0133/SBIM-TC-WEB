const DEFAULT_API_ORIGIN = 'http://localhost:5001'
const rawBase =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? DEFAULT_API_ORIGIN : DEFAULT_API_ORIGIN)
// VITE_API_URL이 .../api 로 끝나면 중복 경로 방지를 위해 제거 (요청 path에 이미 /api 포함)
const API_BASE =
  typeof rawBase === 'string' && /\/api\/?$/i.test(rawBase)
    ? rawBase.replace(/\/api\/?$/i, '')
    : rawBase

// ---------------------------------------------------------------------------
// 타입 (서버 응답과 동일한 snake_case 필드 사용)
// ---------------------------------------------------------------------------

export type ProjectStatus = '예정' | '진행' | '완료'

export interface Project {
  id: string
  name: string
  description: string | null
  code?: string | null
  client?: string | null
  start_date?: string | null
  end_date?: string | null
  pm?: string | null
  status?: ProjectStatus | string | null
  created_at: string
  updated_at: string
}

export interface ProjectsListResponse {
  success: boolean
  error?: string
  projects?: Project[]
}

export interface ProjectMutateResponse {
  success: boolean
  error?: string
  project?: Project
  message?: string
}

// ---------------------------------------------------------------------------
// HTTP 유틸 (JSON 파싱·에러 메시지 통일)
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: { method: string; body?: object }
): Promise<T & { success?: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method,
    headers: options.body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = (text ? JSON.parse(text) : {}) as Record<string, unknown>
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = (data.error as string) || `요청에 실패했습니다. (${res.status})`
    throw new Error(err)
  }
  return data as T & { success?: boolean; error?: string }
}

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

/** 프로젝트 목록 조회 */
export async function getProjectsApi(): Promise<ProjectsListResponse> {
  const data = await request<ProjectsListResponse>('/api/projects', { method: 'GET' })
  if (!data.success && data.error) {
    throw new Error(data.error)
  }
  return data as ProjectsListResponse
}

/** 다음 프로젝트 코드 조회 (YYMM-NNN). 추가 팝업 미리보기용 */
export async function getNextProjectCodeApi(): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const data = await request<{ success: boolean; code?: string; error?: string }>('/api/projects/next-code', {
      method: 'GET',
    })
    return data?.success && data.code ? { success: true, code: data.code } : { success: false, error: data?.error }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '코드 조회 실패' }
  }
}

/** 프로젝트 생성 (관리자·프로젝트 관리자). 코드는 서버에서 YYMM-NNN(년2자리+월2자리-순번3자리) 자동 부여. PM 기본값=등록자. */
export async function createProjectApi(
  userEmail: string,
  name: string,
  options?: {
    description?: string
    client?: string
    startDate?: string
    endDate?: string
    pm?: string
    status?: ProjectStatus
    code?: string
  }
): Promise<ProjectMutateResponse> {
  const opts = options ?? {}
  try {
    const data = await request<ProjectMutateResponse>('/api/projects', {
      method: 'POST',
      body: {
        userEmail,
        name: name.trim(),
        description: opts.description?.trim() ?? '',
        client: opts.client ?? '',
        start_date: opts.startDate ?? '',
        end_date: opts.endDate ?? '',
        pm: opts.pm ?? userEmail,
        status: opts.status ?? '예정',
        code: opts.code?.trim() ?? '',
      },
    })
    return {
      success: true,
      project: data.project,
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '생성에 실패했습니다.',
    }
  }
}

/** 프로젝트 수정 (관리자·프로젝트 관리자). 코드는 읽기 전용. */
export async function updateProjectApi(
  userEmail: string,
  projectId: string,
  name: string,
  options?: {
    description?: string
    code?: string
    client?: string
    startDate?: string
    endDate?: string
    pm?: string
    status?: ProjectStatus
  }
): Promise<ProjectMutateResponse> {
  const opts = options ?? {}
  try {
    const data = await request<ProjectMutateResponse>(
      `/api/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PUT',
        body: {
          userEmail,
          name: name.trim(),
          description: opts.description?.trim() ?? '',
          code: opts.code != null ? String(opts.code) : '',
          client: opts.client != null ? String(opts.client) : '',
          start_date: opts.startDate != null ? String(opts.startDate) : '',
          end_date: opts.endDate != null ? String(opts.endDate) : '',
          pm: opts.pm ?? '',
          status: opts.status ?? '',
        },
      }
    )
    return {
      success: true,
      project: data.project,
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '수정에 실패했습니다.',
    }
  }
}

/** 프로젝트 삭제 (관리자·프로젝트 관리자) */
export async function deleteProjectApi(
  userEmail: string,
  projectId: string
): Promise<ProjectMutateResponse> {
  try {
    const data = await request<ProjectMutateResponse>(
      `/api/projects/${encodeURIComponent(projectId)}?userEmail=${encodeURIComponent(userEmail)}`,
      { method: 'DELETE' }
    )
    return {
      success: true,
      message: (data as { message?: string }).message,
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '삭제에 실패했습니다.',
    }
  }
}

// ---------------------------------------------------------------------------
// 프로젝트 참여자
// ---------------------------------------------------------------------------
export interface ProjectParticipant {
  project_id: string
  user_id: string
  user_name: string
  user_email: string
  user_company?: string | null
  role_in_project: string
  created_at: string
}

export interface ProjectParticipantsResponse {
  success: boolean
  error?: string
  participants?: ProjectParticipant[]
}

export async function getProjectParticipantsApi(
  projectId: string,
  userEmail: string
): Promise<ProjectParticipantsResponse> {
  const data = await request<ProjectParticipantsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/participants?userEmail=${encodeURIComponent(userEmail)}`,
    { method: 'GET' }
  )
  if (!data.success && data.error) throw new Error(data.error)
  return data as ProjectParticipantsResponse
}

export async function addProjectParticipantsApi(
  projectId: string,
  userEmail: string,
  userIds: string[],
  roleInProject?: string
): Promise<ProjectParticipantsResponse> {
  if (!projectId || !userEmail) {
    return {
      success: false,
      error: '프로젝트 정보가 없습니다. 창을 닫았다가 다시 시도하세요.',
    }
  }
  try {
    const path = `/api/projects/${encodeURIComponent(projectId)}/participants`
    const data = await request<ProjectParticipantsResponse>(path, {
      method: 'POST',
      body: { userEmail, userIds, roleInProject: roleInProject ?? '참여자' },
    })
    return data as ProjectParticipantsResponse
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '참여자 추가에 실패했습니다.',
    }
  }
}

export async function removeProjectParticipantApi(
  projectId: string,
  userId: string,
  userEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await request(
      `/api/projects/${encodeURIComponent(projectId)}/participants/${encodeURIComponent(userId)}?userEmail=${encodeURIComponent(userEmail)}`,
      { method: 'DELETE' }
    )
    return { success: true }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '참여자 제거에 실패했습니다.',
    }
  }
}
