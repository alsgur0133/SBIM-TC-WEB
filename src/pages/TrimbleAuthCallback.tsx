import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import TrimblePendingApprovalView, { type TrimblePendingProfile } from '../components/TrimblePendingApprovalView'
import { getStoredCodeVerifierAndState, clearStoredPKCE } from '../lib/trimble-pkce'
import { exchangeTrimbleCode, getTrimbleUserInfo } from '../api/trimble'
import { checkTrimbleUserApi } from '../api/auth'

/**
 * Trimble Identity OAuth 콜백: /auth/trimble/callback ?code=&state=
 * 루트(/) 콜백과 동일하게 DB 확인 후 활성만 로그인, 승인대기는 대기 안내(재로그인 포함).
 */
export default function TrimbleAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithTrimble } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pendingProfile, setPendingProfile] = useState<TrimblePendingProfile | null>(null)
  const [showPending, setShowPending] = useState(false)

  const code = searchParams.get('code')
  const state = searchParams.get('state')

  useEffect(() => {
    const stored = getStoredCodeVerifierAndState()

    if (!code) {
      setError(searchParams.get('error_description') || searchParams.get('error') || '인증 코드가 없습니다.')
      clearStoredPKCE()
      return
    }
    if (!stored || stored.state !== state) {
      setError('세션이 만료되었거나 state가 일치하지 않습니다. 다시 로그인해 주세요.')
      clearStoredPKCE()
      return
    }

    let cancelled = false
    setError(null)
    setShowPending(false)
    setPendingProfile(null)

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
              {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt,
              },
              {
                id: check.user.id,
                name: check.user.name,
                email: check.user.email,
                role: check.user.role,
                company: check.user.company,
              }
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
            setPendingProfile({
              name: nameVal || trimbleUser.name || trimbleUser.email || '—',
              email: u?.email ?? trimbleUser.email ?? '',
              company: u?.company != null ? String(u.company).trim() || null : null,
            })
            setShowPending(true)
            return
          }
        }

        navigate('/trimble-signup', { replace: true, state: { trimbleUser } })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Trimble 로그인 처리에 실패했습니다.')
        }
        clearStoredPKCE()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code, state, loginWithTrimble, navigate])

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-card__title">Trimble 로그인 오류</h1>
          <p className="auth-form__error">{error}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => navigate('/login', { replace: true })}
          >
            로그인 화면으로
          </button>
        </div>
      </div>
    )
  }

  if (showPending) {
    return <TrimblePendingApprovalView profile={pendingProfile} />
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
