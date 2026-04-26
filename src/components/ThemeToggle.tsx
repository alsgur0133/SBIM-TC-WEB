import { useTheme } from '../contexts/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="app-theme-toggle"
      onClick={toggleTheme}
      title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      <span className="app-theme-toggle__icon" aria-hidden>
        {isDark ? '☀' : '☾'}
      </span>
      <span className="app-theme-toggle__label">{isDark ? '라이트' : '다크'}</span>
    </button>
  )
}
