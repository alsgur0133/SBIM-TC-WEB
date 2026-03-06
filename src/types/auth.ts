export interface AuthUser {
  id: string
  name: string
  email: string
  isAdmin?: boolean
  /** 관리자 | 프로젝트 관리자 | 일반 사용자 등 */
  role?: string
  /** 업체명 */
  company?: string
}

interface RegisteredUser extends AuthUser {
  password: string
}

export type { RegisteredUser }
