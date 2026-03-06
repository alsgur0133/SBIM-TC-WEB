import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const isAdmin = user.isAdmin === true || user.email === 'sa'
  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
