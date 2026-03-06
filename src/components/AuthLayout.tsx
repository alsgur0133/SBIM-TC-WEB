import { Outlet } from 'react-router-dom'

export default function AuthLayout() {
  return (
    <div className="auth-layout">
      <div className="auth-layout__bg">
        <div className="auth-layout__grid" aria-hidden />
        <div className="auth-layout__rebar" aria-hidden />
      </div>
      <div className="auth-layout__content">
        <header className="auth-layout__brand">
          <h1 className="auth-layout__title">BRACE</h1>
          <p className="auth-layout__tagline">
            구조 BIM 일정 및 물량 관리
          </p>
        </header>
        <main className="auth-layout__main">
          <Outlet />
        </main>
        <footer className="auth-layout__footer">
          구조 BIM 일정 및 물량 관리 시스템
        </footer>
      </div>
    </div>
  )
}
