/**
 * Trimble Connect / Trimble Identity OAuth 연동
 * - 로그인 URL 생성 (PKCE)
 * - 콜백 후 서버를 통한 토큰 교환
 */
import { API_BASE } from './config'
import { generatePKCE, savePKCEForCallback } from '../lib/trimble-pkce'

/** Trimble에 등록된 콜백 URL과 동일해야 함. 로컬: VITE_TRIMBLE_REDIRECT_URI=http://localhost:5173 */
declare global {
  interface Window {
    __BASE_PATH__?: string
  }
}
/** Trimble 콘솔·토큰 교환과 동일해야 함. 경로 끝 슬래시는 OAuth 비교 오류를 줄이기 위해 제거 */
function normalizeTrimbleRedirectUri(u: string): string {
  return u.trim().replace(/\/$/, '')
}

export function getTrimbleRedirectUri(): string {
  const envUri = import.meta.env.VITE_TRIMBLE_REDIRECT_URI
  if (typeof envUri === 'string' && envUri.trim()) return normalizeTrimbleRedirectUri(envUri)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const base = (typeof window !== 'undefined' && window.__BASE_PATH__) || import.meta.env.BASE_URL || '/'
  const basePath = (typeof base === 'string' ? base : '').replace(/\/$/, '')
  return normalizeTrimbleRedirectUri(`${origin}${basePath}`)
}

const TRIMBLE_AUTH_URL = 'https://id.trimble.com/oauth/authorize'
const TRIMBLE_CONNECT_WEB_DEFAULT = 'https://web.connect.trimble.com'

/**
 * Trimble Connect 웹에서 특정 프로젝트를 열 URL.
 * 연동 ID가 없으면 사이트 루트만 반환합니다.
 * (Windows 앱은 `trimbleconnect:/projects/{id}` 형식 — 웹은 `/projects/{id}` 패턴 사용)
 */
export function buildTrimbleConnectWebOpenUrl(trimbleProjectId?: string | null): string {
  const envBase =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_TRIMBLE_CONNECT_WEB_BASE
      ? String(import.meta.env.VITE_TRIMBLE_CONNECT_WEB_BASE).trim()
      : ''
  const base = (envBase || TRIMBLE_CONNECT_WEB_DEFAULT).replace(/\/$/, '') || TRIMBLE_CONNECT_WEB_DEFAULT
  const id = typeof trimbleProjectId === 'string' ? trimbleProjectId.trim() : ''
  if (!id) return base
  return `${base}/projects/${encodeURIComponent(id)}`
}
/** scope: openid + 앱 이름 필수. VITE_TRIMBLE_SCOPE 우선, 없으면 openid + VITE_TRIMBLE_APP_NAME */
function getTrimbleScope(): string {
  const scopeEnv = import.meta.env.VITE_TRIMBLE_SCOPE
  if (typeof scopeEnv === 'string' && scopeEnv.trim()) return scopeEnv.trim()
  const appName = import.meta.env.VITE_TRIMBLE_APP_NAME
  const name = (typeof appName === 'string' && appName.trim()) ? appName.trim() : 'abies'
  return `openid ${name}`
}

export interface TrimbleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}

export interface TrimbleUserInfo {
  sub: string
  name?: string
  email?: string
  preferred_username?: string
}

/** 로컬(abies) 앱 기본값. 환경 변수 VITE_TRIMBLE_CLIENT_ID 우선 */
const DEFAULT_TRIMBLE_CLIENT_ID = '2678a42f-dc8f-4101-81b7-d4400e793cce'

