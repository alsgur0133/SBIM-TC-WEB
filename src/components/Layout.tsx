import { useState, useMemo, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { resolveAppHref } from '../lib/app-href'
import { useAuth } from '../contexts/AuthContext'
import { canAccessProjectManagement, canAccessUserManagement } from '../lib/auth-access'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import type { Project } from '../api/projects'
import ThemeToggle from './ThemeToggle'
import {
  IconBarChart,
  IconBox,
  IconBriefcase,
  IconCalendar,
  IconClipboardCheck,
  IconCode,
  IconSettings,
  IconCompare,
  IconDrafting,
  IconFileStack,
  IconFolderKanban,
  IconHome,
  IconInfo,
  IconList,
  IconLogOut,
  IconPackage,
  IconTable,
  IconUpload,
  IconUser,
  IconUserCog,
  IconUsers,
  IconViewer3D,
} from './SidebarIcons'
const PATH_LABELS: Record<string, string> = {
  '/': '홈',
  '/dashboard': '대시보드',
  '/projects': '프로젝트 목록',
  '/projects/participants': '프로젝트 참여자 관리',
  '/design-doc': '설계도서 관리',
  '/design-review': '설계검토 관리',
  '/design-schedule': '설계일정 관리',
  '/design-model': '모델 관리',
  '/design-model/info': '모델 정보',
  '/trimble-viewer': '모델 뷰어',
  '/settings': '설정',
  '/code-mgmt': '코드관리',
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
    const list: { path: string; label: string }[] = [{ path: '/dashboard', label: '홈' }]
    const label = pathname.startsWith('/quantity/summary')
      ? '물량집계표'
      : pathname.startsWith('/quantity/compare')
        ? '물량비교'
        : pathname.startsWith('/settings')
        ? '설정'
        : pathname.startsWith('/code-mgmt')
          ? '코드관리'
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
  { path: '/projects', label: '프로젝트 목록', Icon: IconList },
  { path: '/projects/participants', label: '프로젝트 참여자 관리', Icon: IconUsers },
] as const

const designSubMenus = [
  { path: '/design-schedule', label: '설계일정 관리', Icon: IconCalendar },
  { path: '/design-doc', label: '설계도서 관리', Icon: IconFileStack },
  { path: '/design-review', label: '설계검토 관리', Icon: IconClipboardCheck },
] as const

const modelSubMenus = [
  { path: '/design-model', label: '모델 관리', end: true as const, Icon: IconPackage },
  { path: '/design-model/info', label: '모델 정보', end: true as const, Icon: IconInfo },
] as const

const quantitySubMenus = [
  { path: '/quantity', label: '물량 데이터', Icon: IconTable },
  { path: '/quantity/file-registration', label: '물량파일 등록', Icon: IconUpload },
  { path: '/quantity/summary', label: '물량집계표', Icon: IconBarChart },
  { path: '/quantity/compare', label: '물량비교', Icon: IconCompare },
] as const

function formatDate(s: string) {
  if (!s) return '-'
  return s.slice(0, 10)
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [designMenuOpen, setDesignMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
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
  const showProjectMgmt = user ? canAccessProjectManagement(user) : false
  const showUserMgmt = user ? canAccessUserManagement(user) : false
  const [projectMenuOpen, setProjectMenuOpen] = useState(showProjectMgmt && isProjectMenuActive)
  const isDesignActive = designSubMenus.some(({ path }) => location.pathname.startsWith(path))
  const isModelMenuActiveWithViewer =
    location.pathname.startsWith('/design-model') || location.pathname === '/trimble-viewer'
  const isQuantityMenuActive = quantitySubMenus.some(({ path }) => location.pathname.startsWith(path))
  useEffect(() => {
    if (showProjectMgmt && isProjectMenuActive && !projectMenuOpen) setProjectMenuOpen(true)
  }, [isProjectMenuActive, showProjectMgmt])
  useEffect(() => {
    if (isModelMenuActiveWithViewer && !modelMenuOpen) setModelMenuOpen(true)
  }, [isModelMenuActiveWithViewer])
  useEffect(() => {
    if (isQuantityMenuActive && !quantityMenuOpen) setQuantityMenuOpen(true)
  }, [isQuantityMenuActive])
  useEffect(() => {
    if (isDesignActive && !designMenuOpen) setDesignMenuOpen(true)
  }, [isDesignActive])

  function handleSelectProject(p: Project) {
    setSelectedProject(p)
    setProjectPickerOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/')
  }

  /** 모델 뷰어: 선택된 프로젝트의 Trimble Connect ID가 있으면 쿼리로 넘겨 뷰어 연결 안정화 */
  function openModelViewerInNewWindow() {
    const qp = new URLSearchParams()
    const tcId = selectedProject?.trimble_connect_project_id?.trim()
    if (tcId) qp.set('trimbleConnectProjectId', tcId)
    if (selectedRevisionId?.trim()) qp.set('designRevisionId', selectedRevisionId.trim())
    const search = qp.toString()
    const routeSuffix = search ? `?${search}` : ''

    let openUrl = resolveAppHref('model-viewer')
    if (search) openUrl += (openUrl.includes('?') ? '&' : '?') + search

    const features = 'width=1280,height=800,left=80,top=80,resizable=yes,scrollbars=yes'
    const w = window.open(openUrl, 'trimbleModelViewer', features)
    const blocked = !w || (typeof w.closed === 'boolean' && w.closed)
    if (blocked) {
      if (
        window.confirm(
          '팝업이 차단되었거나 새 창을 열 수 없습니다.\n같은 탭에서 모델 뷰어(전체 화면)를 여시겠습니까?'
        )
      ) {
        void navigate(`/model-viewer${routeSuffix}`)
      }
      return
    }
    try {
      w.focus()
    } catch {
      /* ignore */
    }
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
          <NavLink to="/dashboard" className="sidebar__logo" title="대시보드">
            <span className="sidebar__icon" aria-hidden>
              <IconHome />
            </span>
            <span className="sidebar__logo-text">BRACE</span>
          </NavLink>
        </div>
        <div className="sidebar__context">
          <div className="sidebar__project">
            <button
              type="button"
              className="sidebar__project-btn"
              onClick={() => setProjectPickerOpen(true)}
              title="프로젝트 선택"
            >
              <span className="sidebar__icon sidebar__project-btn-icon" aria-hidden>
                <IconBriefcase />
              </span>
              <div className="sidebar__project-btn-texts">
                <span className="sidebar__project-btn-label">프로젝트</span>
                <span className="sidebar__project-btn-value" title={selectedProject ? `${selectedProject.code ?? ''} ${selectedProject.name}`.trim() : ''}>
                  {selectedProject ? [selectedProject.code, selectedProject.name].filter(Boolean).join(' · ') || selectedProject.name : '선택하세요'}
                </span>
              </div>
            </button>
          </div>
          {selectedProject && (
            <div className="sidebar__schedule">
              <div className="sidebar__schedule-field">
                <label className="sidebar__schedule-label" htmlFor="sidebar-phase">
                  설계 차수
                </label>
                <select
                  id="sidebar-phase"
                  className="sidebar__schedule-select"
                  value={selectedPhaseId}
                  onChange={(e) => setSelectedPhaseId(e.target.value)}
                  disabled={loadingPhases}
                >
                  <option value="">선택하세요</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sidebar__schedule-field">
                <label className="sidebar__schedule-label" htmlFor="sidebar-revision">
                  리비전
                </label>
                <select
                  id="sidebar-revision"
                  className="sidebar__schedule-select"
                  value={selectedRevisionId}
                  onChange={(e) => setSelectedRevisionId(e.target.value)}
                  disabled={!selectedPhaseId}
                >
                  <option value="">선택하세요</option>
                  {revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revision_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <nav className="sidebar__nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
            title="대시보드"
          >
            <span className="sidebar__icon" aria-hidden>
              <IconBarChart />
            </span>
            <span className="sidebar__link-text">대시보드</span>
          </NavLink>
          <button
            type="button"
            className="sidebar__link"
            onClick={() => openModelViewerInNewWindow()}
            title="모델 뷰어를 새 창에서 엽니다 (Trimble Connect)"
          >
            <span className="sidebar__icon" aria-hidden>
              <IconViewer3D />
            </span>
            <span className="sidebar__link-text">모델 뷰어</span>
          </button>
          {showProjectMgmt && (
            <div className={`sidebar__group ${projectMenuOpen ? 'sidebar__group--open' : ''}`}>
              <button
                type="button"
                className={`sidebar__group-title ${isProjectMenuActive ? 'sidebar__link--active' : ''}`}
                onClick={() => setProjectMenuOpen((v) => !v)}
                aria-expanded={projectMenuOpen}
                title="프로젝트 관리"
              >
                <span className="sidebar__group-title-start">
                  <span className="sidebar__icon" aria-hidden>
                    <IconFolderKanban />
                  </span>
                  <span className="sidebar__link-text">프로젝트 관리</span>
                </span>
                <span className="sidebar__group-chevron" aria-hidden>{projectMenuOpen ? '▼' : '▶'}</span>
              </button>
              <div className="sidebar__group-items">
                {projectSubMenus.map(({ path, label, Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                    end={path === '/projects'}
                    title={label}
                  >
                    <span className="sidebar__icon" aria-hidden>
                      <Icon />
                    </span>
                    <span className="sidebar__link-text">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}
          <div className={`sidebar__group ${designMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isDesignActive ? 'sidebar__link--active' : ''}`}
              onClick={() => setDesignMenuOpen((v) => !v)}
              aria-expanded={designMenuOpen}
              title="설계 관리"
            >
              <span className="sidebar__group-title-start">
                <span className="sidebar__icon" aria-hidden>
                  <IconDrafting />
                </span>
                <span className="sidebar__link-text">설계 관리</span>
              </span>
              <span className="sidebar__group-chevron" aria-hidden>{designMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {designSubMenus.map(({ path, label, Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                  end={false}
                  title={label}
                >
                  <span className="sidebar__icon" aria-hidden>
                    <Icon />
                  </span>
                  <span className="sidebar__link-text">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div className={`sidebar__group ${modelMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isModelMenuActiveWithViewer ? 'sidebar__link--active' : ''}`}
              onClick={() => setModelMenuOpen((v) => !v)}
              aria-expanded={modelMenuOpen}
              title="모델 관리"
            >
              <span className="sidebar__group-title-start">
                <span className="sidebar__icon" aria-hidden>
                  <IconBox />
                </span>
                <span className="sidebar__link-text">모델 관리</span>
              </span>
              <span className="sidebar__group-chevron" aria-hidden>{modelMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {modelSubMenus.map((item) => {
                const SubIcon = item.Icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                    end={item.end}
                    title={item.label}
                  >
                    <span className="sidebar__icon" aria-hidden>
                      <SubIcon />
                    </span>
                    <span className="sidebar__link-text">{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          </div>
          <NavLink
            to="/code-mgmt"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
            title="코드관리 (분류체계·구성코드)"
          >
            <span className="sidebar__icon" aria-hidden>
              <IconCode />
            </span>
            <span className="sidebar__link-text">코드관리</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
            title="코드 맵핑·철근 DB 등 전체 설정"
          >
            <span className="sidebar__icon" aria-hidden>
              <IconSettings />
            </span>
            <span className="sidebar__link-text">설정</span>
          </NavLink>
          <div className={`sidebar__group ${quantityMenuOpen ? 'sidebar__group--open' : ''}`}>
            <button
              type="button"
              className={`sidebar__group-title ${isQuantityMenuActive ? 'sidebar__link--active' : ''}`}
              onClick={() => setQuantityMenuOpen((v) => !v)}
              aria-expanded={quantityMenuOpen}
              title="물량 관리"
            >
              <span className="sidebar__group-title-start">
                <span className="sidebar__icon" aria-hidden>
                  <IconTable />
                </span>
                <span className="sidebar__link-text">물량 관리</span>
              </span>
              <span className="sidebar__group-chevron" aria-hidden>{quantityMenuOpen ? '▼' : '▶'}</span>
            </button>
            <div className="sidebar__group-items">
              {quantitySubMenus.map(({ path, label, Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => `sidebar__link sidebar__link--sub ${isActive ? 'sidebar__link--active' : ''}`}
                  end={path === '/quantity'}
                  title={label}
                >
                  <span className="sidebar__icon" aria-hidden>
                    <Icon />
                  </span>
                  <span className="sidebar__link-text">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>

          {showUserMgmt && (
            <NavLink
              to="/users"
              className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
              end={false}
              title="사용자 관리"
            >
              <span className="sidebar__icon" aria-hidden>
                <IconUserCog />
              </span>
              <span className="sidebar__link-text">사용자 관리</span>
            </NavLink>
          )}
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
                <NavLink to="/profile" className="sidebar__auth-link" title="내 정보">
                  <span className="sidebar__icon" aria-hidden>
                    <IconUser />
                  </span>
                  <span className="sidebar__link-text">내 정보</span>
                </NavLink>
                <button type="button" className="sidebar__auth-btn" onClick={handleLogout} title="로그아웃">
                  <span className="sidebar__icon" aria-hidden>
                    <IconLogOut />
                  </span>
                  <span className="sidebar__link-text">로그아웃</span>
                </button>
              </>
            ) : (
              <NavLink to="/login" className="sidebar__auth-link" title="로그인">
                <span className="sidebar__icon" aria-hidden>
                  <IconUser />
                </span>
                <span className="sidebar__link-text">로그인</span>
              </NavLink>
            )}
          </div>
        </div>
      </aside>
      <div className="app__body">
        {!selectedProject && (
          <header className="main__header main__header--hint" role="status">
            <div className="main__header-top">
              <p className="main__header-hint">
                왼쪽 메뉴에서 <strong>프로젝트</strong>를 선택한 뒤 이용할 수 있습니다.
              </p>
            </div>
          </header>
        )}
        <div className="app-topbar">
          <Breadcrumb />
          <div className="app-topbar__end">
            {user ? (
              <NavLink to="/profile" className="app-topbar__user" title="내 정보">
                <div className="app-topbar__user-text">
                  <span className="app-topbar__user-name">{user.name?.trim() || user.email?.trim() || '사용자'}</span>
                  {user.role ? <span className="app-topbar__user-role">{user.role}</span> : null}
                </div>
                <span className="app-topbar__avatar" aria-hidden>
                  {(user.name?.trim() || user.email?.trim() || '?').slice(0, 1).toUpperCase()}
                </span>
              </NavLink>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
        <main className="main">
          <div
            className={[
              'main__fill',
              location.pathname.startsWith('/quantity/summary') ? 'main__fill--quantity-summary' : '',
              /\/quantity\/?$/.test(location.pathname) ? 'main__fill--quantity-dock' : '',
              location.pathname === '/trimble-viewer' || location.pathname.endsWith('/trimble-viewer')
                ? 'main__fill--trimble-viewer'
                : '',
              location.pathname === '/dashboard' ? 'main__fill--dashboard' : '',
              location.pathname.startsWith('/design-model') ||
              location.pathname.startsWith('/settings') ||
              location.pathname.startsWith('/code-mgmt') ||
              location.pathname.startsWith('/projects') ||
              location.pathname.startsWith('/design-schedule') ||
              location.pathname.startsWith('/design-doc') ||
              location.pathname.startsWith('/design-review')
                ? 'main__fill--dock'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
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
