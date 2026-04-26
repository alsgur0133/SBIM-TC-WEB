import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'sbim-ui-theme'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (t: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light'
    const s = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (s === 'dark' || s === 'light') return s
    return 'light'
  })

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export function initThemeFromStorage() {
  if (typeof window === 'undefined') return
  const s = localStorage.getItem(STORAGE_KEY) as ThemeMode | null
  const mode = s === 'dark' || s === 'light' ? s : 'light'
  applyTheme(mode)
}
