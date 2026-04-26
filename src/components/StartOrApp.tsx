import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Layout from './Layout'
import TrimblePendingApprovalView from './TrimblePendingApprovalView'
import { getStoredCodeVerifierAndState, clearStoredPKCE } from '../lib/trimble-pkce'
import { exchangeTrimbleCode, getTrimbleRedirectUri, getTrimbleUserInfo } from '../api/trimble'
import { checkTrimbleUserApi } from '../api/auth'

/**
 * 로그인하지 않았으면 /login으로 이동 (Layout 없이),
 * 로그인했으면 사이드바 레이아웃과 콘텐츠 표시.
 * Trimble OAuth 콜백(?code=&state=): 회원 여부 확인 → 활성이면 로그인, 승인대기면 안내(재로그인 동일), 없으면 회원정보 입력으로.
 */
export default function StartOrApp() {
  const { user, loginWithTrimble } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [trimbleProcessing, setTrimbleProcessing] = useState(false)
  const [trimbleError, setTrimbleError] = useState<string | null>(null)
  const [trimblePendingApproval, setTrimblePendingApproval] = useState(false)
  const [trimblePendingProfile, setTrimblePendingProfile] = useState<{
    name: string
    email: string
    company?: string
  } | null>(null)

  const code = searchParams.get('code')
  const state = searchParams.get('state')

  useEffect(() => {
    if (!code || !state) return

    const stored = getStoredCodeVerifierAndState()
    if (!stored || stored.state !== state) {
      clearStoredPKCE()
      navigate('/login', { replace: true, state: { error: '세션이 만료되었습니다. 다시 Trimble Connect로 로그인해 주세요.' } })
      return
    }

    let cancelled = false
    setTrimbleProcessing(true)
    setTrimbleError(null)
    setTrimblePendingApproval(false)
    setTrimblePendingProfile(null)

    ;(async () => {
      try {
        const tokens = await exchangeTrimbleCode(code, stored.codeVerifier)
        if (cancelled) return
        clearStoredPKCE()
        const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000
        const userInfo = await getTrimbleUserInfo(tokens.access_token)
        if (cancelled) return
        const trimbleUser = {
          id: userInfo.sub || userInfo.preferred_username || '',
          name: userInfo.name || userInfo.preferred_username || userInfo.email || 'Trimble 사용자',
          email: (userInfo.email || userInfo.preferred_username || userInfo.sub || '').trim().toLowerCase(),
        }
        const check = await checkTrimbleUserApi({
          email: trimbleUser.email,
          name: trimbleUser.name,
          trimbleId: trimbleUser.id,
        })
        if (cancelled) return

        if (check.success) {
          if (check.exists && check.status === '활성' && check.user) {
            loginWithTrimble(
              { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
              { id: check.user.id, name: check.user.name, email: check.user.email, role: check.user.role, company: check.user.company }
            )
            navigate('/', { replace: true })
            return
          }
          if (check.exists && check.status === '승인대기') {
            const u = check.user
            const nameVal =
              u?.name && String(u.name).trim() && String(u.name).trim() !== (u?.email || '').trim()
                ? String(u.name).trim()
                : (trimbleUser.name && trimbleUser.name !== trimbleUser.email ? trimbleUser.name : '')
            setTrimblePendingProfile({
              name: nameVal || trimbleUser.name || trimbleUser.email || '—',
              email: u?.email ?? trimbleUser.email ?? '',
              company: u?.company != null ? String(u.company).trim() || null : null,
            })
            setTrimblePendingApproval(true)
            return
          }
        }
        navigate('/trimble-signup', { replace: true, state: { trimbleUser } })
      } catch (err) {
        if (!cancelled) {
          setTrimbleError(err instanceof Error ? err.message : 'Trimble 로그인 처리에 실패했습니다.')
          clearStoredPKCE()
        }
      } finally {
        if (!cancelled) setTrimbleProcessing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code, state, loginWithTrimble, navigate])

  if (code && state) {
    if (trimbleError) {
      return (
        <div className="auth-page">
          <div className="auth-card">
            <h1 className="auth-card__title">Trimble 로그인 오류</h1>
            <p className="auth-form__error" style={{ whiteSpace: 'pre-wrap' }}>{trimbleError}</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginTop: '0.5rem' }}>
              {import.meta.env.DEV ? (
                <>
                  · Trimble 앱에 콜백 URL <strong>{getTrimbleRedirectUri()}</strong> 이 등록되어 있는지 확인하세요.
                  <br />
                  · 터미널에서 <strong>npm run server</strong> 로 API 서버를 실행한 뒤 다시 시도하세요.
                </>
              ) : (
                <>
                  · Trimble 개발자 콘솔에 아래 URL이 <strong>허용 Redirect URI</strong>로 등록돼 있는지 확인하세요:{' '}
                  <strong>{getTrimbleRedirectUri()}</strong>
                  <br />
                  · IIS 서버의 <code style={{ fontSize: '0.8em' }}>.env</code>에 있는{' '}
                  <code style={{ fontSize: '0.8em' }}>TRIMBLE_CLIENT_ID</code> /{' '}
                  <code style={{ fontSize: '0.8em' }}>TRIMBLE_CLIENT_SECRET</code>이 빌드에 쓰인 앱과 같은지,
                  배포 후 앱 풀을 재시작했는지 확인하세요.
                  <br />
                  · http↔https를 바꾼 뒤라면 <strong>Ctrl+F5</strong>로 새로고침한 뒤 로그인을 처음부터 다시 하세요.
                  (주소창에 남은 <code style={{ fontSize: '0.8em' }}>code=</code> 는 한 번만 쓸 수 있습니다.)
                </>
              )}
            </p>
            <button type="button" className="btn btn--primary" style={{ marginTop: '1rem' }} onClick={() => navigate('/login', { replace: true })}>
              로그인 화면으로
            </button>
          </div>
        </div>
      )
    }
    if (trimblePendingApproval) {
      return <TrimblePendingApprovalView profile={trimblePendingProfile} />
    }
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">Trimble 로그인 처리 중</h1>
          <p className="auth-card__desc">잠시만 기다려 주세요.</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <Layout />
}
