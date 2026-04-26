/**
 * 모델 뷰어(web-ifc `?viewer=ifc`)·Trimble Connect 임베드와 물량·모델 정보 화면 간 선택/층 동기화.
 * BroadcastChannel(탭 간) + BroadcastChannel 미지원 시 window 커스텀 이벤트.
 */

export const IFC_VIEWER_SYNC_CHANNEL = 'sbim-tc-ifc-viewer-sync-v1'

/** `DesignScheduleContext`와 동일 키 — 상단 리비전 선택이 sessionStorage에만 있을 때 보조 */
const DESIGN_REVISION_STORAGE_KEY = 'sbim-tc-selected-revision-id'

export function readStoredDesignRevisionId(): string {
  if (typeof sessionStorage === 'undefined') return ''
  try {
    return sessionStorage.getItem(DESIGN_REVISION_STORAGE_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

/** 모델정보·물량 등에서 뷰어로 보낼 때: React 컨텍스트 우선, 없으면 저장된 리비전 */
export function effectiveDesignRevisionIdForSync(contextRev: string | null | undefined): string {
  const fromCtx = contextRev?.trim() || ''
  if (fromCtx) return fromCtx
  return readStoredDesignRevisionId()
}

export type IfcViewerSyncAction = 'selectExpress' | 'selectGlobalId' | 'highlightFloor'

export type IfcViewerSyncPayload = {
  v: 1
  action: IfcViewerSyncAction
  designRevisionId: string
  projectId?: string
  expressId?: number
  modelIndex?: number
  globalId?: string | null
  floor?: string | null
  designModelId?: string | null
}

function parsePayload(data: unknown): IfcViewerSyncPayload | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.v !== 1) return null
  const designRevisionId = typeof o.designRevisionId === 'string' ? o.designRevisionId.trim() : ''
  if (!designRevisionId) return null
  const action = o.action as IfcViewerSyncAction
  if (action !== 'selectExpress' && action !== 'selectGlobalId' && action !== 'highlightFloor') return null
  const projectId = typeof o.projectId === 'string' ? o.projectId.trim() : undefined
  const expressId = typeof o.expressId === 'number' && Number.isFinite(o.expressId) ? o.expressId : undefined
  const modelIndex = typeof o.modelIndex === 'number' && Number.isFinite(o.modelIndex) ? o.modelIndex : undefined
  const globalId = o.globalId != null ? String(o.globalId) : undefined
  const floor = o.floor != null ? String(o.floor) : undefined
  const designModelId = o.designModelId != null ? String(o.designModelId).trim() : undefined
  return {
    v: 1,
    action,
    designRevisionId,
    projectId: projectId || undefined,
    expressId,
    modelIndex,
    globalId: globalId || undefined,
    floor,
    designModelId: designModelId || undefined,
  }
}

export function postIfcViewerSync(payload: IfcViewerSyncPayload): void {
  /** 다른 탭·창 */
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(IFC_VIEWER_SYNC_CHANNEL)
      try {
        ch.postMessage(payload)
      } finally {
        ch.close()
      }
    } catch {
      /* ignore */
    }
  }
  /** 같은 창(모델정보 + 뷰어 동시에 떠 있는 경우 등) — BC만으로는 수신이 빠지는 환경 대비 */
  try {
    window.dispatchEvent(new CustomEvent<IfcViewerSyncPayload>('sbim-ifc-viewer-sync', { detail: payload }))
  } catch {
    /* ignore */
  }
}

type Listener = (msg: IfcViewerSyncPayload) => void

let sharedBc: BroadcastChannel | null = null
let bcRefCount = 0
const bcListeners = new Set<(ev: MessageEvent) => void>()

function attachBcListener(onMessage: (ev: MessageEvent) => void) {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  if (!sharedBc) {
    try {
      sharedBc = new BroadcastChannel(IFC_VIEWER_SYNC_CHANNEL)
    } catch {
      return () => {}
    }
    sharedBc.onmessage = (ev: MessageEvent) => {
      for (const fn of bcListeners) {
        try {
          fn(ev)
        } catch {
          /* ignore */
        }
      }
    }
  }
  bcListeners.add(onMessage)
  bcRefCount++
  return () => {
    bcListeners.delete(onMessage)
    bcRefCount--
    if (bcRefCount <= 0 && sharedBc) {
      try {
        sharedBc.close()
      } catch {
        /* ignore */
      }
      sharedBc = null
    }
  }
}

export function subscribeIfcViewerSync(handler: Listener): () => void {
  let lastDedupeKey = ''
  let lastDedupeAt = 0
  const deliver = (p: IfcViewerSyncPayload) => {
    const key = `${p.action}\t${p.designRevisionId}\t${p.expressId ?? ''}\t${p.globalId ?? ''}\t${p.floor ?? ''}\t${p.designModelId ?? ''}`
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (key === lastDedupeKey && now - lastDedupeAt < 80) return
    lastDedupeKey = key
    lastDedupeAt = now
    handler(p)
  }

  const onWin = (ev: Event) => {
    const ce = ev as CustomEvent<unknown>
    const p = parsePayload(ce.detail)
    if (p) deliver(p)
  }
  window.addEventListener('sbim-ifc-viewer-sync', onWin as EventListener)

  let detachBc = () => {}
  if (typeof BroadcastChannel !== 'undefined') {
    const onBc = (ev: MessageEvent) => {
      const p = parsePayload(ev.data)
      if (p) deliver(p)
    }
    detachBc = attachBcListener(onBc)
  }

  return () => {
    detachBc()
    window.removeEventListener('sbim-ifc-viewer-sync', onWin as EventListener)
  }
}
