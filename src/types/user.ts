export type UserRole = '관리자' | '프로젝트 관리자' | '일반 사용자' | '협력업체'
export type UserStatus = '활성' | '비활성'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  createdAt: string
  /** 업체명 */
  company?: string
}

export interface UserFormInput {
  name: string
  email: string
  role: UserRole
  status: UserStatus
  /** 업체명 */
  company?: string
}

export const USER_ROLES: UserRole[] = ['관리자', '프로젝트 관리자', '일반 사용자', '협력업체']
export const USER_STATUSES: UserStatus[] = ['활성', '비활성']
