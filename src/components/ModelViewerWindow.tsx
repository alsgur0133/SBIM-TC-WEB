import { useState, useRef, useCallback, useEffect } from 'react'
import ModelViewerLoader from './ModelViewerLoader'

const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 640
const MIN_WIDTH = 400
const MIN_HEIGHT = 300
const TITLE_BAR_HEIGHT = 40

type ResizeEdge = 'e' | 's' | 'se' | 'w' | 'n' | 'nw' | 'ne' | 'sw'

export interface ModelViewerWindowProps {
  onClose: () => void
  initialX?: number
  initialY?: number
  initialWidth?: number
  initialHeight?: number
}

export default function ModelViewerWindow({
  onClose,
  initialX = 80,
  initialY = 60,
  initialWidth = DEFAULT_WIDTH,
  initialHeight = DEFAULT_HEIGHT,
}: ModelViewerWindowProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY })
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight })
  const [isMaximized, setIsMaximized] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const windowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  const resizeRef = useRef<{
    edge: ResizeEdge
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    startLeft: number
    startTop: number
  } | null>(null)
  const prevRestoreRef = useRef<{ pos: { x: number; y: number }; size: { width: number; height: number } } | null>(null)

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isFullscreen) return
    if ((e.target as HTMLElement).closest('button')) return
    if (isMaximized) {
      setIsMaximized(false)
      if (prevRestoreRef.current) {
        setPos(prevRestoreRef.current.pos)
        setSize(prevRestoreRef.current.size)
      }
      return
    }
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = pos.x
    const startTop = pos.y
    dragRef.current = { startX, startY, startLeft, startTop }

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      setPos({
        x: Math.max(0, d.startLeft + ev.clientX - d.startX),
        y: Math.max(0, d.startTop + ev.clientY - d.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isMaximized, isFullscreen, pos.x, pos.y])

  const handleMaximize = useCallback(() => {
    if (isFullscreen) return
    if (isMaximized) {
      setIsMaximized(false)
      if (prevRestoreRef.current) {
        setPos(prevRestoreRef.current.pos)
        setSize(prevRestoreRef.current.size)
      }
    } else {
      prevRestoreRef.current = { pos: { ...pos }, size: { ...size } }
      setPos({ x: 0, y: 0 })
      setSize({ width: window.innerWidth, height: window.innerHeight })
      setIsMaximized(true)
    }
  }, [isMaximized, isFullscreen, pos, size])

  const toggleFullscreen = useCallback(async () => {
    const el = windowRef.current
    if (!el) return
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen()
        setIsFullscreen(true)
        setIsMaximized(false)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (err) {
      console.warn('Fullscreen not supported:', err)
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const startResize = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    if (e.button !== 0 || isMaximized || isFullscreen) return
    e.preventDefault()
    resizeRef.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: size.width,
      startHeight: size.height,
      startLeft: pos.x,
      startTop: pos.y,
    }
  }, [isMaximized, isFullscreen, size, pos])

  useEffect(() => {
    if (!resizeRef.current) return
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = e.clientX - r.startX
      const dy = e.clientY - r.startY
      let newW = r.startWidth
      let newH = r.startHeight
      let newX = r.startLeft
      let newY = r.startTop
      if (r.edge.includes('e')) newW = Math.max(MIN_WIDTH, r.startWidth + dx)
      if (r.edge.includes('w')) { const w = Math.max(MIN_WIDTH, r.startWidth - dx); newX = r.startLeft + r.startWidth - w; newW = w }
      if (r.edge.includes('s')) newH = Math.max(MIN_HEIGHT, r.startHeight + dy)
      if (r.edge.includes('n')) { const h = Math.max(MIN_HEIGHT, r.startHeight - dy); newY = r.startTop + r.startHeight - h; newH = h }
      setSize({ width: newW, height: newH })
      setPos({ x: newX, y: newY })
    }
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const windowStyle: React.CSSProperties = isFullscreen
    ? { position: 'fixed', inset: 0, width: '100%', height: '100%', borderRadius: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1e1e1e' }
    : isMaximized
      ? { position: 'fixed', top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, borderRadius: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#252526', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }
      : {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: size.width,
          height: size.height,
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#252526',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          border: '1px solid rgba(64,64,64,0.8)',
        }

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-modal="true"
      aria-label="모델 뷰어"
      style={{ ...windowStyle, zIndex: 1100 }}
      className="model-viewer-window"
    >
      {/* 타이틀 바: 드래그 + 버튼 */}
      <div
        style={{
          height: TITLE_BAR_HEIGHT,
          minHeight: TITLE_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 0.5rem 0 0.75rem',
          background: 'rgba(56, 56, 56, 0.98)',
          borderBottom: '1px solid rgba(64, 64, 64, 0.8)',
          cursor: isFullscreen ? 'default' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={handleTitleMouseDown}
      >
        <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#e0e0e0' }}>모델 뷰어</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={titleBarBtnClass}
            title={isMaximized ? '복원' : '최대화'}
            aria-label={isMaximized ? '복원' : '최대화'}
            onClick={handleMaximize}
            disabled={isFullscreen}
            style={titleBarBtnStyle}
          >
            {isMaximized ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
            )}
          </button>
          <button
            type="button"
            className={titleBarBtnClass}
            title={isFullscreen ? '전체화면 해제' : '전체화면'}
            aria-label={isFullscreen ? '전체화면 해제' : '전체화면'}
            onClick={toggleFullscreen}
            style={titleBarBtnStyle}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
          </button>
          <button type="button" className={titleBarBtnClass} title="닫기" aria-label="닫기" onClick={onClose} style={{ ...titleBarBtnStyle, marginLeft: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* 뷰어 영역 */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#1e1e1e' }}>
        <ModelViewerLoader embedded onClose={onClose} />
      </div>

      {/* 리사이즈 핸들 (전체화면/최대화가 아닐 때만) */}
      {!isFullscreen && !isMaximized && (
        <>
          <div style={resizeHandleStyle('e')} onMouseDown={startResize('e')} aria-hidden />
          <div style={resizeHandleStyle('s')} onMouseDown={startResize('s')} aria-hidden />
          <div style={resizeHandleStyle('se')} onMouseDown={startResize('se')} aria-hidden />
          <div style={resizeHandleStyle('w')} onMouseDown={startResize('w')} aria-hidden />
          <div style={resizeHandleStyle('nw')} onMouseDown={startResize('nw')} aria-hidden />
          <div style={resizeHandleStyle('ne')} onMouseDown={startResize('ne')} aria-hidden />
          <div style={resizeHandleStyle('sw')} onMouseDown={startResize('sw')} aria-hidden />
        </>
      )}
    </div>
  )
}

const titleBarBtnStyle: React.CSSProperties = {
  width: 32,
  height: 28,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: '#9ca3af',
  borderRadius: 4,
  cursor: 'pointer',
}
const titleBarBtnClass = 'model-viewer-window__title-btn'
const resizeHandleSize = 8
const RESIZE_INSET = 6
function resizeHandleStyle(edge: ResizeEdge): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', zIndex: 10, background: 'transparent' }
  switch (edge) {
    case 'e':
      return { ...base, right: 0, top: RESIZE_INSET, bottom: RESIZE_INSET, width: resizeHandleSize, cursor: 'ew-resize' }
    case 'w':
      return { ...base, left: 0, top: RESIZE_INSET, bottom: RESIZE_INSET, width: resizeHandleSize, cursor: 'ew-resize' }
    case 's':
      return { ...base, bottom: 0, left: RESIZE_INSET, right: RESIZE_INSET, height: resizeHandleSize, cursor: 'ns-resize' }
    case 'n':
      return { ...base, top: 0, left: RESIZE_INSET, right: RESIZE_INSET, height: resizeHandleSize, cursor: 'ns-resize' }
    case 'se':
      return { ...base, right: 0, bottom: 0, width: resizeHandleSize, height: resizeHandleSize, cursor: 'nwse-resize' }
    case 'sw':
      return { ...base, left: 0, bottom: 0, width: resizeHandleSize, height: resizeHandleSize, cursor: 'nesw-resize' }
    case 'ne':
      return { ...base, top: 0, right: 0, width: resizeHandleSize, height: resizeHandleSize, cursor: 'nesw-resize' }
    case 'nw':
      return { ...base, top: 0, left: 0, width: resizeHandleSize, height: resizeHandleSize, cursor: 'nwse-resize' }
    default:
      return base
  }
}
