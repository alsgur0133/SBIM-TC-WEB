import { NavLink, Outlet, useLocation } from 'react-router-dom'

const CODE_LINKS = [
  { to: 'code-mapping/member', label: '부재 매핑', end: true },
  { to: 'code-mapping/dong', label: '동 관리', end: true },
  { to: 'code-mapping/floor', label: '층 관리', end: true },
  { to: 'code-mapping/material', label: '자재 코드', end: true },
] as const

const REBAR_LINKS = [
  { to: 'rebar-db/schedule/wall', label: '벽체 일람표', end: true },
  { to: 'rebar-db/schedule/lintel', label: '인방보 일람표', end: true },
  { to: 'rebar-db/schedule/column', label: '기둥 일람표', end: true },
  { to: 'rebar-db/length/stock', label: '장대 길이', end: true },
  { to: 'rebar-db/length/lap', label: '이음·정착 길이', end: true },
  { to: 'rebar-db/common/wall', label: '벽체 공통속성', end: true },
  { to: 'rebar-db/common/lintel', label: '인방보 공통속성', end: true },
  { to: 'rebar-db/common/column', label: '기둥 공통속성', end: true },
] as const

/**
 * 설정: 왼쪽 메뉴 + 선택한 항목만 오른쪽에 표시
 */
export default function SettingsShell() {
  const location = useLocation()
  return (
    <div className="settings-shell">
      <aside className="settings-shell__aside" aria-label="설정 메뉴">
        <div className="settings-shell__head">
          <h1 className="settings-shell__h1">설정</h1>
          <p className="settings-shell__desc">
            코드 맵핑은 물량 DB와 연동됩니다. 철근 DB는 <strong>프로젝트별</strong>입니다.
          </p>
        </div>
        <div className="settings-shell__group-label">코드 맵핑</div>
        <nav className="settings-shell__links">
          {CODE_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `settings-shell__link${isActive ? ' settings-shell__link--active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="settings-shell__group-label settings-shell__group-label--spaced">철근 데이터베이스</div>
        <nav className="settings-shell__links">
          {REBAR_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `settings-shell__link${isActive ? ' settings-shell__link--active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="settings-shell__main">
        <div className="settings-shell__content">
          <Outlet key={location.pathname} />
        </div>
      </main>
    </div>
  )
}