/** Trimble Identity 로그인 페이지로 이동할 URL 생성. 호출 후 window.location.href = url 로 리다이렉트. */
export async function getTrimbleLoginUrl(): Promise<string> {
  const clientId = import.meta.env.VITE_TRIMBLE_CLIENT_ID || DEFAULT_TRIMBLE_CLIENT_ID
  if (!clientId) {
    throw new Error('Trimble 클라이언트 ID가 설정되지 않았습니다. (VITE_TRIMBLE_CLIENT_ID)')
  }
  const { codeVerifier, codeChallenge } = await generatePKCE()
  const state = crypto.randomUUID?.() || `s${Date.now()}${Math.random().toString(36).slice(2)}`
  savePKCEForCallback(codeVerifier, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getTrimbleRedirectUri(),
    scope: getTrimbleScope(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${TRIMBLE_AUTH_URL}?${params.toString()}`
}

/** 동일 authorization code는 Trimble에서 1회만 교환 가능 — React StrictMode 개발 이펙트 이중 실행 방지 */
const trimbleCodeExchangeInFlight = new Map<string, Promise<TrimbleTokenResponse>>()

async function exchangeTrimbleCodeImpl(
  code: string,
  codeVerifier: string
): Promise<TrimbleTokenResponse> {
  const redirectUri = getTrimbleRedirectUri()
  const res = await fetch(`${API_BASE}/api/auth/trimble/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string; error_description?: string }
    const desc = (err.error_description && String(err.error_description).trim()) || ''
    const errCode = (err.error && String(err.error).trim()) || ''
    let msg = [desc, errCode].filter(Boolean).join(desc && errCode ? ' — ' : '')
    if (!msg && text) msg = text.slice(0, 400).trim()
    if (!msg) msg = `토큰 교환 실패 (HTTP ${res.status})`
    throw new Error(msg)
  }
  return data as TrimbleTokenResponse
}

/** 콜백에서 code를 서버로 보내 토큰 교환 (서버가 client_secret으로 Trimble /token 호출) */
export async function exchangeTrimbleCode(
  code: string,
  codeVerifier: string
): Promise<TrimbleTokenResponse> {
  const key = String(code).trim()
  const existing = trimbleCodeExchangeInFlight.get(key)
  if (existing) return existing

  const p = exchangeTrimbleCodeImpl(code, codeVerifier).finally(() => {
    trimbleCodeExchangeInFlight.delete(key)
  })
  trimbleCodeExchangeInFlight.set(key, p)
  return p
}

/**
 * Trimble refresh_token은 1회용에 가깝습니다. 동시에 두 번 갱신하면 하나가 실패하므로 동일 토큰 요청을 합칩니다.
 */
const trimbleRefreshInFlight = new Map<string, Promise<TrimbleTokenResponse>>()

async function refreshTrimbleAccessTokenWithServerImpl(refreshToken: string): Promise<TrimbleTokenResponse> {
  const ctrl = new AbortController()
  const timeoutMs = 45000
  const to = window.setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/auth/trimble/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: ctrl.signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`토큰 갱신 요청 시간 초과(${timeoutMs / 1000}초). API 서버(5001) 실행·네트워크를 확인하세요.`)
    }
    throw e
  } finally {
    window.clearTimeout(to)
  }
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // ignore
  }
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error || `토큰 갱신 실패 (${res.status})`)
  }
  return data as TrimbleTokenResponse
}

/**
 * 저장된 refresh_token으로 액세스 토큰 갱신 (Connect API "Session Invalid" 방지)
 */
export async function refreshTrimbleAccessTokenWithServer(refreshToken: string): Promise<TrimbleTokenResponse> {
  const key = String(refreshToken).trim()
  if (!key) throw new Error('refresh_token이 비어 있습니다.')
  const existing = trimbleRefreshInFlight.get(key)
  if (existing) return existing
  const p = refreshTrimbleAccessTokenWithServerImpl(key).finally(() => {
    trimbleRefreshInFlight.delete(key)
  })
  trimbleRefreshInFlight.set(key, p)
  return p
}

/** Trimble Identity userinfo (access_token 검증 및 사용자 정보) */
export async function getTrimbleUserInfo(accessToken: string): Promise<TrimbleUserInfo> {
  const res = await fetch('https://id.trimble.com/oauth/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`사용자 정보 조회 실패 (${res.status})`)
  }
  return res.json() as Promise<TrimbleUserInfo>
}
