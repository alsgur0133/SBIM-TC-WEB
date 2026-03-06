const API_BASE =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:5001')

export interface DesignModel {
  id: string
  design_revision_id: string
  title: string
  memo: string | null
  file_name: string | null
  file_path: string | null
  file_path_dxf?: string | null
  created_at: string
  updated_at: string
}

interface ModelsResponse {
  success: boolean
  error?: string
  models?: DesignModel[]
}

interface ModelMutateResponse {
  success: boolean
  error?: string
  model?: DesignModel
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

export function getDesignModelFileUrl(modelId: string): string {
  return `${API_BASE}/api/design-models/${encodeURIComponent(modelId)}/file`
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
  file?: File | null
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
