import { useRef, useState, useLayoutEffect, useEffect, useCallback, type ReactNode, type UIEvent } from 'react'

export type VirtualListProps<T> = {
  items: readonly T[]
  /** 각 행의 고정 높이(px). 내용은 한 줄·말줄임 권장 */
  rowHeight: number
  overscan?: number
  className?: string
  renderRow: (item: T, index: number) => ReactNode
  getKey: (item: T, index: number) => string | number
  empty?: ReactNode
  /** 값이 바뀌면 스크롤을 맨 위로 (필터·데이터 세트 교체) */
  scrollResetKey?: string | number
}

/**
 * 보이는 구간 + overscan만 DOM에 렌더해 대량 목록에서도 스크롤이 부드럽게 동작합니다.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 10,
  className,
  renderRow,
  getKey,
  empty,
  scrollResetKey,
}: VirtualListProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewH(el.clientHeight || 400)
    })
    ro.observe(el)
    setViewH(el.clientHeight || 400)
    return () => ro.disconnect()
  }, [items.length])

  useEffect(() => {
    setScrollTop(0)
    const el = wrapRef.current
    if (el) el.scrollTop = 0
  }, [scrollResetKey])

  const totalH = items.length * rowHeight
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visCount = Math.ceil(viewH / rowHeight) + overscan * 2
  const end = Math.min(items.length, start + visCount)
  const slice = items.slice(start, end)
  const topPad = start * rowHeight

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  if (items.length === 0 && empty != null) {
    return <>{empty}</>
  }

  return (
    <div ref={wrapRef} className={className} onScroll={onScroll} role="presentation">
      <div style={{ height: totalH, position: 'relative', width: '100%' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: topPad,
          }}
        >
          {slice.map((item, i) => {
            const idx = start + i
            return (
              <div
                key={getKey(item, idx)}
                className="virtual-list__row"
                style={{
                  height: rowHeight,
                  boxSizing: 'border-box',
                }}
              >
                {renderRow(item, idx)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
