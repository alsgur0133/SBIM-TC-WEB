import { API_BASE } from './config'
import type { CodeMgmtSystem } from '../lib/code-mgmt-systems'

export interface CodeMgmtParameter {
  id: string
  code: string
  param_group: string
  param_key: string
  memo: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CodeMgmtCompositionRow {
  composition_id: string
  sort_index: number
  parameter_id: string
  code: string
  param_group: string
  param_key: string
  memo: string | null
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  return data as T
}

export async function getCodeMgmtParametersApi(): Promise<{
  success: boolean
  items?: CodeMgmtParameter[]
  error?: string
}> {
  const res = await fetch(`${API_BASE}/api/code-mgmt/parameters`)
  const data = await parseJson<{ success: boolean; items?: CodeMgmtParameter[]; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function createCodeMgmtParameterApi(
  userEmail: string,
  body: { code: string; param_group?: string; param_key: string; memo?: string; sort_order?: number }
): Promise<{ success: boolean; item?: CodeMgmtParameter; error?: string }> {
  const res = await fetch(`${API_BASE}/api/code-mgmt/parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, ...body }),
  })
  const data = await parseJson<{ success: boolean; item?: CodeMgmtParameter; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function updateCodeMgmtParameterApi(
  userEmail: string,
  id: string,
  body: { code: string; param_group?: string; param_key: string; memo?: string; sort_order?: number }
): Promise<{ success: boolean; item?: CodeMgmtParameter; error?: string }> {
  const res = await fetch(`${API_BASE}/api/code-mgmt/parameters/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, ...body }),
  })
  const data = await parseJson<{ success: boolean; item?: CodeMgmtParameter; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function deleteCodeMgmtParameterApi(userEmail: string, id: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `${API_BASE}/api/code-mgmt/parameters/${encodeURIComponent(id)}?userEmail=${encodeURIComponent(userEmail)}`,
    { method: 'DELETE' }
  )
  const data = await parseJson<{ success: boolean; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function getCodeMgmtCompositionsApi(
  systemType: CodeMgmtSystem
): Promise<{ success: boolean; items?: CodeMgmtCompositionRow[]; error?: string }> {
  const res = await fetch(
    `${API_BASE}/api/code-mgmt/compositions?systemType=${encodeURIComponent(systemType)}`
  )
  const data = await parseJson<{ success: boolean; items?: CodeMgmtCompositionRow[]; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function addCodeMgmtCompositionApi(
  userEmail: string,
  systemType: CodeMgmtSystem,
  parameterId: string
): Promise<{ success: boolean; item?: CodeMgmtCompositionRow; error?: string }> {
  const res = await fetch(`${API_BASE}/api/code-mgmt/compositions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, systemType, parameterId }),
  })
  const data = await parseJson<{ success: boolean; item?: CodeMgmtCompositionRow; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function deleteCodeMgmtCompositionApi(userEmail: string, compositionId: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `${API_BASE}/api/code-mgmt/compositions/${encodeURIComponent(compositionId)}?userEmail=${encodeURIComponent(userEmail)}`,
    { method: 'DELETE' }
  )
  const data = await parseJson<{ success: boolean; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

export async function resetCodeMgmtCompositionsApi(
  userEmail: string,
  systemType: CodeMgmtSystem
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/code-mgmt/compositions/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userEmail, systemType }),
  })
  const data = await parseJson<{ success: boolean; error?: string }>(res)
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}
