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
    <section className="card card--panel home-page">
      <h2>홈</h2>
      <p className="app-page__lead home-page__lead">
        프로젝트를 선택한 뒤 왼쪽 메뉴에서 업무 화면으로 이동할 수 있습니다.
      </p>
      {selectedProject ? (
        <>
          <p className="home-page__context">
            프로젝트: <strong>{selectedProject.name}</strong> — 설계일정 타임라인
          </p>
          {loading ? (
            <p className="gantt gantt--empty home-page__gantt-loading">설계일정을 불러오는 중…</p>
          ) : (
            <GanttChart phases={phases} revisionsByPhase={revisionsByPhase} />
          )}
        </>
      ) : (
        <p className="home-page__context">상단에서 프로젝트를 선택하면 해당 프로젝트의 설계일정 타임라인이 표시됩니다.</p>
      )}
    </section>
  )
}
