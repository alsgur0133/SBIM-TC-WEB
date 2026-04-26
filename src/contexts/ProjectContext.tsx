import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getProjectsApi, type Project } from '../api/projects'
import { SELECTED_PROJECT_ID_KEY } from '../lib/project-storage'
import { useAuth } from './AuthContext'

interface ProjectContextValue {
  projects: Project[]
  selectedProject: Project | null
  setSelectedProject: (project: Project | null) => void
  loadProjects: () => void
  isLoading: boolean
}

/** 선택 프로젝트 등 — Provider 밖에서는 null (예: Trimble 뷰어에서 선택적 사용) */
export const ProjectContext = createContext<ProjectContextValue | null>(null)

function loadStoredProjectId(): string | null {
  try {
    const id = localStorage.getItem(SELECTED_PROJECT_ID_KEY)
    return id || null
  } catch {
    return null
  }
}

function saveStoredProjectId(projectId: string | null) {
  if (projectId) localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId)
  else localStorage.removeItem(SELECTED_PROJECT_ID_KEY)
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadProjects = useCallback(() => {
    setIsLoading(true)
    getProjectsApi()
      .then((res) => {
        if (res.success && res.projects) {
          setProjects(res.projects)
          const storedId = loadStoredProjectId()
          if (storedId) {
            const found = res.projects.find((p) => p.id === storedId)
            if (found) setSelectedProjectState(found)
            else {
              setSelectedProjectState(null)
              saveStoredProjectId(null)
            }
          }
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    if (!user) {
      setSelectedProjectState(null)
      setProjects([])
      return
    }
    loadProjects()
  }, [user?.id, loadProjects])

  const setSelectedProject = useCallback((project: Project | null) => {
    setSelectedProjectState(project)
    saveStoredProjectId(project?.id ?? null)
  }, [])

  const value: ProjectContextValue = {
    projects,
    selectedProject,
    setSelectedProject,
    loadProjects,
    isLoading,
  }

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used within ProjectProvider')
  return ctx
}
