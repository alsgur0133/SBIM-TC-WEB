import { API_BASE } from './config'

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
  /** Trimble Connect 쪽 프로젝트 ID (연동 시) */
  trimble_connect_project_id?: string | null
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

/** Trimble Connect — 현재 로그인 계정이 접근 가능한 프로젝트 목록 (기존 프로젝트 연결용) */
export interface TrimbleConnectProjectSummary {
  id: string
  name: string
  /** Trimble 리전 (asia, europe 등) — 여러 리전 목록 병합 시 표시용 */
  tcRegion?: string
}

export async function fetchTrimbleConnectMyProjectsApi(
  userEmail: string,
  trimbleAccessToken: string
): Promise<{ success: boolean; projects?: TrimbleConnectProjectSummary[]; error?: string }> {
  try {
    const data = await request<{
      success: boolean
      projects?: TrimbleConnectProjectSummary[]
      error?: string
    }>('/api/projects/trimble-my-projects', {
      method: 'POST',
      body: { userEmail, trimbleAccessToken: trimbleAccessToken.trim() },
    })
    if (!data.success && data.error) {
      return { success: false, error: data.error }
    }
    return { success: true, projects: data.projects ?? [] }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : '목록을 불러오지 못했습니다.',
    }
  }
}

/** Trimble Connect 폴더 한 단계 자식 (탐색용) */
export interface TrimbleBrowseItem {
  id: string
  name: string
  kind: 'folder' | 'file'
  versionId?: string
}

export async function browseTrimbleConnectFolderApi(
  projectId: string,
  userEmail: string,
  trimbleAccessToken: string,
  folderId?: string | null
): Promise<{ success: true; rootFolderId: string; folderId: string; items: TrimbleBrowseItem[] }> {
  const body: Record<string, unknown> = {
    userEmail,
    trimbleAccessToken: trimbleAccessToken.trim(),
  }
  if (folderId) body.folderId = folderId
  const data = await request<{
    success: boolean
    rootFolderId?: string
    folderId?: string
    items?: TrimbleBrowseItem[]
    error?: string
  }>(`/api/projects/${encodeURIComponent(projectId)}/trimble-connect/browse-folder`, {
    method: 'POST',
    body,
  })
  if (!data.success || !data.rootFolderId || !data.folderId || !Array.isArray(data.items)) {
    throw new Error(data.error || 'Connect 폴더 목록을 불러오지 못했습니다.')
  }
  return {
    success: true,
    rootFolderId: data.rootFolderId,
    folderId: data.folderId,
    items: data.items,
  }
}

/** Connect → BRACE 파일 가져오기 API 응답 요약 */
export interface TrimbleConnectImportSummary {
  scanned: number
  importedModels: number
  importedDocs: number
  importedQuantity: number
  skipped: number
  errors: number
  failed: { name: string; error: string }[]
}

/**
 * Trimble Connect에 연결된 프로젝트의 폴더/파일을 순회해 현재 설계 리비전에 모델·도서·(선택) 물량으로 등록
 */
