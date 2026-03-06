import { useState, useMemo, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import type { Project } from '../api/projects'

const PATH_LABELS: Record<string, string> = {
  '/': '홈',
  '/projects': '프로젝트 목록',
  '/projects/participants': '프로젝트 참여자 관리',
  '/design-doc': '설계도서 관리',
  '/design-review': '설계검토 관리',
  '/design-schedule': '설계일정 관리',
  '/design-model': '모델 관리',
  '/quantity': '물량 관리',
  '/quantity/file-registration': '물량파일 등록',
  '/quantity/summary': '물량집계표',
  '/quantity/compare': '물량비교',
  '/users': '사용자 관리',
  '/profile': '내 정보',
}

function Breadcrumb() {
  const location = useLocation()
  const items = useMemo(() => {
    const pathname = location.pathname
    const list: { path: string; label: string }[] = [{ path: '/', label: '홈' }]
    const label = pathname.startsWith('/quantity/summary')
      ? '물량집계표'
      : pathname.startsWith('/quantity/compare')
        ? '물량비교'
        : PATH_LABELS[pathname]
    if (pathname !== '/' && label) {
      list.push({ path: pathname, label })
    }
    return list
  }, [location.pathname])
  return (
    <nav className="breadcrumb" aria-label="현재 위치">
      <ol className="breadcrumb__list">
        {items.map((item, i) => (
          <li key={item.path} className="breadcrumb__item">
            {i > 0 && <span className="breadcrumb__sep" aria-hidden>/</span>}
            {i === items.length - 1 ? (
              <span className="breadcrumb__current" aria-current="page">{item.label}</span>
            ) : (
              <NavLink to={item.path} className="breadcrumb__link">
                {item.label}
              </NavLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

const projectSubMenus = [
  { path: '/projects', label: '프로젝트 목록' },
  { path: '/projects/participants', label: '프로젝트 참여자 관리' },
] as const

const designSubMenus = [
  { path: '/design-schedule', label: '설계일정 관리' },
  { path: '/design-doc', label: '설계도서 관리' },
  { path: '/design-review', label: '설계검토 관리' },
  { path: '/design-model', label: '모델 관리' },
] as const

const quantitySubMenus = [
  { path: '/quantity', label: '물량 현황' },
  { path: '/quantity/file-registration', label: '물량파일 등록' },
  { path: '/quantity/summary', label: '물량집계표' },
  { path: '/quantity/compare', label: '물량비교' },
] as const

function formatDate(s: string) {
  if (!s) return '-'
  return s.slice(0, 10)
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [designMenuOpen, setDesignMenuOpen] = useState(true)
  const [quantityMenuOpen, setQuantityMenuOpen] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const { user, logout } = useAuth()
  const { projects, selectedProject, setSelectedProject, loadProjects, isLoading } = useProject()
  const {
    phases,
    revisions,
    selectedPhaseId,
    selectedRevisionId,
    setSelectedPhaseId,
    setSelectedRevisionId,
    loadingPhases,
  } = useDesignSchedule()
  const navigate = useNavigate()
  const location = useLocation()
  const isProjectMenuActive = projectSubMenus.some(({ path }) => location.pathname.startsWith(path))
  const [projectMenuOpen, setProjectMenuOpen] = useState(isProjectMenuActive)
  const isDesignActive = designSubMenus.some(({ path }) => location.pathname.startsWith(path))
  const isQuantityMenuActive = quantitySubMenus.some(({ path }) => location.pathname.startsWith(path))

  useEffect(() => {
    if (isProjectMenuActive && !projectMenuOpen) setProjectMenuOpen(true)
  }, [isProjectMenuActive])
  useEffect(() => {
    if (isQuantityMenuActive && !quantityMenuOpen) setQuantityMenuOpen(true)
  }, [isQuantityMenuActive])

  function handleSelectProject(p: Project) {
    setSelectedProject(p)
    setProjectPickerOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/')
  }

  /** 모델 뷰어를 새 브라우저 창으로 열기 (선택된 리비전의 모델 목록에서 선택 가능) */
  function openModelViewerInNewWindow() {
    const w = 960
    const h = 640
    const left = Math.max(0, (window.screen.width - w) / 2)
    const top = Math.max(0, (window.screen.height - h) / 2)
    const params = new URLSearchParams()
    if (selectedRevisionId) params.set('designRevisionId', selectedRevisionId)
    const url = params.toString() ? `/model-viewer?${params.toString()}` : '/model-viewer'
    window.open(
      url,
      'modelViewer',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
  }

  return (
    <div className="app app--sidebar">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : 'sidebar--collapsed'}`}>
        <div className="sidebar__head">
          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? '메뉴 접기' : '메뉴 펼치기'}
          >
            <span className="sidebar__toggle-icon" />
          </button>
        </div>
        <div className="sidebar__brand">
          <NavLink to="/" className="sidebar__logo">
            BRACE
          </NavLink>
        </div>
        <nav className="sidebar__nav">
          <div className={`sidebar__group ${projectMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isProjectMenuActive ? 'sidebar__link--active' : ''}`}
              onClick={() => setProjectMenuOpen((v) => !v)}
              aria-expanded={projectMenuOpen}
            >
              <span className="sidebar__link-text">프로젝트 관리</span>
              <span className="sidebar__group-chevron" aria-hidden>{projectMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {projectSubMenus.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                  end={path === '/projects'}
                >
                  <span className="sidebar__link-text">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div className={`sidebar__group ${designMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isDesignActive ? 'sidebar__link--active' : ''}`}
              onClick={() => setDesignMenuOpen((v) => !v)}
              aria-expanded={designMenuOpen}
            >
              <span className="sidebar__link-text">설계 관리</span>
              <span className="sidebar__group-chevron" aria-hidden>{designMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {designSubMenus.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                  end={false}
                >
                  <span className="sidebar__link-text">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div className={`sidebar__group ${quantityMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isQuantityMenuActive ? 'sidebar__link--active' : ''}`}
              onClick={() => setQuantityMenuOpen((v) => !v)}
              aria-expanded={quantityMenuOpen}
            >
              <span className="sidebar__link-text">물량 관리</span>
              <span className="sidebar__group-chevron" aria-hidden>{quantityMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {quantitySubMenus.map(({ path, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                  end={path === '/quantity'}
                >
                  <span className="sidebar__link-text">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>

          <NavLink
            to="/users"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
            end={false}
          >
            <span className="sidebar__link-text">사용자 관리</span>
          </NavLink>
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__auth">
            {user ? (
              <>
                <div className="sidebar__user-info">
                  <span className="sidebar__user-name">{user.name}님</span>
                  {user.role && (
                    <span className="sidebar__user-role">{user.role}</span>
                  )}
                </div>
                <NavLink to="/profile" className="sidebar__auth-link">
                  내 정보
                </NavLink>
                <button type="button" className="sidebar__auth-btn" onClick={handleLogout}>
                  로그아웃
                </button>
              </>
            ) : (
              <NavLink to="/login" className="sidebar__auth-link">
                로그인
              </NavLink>
            )}
          </div>
        </div>
      </aside>
      <div className="app__body">
        <header className="main__header">
          <div className="main__header-top">
            <div className="main__header-project">
              <button
                type="button"
                className="btn btn--secondary main__header-project-btn"
                onClick={() => setProjectPickerOpen(true)}
              >
                프로젝트 선택
              </button>
              {selectedProject && (
                <span className="main__header-project-name" title={`${selectedProject.code ?? ''} ${selectedProject.name}`.trim()}>
                  {[selectedProject.code, selectedProject.name].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            {selectedProject && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary main__header-btn"
                  onClick={openModelViewerInNewWindow}
                  title="모델 뷰어를 새 창으로 열기 (창 이동 가능)"
                >
                  모델뷰어
                </button>
                <div className="main__header-design-doc">
                <span className="main__header-label" id="header-phase-label">설계 차수</span>
                <select
                  id="header-phase"
                  className="main__header-select"
                  value={selectedPhaseId}
                  onChange={(e) => setSelectedPhaseId(e.target.value)}
                  disabled={loadingPhases}
                  aria-labelledby="header-phase-label"
                >
                  <option value="">선택하세요</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="main__header-label" id="header-revision-label">리비전</span>
                <select
                  id="header-revision"
                  className="main__header-select"
                  value={selectedRevisionId}
                  onChange={(e) => setSelectedRevisionId(e.target.value)}
                  disabled={!selectedPhaseId}
                  aria-labelledby="header-revision-label"
                >
                  <option value="">선택하세요</option>
                  {revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revision_name}
                    </option>
                  ))}
                </select>
              </div>
              </>
            )}
          </div>
        </header>
        <Breadcrumb />
        <main className="main">
          <div className={`main__fill${location.pathname.startsWith('/quantity/summary') ? ' main__fill--quantity-summary' : ''}`}>
            <Outlet />
          </div>
        </main>

        {/* 프로젝트 선택 팝업: 프로젝트 관리와 동일한 목록 */}
        {projectPickerOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
            <div className="modal modal--project-picker">
              <div className="modal__header">
                <h2 id="project-picker-title" className="modal__title">
                  프로젝트 선택
                </h2>
                <div className="modal__header-actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    onClick={loadProjects}
                    disabled={isLoading}
                    title="목록 새로고침"
                  >
                    {isLoading ? '…' : '↻ 새로고침'}
                  </button>
                  <button
                    type="button"
                    className="modal__close"
                    onClick={() => setProjectPickerOpen(false)}
                    aria-label="닫기"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="modal__body modal__body--no-padding">
                {isLoading && projects.length === 0 ? (
                  <p className="project-picker__loading">프로젝트 목록을 불러오는 중...</p>
                ) : (
                  <div className="project-picker__table-wrap">
                    <table className="project-mgmt__table project-picker__table">
                      <thead>
                        <tr>
                          <th>이름</th>
                          <th>코드</th>
                          <th>발주처</th>
                          <th>프로젝트 기간</th>
                          <th>설명</th>
                          <th>생성일</th>
                          <th>수정일</th>
                          <th>선택</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="project-mgmt__empty">
                              등록된 프로젝트가 없습니다.
                            </td>
                          </tr>
                        ) : (
                          projects.map((p) => (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td>{p.code ?? '-'}</td>
                              <td className="project-mgmt__desc-cell">{p.client ?? '-'}</td>
                              <td>
                                {p.start_date || p.end_date
                                  ? [formatDate(p.start_date ?? ''), formatDate(p.end_date ?? '')].filter((d) => d !== '-').join(' ~ ')
                                  : '-'}
                              </td>
                              <td className="project-mgmt__desc-cell">{p.description || '-'}</td>
                              <td>{formatDate(p.created_at)}</td>
                              <td>{formatDate(p.updated_at)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn--sm btn--primary"
                                  onClick={() => handleSelectProject(p)}
                                >
                                  {selectedProject?.id === p.id ? '선택됨' : '선택'}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <footer className="footer">
          <span>BRACE &copy; {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  )
}
