import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useProject } from './ProjectContext'
import { getPhasesApi, getRevisionsApi, type DesignPhase, type DesignRevision } from '../api/designSchedule'

const STORAGE_KEY_PHASE = 'sbim-tc-selected-phase-id'
const STORAGE_KEY_REVISION = 'sbim-tc-selected-revision-id'

interface DesignScheduleContextValue {
  phases: DesignPhase[]
  revisions: DesignRevision[]
  selectedPhaseId: string
  selectedRevisionId: string
  setSelectedPhaseId: (id: string) => void
  setSelectedRevisionId: (id: string) => void
  selectedPhase: DesignPhase | null
  selectedRevision: DesignRevision | null
  loadingPhases: boolean
  fetchPhases: () => void
  fetchRevisions: (phaseId: string) => void
}

const DesignScheduleContext = createContext<DesignScheduleContextValue | null>(null)

const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} }

function loadStoredPhaseId(): string {
  try {
    return storage.getItem(STORAGE_KEY_PHASE) || ''
  } catch {
    return ''
  }
}

function loadStoredRevisionId(): string {
  try {
    return storage.getItem(STORAGE_KEY_REVISION) || ''
  } catch {
    return ''
  }
}

function saveStoredPhaseId(id: string) {
  try {
    if (id) storage.setItem(STORAGE_KEY_PHASE, id)
    else storage.removeItem(STORAGE_KEY_PHASE)
  } catch {}
}

function saveStoredRevisionId(id: string) {
  try {
    if (id) storage.setItem(STORAGE_KEY_REVISION, id)
    else storage.removeItem(STORAGE_KEY_REVISION)
  } catch {}
}

export function DesignScheduleProvider({ children }: { children: React.ReactNode }) {
  const { selectedProject } = useProject()
  const [phases, setPhases] = useState<DesignPhase[]>([])
  const [revisionsByPhase, setRevisionsByPhase] = useState<Record<string, DesignRevision[]>>({})
  const [selectedPhaseId, setSelectedPhaseIdState] = useState<string>(loadStoredPhaseId)
  const [selectedRevisionId, setSelectedRevisionIdState] = useState<string>(loadStoredRevisionId)
  const [loadingPhases, setLoadingPhases] = useState(false)

  const fetchPhases = useCallback(() => {
    if (!selectedProject) {
      setPhases([])
      setSelectedPhaseIdState('')
      setSelectedRevisionIdState('')
      setRevisionsByPhase({})
      // 창 종료 전까지 유지: 프로젝트 미선택 시에도 저장소는 비우지 않음 (F5 새로고침 후 복원용)
      return
    }
    setLoadingPhases(true)
    setRevisionsByPhase({})
    getPhasesApi(selectedProject.id)
      .then((res) => {
        if (res.success && res.phases) {
          setPhases(res.phases)
          const storedPhaseId = loadStoredPhaseId()
          const validPhase = storedPhaseId && res.phases.some((p) => p.id === storedPhaseId)
          if (validPhase) {
            setSelectedPhaseIdState(storedPhaseId)
            saveStoredPhaseId(storedPhaseId)
            getRevisionsApi(storedPhaseId).then((revRes) => {
              if (revRes.success && revRes.revisions) {
                setRevisionsByPhase((prev) => ({ ...prev, [storedPhaseId]: revRes.revisions! }))
                const storedRevisionId = loadStoredRevisionId()
                const validRev = storedRevisionId && revRes.revisions!.some((r) => r.id === storedRevisionId)
                if (validRev) {
                  setSelectedRevisionIdState(storedRevisionId)
                  saveStoredRevisionId(storedRevisionId)
                } else {
                  setSelectedRevisionIdState('')
                  saveStoredRevisionId('')
                }
              }
            })
          } else {
            setSelectedPhaseIdState('')
            setSelectedRevisionIdState('')
            saveStoredPhaseId('')
            saveStoredRevisionId('')
          }
        } else {
          setPhases([])
        }
      })
      .catch(() => setPhases([]))
      .finally(() => setLoadingPhases(false))
  }, [selectedProject?.id])

  const fetchRevisions = useCallback((phaseId: string) => {
    if (!phaseId) return
    getRevisionsApi(phaseId).then((res) => {
      if (res.success && res.revisions) {
        setRevisionsByPhase((prev) => ({ ...prev, [phaseId]: res.revisions! }))
        const storedRevisionId = loadStoredRevisionId()
        const validRev = storedRevisionId && res.revisions!.some((r) => r.id === storedRevisionId)
        if (validRev) {
          setSelectedRevisionIdState(storedRevisionId)
          saveStoredRevisionId(storedRevisionId)
        } else {
          setSelectedRevisionIdState('')
          saveStoredRevisionId('')
        }
      }
    })
  }, [])

  useEffect(() => {
    fetchPhases()
  }, [fetchPhases])

  useEffect(() => {
    if (selectedPhaseId) {
      fetchRevisions(selectedPhaseId)
    } else {
      setRevisionsByPhase({})
    }
  }, [selectedPhaseId, fetchRevisions])

  // phase가 비었을 때는 화면 상태만 비우고, 저장소는 유지 (F5 시 phase 복원 후 리비전 복원용)
  useEffect(() => {
    if (!selectedPhaseId) {
      setSelectedRevisionIdState('')
    }
  }, [selectedPhaseId])

  const setSelectedPhaseId = useCallback((id: string) => {
    setSelectedPhaseIdState(id)
    saveStoredPhaseId(id)
    if (!id) {
      setSelectedRevisionIdState('')
      saveStoredRevisionId('')
    }
  }, [])

  const setSelectedRevisionId = useCallback((id: string) => {
    setSelectedRevisionIdState(id)
    saveStoredRevisionId(id)
  }, [])

  const revisions = selectedPhaseId ? revisionsByPhase[selectedPhaseId] || [] : []
  const selectedPhase = phases.find((p) => p.id === selectedPhaseId) ?? null
  const selectedRevision = revisions.find((r) => r.id === selectedRevisionId) ?? null

  const value: DesignScheduleContextValue = {
    phases,
    revisions,
    selectedPhaseId,
    selectedRevisionId,
    setSelectedPhaseId,
    setSelectedRevisionId,
    selectedPhase,
    selectedRevision,
    loadingPhases,
    fetchPhases,
    fetchRevisions,
  }

  return (
    <DesignScheduleContext.Provider value={value}>
      {children}
    </DesignScheduleContext.Provider>
  )
}

export function useDesignSchedule() {
  const ctx = useContext(DesignScheduleContext)
  if (!ctx) throw new Error('useDesignSchedule must be used within DesignScheduleProvider')
  return ctx
}
