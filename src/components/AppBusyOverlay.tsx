import { useSyncExternalStore } from 'react'
import { getAppBusySnapshot, subscribeAppBusy } from '../lib/appBusy'

/**
 * /api 요청이 하나라도 진행 중이면 상단에 얇은 진행 막대(비차단, pointer-events 없음).
 */
export default function AppBusyOverlay() {
  const n = useSyncExternalStore(subscribeAppBusy, getAppBusySnapshot, () => 0)
  if (n <= 0) return null
  return (
    <>
      <div className="app-busy-bar" aria-hidden />
      <span className="visually-hidden" role="status" aria-live="polite">
        서버 요청 처리 중
      </span>
    </>
  )
}
