import type { HTMLAttributes, ReactNode } from 'react'
import { VirtualList } from './VirtualList'

export type VirtualDataGridProps<T> = {
  items: readonly T[]
  rowHeight: number
  /** CSS grid-template-columns (헤더·행 공통) */
  gridTemplateColumns: string
  /** 생략 시 외부 `<thead>` 등과 조합할 때 본문만 표시 */
  header?: ReactNode
  renderRow: (item: T, index: number) => ReactNode
  getKey: (item: T, index: number) => string | number
  /** 각 행 래퍼(div)에 전달 (클릭·선택 스타일 등) */
  getRowProps?: (item: T, index: number) => HTMLAttributes<HTMLDivElement>
  empty?: ReactNode
  scrollResetKey?: string | number
  overscan?: number
  wrapClassName?: string
  headClassName?: string
  bodyClassName?: string
}

/**
 * 테이블 대신 그리드 + VirtualList로 대량 행을 렌더합니다(보이는 영역만 DOM 유지).
 */
export function VirtualDataGrid<T>({
  items,
  rowHeight,
  gridTemplateColumns,
  header,
  renderRow,
  getKey,
  empty,
  scrollResetKey,
  overscan,
  wrapClassName,
  headClassName,
  bodyClassName,
  getRowProps,
}: VirtualDataGridProps<T>) {
  if (items.length === 0 && empty != null) {
    return <>{empty}</>
  }

  return (
    <div className={wrapClassName ?? 'virtual-data-grid'}>
      {header != null && (
        <div className={headClassName ?? 'virtual-data-grid__head'}>
          <div
            className="virtual-data-grid__head-grid"
            style={{
              display: 'grid',
              gridTemplateColumns,
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            {header}
          </div>
        </div>
      )}
      <VirtualList
        items={items}
        rowHeight={rowHeight}
        overscan={overscan ?? 12}
        scrollResetKey={scrollResetKey}
        getKey={getKey}
        className={bodyClassName ?? 'virtual-data-grid__body'}
        renderRow={(item, index) => {
          const rp = getRowProps?.(item, index) ?? {}
          const { className: rpc, style: rps, ...rest } = rp
          return (
            <div
              {...rest}
              style={{
                display: 'grid',
                gridTemplateColumns,
                alignItems: 'center',
                gap: '0.25rem',
                minWidth: 0,
                ...(rps && typeof rps === 'object' ? rps : {}),
              }}
              className={['virtual-data-grid__row', rpc].filter(Boolean).join(' ')}
            >
              {renderRow(item, index)}
            </div>
          )
        }}
      />
    </div>
  )
}
