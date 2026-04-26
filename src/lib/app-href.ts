declare global {
  interface Window {
    __BASE_PATH__?: string
  }
}

/** React Router basename과 동일한 앱 내 경로 (window.open 등 동일 출처용) */
export function resolveAppHref(path: string): string {
  const segment = path.replace(/^\//, '')
  const fromWindow =
    typeof window !== 'undefined' && window.__BASE_PATH__ != null && String(window.__BASE_PATH__).trim() !== ''
      ? String(window.__BASE_PATH__).replace(/\/$/, '')
      : ''
  const fromEnv = (import.meta.env.BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
  const base = fromWindow || fromEnv
  if (!base) return `/${segment}`
  return `${base}/${segment}`
}
