import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { AuthUser } from '../types/auth'
import { signUpApi, loginApi, updateProfileApi } from '../api/auth'
import { refreshTrimbleAccessTokenWithServer } from '../api/trimble'
import { clearProjectSessionAfterAuth } from '../lib/project-storage'

const AUTH_STORAGE_KEY = 'sbim-tc-auth'
const TRIMBLE_TOKENS_KEY = 'sbim-tc-trimble-tokens'

export interface TrimbleTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

interface AuthContextValue {
  user: AuthUser | null
  /** Trimble Connect 로그인 시 저장된 토큰 (뷰어/API 호출용) */
  trimbleTokens: TrimbleTokens | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  /** Trimble OAuth 콜백 후 토큰·사용자 정보로 로그인 처리 (role, company는 서버 사용자 정보로 채움) */
  loginWithTrimble: (tokens: TrimbleTokens, trimbleUser: { id: string; name: string; email: string; role?: string; company?: string }) => void
  /**
   * Trimble 액세스 토큰을 만료 전에 갱신하거나, force 시 무조건 갱신 시도.
   * Connect API 호출 전에 호출하면 "Session Invalid"를 줄일 수 있습니다.
   */
  refreshTrimbleAccessToken: (opts?: { force?: boolean }) => Promise<TrimbleTokens | null>
  signUp: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string; message?: string }>
  updateProfile: (name: string, currentPassword: string, newPassword?: string, company?: string) => Promise<{ success: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || !('id' in parsed) || !('name' in parsed) || !('email' in parsed)) {
      return null
    }
    const u = { id: String(parsed.id), name: String(parsed.name), email: String(parsed.email) } as AuthUser
    if (typeof parsed === 'object' && parsed !== null && 'isAdmin' in parsed) {
      u.isAdmin = !!parsed.isAdmin
    }
    if (typeof parsed === 'object' && parsed !== null && 'role' in parsed && typeof (parsed as { role?: string }).role === 'string') {
      u.role = (parsed as { role: string }).role
    }
    if (typeof parsed === 'object' && parsed !== null && 'company' in parsed && typeof (parsed as { company?: string }).company === 'string') {
      u.company = (parsed as { company: string }).company
    }
    if (u.email === 'sa') {
      u.isAdmin = true
      u.role = u.role || '관리자'
    }
    return u
  } catch {
    return null
  }
}

function saveStoredUser(user: AuthUser | null) {
  if (user) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
  else localStorage.removeItem(AUTH_STORAGE_KEY)
}

function loadStoredTrimbleTokens(): TrimbleTokens | null {
  try {
    const raw = localStorage.getItem(TRIMBLE_TOKENS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || !('accessToken' in parsed) || !('expiresAt' in parsed)) return null
    const accessToken = String((parsed as { accessToken: unknown }).accessToken)
    const expiresAt = Number((parsed as { expiresAt: unknown }).expiresAt)
    if (!accessToken || !Number.isFinite(expiresAt)) return null
    const refreshToken = (parsed as { refreshToken?: string }).refreshToken
    return { accessToken, refreshToken, expiresAt }
  } catch {
    return null
  }
}

function saveStoredTrimbleTokens(tokens: TrimbleTokens | null) {
  if (tokens) localStorage.setItem(TRIMBLE_TOKENS_KEY, JSON.stringify(tokens))
  else localStorage.removeItem(TRIMBLE_TOKENS_KEY)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)
  const [trimbleTokens, setTrimbleTokens] = useState<TrimbleTokens | null>(loadStoredTrimbleTokens)

  useEffect(() => {
    saveStoredUser(user)
  }, [user])
  useEffect(() => {
    saveStoredTrimbleTokens(trimbleTokens)
  }, [trimbleTokens])

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginApi(email, password)
    if (result.success && result.user) {
      clearProjectSessionAfterAuth()
      setUser(result.user)
      return { success: true }
    }
    return { success: false, error: result.error }
  }, [])

  const logout = useCallback(() => {
    clearProjectSessionAfterAuth()
    setUser(null)
    setTrimbleTokens(null)
  }, [])

  const loginWithTrimble = useCallback((
    tokens: TrimbleTokens,
    trimbleUser: { id: string; name: string; email: string; role?: string; company?: string }
  ) => {
    clearProjectSessionAfterAuth()
    setTrimbleTokens(tokens)
    setUser({
      id: trimbleUser.id,
      name: trimbleUser.name,
      email: trimbleUser.email,
      role: trimbleUser.role || 'Trimble Connect',
      company: trimbleUser.company,
    })
  }, [])

  const refreshTrimbleAccessToken = useCallback(
    async (opts?: { force?: boolean }): Promise<TrimbleTokens | null> => {
      const fromStorage = loadStoredTrimbleTokens()
      const current = trimbleTokens || fromStorage
      if (!current?.accessToken) return null

      const bufferMs = 120000
      const expiredOrSoon = current.expiresAt <= Date.now() + bufferMs
      if (!opts?.force && !expiredOrSoon) return current

      if (!current.refreshToken) {
        if (opts?.force || expiredOrSoon) {
          return current.expiresAt > Date.now() ? current : null
        }
        return current
      }

      try {
        const r = await refreshTrimbleAccessTokenWithServer(current.refreshToken)
        const next: TrimbleTokens = {
          accessToken: r.access_token,
          refreshToken: r.refresh_token || current.refreshToken,
          expiresAt: Date.now() + Math.max(60, r.expires_in || 3600) * 1000,
        }
        setTrimbleTokens(next)
        return next
      } catch {
        /* 갱신 실패해도 액세스 토큰 유효 시간 안이면 기존 토큰으로 API 재시도 가능 */
        if (current.expiresAt > Date.now()) return current
        return null
      }
    },
    [trimbleTokens]
  )

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const trimmedName = name.trim()
    const normalizedEmail = email.trim().toLowerCase()
    if (!trimmedName) return { success: false, error: '이름을 입력하세요.' }
    if (!normalizedEmail) return { success: false, error: '이메일을 입력하세요.' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { success: false, error: '올바른 이메일 형식이 아닙니다.' }
    }
    if (!password || password.length < 4) {
      return { success: false, error: '비밀번호는 4자 이상 입력하세요.' }
    }

    const result = await signUpApi(trimmedName, normalizedEmail, password)
    if (result.success) {
      // 승인 대기 시 로그인하지 않음 (user 없이 성공만 반환)
      if (result.user) setUser(result.user)
      return { success: true, message: result.message }
    }
    return { success: false, error: result.error }
  }, [])

  const updateProfile = useCallback(
    async (name: string, currentPassword: string, newPassword?: string, company?: string) => {
      if (!user) return { success: false, error: '로그인이 필요합니다.' }
      const trimmedName = name.trim()
      if (!trimmedName) return { success: false, error: '이름을 입력하세요.' }

      const result = await updateProfileApi(
        user.email,
        trimmedName,
        currentPassword,
        newPassword,
        company
      )
      if (result.success && result.user) {
        setUser(result.user)
        return { success: true }
      }
      return { success: false, error: result.error }
    },
    [user]
  )

  const value: AuthContextValue = {
    user,
    trimbleTokens,
    login,
    logout,
    loginWithTrimble,
    refreshTrimbleAccessToken,
    signUp,
    updateProfile,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
