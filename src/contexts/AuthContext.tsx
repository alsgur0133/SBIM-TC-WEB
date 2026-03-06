import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { AuthUser } from '../types/auth'
import { signUpApi, loginApi, updateProfileApi } from '../api/auth'

const AUTH_STORAGE_KEY = 'sbim-tc-auth'

interface AuthContextValue {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)

  useEffect(() => {
    saveStoredUser(user)
  }, [user])

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginApi(email, password)
    if (result.success && result.user) {
      setUser(result.user)
      return { success: true }
    }
    return { success: false, error: result.error }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
  }, [])

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

  const value: AuthContextValue = { user, login, logout, signUp, updateProfile }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
