import type { AuthUser } from '../types/auth'

/** 기본 관리자 계정 (이메일 `sa`) */
export function isSaAccount(user: AuthUser | null | undefined): boolean {
  return (user?.email || '').trim().toLowerCase() === 'sa'
}

/** 사용자 관리: 시스템 관리자(isAdmin) 또는 역할 `관리자`만 (프로젝트 관리자 제외) */
export function canAccessUserManagement(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (isSaAccount(user)) return true
  if (user.isAdmin) return true
  return user.role === '관리자'
}

/** 프로젝트·참여자 관리: 관리자·프로젝트 관리자 */
export function canAccessProjectManagement(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (isSaAccount(user)) return true
  if (user.isAdmin) return true
  const r = user.role
  return r === '관리자' || r === '프로젝트 관리자'
}
