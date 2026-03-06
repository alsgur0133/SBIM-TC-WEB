import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import {
  getProjectsApi,
  getNextProjectCodeApi,
  createProjectApi,
  updateProjectApi,
  deleteProjectApi,
  type Project,
  type ProjectStatus,
} from '../api/projects'
import { getUsersApi, type ApiUserRow } from '../api/auth'

function formatDate(s: string) {
  if (!s) return '-'
  return s.slice(0, 10)
}

const PROJECT_STATUSES: ProjectStatus[] = ['예정', '진행', '완료']

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
    created_at: p.created_at ?? '',
    updated_at: p.updated_at ?? '',
  }
}

export default function ProjectManagement() {
  const { user } = useAuth()
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

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

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

  const sortedProjects = useMemo(() => {
    const list = [...filteredProjects]
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
  }, [filteredProjects, sortKey, sortDir])

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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (sortedProjects.length === 0) return
    const allSelected = sortedProjects.every((p) => selectedIds.has(p.id))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        sortedProjects.forEach((p) => next.delete(p.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        sortedProjects.forEach((p) => next.add(p.id))
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

  function openCreate() {
    setError('')
    setEditingProject(null)
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
    setFormName('')
    setFormDesc('')
    setFormCode('')
    setFormClient('')
    setFormPm('')
    setFormStatus('예정')
    setFormStartDate('')
    setFormEndDate('')
  }

  function handleSave() {
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
    const promise = editingProject
      ? updateProjectApi(user.email, editingProject.id, name, opts)
      : createProjectApi(user.email, name, opts)
    promise
      .then((res) => {
        if (res.success && res.project) {
          const project = normalizeProject(res.project)
          if (!project) {
            setError('저장된 프로젝트 정보를 불러올 수 없습니다.')
            return
          }
          if (editingProject) {
            setProjects((prev) =>
              prev.map((p) => (p.id === project.id ? { ...p, ...project } : p))
            )
            if (selectedProject?.id === project.id) {
              setSelectedProject(project)
            }
          } else {
            setProjects((prev) => [project, ...prev])
            setSelectedProject(project)
          }
          closeModal()
        } else {
          setError(
            normalizeError(res.error || (editingProject ? '수정에 실패했습니다.' : '생성에 실패했습니다.'))
          )
        }
      })
      .catch((err) =>
        setError(
          normalizeError(
            err instanceof Error ? err.message : editingProject ? '수정에 실패했습니다.' : '생성에 실패했습니다.'
          )
        )
      )
      .finally(() => setSaving(false))
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

  return (
    <div className="project-mgmt">
      <header className="project-mgmt__header">
        <h1 className="project-mgmt__title">프로젝트 목록</h1>
        <p className="project-mgmt__desc">
          프로젝트 목록을 조회할 수 있습니다. 생성·수정·삭제는 관리자 또는 프로젝트 관리자만 가능합니다.
        </p>
        {user && !canManage && (
          <p className="project-mgmt__hint">
            역할이 변경된 경우 <strong>로그아웃 후 다시 로그인</strong>하면 프로젝트 관리 권한이 반영됩니다.
          </p>
        )}
      </header>

      <div className="user-mgmt__toolbar project-mgmt__toolbar">
        <input
          type="search"
          className="user-mgmt__search"
          placeholder="코드, 프로젝트명, 발주처, PM, 상태, 비고로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="프로젝트 검색"
        />
        {canManage && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={openCreate}
            disabled={openCreateLoading}
            title="프로젝트 추가"
          >
            {openCreateLoading ? '코드 조회 중...' : '프로젝트 추가'}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={!someSelected || deletingIds.size > 0}
            onClick={deleteSelected}
            title={someSelected ? `선택한 ${selectedIds.size}개 삭제` : '삭제할 항목을 선택하세요'}
          >
            {deletingIds.size > 0 ? '삭제 중...' : '선택 항목 삭제'}
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary project-mgmt__btn-refresh"
          onClick={() => fetchProjects()}
          disabled={loading}
          title="새로고침"
          aria-label="새로고침"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {error && <div className="auth-form__error">{error}</div>}
      {loading ? (
        <p className="user-mgmt__loading">프로젝트 목록을 불러오는 중...</p>
      ) : (
        <div className="user-mgmt__table-wrap">
          <table className="user-mgmt__table project-mgmt__table--filter">
            <thead>
              <tr>
                {canManage && (
                  <th className="user-mgmt__th-check">
                    {sortedProjects.length > 0 && (
                      <input
                        type="checkbox"
                        checked={sortedProjects.length > 0 && sortedProjects.every((p) => selectedIds.has(p.id))}
                        onChange={toggleSelectAll}
                        aria-label="전체 선택"
                      />
                    )}
                  </th>
                )}
                <th className="project-mgmt__th-sort" onClick={() => handleSort('code')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('code')} title="코드로 정렬">
                  프로젝트 코드 {sortKey === 'code' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('name')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('name')} title="이름으로 정렬">
                  프로젝트명 {sortKey === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('client')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('client')} title="발주처로 정렬">
                  발주처 {sortKey === 'client' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('period')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('period')} title="기간으로 정렬">
                  기간 {sortKey === 'period' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('pm')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('pm')} title="PM으로 정렬">
                  PM {sortKey === 'pm' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('status')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('status')} title="상태로 정렬">
                  상태 {sortKey === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="project-mgmt__th-sort" onClick={() => handleSort('description')} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSort('description')} title="비고로 정렬">
                  비고 {sortKey === 'description' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                {canManage && <th>작업</th>}
              </tr>
              <tr className="project-mgmt__filter-row">
                {canManage && <th className="user-mgmt__th-check" />}
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.code}
                    onChange={(e) => setColumnFilter('code', e.target.value)}
                    placeholder="필터"
                    aria-label="코드 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.name}
                    onChange={(e) => setColumnFilter('name', e.target.value)}
                    placeholder="필터"
                    aria-label="프로젝트명 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.client}
                    onChange={(e) => setColumnFilter('client', e.target.value)}
                    placeholder="필터"
                    aria-label="발주처 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.period}
                    onChange={(e) => setColumnFilter('period', e.target.value)}
                    placeholder="필터 (예: 2026)"
                    aria-label="기간 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.pm}
                    onChange={(e) => setColumnFilter('pm', e.target.value)}
                    placeholder="필터"
                    aria-label="PM 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.status}
                    onChange={(e) => setColumnFilter('status', e.target.value)}
                    placeholder="필터"
                    aria-label="상태 필터"
                  />
                </th>
                <th className="project-mgmt__th-filter">
                  <input
                    type="text"
                    className="project-mgmt__filter-input"
                    value={columnFilters.description}
                    onChange={(e) => setColumnFilter('description', e.target.value)}
                    placeholder="필터"
                    aria-label="비고 필터"
                  />
                </th>
                {canManage && <th className="project-mgmt__th-filter" />}
              </tr>
            </thead>
            <tbody>
              {sortedProjects.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="user-mgmt__empty">
                    {projects.length === 0 ? '등록된 프로젝트가 없습니다.' : '검색·필터 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                sortedProjects.map((p) => (
                  <tr
                    key={p.id}
                    className="user-mgmt__row"
                    {...(canManage
                      ? {
                          onDoubleClick: () => openEdit(p),
                          role: 'button' as const,
                          tabIndex: 0,
                          onKeyDown: (e: React.KeyboardEvent) => {
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
                      <td
                        className="user-mgmt__td-check"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          disabled={deletingIds.has(p.id)}
                          aria-label={`${p.name} 선택`}
                        />
                      </td>
                    )}
                    <td>{p.code ?? '—'}</td>
                    <td>{p.name}</td>
                    <td>{p.client ?? '—'}</td>
                    <td>
                      {p.start_date || p.end_date
                        ? [formatDate(p.start_date ?? ''), formatDate(p.end_date ?? '')].filter((d) => d !== '-').join(' ~ ')
                        : '—'}
                    </td>
                    <td>{getPmDisplayName(p.pm)}</td>
                    <td>{p.status ?? '—'}</td>
                    <td>{p.description || '—'}</td>
                    {canManage && (
                      <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn--sm btn--secondary user-mgmt__btn-edit-hover"
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(p)
                          }}
                          title="수정"
                        >
                          수정
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 추가/수정 모달 */}
      {modalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
          <div className="modal">
            <div className="modal__header">
              <h2 id="project-modal-title" className="modal__title">
                {editingProject ? '프로젝트 수정' : '프로젝트 추가'}
              </h2>
              <button
                type="button"
                className="modal__close"
                onClick={closeModal}
                disabled={saving}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <form
              className="modal__body"
              onSubmit={(e) => {
                e.preventDefault()
                handleSave()
              }}
            >
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
              <label className="project-mgmt__label" htmlFor="project-form-desc">비고</label>
              <textarea
                id="project-form-desc"
                className="project-mgmt__input project-mgmt__textarea"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="비고 (선택)"
                rows={3}
              />
              <div className="modal__actions">
                <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                  취소
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving}>
                  {saving ? '처리 중...' : editingProject ? '저장' : '추가'}
                </button>
              </div>
            </form>
          </div>
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
