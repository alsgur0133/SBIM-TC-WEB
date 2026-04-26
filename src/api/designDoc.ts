import { API_BASE, API_SERVER_ORIGIN } from './config'

export interface DesignDocument {
  id: string
  design_revision_id: string
  title: string
  doc_number: string | null
  memo: string | null
  file_name: string | null
  file_path: string | null
  file_path_pdf?: string | null
  file_path_dxf?: string | null
  created_at: string
  updated_at: string
}

interface DocumentsResponse {
  success: boolean
  error?: string
  documents?: DesignDocument[]
}

interface DocumentMutateResponse {
  success: boolean
  error?: string
  document?: DesignDocument
  message?: string
  /** DWG 업로드 시 DXF 변환 성공 여부 (DWG가 아니면 없음) */
  dxf_converted?: boolean
  /** DXF 변환 실패 시 오류 메시지 */
  dxf_error?: string
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

export function getDesignDocFileUrl(documentId: string): string {
  return `${API_BASE}/api/design-docs/${encodeURIComponent(documentId)}/file`
}

/** 설계도서 미리보기(캐드 보기)용 URL - PDF로 표시(DWG는 서버에서 PDF 변환 후 표시) */
export function getDesignDocViewUrl(documentId: string, fileName?: string | null): string {
  let url = `${API_BASE}/api/design-docs/${encodeURIComponent(documentId)}/file/pdf`
  if (fileName) {
    url += '?name=' + encodeURIComponent(fileName.replace(/\.[^.]+$/, '') + '.pdf')
  }
  return url
}

/** 설계도서 DXF 뷰어용 URL - DXF 그대로 또는 DWG를 서버에서 DXF로 변환 후 반환 */
export function getDesignDocDxfUrl(documentId: string, fileName?: string | null): string {
  let url = `${API_BASE}/api/design-docs/${encodeURIComponent(documentId)}/file/dxf`
  if (fileName) {
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'view'
    url += '?name=' + encodeURIComponent(baseName + '.dxf')
  }
  return url
}

/** 설계도서 DXF 뷰어용 파싱된 JSON URL - 서버에서 DXF 파싱 후 entities 반환. 개발 시 API 서버(5001)로 직접 요청해 프록시 404 방지 */
export function getDesignDocDxfJsonUrl(documentId: string): string {
  return `${API_SERVER_ORIGIN}/api/design-docs/${encodeURIComponent(documentId)}/file/dxf/json`
}

export async function createDesignDocumentWithFileApi(
  userEmail: string,
  designRevisionId: string,
  title: string,
  file: File | null,
  docNumber?: string,
  memo?: string
): Promise<DocumentMutateResponse> {
  const form = new FormData()
  form.append('userEmail', userEmail)
  form.append('designRevisionId', designRevisionId)
  form.append('title', title.trim())
  if (docNumber?.trim()) form.append('doc_number', docNumber.trim())
  if (memo?.trim()) form.append('memo', memo.trim())
  if (file) {
    form.append('file', file)
    form.append('fileName', file.name)
    try {
      form.append('fileNameB64', btoa(unescape(encodeURIComponent(file.name))))
    } catch {
      // fallback: fileName only
    }
  }
  const res = await fetch(`${API_BASE}/api/design-docs`, {
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
  return data as DocumentMutateResponse
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

export async function getDesignDocumentsApi(designRevisionId: string): Promise<DocumentsResponse> {
  return get<DocumentsResponse>(
    `/api/design-docs?designRevisionId=${encodeURIComponent(designRevisionId)}`
  )
}

export async function createDesignDocumentApi(
  userEmail: string,
  designRevisionId: string,
  title: string,
  docNumber?: string,
  memo?: string,
  file?: File | null
): Promise<DocumentMutateResponse> {
  return createDesignDocumentWithFileApi(userEmail, designRevisionId, title, file ?? null, docNumber, memo)
}

export async function updateDesignDocumentApi(
  userEmail: string,
  documentId: string,
  title: string,
  docNumber?: string,
  memo?: string
): Promise<DocumentMutateResponse> {
  return put<DocumentMutateResponse>(`/api/design-docs/${encodeURIComponent(documentId)}`, {
    userEmail,
    title: title.trim(),
    doc_number: docNumber?.trim() || null,
    memo: memo?.trim() || null,
  })
}

export async function deleteDesignDocumentApi(
  userEmail: string,
  documentId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  return del(
    `/api/design-docs/${encodeURIComponent(documentId)}?userEmail=${encodeURIComponent(userEmail)}`
  )
}

/** 등록된 DWG 설계도서를 DXF로 변환 (고정 경로 POST /api/design-docs/convert-to-dxf, documentId는 body로 전달) */
export async function convertDesignDocToDxfApi(
  userEmail: string,
  documentId: string
): Promise<{ success: boolean; error?: string; message?: string; document?: DesignDocument }> {
  const res = await fetch(`${API_BASE}/api/design-docs/convert-to-dxf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, documentId }),
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
  return data as { success: boolean; error?: string; message?: string; document?: DesignDocument }
}
