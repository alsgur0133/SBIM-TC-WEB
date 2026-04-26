import type { ReactNode } from 'react'
import '../styles/design-mgmt-shell.css'

export type DesignMgmtKpi = {
  label: string
  value: string | number
  sub?: string
  badge?: string
  badgeVariant?: 'success' | 'warning' | 'info' | 'neutral'
}

export type DesignMgmtPageShellProps = {
  title: string
  titleEn: string
  description: string
  projectTag?: ReactNode
  kpis?: DesignMgmtKpi[]
  heroActions?: ReactNode
  toolbar?: ReactNode
  error?: string | null
  /** 오류가 아닌 안내(예: Connect 폴더 동기화 안내) */
  notice?: string | null
  loading?: boolean
  loadingText?: string
  onRefresh?: () => void
  refreshDisabled?: boolean
  children: ReactNode
}

function badgeClass(v: DesignMgmtKpi['badgeVariant']) {
  switch (v) {
    case 'success':
      return 'dm-shell__kpi-badge dm-shell__kpi-badge--success'
    case 'warning':
      return 'dm-shell__kpi-badge dm-shell__kpi-badge--warning'
    case 'info':
      return 'dm-shell__kpi-badge dm-shell__kpi-badge--info'
    default:
      return 'dm-shell__kpi-badge dm-shell__kpi-badge--neutral'
  }
}

export default function DesignMgmtPageShell({
  title,
  titleEn,
  description,
  projectTag,
  kpis = [],
  heroActions,
  toolbar,
  error,
  notice,
  loading,
  loadingText = '불러오는 중…',
  onRefresh,
  refreshDisabled,
  children,
}: DesignMgmtPageShellProps) {
  return (
    <div className="dm-shell project-mgmt">
      <div className="dm-shell__top">
        <div className="dm-shell__top-spacer" aria-hidden />
        <div className="dm-shell__top-actions">
          {onRefresh ? (
            <button
              type="button"
              className="dm-shell__icon-btn"
              onClick={onRefresh}
              disabled={refreshDisabled}
              title="새로고침"
              aria-label="새로고침"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <header className="dm-shell__hero">
        <div className="dm-shell__hero-text">
          <h1 className="dm-shell__title">
            {title}
            <span className="dm-shell__title-en">{titleEn}</span>
          </h1>
          <p className="dm-shell__lead">{description}</p>
          {projectTag}
        </div>
        {heroActions ? <div className="dm-shell__hero-actions">{heroActions}</div> : null}
      </header>

      {kpis.length > 0 ? (
        <div className="dm-shell__kpi-grid">
          {kpis.map((k, i) => (
            <div key={`${k.label}-${i}`} className="dm-shell__kpi">
              <div className="dm-shell__kpi-head">
                <span className="dm-shell__kpi-label">{k.label}</span>
                {k.badge ? <span className={badgeClass(k.badgeVariant)}>{k.badge}</span> : null}
              </div>
              <div className="dm-shell__kpi-value">{k.value}</div>
              {k.sub ? <div className="dm-shell__kpi-sub">{k.sub}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="dm-shell__error" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="dm-shell__notice" role="status">
          {notice}
        </p>
      ) : null}

      {toolbar ? <div className="dm-shell__toolbar">{toolbar}</div> : null}

      {loading ? <p className="dm-shell__loading">{loadingText}</p> : <div className="dm-shell__body">{children}</div>}
    </div>
  )
}
