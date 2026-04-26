import { useNavigate } from 'react-router-dom'

export interface TrimblePendingProfile {
  name: string
  email: string
  company?: string | null
}

/**
 * Trimble OAuth 후 DB 상태가 승인대기일 때 표시 (재로그인 시에도 동일)
 */
export default function TrimblePendingApprovalView({ profile }: { profile: TrimblePendingProfile | null }) {
  const navigate = useNavigate()
  const p = profile

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">승인 대기 중</h1>
        <p className="auth-card__desc" style={{ fontWeight: 600, color: 'var(--main-text)' }}>
          아직 관리자 승인 전입니다. 승인이 완료될 때까지 로그인할 수 없습니다.
        </p>
        <p className="auth-card__desc">
          가입 신청이 접수된 상태입니다. 관리자가 승인하면 Trimble Connect로 다시 로그인해 주세요.
        </p>
        {p && (
          <>
            <dl className="auth-card__pending-profile">
              <div>
                <dt>이름</dt>
                <dd>{p.name || '—'}</dd>
              </div>
              <div>
                <dt>회사</dt>
                <dd>
                  {p.company != null && String(p.company).trim() ? (
                    String(p.company).trim()
                  ) : (
                    <span className="auth-card__pending-empty" title="가입 시 회사를 입력하지 않았습니다. 승인 후 [내 정보]에서 수정할 수 있습니다.">
                      —
                    </span>
                  )}
                </dd>
              </div>
              {p.email ? (
                <div>
                  <dt>이메일</dt>
                  <dd>{p.email}</dd>
                </div>
              ) : null}
            </dl>
            {(!p.company || !String(p.company).trim()) && (
              <p className="auth-card__desc" style={{ fontSize: '0.8125rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                회사가 비어 있으면 승인 후 <strong>내 정보</strong>에서 수정할 수 있습니다.
              </p>
            )}
          </>
        )}
        <button type="button" className="btn btn--primary" onClick={() => navigate('/login', { replace: true })}>
          로그인 화면으로
        </button>
      </div>
    </div>
  )
}
