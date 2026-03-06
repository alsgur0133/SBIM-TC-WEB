const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:5001')

export interface DesignReview {
  id: string
  design_revision_id: string
  title: string
  memo: string | null
  file_name: string | null
  file_path: string | null
  created_at: string
  updated_at: string
  /** 공유 대상 참여자 user_id 목록 */
  shared_participant_ids?: string[]
}

interface ReviewsResponse {
  success: boolean
  error?: string
  reviews?: DesignReview[]
}

interface ReviewMutateResponse {
  success: boolean
  error?: string
  review?: DesignReview
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

export function getDesignReviewFileUrl(reviewId: string): string {
  return `${API_BASE}/api/design-reviews/${encodeURIComponent(reviewId)}/file`
}

export async function getDesignReviewsApi(designRevisionId: string): Promise<ReviewsResponse> {
  return get<ReviewsResponse>(
    `/api/design-reviews?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function createDesignReviewApi(
  userEmail: string,
  designRevisionId: string,
  title: string,
  file: File,
  memo?: string
): Promise<ReviewMutateResponse> {
  const form = new FormData()
  form.append('userEmail', userEmail)
  form.append('designRevisionId', designRevisionId)
  form.append('title', title.trim())
  if (memo?.trim()) form.append('memo', memo.trim())
  form.append('file', file)
  form.append('fileName', file.name)
  try {
    form.append('fileNameB64', btoa(unescape(encodeURIComponent(file.name))))
  } catch {
    // fallback
  }
  const res = await fetch(`${API_BASE}/api/design-reviews`, {
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
  return data as ReviewMutateResponse
}

export async function updateDesignReviewApi(
  userEmail: string,
  reviewId: string,
  title: string,
  memo?: string,
  sharedParticipantIds?: string[]
): Promise<ReviewMutateResponse> {
  return put<ReviewMutateResponse>(`/api/design-reviews/${encodeURIComponent(reviewId)}`, {
    userEmail,
    title: title.trim(),
    memo: memo?.trim() || null,
    shared_participant_ids: sharedParticipantIds ?? undefined,
  })
}

export async function deleteDesignReviewApi(
  userEmail: string,
  reviewId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/design-reviews/${encodeURIComponent(reviewId)}?userEmail=${encodeURIComponent(userEmail)}`
  )
}
