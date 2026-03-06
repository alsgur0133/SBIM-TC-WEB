import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Layout from './Layout'

/**
 * 로그인하지 않았으면 /login으로 이동 (Layout 없이),
 * 로그인했으면 사이드바 레이아웃과 콘텐츠 표시
 */
export default function StartOrApp() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Layout />
}
