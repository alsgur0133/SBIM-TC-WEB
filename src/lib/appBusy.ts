/**
 * 전역 API 요청 수를 추적해 상단 진행 표시용.
 * window.fetch를 한 번 감싸 /api 호출만 집계(대용량 IFC 파일 GET 등은 제외).
 */

let count = 0
const listeners = new Set<() => void>()

export function subscribeAppBusy(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

export function getAppBusySnapshot(): number {
  return count
}

function notify() {
  listeners.forEach((l) => l())
}

function delta(d: number) {
  count = Math.max(0, count + d)
  notify()
}

function shouldTrackApiFetch(url: string, method: string): boolean {
  try {
    const u = url.startsWith('http') ? new URL(url) : new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    if (!u.pathname.includes('/api')) return false
    const m = (method || 'GET').toUpperCase()
    if (m === 'GET' && /\/design-models\/[^/]+\/file\/?$/i.test(u.pathname)) return false
    return true
  } catch {
    return false
  }
}

let installed = false

export function installAppBusyFetch(): void {
  if (typeof window === 'undefined' || installed) return
  const w = window as Window & { __braceAppBusyFetch?: boolean }
  if (w.__braceAppBusyFetch) return
  w.__braceAppBusyFetch = true
  installed = true

  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = ''
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url
    const method = init?.method || (input instanceof Request ? input.method : undefined) || 'GET'
    const track = shouldTrackApiFetch(url, method)
    if (track) delta(1)
    try {
      return await orig(input as RequestInfo, init)
    } finally {
      if (track) delta(-1)
    }
  }
}
