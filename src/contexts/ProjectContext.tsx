import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getProjectsApi, type Project } from '../api/projects'

const STORAGE_KEY = 'sbim-tc-selected-project-id'

interface ProjectContextValue {
  projects: Project[]
  selectedProject: Project | null
  setSelectedProject: (project: Project | null) => void
  loadProjects: () => void
  isLoading: boolean
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

function loadStoredProjectId(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    return id || null
  } catch {
    return null
  }
}

function saveStoredProjectId(projectId: string | null) {
  if (projectId) localStorage.setItem(STORAGE_KEY, projectId)
  else localStorage.removeItem(STORAGE_KEY)
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
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
    loadProjects()
  }, [loadProjects])

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