export async function importTrimbleConnectFilesApi(
  projectId: string,
  userEmail: string,
  trimbleAccessToken: string,
  designRevisionId: string,
  options?: {
    importModels?: boolean
    importDocuments?: boolean
    importQuantity?: boolean
    maxDepth?: number
    maxFiles?: number
    skipExisting?: boolean
    /** 지정 시 전체 스캔 대신 이 파일만 가져옵니다(Connect 탐색기에서 선택). */
    selectedFileEntries?: { id: string; name: string; versionId?: string; path?: string[] }[]
  }
): Promise<{ success: true; summary: TrimbleConnectImportSummary }> {
  const o = options ?? {}
  const data = await request<{ success: boolean; summary?: TrimbleConnectImportSummary; error?: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/trimble-connect/import-files`,
    {
      method: 'POST',
      body: {
        userEmail,
        trimbleAccessToken: trimbleAccessToken.trim(),
        designRevisionId,
        importModels: o.importModels,
        importDocuments: o.importDocuments,
        importQuantity: o.importQuantity,
        maxDepth: o.maxDepth,
        maxFiles: o.maxFiles,
        skipExisting: o.skipExisting,
        ...(o.selectedFileEntries && o.selectedFileEntries.length > 0
          ? { selectedFileEntries: o.selectedFileEntries }
          : {}),
      },
    }
  )
  if (!data.success || !data.summary) {
    throw new Error(data.error || 'Connect에서 파일을 가져오지 못했습니다.')
  }
  return { success: true, summary: data.summary }
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
    /** Trimble Connect OAuth 액세스 토큰(있으면 Connect에 동일 이름 프로젝트 생성 시도) */
    trimbleAccessToken?: string
    /** false면 토큰이 있어도 Connect 연동 안 함 */
    syncTrimbleConnect?: boolean
    /** 이미 Connect에 있는 프로젝트 ID — 있으면 새로 만들지 않고 이 ID로만 연결 */
    trimbleExistingProjectId?: string
  }
): Promise<
  ProjectMutateResponse & {
    trimbleConnectError?: string
    trimbleAutoImport?: TrimbleConnectImportSummary
    trimbleAutoImportError?: string
  }
> {
  const opts = options ?? {}
  try {
    const body: Record<string, unknown> = {
      userEmail,
      name: name.trim(),
      description: opts.description?.trim() ?? '',
      client: opts.client ?? '',
      start_date: opts.startDate ?? '',
      end_date: opts.endDate ?? '',
      pm: opts.pm ?? userEmail,
      status: opts.status ?? '예정',
      code: opts.code?.trim() ?? '',
    }
    if (opts.trimbleExistingProjectId?.trim()) {
      body.trimbleExistingProjectId = opts.trimbleExistingProjectId.trim()
    }
    if (opts.trimbleAccessToken?.trim()) {
      body.trimbleAccessToken = opts.trimbleAccessToken.trim()
      if (opts.syncTrimbleConnect === false) body.syncTrimbleConnect = false
    }
    const data = await request<
      ProjectMutateResponse & {
        trimbleConnectError?: string
        trimbleAutoImport?: TrimbleConnectImportSummary
        trimbleAutoImportError?: string
      }
    >('/api/projects', {
      method: 'POST',
      body,
    })
    return {
      success: true,
      project: data.project,
      trimbleConnectError: data.trimbleConnectError,
      trimbleAutoImport: data.trimbleAutoImport,
      trimbleAutoImportError: data.trimbleAutoImportError,
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

export interface TrimbleConnectInviteResult {
  ok?: boolean
  invited?: number
  error?: string
  skipped?: boolean
  reason?: string
  partialErrors?: string[]
  via?: string
}

export async function addProjectParticipantsApi(
  projectId: string,
  userEmail: string,
  userIds: string[],
  roleInProject?: string,
  options?: { trimbleAccessToken?: string; syncTrimbleConnect?: boolean }
): Promise<ProjectParticipantsResponse & { trimbleConnectInvite?: TrimbleConnectInviteResult }> {
  if (!projectId || !userEmail) {
    return {
      success: false,
      error: '프로젝트 정보가 없습니다. 창을 닫았다가 다시 시도하세요.',
    }
  }
  try {
    const path = `/api/projects/${encodeURIComponent(projectId)}/participants`
    const body: Record<string, unknown> = {
      userEmail,
      userIds,
      roleInProject: roleInProject ?? '참여자',
    }
    if (options?.trimbleAccessToken?.trim()) {
      body.trimbleAccessToken = options.trimbleAccessToken.trim()
      if (options.syncTrimbleConnect === false) body.syncTrimbleConnect = false
    }
    const data = await request<ProjectParticipantsResponse & { trimbleConnectInvite?: TrimbleConnectInviteResult }>(
      path,
      {
        method: 'POST',
        body,
      }
    )
    return data as ProjectParticipantsResponse & { trimbleConnectInvite?: TrimbleConnectInviteResult }
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
