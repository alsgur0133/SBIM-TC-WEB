/** 배포 시 서브경로(예: /SBIM-TC-WEB) - 서버가 HTML에 넣어준 window.__BASE_PATH__ 우선 사용 */
declare global { interface Window { __BASE_PATH__?: string } }

function stripSlash (s: string): string {
  return s.replace(/\/$/, '')
}

const viteApiRaw = import.meta.env.VITE_API_URL
const viteApiNonEmpty = typeof viteApiRaw === 'string' && viteApiRaw.trim() !== '' ? viteApiRaw.trim() : undefined
const baseFromBuild = stripSlash(import.meta.env.BASE_URL || '')

function runtimeBaseFromDom (): string {
  if (typeof document === 'undefined') return ''
  const el = document.querySelector('base[href]')
  const href = el?.getAttribute('href')?.trim()
  if (!href || href === '/') return ''
  try {
    const path = new URL(href, window.location.origin).pathname
    return stripSlash(path)
  } catch {
    return stripSlash(href)
  }
}

/** OAuth 복귀 직후 등, 모듈 최초 로드보다 늦게 주입되는 __BASE_PATH__ 대비 */
function runtimeBaseFromPathname (): string {
  if (typeof window === 'undefined') return ''
  const segs = window.location.pathname.split('/').filter(Boolean)
  const first = segs[0]
  return first ? `/${first}` : ''
}

/**
 * fetch 직전에 호출 — 모듈 로드 시점에 window.__BASE_PATH__ 가 비어 있던 경우(IIS HTML 주입 순서) 보완
 */
export function getApiBase (): string {
  const winBase =
    typeof window !== 'undefined' && window.__BASE_PATH__
      ? stripSlash(String(window.__BASE_PATH__))
      : ''

  let base =
    winBase ||
    viteApiNonEmpty ||
    (import.meta.env.DEV ? '' : baseFromBuild)

  /** 프로덕션: 주소창이 /bracetc/... 인데 base 가 비면 fetch 가 /api 로 가 상위 IIS 사이트 404(HTML) 남 */
  if (typeof window !== 'undefined' && !import.meta.env.DEV && !base) {
    base = runtimeBaseFromPathname() || runtimeBaseFromDom()
  }

  /**
   * build:iis 가 넣은 VITE_BASE_PATH(예: bracetc)와 주소창이 맞는데 API base 만 빈 경우 보정.
   * (첫 경로 세그먼트만 쓰면 /dashboard 같은 루트 배포에서 오동작하므로 VITE_BASE_PATH 로만 한정)
   */
  if (typeof window !== 'undefined' && !import.meta.env.DEV) {
    const raw = typeof import.meta.env.VITE_BASE_PATH === 'string' ? import.meta.env.VITE_BASE_PATH.trim() : ''
    const builtSeg = raw ? `/${raw.replace(/^\/|\/$/g, '')}` : ''
    const p = window.location.pathname
    if (
      builtSeg &&
      (p === builtSeg || p.startsWith(`${builtSeg}/`) || p.startsWith(`${builtSeg}?`)) &&
      (!base || base === '/')
    ) {
      base = builtSeg
    }
  }

  const BASE_FOR_API = import.meta.env.DEV ? '' : base
  return typeof BASE_FOR_API === 'string' && /\/api\/?$/i.test(BASE_FOR_API)
    ? BASE_FOR_API.replace(/\/api\/?$/i, '')
    : BASE_FOR_API
}

/**
 * `${API_BASE}/api/...` 가 모듈 로드 직후 한 번만 고정되지 않도록, 문자열 변환 시마다 getApiBase() 반영.
 * (IIS에서 __BASE_PATH__ 주입·서브경로 OAuth 직후 404 방지)
 */
export const API_BASE = new Proxy(Object.create(null), {
  get (_t, prop) {
    const s = getApiBase()
    if (prop === Symbol.toPrimitive) {
      return (hint: string) => (hint === 'number' ? Number.NaN : s)
    }
    if (prop === 'toString') return () => s
    if (prop === 'valueOf') return () => s
    return (s as unknown as Record<string, unknown>)[prop as string]
  },
}) as unknown as string

/** 파일 URL 등 절대 origin이 필요할 때 (개발 시 5001, 배포 시 빈 문자열이면 현재 origin) */
export const API_SERVER_ORIGIN =
  viteApiNonEmpty ?? (import.meta.env.DEV ? 'http://127.0.0.1:5001' : '')
