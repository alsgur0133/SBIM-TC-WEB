import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { canAccessProjectManagement, canAccessUserManagement } from '../lib/auth-access'

type AccessKind = 'projectManagement' | 'userManagement'

export default function RequireAccess({
  access,
  children,
}: {
  access: AccessKind
  children: ReactNode
}) {
  const { user } = useAuth()
  const ok =
    access === 'projectManagement'
      ? canAccessProjectManagement(user)
      : canAccessUserManagement(user)
  if (!ok) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
