import { useState, useEffect, useCallback, useRef, useMemo, type KeyboardEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import {
  getProjectsApi,
  getNextProjectCodeApi,
  createProjectApi,
  updateProjectApi,
  deleteProjectApi,
  fetchTrimbleConnectMyProjectsApi,
  type Project,
  type ProjectStatus,
  type TrimbleConnectProjectSummary,
  type TrimbleConnectImportSummary,
} from '../api/projects'
import { getUsersApi, type ApiUserRow } from '../api/auth'
import './ProjectManagement.css'

const PAGE_SIZE = 10

function formatDate(s: string) {
  if (!s) return '-'
  return s.slice(0, 10)
}

const PROJECT_STATUSES: ProjectStatus[] = ['예정', '진행', '완료']

function exportProjectsCsv(rows: Project[]) {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['코드', '프로젝트명', '발주처', '시작', '종료', 'PM', '상태', '비고']
  const lines = rows.map((p) =>
    [
      p.code ?? '',
      p.name ?? '',
      p.client ?? '',
      (p.start_date ?? '').slice(0, 10),
      (p.end_date ?? '').slice(0, 10),
      p.pm ?? '',
      p.status ?? '',
      p.description ?? '',
    ]
      .map((c) => esc(String(c)))
      .join(',')
  )
  const bom = '\uFEFF'
  const blob = new Blob([bom + head.join(',') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `project-list-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function initialsFromDisplayName(s: string) {
  const t = (s || '').trim()
  if (!t || t === '—') return '?'
  if (t.includes('@')) return t.slice(0, 2).toUpperCase()
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

function statusPillMeta(status: string | null | undefined): { className: string; label: string } {
  const s = (status || '예정').trim()
  if (s === '진행') return { className: 'project-list-page__pill project-list-page__pill--progress', label: '진행' }
  if (s === '완료') return { className: 'project-list-page__pill project-list-page__pill--done', label: '완료' }
  return { className: 'project-list-page__pill project-list-page__pill--scheduled', label: '예정' }
}

type TcConnectMode = 'create' | 'link' | 'none'

function trimbleRegionLabel(loc: string | undefined): string {
  if (!loc) return ''
  const m: Record<string, string> = {
    asia: '아시아',
    australia: '호주',
    europe: '유럽',
    northAmerica: '북미',
    na: '북미',
    ap: '아시아',
    eu: '유럽',
    'ap-au': '호주',
  }
  return m[loc] || m[loc.toLowerCase()] || loc
}

/** API 응답 project를 테이블 표시용 필드로 정규화 */
function normalizeProject(p: Project | undefined): Project | null {
  if (!p?.id) return null
  return {
    id: p.id,
    name: p.name ?? '',
    description: p.description ?? null,
    code: p.code ?? null,
    client: p.client ?? null,
    start_date: p.start_date ?? null,
    end_date: p.end_date ?? null,
    pm: p.pm ?? null,
    status: (p.status as ProjectStatus) ?? '예정',
    trimble_connect_project_id: p.trimble_connect_project_id ?? null,
    created_at: p.created_at ?? '',
    updated_at: p.updated_at ?? '',
  }
}

export default function ProjectManagement() {
  const { user, trimbleTokens, refreshTrimbleAccessToken } = useAuth()
  const { selectedProject, setSelectedProject } = useProject()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formPm, setFormPm] = useState('')
  const [formStatus, setFormStatus] = useState<ProjectStatus>('예정')
  const [formStartDate, setFormStartDate] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formClient, setFormClient] = useState('')
  const [saving, setSaving] = useState(false)
  const [openCreateLoading, setOpenCreateLoading] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all')
  const [page, setPage] = useState(1)
  const [userList, setUserList] = useState<ApiUserRow[]>([])
  const [columnFilters, setColumnFilters] = useState({
    code: '',
    name: '',
    client: '',
    period: '',
    pm: '',
    status: '',
    description: '',
  })
  const [sortKey, setSortKey] = useState<'code' | 'name' | 'client' | 'period' | 'pm' | 'status' | 'description'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const formNameInputRef = useRef<HTMLInputElement>(null)
  const [tcConnectMode, setTcConnectMode] = useState<TcConnectMode>('create')
  const [tcProjects, setTcProjects] = useState<TrimbleConnectProjectSummary[]>([])
  const [tcListLoading, setTcListLoading] = useState(false)
  const [tcListError, setTcListError] = useState('')
  const [selectedTcProjectId, setSelectedTcProjectId] = useState('')
  const [tcManualProjectId, setTcManualProjectId] = useState('')

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const loadTrimbleProjects = useCallback(async () => {
    if (!user?.email || !trimbleTokens?.accessToken) return
    setTcListLoading(true)
    setTcListError('')
    let session = await refreshTrimbleAccessToken()
    if (!session?.accessToken) {
      setTcListLoading(false)
      setTcListError(
        'Trimble 세션이 만료되었거나 갱신할 수 없습니다. 로그아웃 후 상단에서 Trimble Connect로 다시 로그인해 주세요.'
      )
      return
    }
    let res = await fetchTrimbleConnectMyProjectsApi(user.email, session.accessToken)
    if (!res.success) {
      const errLow = (res.error || '').toLowerCase()
      if (/session invalid|invalid.?token|invalid_token|unauthorized|401/.test(errLow)) {
        const again = await refreshTrimbleAccessToken({ force: true })
        if (again?.accessToken) {
          res = await fetchTrimbleConnectMyProjectsApi(user.email, again.accessToken)
        }
      }
    }
    setTcListLoading(false)
    if (res.success && Array.isArray(res.projects)) {
      setTcProjects(res.projects)
      if (res.projects.length === 0) {
        setTcListError(
          'Connect에서 가져온 프로젝트가 없습니다. 웹(Connect)에서 참여 중인 프로젝트가 있는지 확인하세요.'
        )
      }
    } else {
      const msg = res.error || '목록을 불러오지 못했습니다.'
      setTcListError(
        /session invalid/i.test(msg)
          ? `${msg} — 다시 시도해도 같으면 Trimble Connect로 재로그인해 주세요.`
          : msg
      )
    }
  }, [user?.email, trimbleTokens?.accessToken, refreshTrimbleAccessToken])

  useEffect(() => {
    if (!modalOpen || editingProject || tcConnectMode !== 'link') return
    if (!trimbleTokens?.accessToken || !user?.email) return
    void loadTrimbleProjects()
  }, [modalOpen, editingProject, tcConnectMode, trimbleTokens?.accessToken, user?.email, loadTrimbleProjects])

  const filteredProjects = useMemo(() => {
    let list = projects
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          (p.code ?? '').toLowerCase().includes(q) ||
          (p.name ?? '').toLowerCase().includes(q) ||
          (p.client ?? '').toLowerCase().includes(q) ||
          (p.pm ?? '').toLowerCase().includes(q) ||
          (p.status ?? '').toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q)
      )
    }
    const f = columnFilters
    const match = (val: string | null | undefined, filterVal: string) => {
      if (!filterVal.trim()) return true
      return (val ?? '').toLowerCase().includes(filterVal.trim().toLowerCase())
    }
    if (f.code.trim()) list = list.filter((p) => match(p.code, f.code))
    if (f.name.trim()) list = list.filter((p) => match(p.name, f.name))
    if (f.client.trim()) list = list.filter((p) => match(p.client, f.client))
    if (f.pm.trim()) list = list.filter((p) => match(p.pm, f.pm))
    if (f.status.trim()) list = list.filter((p) => match(p.status, f.status))
    if (f.period.trim()) {
      const periodVal = f.period.trim().toLowerCase()
      list = list.filter((p) => {
        const start = formatDate(p.start_date ?? '')
        const end = formatDate(p.end_date ?? '')
        const periodStr = [start, end].filter((d) => d !== '-').join(' ~ ')
        return periodStr.toLowerCase().includes(periodVal)
      })
    }
    if (f.description.trim()) list = list.filter((p) => match(p.description, f.description))
    return list
  }, [projects, search, columnFilters])

  const filteredByStatus = useMemo(() => {
    if (statusFilter === 'all') return filteredProjects
    return filteredProjects.filter((p) => (p.status ?? '') === statusFilter)
  }, [filteredProjects, statusFilter])

  const sortedProjects = useMemo(() => {
    const list = [...filteredByStatus]
    if (list.length === 0) return list
    const getSortValue = (p: Project) => {
      switch (sortKey) {
        case 'code':
          return (p.code ?? '').toLowerCase()
        case 'name':
          return (p.name ?? '').toLowerCase()
        case 'client':
          return (p.client ?? '').toLowerCase()
        case 'pm':
          return (p.pm ?? '').toLowerCase()
        case 'status':
          return (p.status ?? '').toLowerCase()
        case 'period':
          return (p.start_date ?? '').toLowerCase()
        case 'description':
          return (p.description ?? '').toLowerCase()
        default:
          return ''
      }
    }
    list.sort((a, b) => {
      const va = getSortValue(a)
      const vb = getSortValue(b)
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [filteredByStatus, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedProjects.length / PAGE_SIZE))
  const effectivePage = Math.min(Math.max(1, page), totalPages)
  const pageRows = sortedProjects.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== effectivePage) setPage(effectivePage)
  }, [page, effectivePage])

  useEffect(() => {
    setPage(1)
  }, [search, columnFilters, statusFilter])

  /** 관리자일 때는 PM으로 '프로젝트 관리자' 역할 사용자만 선택 가능. 수정 시 기존 PM이 목록에 없으면 그대로 표시용으로 포함 */
  const pmSelectUserList = useMemo(() => {
    const base = user?.role === '관리자'
      ? userList.filter((u) => u.role === '프로젝트 관리자')
      : userList
    if (editingProject?.pm && user?.role === '관리자') {
      const hasCurrent = base.some((u) => (u.email || '').toLowerCase() === (editingProject.pm || '').toLowerCase())
      if (!hasCurrent) {
        const existing = userList.find((u) => (u.email || '').toLowerCase() === (editingProject.pm || '').toLowerCase())
        if (existing) return [existing, ...base]
      }
    }
    return base
  }, [user?.role, userList, editingProject?.pm])

  function getPmDisplayName(pmEmail: string | null | undefined): string {
    if (!pmEmail) return '—'
    const u = userList.find((x) => (x.email || '').toLowerCase() === (pmEmail || '').toLowerCase())
    return u ? (u.name || u.email) : pmEmail
  }

  const someSelected = selectedIds.size > 0

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function setColumnFilter(key: keyof typeof columnFilters, value: string) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }))
  }

  function normalizeError(msg: string): string {
    if (!msg) return '요청을 처리할 수 없습니다.'
    if (msg.includes('경로를 찾을 수 없습니다') || msg.includes('404'))
      return '프로젝트 API를 사용할 수 없습니다. 터미널에서 "npm run server"로 API 서버를 재시작한 뒤 새로고침해 보세요.'
    if (msg.includes('연결할 수 없습니다') || msg.includes('Failed to fetch'))
      return '서버에 연결할 수 없습니다. API 서버가 실행 중인지 확인하세요. (npm run server)'
    return msg
  }

  const fetchProjects = useCallback((silent = false) => {
    if (!silent) {
      setError('')
      setLoading(true)
    }
    getProjectsApi()
      .then((res) => {
        if (res.success && Array.isArray(res.projects)) {
          setProjects(res.projects)
        } else if (!silent) {
          setError(normalizeError(res.error || '목록을 불러올 수 없습니다.'))
        }
      })
      .catch((err) => {
        if (!silent) {
          setError(normalizeError(err instanceof Error ? err.message : '목록을 불러올 수 없습니다.'))
        }
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (!canManage || !user?.email) return
    getUsersApi(user.email)
      .then((res) => {
        if (res.success && Array.isArray(res.users)) {
          setUserList(res.users.filter((u) => u.status === '활성'))
        }
      })
      .catch(() => setUserList([]))
  }, [canManage, user?.email])

  useEffect(() => {
    if (!modalOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [modalOpen])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (pageRows.length === 0) return
    const allSelected = pageRows.every((p) => selectedIds.has(p.id))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageRows.forEach((p) => next.delete(p.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        pageRows.forEach((p) => next.add(p.id))
        return next
      })
    }
  }

  async function deleteSelected() {
    const toDelete = projects.filter((p) => selectedIds.has(p.id))
    if (toDelete.length === 0) {
      setError('삭제할 항목을 선택하세요.')
      return
    }
    if (!window.confirm(`선택한 ${toDelete.length}개의 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return
    if (!user?.email) return
    setError('')
    setDeletingIds(new Set(toDelete.map((p) => p.id)))
    const failed: string[] = []
    for (const p of toDelete) {
      const res = await deleteProjectApi(user.email, p.id)
      if (!res.success) failed.push(p.name)
    }
    setDeletingIds(new Set())
    setSelectedIds(new Set())
    if (failed.length > 0) {
      setError(`일부 삭제 실패: ${failed.join(', ')}`)
    }
    setProjects((prev) => prev.filter((p) => !toDelete.some((d) => d.id === p.id)))
  }

  function resetTrimbleFormState() {
    setTcConnectMode('create')
    setTcProjects([])
    setSelectedTcProjectId('')
    setTcManualProjectId('')
    setTcListError('')
    setTcListLoading(false)
  }

  function openCreate() {
    setError('')
    setEditingProject(null)
    resetTrimbleFormState()
    setFormName('')
    setFormDesc('')
    setFormClient('')
    setFormPm(user?.email ?? '')
    setFormStatus('예정')
    setFormStartDate('')
    setFormEndDate('')
    const fallbackCode = (() => {
      const d = new Date()
      const yymm = String(d.getFullYear()).slice(-2) + String(d.getMonth() + 1).padStart(2, '0')
      return `${yymm}-001`
    })()
    setOpenCreateLoading(true)
    getNextProjectCodeApi()
      .then((res) => {
        setFormCode(res.success && res.code ? res.code : fallbackCode)
        setModalOpen(true)
        setTimeout(() => formNameInputRef.current?.focus(), 0)
      })
      .catch(() => {
        setFormCode(fallbackCode)
        setModalOpen(true)
        setTimeout(() => formNameInputRef.current?.focus(), 0)
      })
      .finally(() => setOpenCreateLoading(false))
  }

  function openEdit(p: Project) {
    setError('')
    setEditingProject(p)
    resetTrimbleFormState()
    setFormName(p.name)
    setFormDesc(p.description || '')
    setFormCode(p.code ?? '')
    setFormClient(p.client ?? '')
    setFormPm(p.pm ?? user?.email ?? '')
    setFormStatus((p.status as ProjectStatus) || '예정')
    setFormStartDate(p.start_date ?? '')
    setFormEndDate(p.end_date ?? '')
    setModalOpen(true)
    setTimeout(() => formNameInputRef.current?.focus(), 0)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingProject(null)
    resetTrimbleFormState()
    setFormName('')
    setFormDesc('')
    setFormCode('')
    setFormClient('')
    setFormPm('')
    setFormStatus('예정')
    setFormStartDate('')
    setFormEndDate('')
  }

  async function handleSave() {
    const name = formName.trim()
    if (!name) {
      setError('프로젝트 이름을 입력하세요.')
      return
    }
    if (!user?.email) return
    setError('')
    setSaving(true)
    const opts = {
      description: formDesc.trim() || undefined,
      client: formClient.trim() || undefined,
      startDate: formStartDate.trim() || undefined,
      endDate: formEndDate.trim() || undefined,
      pm: formPm.trim() || undefined,
      status: formStatus,
      code: formCode.trim() || undefined,
    }
    let createOpts: typeof opts & {
      trimbleAccessToken?: string
      syncTrimbleConnect?: boolean
      trimbleExistingProjectId?: string
    } = { ...opts }
    if (!editingProject) {
      if (trimbleTokens?.accessToken) {
        if (tcConnectMode === 'none') {
          createOpts = {
            ...opts,
            trimbleAccessToken: trimbleTokens.accessToken,
            syncTrimbleConnect: false,
          }
        } else {
          let session = await refreshTrimbleAccessToken()
          if (!session?.accessToken && trimbleTokens?.accessToken) {
            session = trimbleTokens
          }
          if (!session?.accessToken) {
            setError(
              'Trimble Connect 토큰을 갱신할 수 없습니다. 로그아웃 후 Trimble로 다시 로그인한 뒤 다시 시도해 주세요.'
            )
            setSaving(false)
            return
          }
          if (tcConnectMode === 'link') {
            const tid = selectedTcProjectId.trim() || tcManualProjectId.trim()
            if (!tid) {
              setError('Connect 기존 프로젝트를 목록에서 선택하거나 프로젝트 ID를 입력하세요.')
              setSaving(false)
              return
            }
            createOpts = {
              ...opts,
              trimbleAccessToken: session.accessToken,
              trimbleExistingProjectId: tid,
            }
          } else {
            createOpts = { ...opts, trimbleAccessToken: session.accessToken }
          }
        }
      } else {
        const tid = tcManualProjectId.trim()
        if (tid) {
          createOpts = { ...opts, trimbleExistingProjectId: tid }
        }
      }
    }
    try {
      const res = editingProject
        ? await updateProjectApi(user.email, editingProject.id, name, opts)
        : await createProjectApi(user.email, name, createOpts)
      if (res.success && res.project) {
        const project = normalizeProject(res.project)
        if (!project) {
          setError('저장된 프로젝트 정보를 불러올 수 없습니다.')
          return
        }
        if (editingProject) {
          setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...project } : p)))
          if (selectedProject?.id === project.id) {
            setSelectedProject(project)
          }
        } else {
          setProjects((prev) => [project, ...prev])
          setSelectedProject(project)
        }
        closeModal()
        const tcErr = 'trimbleConnectError' in res ? (res as { trimbleConnectError?: string }).trimbleConnectError : undefined
        if (!editingProject && tcErr) {
          window.alert(
            'BRACE 프로젝트는 저장되었으나 Trimble Connect 프로젝트 생성에 실패했습니다.\n\n' + tcErr
          )
        }
        if (!editingProject && project.trimble_connect_project_id?.trim()) {
          const ta = (res as { trimbleAutoImport?: TrimbleConnectImportSummary }).trimbleAutoImport
          const tae = (res as { trimbleAutoImportError?: string }).trimbleAutoImportError
          if (ta) {
            window.alert(
              `Trimble Connect에서 설계 모델을 서버가 가져왔습니다.\n등록: ${ta.importedModels}건, 스캔: ${ta.scanned}건, 건너뜀: ${ta.skipped}건` +
                (ta.errors > 0 ? `\n오류: ${ta.errors}건` : '')
            )
          } else if (tae) {
            window.alert(
              '프로젝트는 생성되었으나 Trimble에서 모델 자동 가져오기에 실패했습니다.\n' +
                tae +
                '\n\n모델 관리 화면에서 다시 가져오기를 시도할 수 있습니다.'
            )
          }
        }
      } else {
        setError(
          normalizeError(res.error || (editingProject ? '수정에 실패했습니다.' : '생성에 실패했습니다.'))
        )
      }
    } catch (err) {
      setError(
        normalizeError(
          err instanceof Error ? err.message : editingProject ? '수정에 실패했습니다.' : '생성에 실패했습니다.'
        )
      )
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete() {
    if (!pendingDelete || !user?.email) return
    const p = pendingDelete
    setPendingDelete(null)
    setError('')
    setDeletingIds((prev) => new Set(prev).add(p.id))
    deleteProjectApi(user.email, p.id)
      .then((res) => {
        if (res.success) {
          setProjects((prev) => prev.filter((x) => x.id !== p.id))
          setSelectedIds((prev) => {
            const next = new Set(prev)
            next.delete(p.id)
            return next
          })
        } else {
          setError(normalizeError(res.error || '삭제에 실패했습니다.'))
        }
      })
      .catch((err) => setError(normalizeError(err instanceof Error ? err.message : '삭제에 실패했습니다.')))
      .finally(() => setDeletingIds((prev) => { const next = new Set(prev); next.delete(p.id); return next }))
  }

  const listFrom = sortedProjects.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1
  const listTo = Math.min(effectivePage * PAGE_SIZE, sortedProjects.length)

  return (
    <div className="project-mgmt project-list-page">
      <div className="project-list-page__top">
        <div className="project-list-page__top-spacer" aria-hidden />
        <div className="project-list-page__search-wrap">
          <span className="project-list-page__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="project-list-page__search"
            placeholder="코드·프로젝트명·발주처·PM·상태·비고 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="프로젝트 검색"
          />
        </div>
        <div className="project-list-page__top-actions">
          <button
            type="button"
            className="project-list-page__icon-btn"
            onClick={() => fetchProjects()}
            disabled={loading}
            title="목록 새로고침"
            aria-label="목록 새로고침"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <header className="project-list-page__hero">
        <div className="project-list-page__hero-text">
          <h1 className="project-list-page__title">
            프로젝트 목록
            <span className="project-list-page__title-en">Project List</span>
          </h1>
          <p className="project-list-page__lead">
            활성 프로젝트를 한곳에서 관리합니다. 생성·수정·삭제는 관리자 또는 프로젝트 관리자만 가능합니다.
          </p>
          {user && !canManage && (
            <p className="project-list-page__hint">
              역할이 변경된 경우 <strong>로그아웃 후 다시 로그인</strong>하면 권한이 반영됩니다.
            </p>
          )}
        </div>
        <div className="project-list-page__hero-actions">
          {canManage && (
            <button
              type="button"
              className="project-list-page__btn project-list-page__btn--ghost"
              disabled={!someSelected || deletingIds.size > 0}
              onClick={deleteSelected}
              title={someSelected ? `선택 ${selectedIds.size}건 삭제` : '삭제할 항목을 선택하세요'}
            >
              선택 항목 삭제
            </button>
          )}
          {canManage && (
            <button
              type="button"
              className="project-list-page__btn project-list-page__btn--primary"
              onClick={openCreate}
              disabled={openCreateLoading}
            >
              {openCreateLoading ? '코드 조회 중…' : '+ 프로젝트 추가'}
            </button>
          )}
        </div>
      </header>

      {error ? <p className="project-list-page__error" role="alert">{error}</p> : null}

      {loading ? (
        <p className="project-list-page__loading">프로젝트 목록을 불러오는 중…</p>
      ) : (
        <div className="project-list-page__panel">
          <div className="project-list-page__toolbar">
            <div className="project-list-page__toolbar-left">
              <label className="visually-hidden" htmlFor="project-status-filter">
                상태로 목록 좁히기
              </label>
              <select
                id="project-status-filter"
                className="project-list-page__select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | ProjectStatus)}
                aria-label="상태 필터"
              >
                <option value="all">전체 프로젝트</option>
                <option value="예정">예정만</option>
                <option value="진행">진행만</option>
                <option value="완료">완료만</option>
              </select>
            </div>
            <div className="project-list-page__toolbar-right">
              <button
                type="button"
                className="project-list-page__icon-btn"
                onClick={() => fetchProjects(true)}
                disabled={loading}
                title="백그라운드 새로고침"
                aria-label="백그라운드 새로고침"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
              <button
                type="button"
                className="project-list-page__icon-btn"
                onClick={() => exportProjectsCsv(sortedProjects)}
                disabled={sortedProjects.length === 0}
                title="표시 중인 목록 CSV보내기"
                aria-label="CSV보내기"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="project-list-page__table-scroll">
            <table className="project-list-page__table">
              <thead>
                <tr>
                  {canManage && (
                    <th style={{ width: 44 }}>
                      {pageRows.length > 0 ? (
                        <input
                          type="checkbox"
                          checked={pageRows.length > 0 && pageRows.every((p) => selectedIds.has(p.id))}
                          onChange={toggleSelectAll}
                          aria-label="현재 페이지 전체 선택"
                        />
                      ) : null}
                    </th>
                  )}
                  <th className="project-list-page__th-sort" onClick={() => handleSort('code')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('code')} title="코드로 정렬">
                    코드 {sortKey === 'code' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('name')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('name')} title="이름으로 정렬">
                    프로젝트명 {sortKey === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('client')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('client')} title="발주처로 정렬">
                    발주처 {sortKey === 'client' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('period')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('period')} title="기간으로 정렬">
                    기간 {sortKey === 'period' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('pm')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('pm')} title="PM으로 정렬">
                    PM {sortKey === 'pm' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('status')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('status')} title="상태로 정렬">
                    상태 {sortKey === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="project-list-page__th-sort" onClick={() => handleSort('description')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('description')} title="비고로 정렬">
                    비고 {sortKey === 'description' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  {canManage ? <th style={{ width: 52 }}>작업</th> : null}
                </tr>
                <tr className="project-list-page__filter-row">
                  {canManage ? <th /> : null}
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.code}
                      onChange={(e) => setColumnFilter('code', e.target.value)}
                      placeholder="필터"
                      aria-label="코드 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.name}
                      onChange={(e) => setColumnFilter('name', e.target.value)}
                      placeholder="필터"
                      aria-label="프로젝트명 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.client}
                      onChange={(e) => setColumnFilter('client', e.target.value)}
                      placeholder="필터"
                      aria-label="발주처 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.period}
                      onChange={(e) => setColumnFilter('period', e.target.value)}
                      placeholder="예: 2026"
                      aria-label="기간 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.pm}
                      onChange={(e) => setColumnFilter('pm', e.target.value)}
                      placeholder="필터"
                      aria-label="PM 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.status}
                      onChange={(e) => setColumnFilter('status', e.target.value)}
                      placeholder="필터"
                      aria-label="상태 필터"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="project-list-page__filter-input"
                      value={columnFilters.description}
                      onChange={(e) => setColumnFilter('description', e.target.value)}
                      placeholder="필터"
                      aria-label="비고 필터"
                    />
                  </th>
                  {canManage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {sortedProjects.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 9 : 8} style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                      {projects.length === 0 ? '등록된 프로젝트가 없습니다.' : '검색·필터 결과가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((p) => {
                    const pmName = getPmDisplayName(p.pm)
                    const pill = statusPillMeta(p.status)
                    return (
                      <tr
                        key={p.id}
                        {...(canManage
                          ? {
                              onDoubleClick: () => openEdit(p),
                              role: 'button' as const,
                              tabIndex: 0,
                              onKeyDown: (e: KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  openEdit(p)
                                }
                              },
                              'aria-label': `${p.name} 더블클릭 시 수정`,
                              title: '더블클릭 시 수정',
                            }
                          : {})}
                      >
                        {canManage && (
                          <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(p.id)}
                              onChange={() => toggleSelect(p.id)}
                              disabled={deletingIds.has(p.id)}
                              aria-label={`${p.name} 선택`}
                            />
                          </td>
                        )}
                        <td style={{ fontWeight: 600, color: '#475569' }}>{p.code ?? '—'}</td>
                        <td className="project-list-page__cell-name">
                          <div className="project-list-page__name-title">{p.name}</div>
                        </td>
                        <td>{p.client ?? '—'}</td>
                        <td>
                          {p.start_date || p.end_date
                            ? [formatDate(p.start_date ?? ''), formatDate(p.end_date ?? '')].filter((d) => d !== '-').join(' ~ ')
                            : '—'}
                        </td>
                        <td>
                          <div className="project-list-page__pm-cell">
                            <span className="project-list-page__pm-avatar">{initialsFromDisplayName(pmName)}</span>
                            <span className="project-list-page__pm-name">{pmName}</span>
                          </div>
                        </td>
                        <td>
                          <span className={pill.className}>{pill.label}</span>
                        </td>
                        <td style={{ maxWidth: 200, color: '#64748b', fontSize: '0.78rem' }}>{p.description || '—'}</td>
                        {canManage && (
                          <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            <details className="project-list-page__details">
                              <summary aria-label="작업 메뉴">⋮</summary>
                              <div className="project-list-page__menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    openEdit(p)
                                    const el = document.activeElement as HTMLElement | null
                                    el?.blur()
                                  }}
                                >
                                  수정
                                </button>
                              </div>
                            </details>
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {sortedProjects.length > 0 ? (
            <div className="project-list-page__pagination">
              <span>
                {listFrom}–{listTo} / 총 {sortedProjects.length.toLocaleString()}건
              </span>
              <div className="project-list-page__pager">
                <button
                  type="button"
                  className="project-list-page__page-btn"
                  disabled={effectivePage <= 1}
                  onClick={() => setPage((x) => Math.max(1, x - 1))}
                  aria-label="이전 페이지"
                >
                  ‹
                </button>
                {totalPages <= 10 ? (
                  Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`project-list-page__page-btn${n === effectivePage ? ' is-active' : ''}`}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))
                ) : (
                  <span style={{ padding: '0 0.5rem', fontWeight: 600, color: '#334155' }}>
                    {effectivePage} / {totalPages}
                  </span>
                )}
                <button
                  type="button"
                  className="project-list-page__page-btn"
                  disabled={effectivePage >= totalPages}
                  onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
                  aria-label="다음 페이지"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}

          <div className="project-list-page__footer" style={{ padding: '0 1.25rem 1rem' }}>
            <div className="project-list-page__legend">
              <span>
                <i className="project-list-page__legend-dot project-list-page__legend-dot--blue" aria-hidden /> 진행
              </span>
              <span>
                <i className="project-list-page__legend-dot project-list-page__legend-dot--green" aria-hidden /> 완료
              </span>
            </div>
            <span>© SBIM TC — 프로젝트 콘솔 (내부용)</span>
          </div>
        </div>
      )}

      {/* 추가/수정: 오른쪽 슬라이드 패널 (내부 스크롤) */}
      {modalOpen && (
        <div className="project-drawer-root is-open" role="presentation">
          <div
            className="project-drawer-backdrop"
            aria-hidden="true"
            onClick={() => {
              if (!saving) closeModal()
            }}
          />
          <aside
            className="project-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-drawer-title"
          >
            <div className="project-drawer__header">
              <h2 id="project-drawer-title" className="project-drawer__title">
                {editingProject ? '프로젝트 수정' : '프로젝트 추가'}
              </h2>
              <button
                type="button"
                className="project-drawer__close"
                onClick={closeModal}
                disabled={saving}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <form
              className="project-drawer__form"
              onSubmit={(e) => {
                e.preventDefault()
                handleSave()
              }}
            >
              <div className="project-drawer__scroll">
              {error && <div className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
              <label className="project-mgmt__label" htmlFor="project-form-name">
                프로젝트명 <span className="project-mgmt__required">*</span>
              </label>
              <input
                id="project-form-name"
                ref={formNameInputRef}
                type="text"
                className="project-mgmt__input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="프로젝트명"
                autoComplete="off"
              />
              <label className="project-mgmt__label" htmlFor="project-form-code">프로젝트 코드</label>
              <input
                id="project-form-code"
                type="text"
                className="project-mgmt__input"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder={editingProject ? '' : '예: 2602-001 (비워두면 자동 부여)'}
                title="년도 2자리+월 2자리-순번 3자리 (예: 2602-001). 비워두면 자동 부여됩니다."
              />
              <label className="project-mgmt__label">기간</label>
              <div className="project-mgmt__date-row">
                <input
                  type="date"
                  className="project-mgmt__input project-mgmt__input--date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  placeholder="시작일"
                />
                <span className="project-mgmt__date-sep">~</span>
                <input
                  type="date"
                  className="project-mgmt__input project-mgmt__input--date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  placeholder="종료일"
                />
              </div>
              <label className="project-mgmt__label" htmlFor="project-form-client">발주처</label>
              <input
                id="project-form-client"
                type="text"
                className="project-mgmt__input"
                value={formClient}
                onChange={(e) => setFormClient(e.target.value)}
                placeholder="발주처 (선택)"
                autoComplete="off"
              />
              <label className="project-mgmt__label" htmlFor="project-form-pm">PM</label>
              <select
                id="project-form-pm"
                className="project-mgmt__input project-mgmt__select"
                value={formPm}
                onChange={(e) => setFormPm(e.target.value)}
                aria-label="PM 선택"
                title={user?.role === '관리자' ? '관리자는 프로젝트 관리자 역할만 PM으로 선택할 수 있습니다.' : undefined}
              >
                <option value="">선택</option>
                {pmSelectUserList.map((u) => (
                  <option key={u.id} value={u.email || ''}>
                    {u.name || u.email} {u.email ? `(${u.email})` : ''}
                  </option>
                ))}
              </select>
              <label className="project-mgmt__label" htmlFor="project-form-status">상태</label>
              <select
                id="project-form-status"
                className="project-mgmt__input project-mgmt__select"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as ProjectStatus)}
                aria-label="상태 선택"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {!editingProject && (
                <div className="project-mgmt__trimble-box">
                  <label className="project-mgmt__label">Trimble Connect 연동</label>
                  {trimbleTokens?.accessToken ? (
                    <>
                      <div className="project-mgmt__tc-radios" role="radiogroup" aria-label="Trimble 연동 방식">
                        <label className="project-mgmt__tc-radio">
                          <input
                            type="radio"
                            name="tcMode"
                            checked={tcConnectMode === 'create'}
                            onChange={() => {
                              setTcConnectMode('create')
                              setTcListError('')
                            }}
                          />
                          Connect에 새 프로젝트 만들기
                        </label>
                        <label className="project-mgmt__tc-radio">
                          <input
                            type="radio"
                            name="tcMode"
                            checked={tcConnectMode === 'link'}
                            onChange={() => {
                              setTcConnectMode('link')
                              setTcListError('')
                            }}
                          />
                          기존 Connect 프로젝트 연결
                        </label>
                        <label className="project-mgmt__tc-radio">
                          <input
                            type="radio"
                            name="tcMode"
                            checked={tcConnectMode === 'none'}
                            onChange={() => {
                              setTcConnectMode('none')
                              setTcListError('')
                            }}
                          />
                          Connect 연동 안 함 (BRACE에만 추가)
                        </label>
                      </div>
                      {tcConnectMode === 'link' && (
                        <div className="project-mgmt__tc-link">
                          <div className="project-mgmt__tc-link-toolbar">
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => void loadTrimbleProjects()}
                              disabled={tcListLoading}
                            >
                              {tcListLoading ? '불러오는 중...' : 'Connect 목록 새로고침'}
                            </button>
                          </div>
                          {tcListError && (
                            <p className="project-mgmt__hint-small project-mgmt__hint-small--warn">{tcListError}</p>
                          )}
                          <select
                            className="project-mgmt__input project-mgmt__select"
                            value={selectedTcProjectId}
                            onChange={(e) => setSelectedTcProjectId(e.target.value)}
                            aria-label="연결할 Connect 프로젝트"
                          >
                            <option value="">목록에서 선택...</option>
                            {tcProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.tcRegion ? ` · ${trimbleRegionLabel(p.tcRegion)}` : ''}
                              </option>
                            ))}
                          </select>
                          <label className="project-mgmt__label" htmlFor="tc-manual-id">
                            또는 프로젝트 ID 직접 입력
                          </label>
                          <input
                            id="tc-manual-id"
                            type="text"
                            className="project-mgmt__input"
                            value={tcManualProjectId}
                            onChange={(e) => setTcManualProjectId(e.target.value)}
                            placeholder="Connect에서 확인한 프로젝트 UUID"
                            autoComplete="off"
                          />
                          <p className="project-mgmt__hint-small">
                            목록이 비어 있거나 찾기 어려우면 웹 Connect 주소·프로젝트 정보에 나온 ID를 붙여 넣을 수 있습니다.
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="project-mgmt__hint-small">
                        Trimble로 로그인하면 새 프로젝트 생성 또는 목록에서 기존 프로젝트 연결이 가능합니다.
                      </p>
                      <label className="project-mgmt__label" htmlFor="tc-manual-only">
                        Connect 프로젝트 ID만 연결 (선택)
                      </label>
                      <input
                        id="tc-manual-only"
                        type="text"
                        className="project-mgmt__input"
                        value={tcManualProjectId}
                        onChange={(e) => setTcManualProjectId(e.target.value)}
                        placeholder="UUID (선택)"
                        autoComplete="off"
                      />
                    </>
                  )}
                </div>
              )}
              <label className="project-mgmt__label" htmlFor="project-form-desc">비고</label>
              <textarea
                id="project-form-desc"
                className="project-mgmt__input project-mgmt__textarea"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="비고 (선택)"
                rows={3}
              />
              </div>
              <div className="project-drawer__footer">
                <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                  취소
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? '처리 중...' : editingProject ? '저장' : '추가'}
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {pendingDelete && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="project-delete-title">
          <div className="modal">
            <h2 id="project-delete-title" className="modal__title">프로젝트 삭제</h2>
            <div className="modal__body">
              <p>
                정말 <strong>"{pendingDelete.name}"</strong> 프로젝트를 삭제하시겠습니까?
              </p>
              <p className="user-mgmt__confirm-note">이 작업은 되돌릴 수 없습니다.</p>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setPendingDelete(null)}>
                아니오
              </button>
              <button type="button" className="btn btn--danger" onClick={confirmDelete}>
                예
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
