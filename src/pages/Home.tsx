import { useState, useEffect, useCallback } from 'react'
import { useProject } from '../contexts/ProjectContext'
import { getPhasesApi, getRevisionsApi, type DesignPhase, type DesignRevision } from '../api/designSchedule'
import GanttChart from '../components/GanttChart'

export default function Home() {
  const { selectedProject } = useProject()
  const [phases, setPhases] = useState<DesignPhase[]>([])
  const [revisionsByPhase, setRevisionsByPhase] = useState<Record<string, DesignRevision[]>>({})
  const [loading, setLoading] = useState(false)

  const loadGanttData = useCallback(() => {
    const projectId = selectedProject?.id
    if (!projectId) {
      setPhases([])
      setRevisionsByPhase({})
      return
    }
    setLoading(true)
    getPhasesApi(projectId)
      .then((res) => {
        if (!res.success || !res.phases) {
          setPhases([])
          setRevisionsByPhase({})
          return
        }
        const list = res.phases
        setPhases(list)
        const revMap: Record<string, DesignRevision[]> = {}
        let done = 0
        if (list.length === 0) {
          setRevisionsByPhase({})
          setLoading(false)
          return
        }
        list.forEach((p) => {
          getRevisionsApi(p.id).then((revRes) => {
            revMap[p.id] = revRes.success && revRes.revisions ? revRes.revisions : []
            done += 1
            if (done === list.length) {
              setRevisionsByPhase(revMap)
              setLoading(false)
            }
          })
        })
      })
      .catch(() => {
        setPhases([])
        setRevisionsByPhase({})
        setLoading(false)
      })
  }, [selectedProject?.id])

  useEffect(() => {
    loadGanttData()
  }, [loadGanttData])

  return (
    <section className="card">
      <h2>홈</h2>
      <p style={{ marginBottom: 0 }}>
        BRACE에 오신 것을 환영합니다. 메뉴에서 설계도서 관리, 물량 관리를 이용할 수 있습니다.
      </p>
      {selectedProject ? (
        <>
          <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
            프로젝트: <strong>{selectedProject.name}</strong> — 설계일정 타임라인
          </p>
          {loading ? (
            <p className="gantt gantt--empty" style={{ marginTop: '1rem' }}>
              설계일정을 불러오는 중…
            </p>
          ) : (
            <GanttChart phases={phases} revisionsByPhase={revisionsByPhase} />
          )}
        </>
      ) : (
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
          상단에서 프로젝트를 선택하면 해당 프로젝트의 설계일정 타임라인 다이어그램이 표시됩니다.
        </p>
      )}
    </section>
  )
}
