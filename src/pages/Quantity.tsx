import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getQuantityRevisionStatsApi,
  getQuantityRevisionItemsApi,
  getQuantityFilesApi,
  getQuantityFileItemsApi,
  getAllQuantityRevisionItemsApi,
  getAllQuantityFileItemsAsRevisionApi,
  updateQuantityFileItemApi,
  deleteQuantityFileItemApi,
  bulkDeleteQuantityFileItemsApi,
  createQuantityFileItemApi,
  type QuantityRevisionItem,
  type QuantityRevisionStats,
  type QuantityFile,
  type QuantityFileItemInput,
} from '../api/quantityFile'
import {
  buildBomViewFromItems,
  allIdsForBomRow,
  bomRowMatchesSearch,
  parseCellNumber,
  formatBomTotal,
  type BomBuiltRow,
} from '../utils/quantityBom'
import { effectiveDesignRevisionIdForSync, postIfcViewerSync } from '../lib/ifcViewerSync'
import { VirtualDataGrid } from '../components/VirtualDataGrid'

const PAGE_SIZE = 75

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

function csvEscape(s: string): string {
  const t = String(s ?? '')
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`
  return t
}

/** 구버전 서버(quantity-revision API 없음)용: 파일별 items API로 건수만 합산 */
async function buildRevisionStatsFromFiles(files: QuantityFile[]): Promise<QuantityRevisionStats> {
  if (files.length === 0) {
    return { success: true, fileCount: 0, itemCount: 0, byFile: [] }
  }
  const byFile = await Promise.all(
    files.map(async (f) => {
      const r = await getQuantityFileItemsApi(f.id, { limit: 1, offset: 0 })
      const n = typeof r.total === 'number' ? r.total : r.items?.length ?? 0
      return { id: f.id, title: f.title, itemCount: n }
    })
  )
  const itemCount = byFile.reduce((a, b) => a + b.itemCount, 0)
  return { success: true, fileCount: files.length, itemCount, byFile }
}

function isPathNotFoundError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /경로를 찾을 수 없|404/.test(m)
}

export default function Quantity() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const { selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision, loadingPhases } = useDesignSchedule()

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  const syncIfcViewerFromQtyItem = useCallback(
    (r: QuantityRevisionItem) => {
      const rev = effectiveDesignRevisionIdForSync(selectedRevisionId)
      if (!rev) return
      const pid = selectedProject?.id
      const g = r.guid?.trim()
      if (g) {
        postIfcViewerSync({
          v: 1,
          action: 'selectGlobalId',
          designRevisionId: rev,
          projectId: pid,
          globalId: g,
        })
        return
      }
      const f = r.floor?.trim()
      if (f) {
        postIfcViewerSync({
          v: 1,
          action: 'highlightFloor',
          designRevisionId: rev,
          projectId: pid,
          floor: f,
        })
      }
    },
    [selectedRevisionId, selectedProject?.id]
  )

  const [stats, setStats] = useState<QuantityRevisionStats | null>(null)
  const [files, setFiles] = useState<QuantityFile[]>([])
  const [fileFilter, setFileFilter] = useState<string>('')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<QuantityRevisionItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [editRow, setEditRow] = useState<QuantityRevisionItem | null>(null)
  const [editForm, setEditForm] = useState<QuantityFileItemInput>({})
  const [saving, setSaving] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addFileId, setAddFileId] = useState('')
  const [addForm, setAddForm] = useState<QuantityFileItemInput>({ name: '', result_value: '' })

  /** 물량파일 1개 선택 시 기본 B.O.M 표 (부재별 집계표 파싱 데이터) */
  const [tableView, setTableView] = useState<'bom' | 'list'>('list')
  const [bomState, setBomState] = useState<{
    rows: BomBuiltRow[]
    extraCols: string[]
    rawDbTotal: number
  } | null>(null)

  useEffect(() => {
    if (fileFilter) setTableView('bom')
    else {
      setTableView('list')
      setBomState(null)
    }
  }, [fileFilter])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 320)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
  }, [selectedRevisionId, fileFilter, debouncedSearch, tableView])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const loadStatsAndFiles = useCallback(async () => {
    if (!selectedRevisionId) {
      setStats(null)
      setFiles([])
      return
    }
    let fileList: QuantityFile[] = []
    try {
      const f = await getQuantityFilesApi(selectedRevisionId)
      fileList = f.files ?? []
      setFiles(fileList)
    } catch {
      setFiles([])
      setStats(null)
      return
    }
    try {
      const s = await getQuantityRevisionStatsApi(selectedRevisionId)
      setStats(s)
    } catch (e) {
      if (isPathNotFoundError(e) && fileList.length > 0) {
        try {
          setStats(await buildRevisionStatsFromFiles(fileList))
        } catch {
          setStats(null)
        }
      } else {
        setStats(null)
      }
    }
  }, [selectedRevisionId])

  const loadItems = useCallback(async () => {
    if (!selectedRevisionId) {
      setItems([])
      setTotal(0)
      setBomState(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      if (fileFilter && tableView === 'bom') {
        let all: QuantityRevisionItem[] = []
        let rawTot = 0
        try {
          const r = await getAllQuantityRevisionItemsApi(selectedRevisionId, fileFilter)
          all = r.items
          rawTot = r.total
        } catch {
          try {
            const title = files.find((f) => f.id === fileFilter)?.title ?? ''
            all = await getAllQuantityFileItemsAsRevisionApi(fileFilter, title)
            rawTot = all.length
          } catch (e2) {
            setItems([])
            setTotal(0)
            setBomState(null)
            setError(errMsg(e2, '목록을 불러오지 못했습니다.'))
            return
          }
        }
        const built = buildBomViewFromItems(all)
        if (!built?.rows.length) {
          setToast('이 파일은 B.O.M 형식(부재별 집계표)이 아니어서 DB 목록으로 표시합니다.')
          setTableView('list')
          setBomState(null)
          return
        }
        let brows = built.rows
        if (debouncedSearch) brows = brows.filter((r) => bomRowMatchesSearch(r, debouncedSearch))
        setBomState({
          rows: brows,
          extraCols: built.extraColLabels,
          rawDbTotal: rawTot,
        })
        setItems([])
        setTotal(brows.length)
        return
      }

      setBomState(null)
      const res = await getQuantityRevisionItemsApi(selectedRevisionId, {
        quantityFileId: fileFilter || undefined,
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      const list = res.items ?? []
      setItems(list)
      setTotal(
        typeof res.total === 'number' ? res.total : list.length
      )
    } catch (e) {
      if (fileFilter && isPathNotFoundError(e)) {
        try {
          const res = await getQuantityFileItemsApi(fileFilter, {
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            search: debouncedSearch || undefined,
          })
          const mapped: QuantityRevisionItem[] = (res.items ?? []).map((it) => ({
            ...it,
            file_title: res.fileTitle ?? '',
          }))
          setItems(mapped)
          setTotal(
            typeof res.total === 'number' ? res.total : mapped.length
          )
        } catch (e2) {
          setItems([])
          setTotal(0)
          setError(errMsg(e2, '목록을 불러오지 못했습니다.'))
        }
      } else {
        setItems([])
        setTotal(0)
        setError(
          isPathNotFoundError(e)
            ? '통합 물량 목록 API를 찾을 수 없습니다. Node API 서버를 최신 코드로 재시작하세요. (npm run dev:all 중이면 터미널에서 서버를 한 번 멈췄다가 다시 실행) 임시로 상단 「물량파일」에서 파일을 하나 선택하면 해당 파일 데이터만 볼 수 있습니다.'
            : errMsg(e, '목록을 불러오지 못했습니다.')
        )
      }
    } finally {
      setLoading(false)
    }
  }, [selectedRevisionId, fileFilter, debouncedSearch, page, tableView, files])

  useEffect(() => {
    void loadStatsAndFiles()
  }, [loadStatsAndFiles])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showFileColumn = !fileFilter
  const showBomTable = Boolean(fileFilter && tableView === 'bom' && bomState)

  const bomTotals = useMemo(() => {
    if (!bomState) return null
    const sumVals = (vals: (number | null)[]) => {
      let s = 0
      let any = false
      for (const v of vals) {
        if (v != null && Number.isFinite(v)) {
          s += v
          any = true
        }
      }
      return any ? s : null
    }
    const rows = bomState.rows
    const rebar: Record<string, number | null> = {}
    for (const c of bomState.extraCols) {
      rebar[c] = sumVals(rows.map((r) => parseCellNumber(r.rebar[c])))
    }
    return {
      qty: sumVals(rows.map((r) => parseCellNumber(r.qty))),
      totalVol: sumVals(rows.map((r) => parseCellNumber(r.totalVol))),
      unitVol: sumVals(rows.map((r) => parseCellNumber(r.unitVol))),
      w: sumVals(rows.map((r) => parseCellNumber(r.width))),
      h: sumVals(rows.map((r) => parseCellNumber(r.height))),
      d: sumVals(rows.map((r) => parseCellNumber(r.depth))),
      rebar,
    }
  }, [bomState])

  const bomGridTemplateColumns = useMemo(() => {
    if (!bomState) return ''
    const ec = bomState.extraCols
    const parts: string[] = []
    if (canManage) parts.push('40px')
    parts.push(
      'minmax(72px,0.85fr)',
      'minmax(64px,0.75fr)',
      'minmax(80px,0.95fr)',
      'minmax(88px,1fr)',
      'minmax(48px,0.65fr)',
      'minmax(56px,0.72fr)',
      'minmax(64px,0.8fr)',
      'minmax(64px,0.8fr)',
      'minmax(48px,0.65fr)',
      'minmax(48px,0.65fr)',
      'minmax(48px,0.65fr)',
    )
    if (ec.length === 0) parts.push('minmax(40px,0.55fr)')
    else for (let i = 0; i < ec.length; i++) parts.push('minmax(56px,0.75fr)')
    if (canManage) parts.push('minmax(136px,1.35fr)')
    return parts.join(' ')
  }, [bomState, canManage])

  const qtyDbGridTemplateColumns = useMemo(() => {
    const parts: string[] = []
    if (canManage) parts.push('40px')
    if (showFileColumn) parts.push('minmax(96px,1.1fr)')
    parts.push(
      'minmax(44px,0.65fr)',
      'minmax(44px,0.65fr)',
      'minmax(72px,1fr)',
      'minmax(100px,1.3fr)',
      'minmax(72px,1fr)',
      'minmax(64px,0.95fr)',
      'minmax(56px,0.85fr)',
    )
    if (canManage) parts.push('minmax(132px,1.25fr)')
    return parts.join(' ')
  }, [canManage, showFileColumn])

  const toggleAll = (checked: boolean) => {
    if (showBomTable && bomState) {
      const all = bomState.rows.flatMap((r) => allIdsForBomRow(r))
      setSelectedIds(checked ? new Set(all) : new Set())
      return
    }
    if (checked) setSelectedIds(new Set(items.map((r) => r.id)))
    else setSelectedIds(new Set())
  }

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (checked) n.add(id)
      else n.delete(id)
      return n
    })
  }

  const toggleBomRow = (row: BomBuiltRow, checked: boolean) => {
    const ids = allIdsForBomRow(row)
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (checked) ids.forEach((id) => n.add(id))
      else ids.forEach((id) => n.delete(id))
      return n
    })
  }

  const isBomRowFullySelected = (row: BomBuiltRow) => {
    const ids = allIdsForBomRow(row)
    return ids.length > 0 && ids.every((id) => selectedIds.has(id))
  }

  const openEdit = (row: QuantityRevisionItem) => {
    setEditRow(row)
    setEditForm({
      dong: row.dong ?? '',
      floor: row.floor ?? '',
      sign: row.sign ?? '',
      name: row.name ?? '',
      spec: row.spec ?? '',
      formula: row.formula ?? '',
      result_value: row.result_value ?? '',
      item_type: row.item_type ?? '',
      guid: row.guid ?? '',
    })
  }

  const saveEdit = async () => {
    if (!user?.email || !editRow) return
    setSaving(true)
    try {
      await updateQuantityFileItemApi(user.email, editRow.id, editForm)
      setToast('저장되었습니다.')
      setEditRow(null)
      void loadItems()
      void loadStatsAndFiles()
    } catch (e) {
      setError(errMsg(e, '저장에 실패했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteBomRow = async (row: BomBuiltRow) => {
    if (!user?.email) return
    const ids = allIdsForBomRow(row)
    if (!window.confirm(`이 B.O.M 행(콘크리트+철근·부속 ${ids.length}건)을 삭제할까요?\n${row.drawNo}`)) return
    try {
      for (const id of ids) {
        await deleteQuantityFileItemApi(user.email, id)
      }
      setToast(`${ids.length}건 삭제되었습니다.`)
      setSelectedIds((prev) => {
        const n = new Set(prev)
        ids.forEach((id) => n.delete(id))
        return n
      })
      void loadItems()
      void loadStatsAndFiles()
    } catch (e) {
      setError(errMsg(e, '삭제에 실패했습니다.'))
    }
  }

  const confirmDeleteOne = async (row: QuantityRevisionItem) => {
    if (!user?.email) return
    if (!window.confirm(`이 물량 행을 삭제할까요?\n${row.name || row.id}`)) return
    try {
      await deleteQuantityFileItemApi(user.email, row.id)
      setToast('삭제되었습니다.')
      setSelectedIds((prev) => {
        const n = new Set(prev)
        n.delete(row.id)
        return n
      })
      void loadItems()
      void loadStatsAndFiles()
    } catch (e) {
      setError(errMsg(e, '삭제에 실패했습니다.'))
    }
  }

  const bulkDelete = async () => {
    if (!user?.email || selectedIds.size === 0) return
    if (!window.confirm(`선택한 ${selectedIds.size}건을 삭제할까요?`)) return
    try {
      const r = await bulkDeleteQuantityFileItemsApi(user.email, Array.from(selectedIds))
      setToast(r.message || `${r.deleted ?? 0}건 삭제됨`)
      setSelectedIds(new Set())
      void loadItems()
      void loadStatsAndFiles()
    } catch (e) {
      setError(errMsg(e, '일괄 삭제에 실패했습니다.'))
    }
  }

  const saveAdd = async () => {
    if (!user?.email) return
    const fid = addFileId || files[0]?.id
    if (!fid) {
      setError('물량파일이 없습니다. 먼저 물량파일을 등록하세요.')
      return
    }
    setSaving(true)
    try {
      await createQuantityFileItemApi(user.email, fid, addForm)
      setToast('행이 추가되었습니다.')
      setAddOpen(false)
      setAddForm({ name: '', result_value: '' })
      void loadItems()
      void loadStatsAndFiles()
    } catch (e) {
      setError(errMsg(e, '추가에 실패했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = useCallback(() => {
    if (showBomTable && bomState) {
      const cols = bomState.extraCols
      const headers = [
        'ID(guid)',
        "CON'C 강도",
        '도면번호',
        '구조번호',
        '층',
        '수량',
        '총물량',
        '단위물량',
        '가로',
        '세로',
        '두께(깊이)',
        ...cols,
      ]
      const lines = [headers.join(',')]
      for (const r of bomState.rows) {
        const cells = [
          r.concrete.guid ?? '',
          r.concStrength,
          r.drawNo,
          r.structNo,
          r.floor,
          r.qty,
          r.totalVol,
          r.unitVol,
          r.width,
          r.height,
          r.depth,
          ...cols.map((c) => r.rebar[c] ?? ''),
        ]
        lines.push(cells.map((c) => csvEscape(String(c))).join(','))
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `quantity_bom_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setToast('B.O.M 목록을 CSV로 저장했습니다.')
      return
    }
    const headers = showFileColumn
      ? ['물량파일', '동', '층', '부호', '명칭', '규격', '산출식', '결과값', '유형', 'guid']
      : ['동', '층', '부호', '명칭', '규격', '산출식', '결과값', '유형', 'guid']
    const lines = [headers.join(',')]
    for (const r of items) {
      const cells = showFileColumn
        ? [
            r.file_title,
            r.dong ?? '',
            r.floor ?? '',
            r.sign ?? '',
            r.name ?? '',
            r.spec ?? '',
            r.formula ?? '',
            r.result_value ?? '',
            r.item_type ?? '',
            r.guid ?? '',
          ]
        : [
            r.dong ?? '',
            r.floor ?? '',
            r.sign ?? '',
            r.name ?? '',
            r.spec ?? '',
            r.formula ?? '',
            r.result_value ?? '',
            r.item_type ?? '',
            r.guid ?? '',
          ]
      lines.push(cells.map((c) => csvEscape(String(c))).join(','))
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quantity_export_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setToast('현재 페이지 데이터를 CSV로 저장했습니다.')
  }, [items, showFileColumn, showBomTable, bomState])

  useEffect(() => {
    if (addOpen && files.length && !addFileId) {
      setAddFileId(fileFilter || files[0].id)
    }
  }, [addOpen, files, fileFilter, addFileId])

  if (!selectedProject) {
    return (
      <section className="card card--panel">
        <h2>물량 관리</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          물량 관리는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/projects" className="btn btn--primary">
            프로젝트 관리에서 선택하기
          </Link>
        </p>
      </section>
    )
  }

  if (!selectedPhaseId && !loadingPhases) {
    return (
      <section className="card card--panel">
        <h2>물량 관리</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          <strong>설계 차수</strong>와 <strong>리비전</strong>을 상단에서 선택하세요.
        </p>
      </section>
    )
  }

  if (selectedPhaseId && !selectedRevisionId) {
    return (
      <section className="card card--panel">
        <h2>물량 관리</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong> · 설계 차수: <strong>{selectedPhase?.name ?? '선택됨'}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단에서 <strong>리비전</strong>을 선택하면 물량 데이터를 관리할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <div className="qty-mgmt qty-mgmt--dock">
      <header className="qty-mgmt__hero">
        <div>
          <h2 className="qty-mgmt__title">물량 관리</h2>
          <p className="qty-mgmt__subtitle">
            {selectedProject.name} · {selectedPhase?.name} · {selectedRevision?.revision_name}
          </p>
        </div>
        {toast && <div className="qty-mgmt__toast" role="status">{toast}</div>}
      </header>

      <div className="qty-mgmt__stats">
        <div className="qty-mgmt__stat">
          <span className="qty-mgmt__stat-value">{stats?.fileCount ?? '—'}</span>
          <span className="qty-mgmt__stat-label">물량파일</span>
        </div>
        <div className="qty-mgmt__stat qty-mgmt__stat--accent">
          <span className="qty-mgmt__stat-value">{stats?.itemCount?.toLocaleString() ?? '—'}</span>
          <span className="qty-mgmt__stat-label">총 데이터 행</span>
        </div>
        <div className="qty-mgmt__stat">
          <span className="qty-mgmt__stat-value">{total.toLocaleString()}</span>
          <span className="qty-mgmt__stat-label">현재 필터·검색 결과</span>
        </div>
      </div>

      {error && (
        <div className="auth-form__error qty-mgmt__banner" style={{ marginBottom: '0.75rem' }}>
          {error}
          <button type="button" className="btn btn--sm btn--secondary" style={{ marginLeft: '0.75rem' }} onClick={() => setError('')}>
            닫기
          </button>
        </div>
      )}

      <section className="card card--panel qty-mgmt__panel">
        <div className="qty-mgmt__toolbar">
          <div className="qty-mgmt__toolbar-row">
            <label className="qty-mgmt__field">
              <span className="qty-mgmt__field-label">물량파일</span>
              <select
                className="project-mgmt__input"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                aria-label="물량파일 필터"
              >
                <option value="">전체 파일</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                    {stats?.byFile?.find((b) => b.id === f.id) != null
                      ? ` (${stats.byFile.find((b) => b.id === f.id)!.itemCount})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="qty-mgmt__field qty-mgmt__field--grow">
              <span className="qty-mgmt__field-label">검색</span>
              <input
                type="search"
                className="project-mgmt__input"
                placeholder="명칭, 규격, 부호, 산출식, 결과값, 파일명…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="물량 데이터 검색"
              />
            </label>
            {fileFilter && (
              <div className="qty-mgmt__view-toggle" role="group" aria-label="표시 형식">
                <button
                  type="button"
                  className={`qty-mgmt__view-toggle-btn ${tableView === 'bom' ? 'qty-mgmt__view-toggle-btn--active' : ''}`}
                  onClick={() => setTableView('bom')}
                >
                  B.O.M 목록
                </button>
                <button
                  type="button"
                  className={`qty-mgmt__view-toggle-btn ${tableView === 'list' ? 'qty-mgmt__view-toggle-btn--active' : ''}`}
                  onClick={() => setTableView('list')}
                >
                  DB 목록
                </button>
              </div>
            )}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void loadItems()}>
              새로고침
            </button>
          </div>
          <div className="qty-mgmt__toolbar-row qty-mgmt__toolbar-row--actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={exportCsv}
              disabled={showBomTable ? (bomState?.rows.length ?? 0) === 0 : items.length === 0}
            >
              {showBomTable ? 'CSV보내기 (B.O.M)' : 'CSV보내기 (현재 페이지)'}
            </button>
            {canManage && (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    setAddFileId(fileFilter || files[0]?.id || '')
                    setAddOpen(true)
                  }}
                  disabled={files.length === 0}
                >
                  행 추가
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => void bulkDelete()}
                  disabled={selectedIds.size === 0}
                >
                  선택 삭제 ({selectedIds.size})
                </button>
              </>
            )}
          </div>
        </div>

        <div className="qty-mgmt__table-wrap">
          {loading ? (
            <p className="qty-mgmt__muted">불러오는 중…</p>
          ) : showBomTable && bomState ? (
            bomState.rows.length === 0 ? (
              <p className="qty-mgmt__muted">검색 조건에 맞는 B.O.M 행이 없습니다.</p>
            ) : (
              <div className="qty-bom-scroll">
                <table className="qty-bom-table">
                  <caption className="qty-bom-caption">B.O.M 목록 · DB 원본 {bomState.rawDbTotal.toLocaleString()}행</caption>
                  <thead>
                    <tr>
                      {canManage && (
                        <th className="qty-bom-th-check" rowSpan={2}>
                          <input
                            type="checkbox"
                            checked={(() => {
                              const all = bomState.rows.flatMap((r) => allIdsForBomRow(r))
                              return all.length > 0 && all.every((id) => selectedIds.has(id))
                            })()}
                            onChange={(e) => toggleAll(e.target.checked)}
                            aria-label="B.O.M 전체 선택"
                          />
                        </th>
                      )}
                      <th rowSpan={2}>ID</th>
                      <th rowSpan={2}>CON&apos;C 강도</th>
                      <th rowSpan={2}>도면번호</th>
                      <th rowSpan={2}>구조번호</th>
                      <th colSpan={2}>층 · 수량</th>
                      <th colSpan={2}>물량집계</th>
                      <th colSpan={3}>SIZE(㎜) 목높이 제외</th>
                      <th colSpan={Math.max(1, bomState.extraCols.length)}>이형철근 · 부속</th>
                      {canManage && (
                        <th rowSpan={2} className="qty-bom-th-actions">
                          작업
                        </th>
                      )}
                    </tr>
                    <tr>
                      <th>층</th>
                      <th>수량</th>
                      <th>총물량</th>
                      <th>단위물량</th>
                      <th>가로</th>
                      <th>세로</th>
                      <th>두께(깊이)</th>
                      {bomState.extraCols.length === 0 ? (
                        <th>—</th>
                      ) : (
                        bomState.extraCols.map((c) => (
                          <th key={c} className="qty-bom-th-rebar">
                            {c}
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>
                </table>
                <VirtualDataGrid
                  wrapClassName="virtual-data-grid qty-bom-virtual-grid"
                  bodyClassName="virtual-data-grid__body qty-bom-virtual-body"
                  gridTemplateColumns={bomGridTemplateColumns}
                  rowHeight={52}
                  scrollResetKey={`${fileFilter}|${debouncedSearch}|${bomState.rows.length}|${bomGridTemplateColumns}`}
                  getKey={(row, idx) => `${row.concrete.id}-${idx}`}
                  getRowProps={(row) => {
                    const ids = allIdsForBomRow(row)
                    const anySel = ids.some((id) => selectedIds.has(id))
                    return {
                      className: anySel ? 'qty-mgmt__tr--selected' : undefined,
                      style: { cursor: 'pointer' },
                      onClick: (e) => {
                        if ((e.target as HTMLElement).closest('input,button,a')) return
                        syncIfcViewerFromQtyItem(row.concrete)
                      },
                    }
                  }}
                  renderRow={(row) => {
                    const rowSel = isBomRowFullySelected(row)
                    return (
                      <>
                        {canManage && (
                          <span className="qty-bom-td-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={rowSel}
                              onChange={(e) => toggleBomRow(row, e.target.checked)}
                              aria-label={`B.O.M 행 선택 ${row.drawNo}`}
                            />
                          </span>
                        )}
                        <span className="qty-mgmt__td-muted qty-bom-td-id" title={row.concrete.guid || ''}>
                          {row.concrete.guid || '—'}
                        </span>
                        <span>{row.concStrength || '—'}</span>
                        <span className="qty-mgmt__td-strong">{row.drawNo || '—'}</span>
                        <span className="qty-mgmt__td-clip" title={row.structNo}>
                          {row.structNo || '—'}
                        </span>
                        <span>{row.floor || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.qty || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.totalVol || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.unitVol || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.width || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.height || '—'}</span>
                        <span className="qty-mgmt__td-num">{row.depth || '—'}</span>
                        {bomState.extraCols.length === 0 ? (
                          <span>—</span>
                        ) : (
                          bomState.extraCols.map((c) => (
                            <span key={c} className="qty-mgmt__td-num">
                              {row.rebar[c] ?? ''}
                            </span>
                          ))
                        )}
                        {canManage && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <div className="qty-mgmt__row-actions">
                              <button type="button" className="btn btn--sm btn--secondary" onClick={() => openEdit(row.concrete)}>
                                수정
                              </button>
                              <button type="button" className="btn btn--sm btn--danger" onClick={() => void confirmDeleteBomRow(row)}>
                                삭제
                              </button>
                            </div>
                          </span>
                        )}
                      </>
                    )
                  }}
                  items={bomState.rows}
                />
                {bomTotals && (
                  <table className="qty-bom-table qty-bom-tfoot-wrap">
                    <tfoot>
                      <tr className="qty-bom-tfoot">
                        <td colSpan={canManage ? 7 : 6}>합계</td>
                        <td className="qty-mgmt__td-num">{bomTotals.qty != null ? formatBomTotal(bomTotals.qty) : '—'}</td>
                        <td className="qty-mgmt__td-num">{bomTotals.totalVol != null ? formatBomTotal(bomTotals.totalVol) : '—'}</td>
                        <td className="qty-mgmt__td-num">{bomTotals.unitVol != null ? formatBomTotal(bomTotals.unitVol) : '—'}</td>
                        <td className="qty-mgmt__td-num">{bomTotals.w != null ? formatBomTotal(bomTotals.w) : '—'}</td>
                        <td className="qty-mgmt__td-num">{bomTotals.h != null ? formatBomTotal(bomTotals.h) : '—'}</td>
                        <td className="qty-mgmt__td-num">{bomTotals.d != null ? formatBomTotal(bomTotals.d) : '—'}</td>
                        {bomState.extraCols.length === 0 ? (
                          <td>—</td>
                        ) : (
                          bomState.extraCols.map((c) => (
                            <td key={c} className="qty-mgmt__td-num">
                              {bomTotals.rebar[c] != null ? formatBomTotal(bomTotals.rebar[c]!) : '—'}
                            </td>
                          ))
                        )}
                        {canManage && <td />}
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )
          ) : items.length === 0 ? (
            <p className="qty-mgmt__muted">표시할 물량 데이터가 없습니다. 물량파일을 등록하거나 검색 조건을 바꿔 보세요.</p>
          ) : (
            <>
              <table className="qty-mgmt__table">
                <thead>
                  <tr>
                    {canManage && (
                      <th className="qty-mgmt__th-check">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && selectedIds.size === items.length}
                          onChange={(e) => toggleAll(e.target.checked)}
                          aria-label="현재 페이지 전체 선택"
                        />
                      </th>
                    )}
                    {showFileColumn && <th>물량파일</th>}
                    <th>동</th>
                    <th>층</th>
                    <th>부호</th>
                    <th>명칭</th>
                    <th>규격</th>
                    <th>결과값</th>
                    <th>유형</th>
                    {canManage && <th style={{ width: '7rem' }}>작업</th>}
                  </tr>
                </thead>
              </table>
              <VirtualDataGrid
                wrapClassName="virtual-data-grid qty-mgmt-virtual-db"
                bodyClassName="virtual-data-grid__body qty-mgmt__table-virtual-body"
                gridTemplateColumns={qtyDbGridTemplateColumns}
                rowHeight={44}
                scrollResetKey={`${page}|${fileFilter}|${debouncedSearch}|${total}|${items.length}`}
                getKey={(r) => r.id}
                getRowProps={(r) => ({
                  className: selectedIds.has(r.id) ? 'qty-mgmt__tr--selected' : undefined,
                  style: { cursor: 'pointer' },
                  onClick: (e) => {
                    if ((e.target as HTMLElement).closest('input,button,a')) return
                    syncIfcViewerFromQtyItem(r)
                  },
                })}
                renderRow={(r) => (
                  <>
                    {canManage && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={(e) => toggleOne(r.id, e.target.checked)}
                          aria-label={`선택 ${r.name || r.id}`}
                        />
                      </span>
                    )}
                    {showFileColumn && <span className="qty-mgmt__td-muted">{r.file_title}</span>}
                    <span>{r.dong || '—'}</span>
                    <span>{r.floor || '—'}</span>
                    <span className="qty-mgmt__td-clip" title={r.sign || ''}>
                      {r.sign || '—'}
                    </span>
                    <span className="qty-mgmt__td-strong" title={r.name || ''}>
                      {r.name || '—'}
                    </span>
                    <span className="qty-mgmt__td-clip" title={r.spec || ''}>
                      {r.spec || '—'}
                    </span>
                    <span className="qty-mgmt__td-num">{r.result_value || '—'}</span>
                    <span className="qty-mgmt__td-clip">{r.item_type || '—'}</span>
                    {canManage && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <div className="qty-mgmt__row-actions">
                          <button type="button" className="btn btn--sm btn--secondary" onClick={() => openEdit(r)}>
                            수정
                          </button>
                          <button type="button" className="btn btn--sm btn--danger" onClick={() => void confirmDeleteOne(r)}>
                            삭제
                          </button>
                        </div>
                      </span>
                    )}
                  </>
                )}
                items={items}
              />
            </>
          )}
        </div>

        {!showBomTable && (
          <div className="qty-mgmt__pager">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </button>
            <span className="qty-mgmt__pager-info">
              {page} / {totalPages} 페이지 · {total.toLocaleString()}건
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
        )}
      </section>

      {editRow && (
        <div className="qty-mgmt__modal-root" role="dialog" aria-modal="true" aria-labelledby="qty-edit-title" onClick={() => !saving && setEditRow(null)}>
          <div className="qty-mgmt__modal card" onClick={(e) => e.stopPropagation()}>
            <h3 id="qty-edit-title">물량 행 수정</h3>
            <p className="qty-mgmt__muted" style={{ fontSize: '0.85rem' }}>
              #{editRow.id} · {editRow.file_title}
            </p>
            <div className="qty-mgmt__form-grid">
              {(
                [
                  ['dong', '동'],
                  ['floor', '층'],
                  ['sign', '부호'],
                  ['name', '명칭'],
                  ['spec', '규격'],
                  ['formula', '산출식'],
                  ['result_value', '결과값'],
                  ['item_type', '유형'],
                  ['guid', 'guid'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="qty-mgmt__form-field">
                  <span>{label}</span>
                  <input
                    className="project-mgmt__input"
                    value={String(editForm[key] ?? '')}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="qty-mgmt__modal-actions">
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => setEditRow(null)}>
                취소
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void saveEdit()}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="qty-mgmt__modal-root" role="dialog" aria-modal="true" aria-labelledby="qty-add-title" onClick={() => !saving && setAddOpen(false)}>
          <div className="qty-mgmt__modal card" onClick={(e) => e.stopPropagation()}>
            <h3 id="qty-add-title">물량 행 추가</h3>
            <label className="qty-mgmt__form-field">
              <span>물량파일</span>
              <select className="project-mgmt__input" value={addFileId} onChange={(e) => setAddFileId(e.target.value)}>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="qty-mgmt__form-grid">
              {(
                [
                  ['dong', '동'],
                  ['floor', '층'],
                  ['sign', '부호'],
                  ['name', '명칭'],
                  ['spec', '규격'],
                  ['formula', '산출식'],
                  ['result_value', '결과값'],
                  ['item_type', '유형'],
                  ['guid', 'guid'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="qty-mgmt__form-field">
                  <span>{label}</span>
                  <input
                    className="project-mgmt__input"
                    value={String(addForm[key] ?? '')}
                    onChange={(e) => setAddForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="qty-mgmt__modal-actions">
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => setAddOpen(false)}>
                취소
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void saveAdd()}>
                {saving ? '추가 중…' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
