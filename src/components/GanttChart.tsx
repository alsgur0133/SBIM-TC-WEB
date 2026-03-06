import { useMemo, Fragment } from 'react'
import type { DesignPhase, DesignRevision } from '../api/designSchedule'

interface GanttChartProps {
  phases: DesignPhase[]
  revisionsByPhase: Record<string, DesignRevision[]>
}

export default function GanttChart({ phases, revisionsByPhase }: GanttChartProps) {
  const items = useMemo(() => {
    return phases.map((phase, index) => {
      const revisions = revisionsByPhase[phase.id] || []
      return {
        phase,
        revisions,
        side: index % 2 === 0 ? 'right' as const : 'left' as const,
      }
    })
  }, [phases, revisionsByPhase])

  const hasData = items.length > 0

  if (!hasData) {
    return (
      <div className="gantt gantt--empty">
        <p className="gantt__empty">설계 차수·리비전이 없습니다. 설계일정 관리에서 등록해 보세요.</p>
      </div>
    )
  }

  return (
    <div className="gantt gantt--vertical-timeline">
      <div className="vtl">
        <div className="vtl__line" aria-hidden />
        <div className="vtl__list">
          {items.map(({ phase, revisions, side }) => (
            <Fragment key={phase.id}>
              <div className={`vtl__item vtl__item--${side}`}>
                <div className="vtl__item-left">
                  {side === 'left' && (
                    <>
                      <div className="vtl__card">
                        <h3 className="vtl__card-title">{phase.name}</h3>
                      </div>
                      <div className="vtl__connector" aria-hidden />
                    </>
                  )}
                </div>
                <div className="vtl__node" aria-hidden />
                <div className="vtl__item-right">
                  {side === 'right' && (
                    <>
                      <div className="vtl__connector" aria-hidden />
                      <div className="vtl__card">
                        <h3 className="vtl__card-title">{phase.name}</h3>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {revisions.length > 0 &&
                revisions.map((r) => (
                  <div key={r.id} className={`vtl__item vtl__item--revision vtl__item--${side}`}>
                    <div className="vtl__item-left">
                      {side === 'left' && (
                        <>
                          <div className="vtl__revision-label">{r.revision_name}</div>
                          <div className="vtl__connector vtl__connector--revision" aria-hidden />
                        </>
                      )}
                    </div>
                    <div className="vtl__node vtl__node--revision" aria-hidden title={r.revision_name} />
                    <div className="vtl__item-right">
                      {side === 'right' && (
                        <>
                          <div className="vtl__connector vtl__connector--revision" aria-hidden />
                          <div className="vtl__revision-label">{r.revision_name}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
