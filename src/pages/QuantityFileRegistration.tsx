import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getQuantityFilesApi,
  createQuantityFileApi,
  updateQuantityFileApi,
  deleteQuantityFileApi,
  getQuantityFileDownloadUrl,
  getQuantityFileItemsApi,
  reparseQuantityFileApi,
  getQuantityDistinctNamesApi,
  getQuantityNameMappingsApi,
  createQuantityNameMappingApi,
  deleteQuantityNameMappingApi,
  getQuantityDistinctSpecsApi,
  getQuantityDistinctDongsApi,
  getQuantityDongsApi,
  createQuantityDongApi,
  deleteQuantityDongApi,
  updateQuantityDongApi,
  updateQuantityDongsOrderApi,
  getQuantityDistinctFloorsApi,
  getQuantityFileDataModalFiltersApi,
  getQuantityFloorsApi,
  createQuantityFloorApi,
  deleteQuantityFloorApi,
  updateQuantityFloorsOrderApi,
  getQuantitySpecsApi,
  createQuantitySpecApi,
  deleteQuantitySpecApi,
  NAME_CATEGORIES,
  type QuantityFile,
  type QuantityFileItem,
  type QuantityNameMapping,
  type QuantitySpec,
  type QuantityDong,
  type QuantityFloor,
} from '../api/quantityFile'
import { TrimbleConnectImportButton } from '../components/TrimbleConnectImportButton'

function getApiErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/failed to fetch|network error|load failed|connection refused|networkrequestfailed/i.test(msg))
    return '서버에 연결할 수 없습니다. 터미널에서 "npm run server"를 실행했는지 확인해 주세요.'
  if (/경로를 찾을 수 없습니다|404/i.test(msg))
    return '요청한 API 경로를 찾을 수 없습니다. 터미널에서 "npm run server"를 실행 중인지, 개발 시 "npm run dev:all" 사용을 권장합니다.'
  return msg || fallback
}

const FLOOR_CATEGORY_ORDER_KEY = 'quantityFloorCategoryOrder'
const DEFAULT_FLOOR_CATEGORY_ORDER = ['FT', 'PIT', 'BF', 'F', 'RF', 'PHF'] as const
const FLOOR_CATEGORY_LABELS: Record<string, string> = {
  FT: 'FT (기초)',
  PIT: 'PIT (피트)',
  BF: 'BF (지하층)',
  F: 'F (지상층)',
  RF: 'RF (옥상층)',
  PHF: 'PHF (옥탑층)',
}

export default function QuantityFileRegistration() {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const { selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision, loadingPhases } = useDesignSchedule()
  const [files, setFiles] = useState<QuantityFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFile, setEditingFile] = useState<QuantityFile | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formFile, setFormFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterTitle, setFilterTitle] = useState('')
  const [filterMemo, setFilterMemo] = useState('')
  const [filterFile, setFilterFile] = useState<'all' | 'has' | 'none'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [dataModalFile, setDataModalFile] = useState<QuantityFile | null>(null)
  const [dataModalItems, setDataModalItems] = useState<QuantityFileItem[]>([])
  const [dataModalTotal, setDataModalTotal] = useState<number | null>(null)
  const [loadingDataModal, setLoadingDataModal] = useState(false)
  const [loadingMoreDataModal, setLoadingMoreDataModal] = useState(false)
  const [reparsing, setReparsing] = useState(false)
  const [dataModalError, setDataModalError] = useState('')
  const [dataModalSearch, setDataModalSearch] = useState('')
  const [dataModalFilterDong, setDataModalFilterDong] = useState('')
  const [dataModalFilterFloor, setDataModalFilterFloor] = useState('')
  const [dataModalFilterSignType, setDataModalFilterSignType] = useState('')
  const [dataModalFilterSignCode, setDataModalFilterSignCode] = useState('')
  const [dataModalFilterCategory, setDataModalFilterCategory] = useState('')
  const [dataModalDongOrder, setDataModalDongOrder] = useState<string[]>([])
  const [dataModalFloorOrder, setDataModalFloorOrder] = useState<string[]>([])
  const [dataModalRevisionFilters, setDataModalRevisionFilters] = useState<{
    dongs: string[]
    floors: string[]
    signTypes: string[]
    signCodes: string[]
  }>({ dongs: [], floors: [], signTypes: [], signCodes: [] })
  const dataModalScrollRef = useRef<HTMLDivElement>(null)
  const dataModalInitialFetchRef = useRef(true)
  const [dataModalSize, setDataModalSize] = useState<{ width: number; height: number } | null>(null)
  const dataModalResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null)
  const dataModalRef = useRef<HTMLDivElement>(null)

  const handleDataModalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const modal = dataModalRef.current
    if (!modal) return
    const rect = modal.getBoundingClientRect()
    const startW = dataModalSize?.width ?? rect.width
    const startH = dataModalSize?.height ?? rect.height
    dataModalResizeRef.current = { startX: e.clientX, startY: e.clientY, startW, startH }
    const minW = 480
    const minH = 400
    const onMove = (ev: MouseEvent) => {
      const r = dataModalResizeRef.current
      if (!r) return
      const maxW = window.innerWidth * 0.95
      const maxH = window.innerHeight * 0.9
      const w = Math.min(maxW, Math.max(minW, r.startW + (ev.clientX - r.startX)))
      const h = Math.min(maxH, Math.max(minH, r.startH + (ev.clientY - r.startY)))
      setDataModalSize({ width: w, height: h })
    }
    const onUp = () => {
      dataModalResizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [dataModalSize])

  const [nameMappings, setNameMappings] = useState<QuantityNameMapping[]>([])
  const [nameMappingModalOpen, setNameMappingModalOpen] = useState(false)
  const [newNamePattern, setNewNamePattern] = useState('')
  const [newNameCategory, setNewNameCategory] = useState<string>(NAME_CATEGORIES[0])
  const [nameMappingSaving, setNameMappingSaving] = useState(false)
  const [nameMappingDeletingId, setNameMappingDeletingId] = useState<number | null>(null)
  const [nameMappingFilterCategory, setNameMappingFilterCategory] = useState('')
  const [selectedNameMappingIds, setSelectedNameMappingIds] = useState<Set<number>>(new Set())
  const [nameMappingBulkDeleting, setNameMappingBulkDeleting] = useState(false)
  const [deletedNamePatternsToShow, setDeletedNamePatternsToShow] = useState<Set<string>>(new Set())
  const [distinctNames, setDistinctNames] = useState<string[]>([])
  const [loadingDistinctNames, setLoadingDistinctNames] = useState(false)
  const [selectedNamesForMapping, setSelectedNamesForMapping] = useState<Set<string>>(new Set())
  const [addingSelectedNames, setAddingSelectedNames] = useState(false)

  const [specs, setSpecs] = useState<QuantitySpec[]>([])
  const [specModalOpen, setSpecModalOpen] = useState(false)
  const [newSpecValue, setNewSpecValue] = useState('')
  const [newSpecCategory, setNewSpecCategory] = useState<string>(NAME_CATEGORIES[0])
  const [specSaving, setSpecSaving] = useState(false)
  const [specDeletingId, setSpecDeletingId] = useState<number | null>(null)
  const [specFilterCategory, setSpecFilterCategory] = useState('')
  const [selectedSpecIds, setSelectedSpecIds] = useState<Set<number>>(new Set())
  const [specBulkDeleting, setSpecBulkDeleting] = useState(false)
  const [deletedSpecsToShow, setDeletedSpecsToShow] = useState<Set<string>>(new Set())
  const [distinctSpecs, setDistinctSpecs] = useState<string[]>([])
  const [loadingDistinctSpecs, setLoadingDistinctSpecs] = useState(false)
  const [selectedSpecsForMapping, setSelectedSpecsForMapping] = useState<Set<string>>(new Set())
  const [addingSelectedSpecs, setAddingSelectedSpecs] = useState(false)

  const [dongModalOpen, setDongModalOpen] = useState(false)
  const [dongs, setDongs] = useState<QuantityDong[]>([])
  const [newDongValue, setNewDongValue] = useState('')
  const [dongSaving, setDongSaving] = useState(false)
  const [dongDeletingId, setDongDeletingId] = useState<number | null>(null)
  const [selectedDongIds, setSelectedDongIds] = useState<Set<number>>(new Set())
  const [dongBulkDeleting, setDongBulkDeleting] = useState(false)
  const [dongReordering, setDongReordering] = useState(false)
  const [draggedDongId, setDraggedDongId] = useState<number | null>(null)
  const [dongDragOverId, setDongDragOverId] = useState<number | null>(null)
  const [deletedDongsToShow, setDeletedDongsToShow] = useState<Set<string>>(new Set())
  const [distinctDongs, setDistinctDongs] = useState<string[]>([])
  const [loadingDistinctDongs, setLoadingDistinctDongs] = useState(false)
  const [selectedDongsForMapping, setSelectedDongsForMapping] = useState<Set<string>>(new Set())
  const [addingSelectedDongs, setAddingSelectedDongs] = useState(false)

  const [floorModalOpen, setFloorModalOpen] = useState(false)
  const [floors, setFloors] = useState<QuantityFloor[]>([])
  const [newFloorValue, setNewFloorValue] = useState('')
  const [floorSaving, setFloorSaving] = useState(false)
  const [floorDeletingId, setFloorDeletingId] = useState<number | null>(null)
  const [selectedFloorIds, setSelectedFloorIds] = useState<Set<number>>(new Set())
  const [floorBulkDeleting, setFloorBulkDeleting] = useState(false)
  const [deletedFloorsToShow, setDeletedFloorsToShow] = useState<Set<string>>(new Set())
  const [distinctFloors, setDistinctFloors] = useState<string[]>([])
  const [loadingDistinctFloors, setLoadingDistinctFloors] = useState(false)
  const [selectedFloorsForMapping, setSelectedFloorsForMapping] = useState<Set<string>>(new Set())
  const [addingSelectedFloors, setAddingSelectedFloors] = useState(false)
  const [draggedFloorId, setDraggedFloorId] = useState<number | null>(null)
  const [floorDragOverId, setFloorDragOverId] = useState<number | null>(null)
  const [floorReordering, setFloorReordering] = useState(false)
  const [floorColumnSort, setFloorColumnSort] = useState<'default' | 'asc' | 'desc'>('asc')
  const [floorCategoryOrder, setFloorCategoryOrder] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(FLOOR_CATEGORY_ORDER_KEY)
      if (s) {
        const parsed = JSON.parse(s) as unknown
        if (Array.isArray(parsed) && parsed.length === DEFAULT_FLOOR_CATEGORY_ORDER.length) {
          return parsed
        }
      }
    } catch {
      // ignore
    }
    return [...DEFAULT_FLOOR_CATEGORY_ORDER]
  })
  const [floorSortOrderEditOpen, setFloorSortOrderEditOpen] = useState(false)
  const [floorSortOrderEditDraft, setFloorSortOrderEditDraft] = useState<string[]>([])

  const canManage = user?.role === '프로젝트 관리자' || user?.role === '관리자'

  function getCategoryForName(name: string | null, mappings: QuantityNameMapping[]): string {
    if (!name || !mappings.length) return ''
    const n = String(name).trim()
    for (const m of mappings) {
      if (m.name_pattern && n.includes(m.name_pattern)) return m.category
    }
    return ''
  }

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      const t = filterTitle.trim().toLowerCase()
      if (t && !(f.title || '').toLowerCase().includes(t)) return false
      const m = filterMemo.trim().toLowerCase()
      if (m && !(f.memo || '').toLowerCase().includes(m)) return false
      if (filterFile === 'has' && !f.file_path) return false
      if (filterFile === 'none' && f.file_path) return false
      return true
    })
  }, [files, filterTitle, filterMemo, filterFile])

  const dataModalItemsWithCategory = useMemo(() => {
    return dataModalItems.map((item) => ({
      ...item,
      category: getCategoryForName(item.name, nameMappings),
    }))
  }, [dataModalItems, nameMappings])

  const dataModalFilteredItems = useMemo(() => {
    const search = dataModalSearch.trim().toLowerCase()
    const dong = dataModalFilterDong.trim()
    const floor = dataModalFilterFloor.trim()
    const signTypeFilter = dataModalFilterSignType.trim()
    const signCodeFilter = dataModalFilterSignCode.trim()
    const catFilter = dataModalFilterCategory.trim()
    let list = dataModalItemsWithCategory
    if (dong || floor || signTypeFilter || signCodeFilter || search || catFilter) {
      list = list.filter((item) => {
        if (dong && (item.dong ?? '').trim() !== dong) return false
        if (floor && (item.floor ?? '').trim() !== floor) return false
        const signParts = (item.sign ?? '').trim().split(/\s+/)
        const itemSignType = signParts[0] ?? ''
        const itemSignCode = signParts[1] ?? ''
        if (signTypeFilter && itemSignType !== signTypeFilter) return false
        if (signCodeFilter && itemSignCode !== signCodeFilter) return false
        if (catFilter) {
          if (catFilter === '미매핑') {
            if (item.category !== '') return false
          } else if (item.category !== catFilter) return false
        }
        if (search) {
          const fields = [
            item.dong,
            item.floor,
            item.sign,
            item.name,
            item.spec,
            item.formula,
            item.result_value,
            item.item_type,
            item.guid,
            item.category,
          ]
          const hasMatch = fields.some((v) => (v != null ? String(v).toLowerCase().includes(search) : false))
          if (!hasMatch) return false
        }
        return true
      })
    }
    return list
  }, [dataModalItemsWithCategory, dataModalSearch, dataModalFilterDong, dataModalFilterFloor, dataModalFilterSignType, dataModalFilterSignCode, dataModalFilterCategory])

  /** 동·층 관리에서 저장된 정렬 기준으로 부재별산출서 행 정렬 */
  const dataModalSortedFilteredItems = useMemo(() => {
    const list = [...dataModalFilteredItems]
    if (dataModalDongOrder.length === 0 && dataModalFloorOrder.length === 0) return list
    const dongIdx = (v: string | null) => {
      const s = (v ?? '').trim()
      const i = dataModalDongOrder.indexOf(s)
      return i >= 0 ? i : dataModalDongOrder.length
    }
    const floorIdx = (v: string | null) => {
      const s = (v ?? '').trim()
      const i = dataModalFloorOrder.indexOf(s)
      return i >= 0 ? i : dataModalFloorOrder.length
    }
    return list.sort((a, b) => {
      const dA = dongIdx(a.dong)
      const dB = dongIdx(b.dong)
      if (dA !== dB) return dA - dB
      const fA = floorIdx(a.floor)
      const fB = floorIdx(b.floor)
      if (fA !== fB) return fA - fB
      return a.id - b.id
    })
  }, [dataModalFilteredItems, dataModalDongOrder, dataModalFloorOrder])

  const filteredNameMappings = useMemo(() => {
    if (!nameMappingFilterCategory.trim()) return nameMappings
    return nameMappings.filter((m) => m.category === nameMappingFilterCategory)
  }, [nameMappings, nameMappingFilterCategory])

  const sortedFilteredNameMappings = useMemo(() => {
    return [...filteredNameMappings].sort((a, b) => {
      const catA = a.category ?? ''
      const catB = b.category ?? ''
      const c = catA.localeCompare(catB)
      if (c !== 0) return c
      return (a.name_pattern ?? '').localeCompare(b.name_pattern ?? '')
    })
  }, [filteredNameMappings])

  const filteredSpecs = useMemo(() => {
    if (!specFilterCategory.trim()) return specs
    return specs.filter((s) => s.category === specFilterCategory)
  }, [specs, specFilterCategory])

  const sortedFilteredSpecs = useMemo(() => {
    return [...filteredSpecs].sort((a, b) => {
      const catA = a.category ?? ''
      const catB = b.category ?? ''
      const c = catA.localeCompare(catB)
      if (c !== 0) return c
      return (a.spec_value ?? '').localeCompare(b.spec_value ?? '')
    })
  }, [filteredSpecs])

  const sortedDongs = useMemo(() => {
    return [...dongs].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  }, [dongs])

  const sortedFloors = useMemo(() => {
    return [...floors].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  }, [floors])

  const displayFloors = useMemo(() => {
    if (floorColumnSort === 'default') return sortedFloors
    const getFloorCategoryKey = (s: string): string => {
      const raw = (s ?? '').trim()
      const v = raw.toUpperCase()
      if (v.includes('FT')) return 'FT'
      if (v.includes('PIT')) return 'PIT'
      if (v.startsWith('B') || raw.startsWith('지하')) return 'BF'
      if (v.startsWith('PH')) return 'PHF'
      if (v.includes('RF') || v.startsWith('R')) return 'RF'
      return 'F'
    }
    const getFloorSortKey = (s: string): { categoryOrder: number; num: number } => {
      const raw = (s ?? '').trim()
      const numMatch = raw.match(/-?\d+/)
      const num = numMatch ? parseInt(numMatch[0], 10) : 0
      const key = getFloorCategoryKey(s)
      const categoryOrder = floorCategoryOrder.indexOf(key)
      return { categoryOrder: categoryOrder >= 0 ? categoryOrder : 999, num }
    }
    return [...sortedFloors].sort((a, b) => {
      const ka = getFloorSortKey(a.floor_value ?? '')
      const kb = getFloorSortKey(b.floor_value ?? '')
      if (ka.categoryOrder !== kb.categoryOrder) {
        return floorColumnSort === 'asc'
          ? ka.categoryOrder - kb.categoryOrder
          : kb.categoryOrder - ka.categoryOrder
      }
      if (ka.num !== kb.num) {
        return floorColumnSort === 'asc' ? ka.num - kb.num : kb.num - ka.num
      }
      return (a.floor_value ?? '').localeCompare(b.floor_value ?? '', 'ko')
    })
  }, [sortedFloors, floorColumnSort, floorCategoryOrder])

  /** 기본정렬: 층 유형 순서(낮은 층부터)로 정렬한 순서를 서버에 저장 */
  const applyDefaultFloorOrder = useCallback(() => {
    if (!user?.email || floors.length === 0) return
    const getFloorCategoryKey = (s: string): string => {
      const raw = (s ?? '').trim()
      const v = raw.toUpperCase()
      if (v.includes('FT')) return 'FT'
      if (v.includes('PIT')) return 'PIT'
      if (v.startsWith('B') || raw.startsWith('지하')) return 'BF'
      if (v.startsWith('PH')) return 'PHF'
      if (v.includes('RF') || v.startsWith('R')) return 'RF'
      return 'F'
    }
    const getFloorSortKey = (s: string): { categoryOrder: number; num: number } => {
      const raw = (s ?? '').trim()
      const numMatch = raw.match(/-?\d+/)
      const num = numMatch ? parseInt(numMatch[0], 10) : 0
      const key = getFloorCategoryKey(s)
      const categoryOrder = floorCategoryOrder.indexOf(key)
      return { categoryOrder: categoryOrder >= 0 ? categoryOrder : 999, num }
    }
    const defaultOrder = [...floors].sort((a, b) => {
      const ka = getFloorSortKey(a.floor_value ?? '')
      const kb = getFloorSortKey(b.floor_value ?? '')
      if (ka.categoryOrder !== kb.categoryOrder) return ka.categoryOrder - kb.categoryOrder
      if (ka.num !== kb.num) return ka.num - kb.num
      return (a.floor_value ?? '').localeCompare(b.floor_value ?? '', 'ko')
    })
    const newOrderIds = defaultOrder.map((x) => x.id)
    setFloorReordering(true)
    updateQuantityFloorsOrderApi(user.email, newOrderIds)
      .then(() => {
        setFloors(defaultOrder.map((item, index) => ({ ...item, sort_order: index })))
        setFloorColumnSort('default')
      })
      .finally(() => setFloorReordering(false))
  }, [user?.email, floors, floorCategoryOrder])

  const fetchFiles = useCallback(() => {
    if (!selectedRevisionId) {
      setFiles([])
      return
    }
    setLoadingFiles(true)
    setError('')
    getQuantityFilesApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.files) setFiles(res.files)
        else setFiles([])
      })
      .catch((err) => {
        setFiles([])
        setError(getApiErrorMessage(err, '물량파일 목록을 불러올 수 없습니다.'))
      })
      .finally(() => setLoadingFiles(false))
  }, [selectedRevisionId])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [selectedRevisionId, files])

  useEffect(() => {
    if (!selectedRevisionId) return
    getQuantityNameMappingsApi()
      .then((res) => { if (res.success && res.items) setNameMappings(res.items) })
      .catch(() => setNameMappings([]))
  }, [selectedRevisionId])

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredFiles.map((f) => f.id)))
    else setSelectedIds(new Set())
  }

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (!user?.email || selectedIds.size === 0) return
    if (!window.confirm(`선택한 ${selectedIds.size}건의 물량파일을 삭제하시겠습니까?`)) return
    setBulkDeleting(true)
    setError('')
    let failed = false
    for (const id of Array.from(selectedIds)) {
      try {
        const res = await deleteQuantityFileApi(user.email, id)
        if (!res.success) {
          setError(res.error || '일부 삭제에 실패했습니다.')
          failed = true
          break
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '삭제에 실패했습니다.'))
        failed = true
        break
      }
    }
    setBulkDeleting(false)
    if (!failed) {
      setSelectedIds(new Set())
      fetchFiles()
    }
  }

  const openCreate = () => {
    setEditingFile(null)
    setFormTitle('')
    setFormMemo('')
    setFormFile(null)
    setError('')
    setModalOpen(true)
  }

  const openEdit = (file: QuantityFile) => {
    setEditingFile(file)
    setFormTitle(file.title)
    setFormMemo(file.memo ?? '')
    setFormFile(null)
    setError('')
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!user?.email) return
    const title = formTitle.trim()
    if (editingFile) {
      if (!title) {
        setError('제목을 입력하세요.')
        return
      }
      setSaving(true)
      setError('')
      try {
        const res = await updateQuantityFileApi(user.email, editingFile.id, title, formMemo.trim() || undefined)
        if (res.success) {
          setModalOpen(false)
          fetchFiles()
        } else {
          setError(res.error || '저장에 실패했습니다.')
        }
      } catch (err) {
        setError(getApiErrorMessage(err, '저장에 실패했습니다.'))
      } finally {
        setSaving(false)
      }
      return
    }
    if (!formFile) {
      setError('엑셀 파일을 선택하세요.')
      return
    }
    const ext = (formFile.name || '').toLowerCase()
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setError('엑셀 파일(.xlsx, .xls)만 등록할 수 있습니다.')
      return
    }
    const displayTitle = title || formFile.name
    setSaving(true)
    setError('')
    try {
      const res = await createQuantityFileApi(
        user.email,
        selectedRevisionId!,
        displayTitle,
        formFile,
        formMemo.trim() || undefined
      )
      if (res.success) {
        setModalOpen(false)
        fetchFiles()
      } else {
        setError(res.error || '저장에 실패했습니다.')
      }
    } catch (err) {
      setError(getApiErrorMessage(err, '저장에 실패했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const PAGE_SIZE = 200

  const openDataModal = (file: QuantityFile) => {
    setDataModalFile(file)
    setDataModalItems([])
    setDataModalTotal(null)
    dataModalInitialFetchRef.current = true
    setDataModalError('')
    setDataModalSearch('')
    setDataModalFilterDong('')
    setDataModalFilterFloor('')
    setDataModalFilterSignType('')
    setDataModalFilterSignCode('')
    setDataModalDongOrder([])
    setDataModalFloorOrder([])
    setLoadingDataModal(true)
    // 해당 물량파일 내에 실제 존재하는 동/층/부재유형/부호만 필터 옵션으로 사용 (층 선택 시 데이터 없음 방지)
    const filtersPromise = getQuantityFileDataModalFiltersApi(file.id).then((r) =>
      r.success
        ? {
            dongs: r.dongs ?? [],
            floors: r.floors ?? [],
            signTypes: r.signTypes ?? [],
            signCodes: r.signCodes ?? [],
          }
        : { dongs: [], floors: [], signTypes: [], signCodes: [] }
    )
    Promise.all([
      getQuantityDongsApi().then((r) => (r.success && r.items ? r.items : [])),
      getQuantityFloorsApi().then((r) => (r.success && r.items ? r.items : [])),
      filtersPromise,
    ])
      .then(([dongs, floors, revisionFilters]) => {
        setDataModalRevisionFilters(revisionFilters)
        setDataModalDongOrder(dongs.map((d) => (d.dong_value ?? '').trim()))
        // 층관리와 동일한 정렬: 동관리/층관리 저장 순서(API) + 층은 유형·숫자 기준으로 정렬 (1F, 2F, … 10F)
        const categoryOrder = (() => {
          try {
            const s = localStorage.getItem(FLOOR_CATEGORY_ORDER_KEY)
            if (s) {
              const p = JSON.parse(s) as unknown
              if (Array.isArray(p) && p.length === DEFAULT_FLOOR_CATEGORY_ORDER.length) return p as string[]
            }
          } catch {
            // ignore
          }
          return [...DEFAULT_FLOOR_CATEGORY_ORDER]
        })()
        const getFloorCategoryKey = (s: string): string => {
          const raw = (s ?? '').trim()
          const v = raw.toUpperCase()
          if (v.includes('FT')) return 'FT'
          if (v.includes('PIT')) return 'PIT'
          if (v.startsWith('B') || raw.startsWith('지하')) return 'BF'
          if (v.startsWith('PH')) return 'PHF'
          if (v.includes('RF') || v.startsWith('R')) return 'RF'
          return 'F'
        }
        const getFloorSortKey = (s: string): { categoryOrder: number; num: number } => {
          const raw = (s ?? '').trim()
          const numMatch = raw.match(/-?\d+/)
          const num = numMatch ? parseInt(numMatch[0], 10) : 0
          const key = getFloorCategoryKey(s)
          const co = categoryOrder.indexOf(key)
          return { categoryOrder: co >= 0 ? co : 999, num }
        }
        const sortedFloorsForModal = [...floors].sort((a, b) => {
          const ka = getFloorSortKey(a.floor_value ?? '')
          const kb = getFloorSortKey(b.floor_value ?? '')
          if (ka.categoryOrder !== kb.categoryOrder) return ka.categoryOrder - kb.categoryOrder
          if (ka.num !== kb.num) return ka.num - kb.num
          return (a.floor_value ?? '').localeCompare(b.floor_value ?? '', 'ko')
        })
        setDataModalFloorOrder(sortedFloorsForModal.map((f) => (f.floor_value ?? '').trim()))
      })
      .catch(() => {})
  }

  // 필터(동/층/부재유형/부호) 변경 시 서버에 필터 반영해 다시 조회 (재조회 시 로딩 화면 없이 기존 테이블 유지)
  useEffect(() => {
    if (!dataModalFile) return
    const isInitialFetch = dataModalInitialFetchRef.current
    if (isInitialFetch) {
      dataModalInitialFetchRef.current = false
      setLoadingDataModal(true)
    }
    getQuantityFileItemsApi(dataModalFile.id, {
      limit: PAGE_SIZE,
      offset: 0,
      dong: dataModalFilterDong.trim() || undefined,
      floor: dataModalFilterFloor.trim() || undefined,
      signType: dataModalFilterSignType.trim() || undefined,
      signCode: dataModalFilterSignCode.trim() || undefined,
    })
      .then((res) => {
        if (res.success && res.items) {
          setDataModalItems(res.items)
          setDataModalTotal(res.total ?? res.items.length)
        } else {
          setDataModalItems([])
          setDataModalTotal(0)
        }
      })
      .catch(() => {
        setDataModalItems([])
        setDataModalTotal(null)
      })
      .finally(() => {
        setLoadingDataModal(false)
        dataModalScrollRef.current?.scrollTo({ top: 0 })
      })
  }, [
    dataModalFile?.id,
    dataModalFilterDong,
    dataModalFilterFloor,
    dataModalFilterSignType,
    dataModalFilterSignCode,
  ])

  const loadMoreDataModal = () => {
    if (!dataModalFile || loadingMoreDataModal || dataModalTotal == null) return
    if (dataModalItems.length >= dataModalTotal) return
    setLoadingMoreDataModal(true)
    getQuantityFileItemsApi(dataModalFile.id, {
      limit: PAGE_SIZE,
      offset: dataModalItems.length,
      dong: dataModalFilterDong.trim() || undefined,
      floor: dataModalFilterFloor.trim() || undefined,
      signType: dataModalFilterSignType.trim() || undefined,
      signCode: dataModalFilterSignCode.trim() || undefined,
    })
      .then((res) => {
        if (res.success && res.items?.length) {
          setDataModalItems((prev) => [...prev, ...res.items!])
        }
      })
      .finally(() => setLoadingMoreDataModal(false))
  }

  const handleReparse = () => {
    if (!dataModalFile || !user?.email) return
    setReparsing(true)
    setDataModalError('')
    reparseQuantityFileApi(user.email, dataModalFile.id)
      .then((res) => {
        if (res.success && res.items) {
          setDataModalItems(res.items)
          setDataModalTotal(res.items.length)
        } else {
          setDataModalError(res.error || '다시 읽기에 실패했습니다.')
        }
      })
      .catch((err) => setDataModalError(getApiErrorMessage(err, '다시 읽기에 실패했습니다.')))
      .finally(() => setReparsing(false))
  }

  const handleDelete = (file: QuantityFile) => {
    if (!user?.email || !window.confirm(`"${file.title}" 물량파일을 삭제하시겠습니까?`)) return
    setDeletingId(file.id)
    deleteQuantityFileApi(user.email, file.id)
      .then((res) => {
        if (res.success) fetchFiles()
        else setError(res.error || '삭제에 실패했습니다.')
      })
      .catch((err) => setError(getApiErrorMessage(err, '삭제에 실패했습니다.')))
      .finally(() => setDeletingId(null))
  }

  if (!selectedProject) {
    return (
      <section className="card">
        <h2>물량파일 등록</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          물량파일 등록은 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
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
      <section className="card">
        <h2>물량파일 등록</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          <strong>설계 차수</strong>와 <strong>리비전</strong>을 선택하세요. 상단 헤더에서 선택하거나, 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
        </p>
      </section>
    )
  }

  if (selectedPhaseId && !selectedRevisionId) {
    return (
      <section className="card">
        <h2>물량파일 등록</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong> · 설계 차수: <strong>{selectedPhase?.name ?? '선택됨'}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단 헤더에서 <strong>리비전</strong>을 선택한 후 물량 파일을 등록할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="card">
        <h2>물량파일 등록</h2>

        {error && (
          <div className="auth-form__error" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
            {error}
          </div>
        )}

        {selectedRevisionId && (
          <>
            <div className="design-doc__toolbar" style={{ marginTop: '0.5rem' }}>
              <span className="design-doc__revision-label">
                선택: {selectedPhase?.name} — {selectedRevision?.revision_name}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {canManage && selectedIds.size > 0 && (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? '삭제 중…' : `선택 항목 삭제 (${selectedIds.size})`}
                  </button>
                )}
                {canManage && user?.email && selectedProject && (
                  <TrimbleConnectImportButton
                    projectId={selectedProject.id}
                    trimbleProjectLinked={!!selectedProject.trimble_connect_project_id}
                    designRevisionId={selectedRevisionId}
                    userEmail={user.email}
                    canManage={canManage}
                    onImported={() => {
                      if (!selectedRevisionId) return
                      setLoadingFiles(true)
                      getQuantityFilesApi(selectedRevisionId)
                        .then((res) => {
                          if (res.success && res.files) setFiles(res.files)
                          else setFiles([])
                        })
                        .catch(() => setFiles([]))
                        .finally(() => setLoadingFiles(false))
                    }}
                    label="Connect에서 물량 가져오기"
                    defaultImportModels={false}
                    defaultImportDocuments={false}
                    defaultImportQuantity
                  />
                )}
                {canManage && (
                  <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
                    물량파일 추가
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setNameMappingModalOpen(true)
                    setSelectedNamesForMapping(new Set())
                    setSelectedNameMappingIds(new Set())
                    setDeletedNamePatternsToShow(new Set())
                    getQuantityNameMappingsApi()
                      .then((res) => { if (res.success && res.items) setNameMappings(res.items) })
                      .catch(() => setNameMappings([]))
                    if (selectedRevisionId) {
                      setLoadingDistinctNames(true)
                      getQuantityDistinctNamesApi(selectedRevisionId)
                        .then((res) => { if (res.success && res.names) setDistinctNames(res.names) })
                        .catch(() => setDistinctNames([]))
                        .finally(() => setLoadingDistinctNames(false))
                    } else {
                      setDistinctNames([])
                    }
                  }}
                >
                  명칭관리
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setSpecModalOpen(true)
                    setNewSpecValue('')
                    setSelectedSpecsForMapping(new Set())
                    setSelectedSpecIds(new Set())
                    setDeletedSpecsToShow(new Set())
                    getQuantitySpecsApi()
                      .then((res) => { if (res.success && res.items) setSpecs(res.items) })
                      .catch(() => setSpecs([]))
                    if (selectedRevisionId) {
                      setLoadingDistinctSpecs(true)
                      getQuantityDistinctSpecsApi(selectedRevisionId)
                        .then((res) => { if (res.success && res.specs) setDistinctSpecs(res.specs) })
                        .catch(() => setDistinctSpecs([]))
                        .finally(() => setLoadingDistinctSpecs(false))
                    } else {
                      setDistinctSpecs([])
                    }
                  }}
                >
                  규격관리
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setDongModalOpen(true)
                    setSelectedDongIds(new Set())
                    setSelectedDongsForMapping(new Set())
                    setDeletedDongsToShow(new Set())
                    getQuantityDongsApi()
                      .then((res) => { if (res.success && res.items) setDongs(res.items) })
                      .catch(() => setDongs([]))
                    if (selectedRevisionId) {
                      setLoadingDistinctDongs(true)
                      getQuantityDistinctDongsApi(selectedRevisionId)
                        .then((res) => { if (res.success && res.dongs) setDistinctDongs(res.dongs) })
                        .catch(() => setDistinctDongs([]))
                        .finally(() => setLoadingDistinctDongs(false))
                    } else {
                      setDistinctDongs([])
                    }
                  }}
                >
                  동관리
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setFloorModalOpen(true)
                    setFloorColumnSort('asc')
                    setSelectedFloorIds(new Set())
                    setSelectedFloorsForMapping(new Set())
                    setDeletedFloorsToShow(new Set())
                    getQuantityFloorsApi()
                      .then((res) => { if (res.success && res.items) setFloors(res.items) })
                      .catch(() => setFloors([]))
                    if (selectedRevisionId) {
                      setLoadingDistinctFloors(true)
                      getQuantityDistinctFloorsApi(selectedRevisionId)
                        .then((res) => { if (res.success && res.floors) setDistinctFloors(res.floors) })
                        .catch(() => setDistinctFloors([]))
                        .finally(() => setLoadingDistinctFloors(false))
                    } else {
                      setDistinctFloors([])
                    }
                  }}
                >
                  층관리
                </button>
              </div>
            </div>

            {loadingFiles ? (
              <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>목록을 불러오는 중…</p>
            ) : (
              <div className="design-doc__table-wrap" style={{ marginTop: '0.5rem' }}>
                <table className="project-mgmt__table design-doc__table">
                  <thead>
                    <tr>
                      {canManage && (
                        <th style={{ width: '2.5rem' }}>
                          <input
                            type="checkbox"
                            checked={filteredFiles.length > 0 && selectedIds.size === filteredFiles.length}
                            onChange={(e) => toggleSelectAll(e.target.checked)}
                            aria-label="전체 선택"
                          />
                        </th>
                      )}
                      <th>제목</th>
                      <th>파일 (엑셀)</th>
                      <th>비고</th>
                      {canManage && <th>작업</th>}
                    </tr>
                    <tr className="design-doc__filter-row">
                      {canManage && <th />}
                      <th>
                        <input
                          type="text"
                          className="project-mgmt__input design-doc__filter-input"
                          placeholder="필터…"
                          value={filterTitle}
                          onChange={(e) => setFilterTitle(e.target.value)}
                          aria-label="제목 필터"
                        />
                      </th>
                      <th>
                        <select
                          className="project-mgmt__input design-doc__filter-input"
                          value={filterFile}
                          onChange={(e) => setFilterFile(e.target.value as 'all' | 'has' | 'none')}
                          aria-label="파일 필터"
                        >
                          <option value="all">전체</option>
                          <option value="has">파일 있음</option>
                          <option value="none">파일 없음</option>
                        </select>
                      </th>
                      <th>
                        <input
                          type="text"
                          className="project-mgmt__input design-doc__filter-input"
                          placeholder="필터…"
                          value={filterMemo}
                          onChange={(e) => setFilterMemo(e.target.value)}
                          aria-label="비고 필터"
                        />
                      </th>
                      {canManage && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 5 : 4} className="project-mgmt__empty">
                          {files.length === 0
                            ? '등록된 물량파일이 없습니다. ' + (canManage ? '물량파일 추가로 엑셀 파일을 등록하세요.' : '')
                            : '필터 조건에 맞는 항목이 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      filteredFiles.map((file) => (
                        <tr key={file.id}>
                          {canManage && (
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(file.id)}
                                onChange={(e) => toggleSelect(file.id, e.target.checked)}
                                aria-label={`${file.title} 선택`}
                              />
                            </td>
                          )}
                          <td>{file.title}</td>
                          <td>
                            {file.file_path ? (
                              <>
                                <a
                                  href={getQuantityFileDownloadUrl(file.id)}
                                  download
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {file.file_name || file.title || '다운로드'}
                                </a>
                                <button
                                  type="button"
                                  className="btn btn--sm btn--secondary"
                                  style={{ marginLeft: '0.5rem' }}
                                  onClick={() => openDataModal(file)}
                                  title="부재별산출서 보기"
                                >
                                  부재별산출서
                                </button>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>{file.memo ?? '—'}</td>
                          {canManage && (
                            <td>
                              <button
                                type="button"
                                className="btn btn--sm btn--secondary"
                                onClick={() => openEdit(file)}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm btn--danger"
                                onClick={() => handleDelete(file)}
                                disabled={deletingId === file.id}
                              >
                                {deletingId === file.id ? '처리 중…' : '삭제'}
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
          </>
        )}

        {!selectedRevisionId && selectedPhaseId && (
          <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
            리비전을 선택하면 해당 리비전의 물량파일 목록이 표시됩니다.
          </p>
        )}

        {!selectedPhaseId && (
          <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
            상단 헤더에서 설계 차수와 리비전을 선택하세요. 설계일정 관리에서 차수·리비전을 먼저 등록해 두어야 합니다.
          </p>
        )}

        {dataModalFile && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quantity-data-modal-title">
            <div
              ref={dataModalRef}
              className="modal modal--wide modal--resizable"
              style={
                dataModalSize
                  ? {
                      width: dataModalSize.width,
                      height: dataModalSize.height,
                      minWidth: 480,
                      minHeight: 400,
                      maxWidth: '95vw',
                      maxHeight: '90vh',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    }
                  : undefined
              }
            >
              <div
                role="presentation"
                aria-label="창 크기 조절"
                onMouseDown={handleDataModalResizeStart}
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 24,
                  height: 24,
                  cursor: 'nwse-resize',
                  zIndex: 10,
                  borderTop: '2px solid var(--main-border)',
                  borderLeft: '2px solid var(--main-border)',
                  borderTopLeftRadius: 6,
                  background: 'var(--main-bg-sub, #f5f5f5)',
                }}
              />
              <div className="modal__header">
                <h2 id="quantity-data-modal-title" className="modal__title">
                  물량 데이터: {dataModalFile.title}
                </h2>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setDataModalFile(null)}
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
              <div className="modal__body modal__body--no-padding">
                {loadingDataModal ? (
                  <p style={{ padding: '1rem', color: 'var(--main-text-muted)' }}>불러오는 중…</p>
                ) : dataModalItems.length === 0 ? (
                  <div style={{ padding: '1rem' }}>
                    <p style={{ color: 'var(--main-text-muted)', marginBottom: '0.75rem' }}>
                      {dataModalFilterDong || dataModalFilterFloor || dataModalFilterSignType || dataModalFilterSignCode
                        ? '선택한 동/층/부재유형/부호 조건에 맞는 데이터가 없습니다.'
                        : '저장된 물량 데이터가 없습니다.'}
                    </p>
                    {dataModalError && (
                      <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{dataModalError}</p>
                    )}
                    {canManage && dataModalFile?.file_path && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={handleReparse}
                        disabled={reparsing}
                      >
                        {reparsing ? '읽는 중…' : '파일에서 다시 읽기'}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--main-border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <input
                        type="search"
                        placeholder="검색 (동·층·부재유형·부호·명칭·규격 등)"
                        value={dataModalSearch}
                        onChange={(e) => setDataModalSearch(e.target.value)}
                        style={{ minWidth: '200px', padding: '0.35rem 0.5rem', fontSize: '0.9rem' }}
                        aria-label="검색"
                      />
                      {(dataModalSearch || dataModalFilterDong || dataModalFilterFloor || dataModalFilterSignType || dataModalFilterSignCode || dataModalFilterCategory) && (
                        <button
                          type="button"
                          className="btn btn--sm btn--secondary"
                          onClick={() => {
                            setDataModalSearch('')
                            setDataModalFilterDong('')
                            setDataModalFilterFloor('')
                            setDataModalFilterSignType('')
                            setDataModalFilterSignCode('')
                            setDataModalFilterCategory('')
                          }}
                        >
                          필터 초기화
                        </button>
                      )}
                    </div>
                    <div
                      ref={dataModalScrollRef}
                      className="design-doc__table-wrap quantity-data-table-wrap"
                      style={{ maxHeight: '70vh', overflow: 'auto' }}
                      onScroll={(e) => {
                        const el = e.currentTarget
                        if (!dataModalFile || loadingMoreDataModal || dataModalTotal == null || dataModalItems.length >= dataModalTotal) return
                        const threshold = 200
                        if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) loadMoreDataModal()
                      }}
                    >
                      <table className="project-mgmt__table design-doc__table quantity-data-table">
                        <thead>
                          <tr>
                            <th>동</th>
                            <th>층</th>
                            <th>부재유형</th>
                            <th>부호</th>
                            <th>명칭</th>
                            <th>자재분류</th>
                            <th>규격</th>
                            <th>산출식</th>
                            <th>결과값</th>
                            <th>아이템구분</th>
                            <th>guid</th>
                          </tr>
                          <tr className="quantity-data-table__filter-row">
                            <th>
                              <select
                                value={dataModalFilterDong}
                                onChange={(e) => setDataModalFilterDong(e.target.value)}
                                style={{ width: '100%', maxWidth: '100%', padding: '0.25rem 0.35rem', fontSize: '0.8rem' }}
                                aria-label="동 필터"
                              >
                                <option value="">전체</option>
                                {dataModalRevisionFilters.dongs.map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            </th>
                            <th>
                              <select
                                value={dataModalFilterFloor}
                                onChange={(e) => setDataModalFilterFloor(e.target.value)}
                                style={{ width: '100%', maxWidth: '100%', padding: '0.25rem 0.35rem', fontSize: '0.8rem' }}
                                aria-label="층 필터"
                              >
                                <option value="">전체</option>
                                {dataModalRevisionFilters.floors.map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            </th>
                            <th>
                              <select
                                value={dataModalFilterSignType}
                                onChange={(e) => setDataModalFilterSignType(e.target.value)}
                                style={{ width: '100%', maxWidth: '100%', padding: '0.25rem 0.35rem', fontSize: '0.8rem' }}
                                aria-label="부재유형 필터"
                              >
                                <option value="">전체</option>
                                {dataModalRevisionFilters.signTypes.map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            </th>
                            <th>
                              <select
                                value={dataModalFilterSignCode}
                                onChange={(e) => setDataModalFilterSignCode(e.target.value)}
                                style={{ width: '100%', maxWidth: '100%', padding: '0.25rem 0.35rem', fontSize: '0.8rem' }}
                                aria-label="부호 필터"
                              >
                                <option value="">전체</option>
                                {dataModalRevisionFilters.signCodes.map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            </th>
                            <th></th>
                            <th>
                              <select
                                value={dataModalFilterCategory}
                                onChange={(e) => setDataModalFilterCategory(e.target.value)}
                                style={{ width: '100%', maxWidth: '100%', padding: '0.25rem 0.35rem', fontSize: '0.8rem' }}
                                aria-label="자재분류 필터"
                              >
                                <option value="">전체</option>
                                <option value="콘크리트">콘크리트</option>
                                <option value="거푸집">거푸집</option>
                                <option value="철근">철근</option>
                                <option value="미매핑">미매핑</option>
                              </select>
                            </th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataModalSortedFilteredItems.map((item) => {
                            const signParts = (item.sign ?? '').trim().split(/\s+/)
                            const signType = signParts[0] ?? '—'
                            const signCode = signParts[1] ?? (signParts[0] ? '—' : '—')
                            return (
                            <tr key={item.id}>
                              <td>{item.dong ?? '—'}</td>
                              <td>{item.floor ?? '—'}</td>
                              <td>{signType}</td>
                              <td>{signCode}</td>
                              <td>{item.name ?? '—'}</td>
                              <td>{item.category ? item.category : '—'}</td>
                              <td>{item.spec ?? '—'}</td>
                              <td>{item.formula ?? '—'}</td>
                              <td>{item.result_value ?? '—'}</td>
                              <td>{item.item_type ?? '—'}</td>
                              <td>{item.guid ?? '—'}</td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>
                    {dataModalTotal != null && dataModalItems.length < dataModalTotal && loadingMoreDataModal && (
                      <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--main-border)', fontSize: '0.875rem', color: 'var(--main-text-muted)' }}>
                        다음 데이터 불러오는 중…
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {nameMappingModalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="name-mapping-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="name-mapping-modal-title" className="modal__title">명칭 매핑 (콘크리트 / 거푸집 / 철근)</h2>
                <button type="button" className="modal__close" onClick={() => setNameMappingModalOpen(false)} aria-label="닫기">×</button>
              </div>
              <div className="modal__body">
                <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  부재별산출서의 <strong>명칭</strong>에 포함된 키워드로 분류합니다. 직접 입력하거나, 아래 좌측에서 물량 데이터 명칭을 선택해 추가할 수 있습니다.
                </p>

                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>직접 입력</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    placeholder="명칭 키워드 (예: 콘크리트)"
                    value={newNamePattern}
                    onChange={(e) => setNewNamePattern(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem', minWidth: '140px' }}
                  />
                  <select
                    value={newNameCategory}
                    onChange={(e) => setNewNameCategory(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem' }}
                  >
                    {NAME_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!newNamePattern.trim() || nameMappingSaving}
                    onClick={() => {
                      if (!user?.email || !newNamePattern.trim()) return
                      setNameMappingSaving(true)
                      createQuantityNameMappingApi(user.email, newNamePattern.trim(), newNameCategory)
                        .then((res) => {
                          if (res.success && res.item) {
                            setNameMappings((prev) => [...prev, res.item!].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
                            setNewNamePattern('')
                          }
                        })
                        .catch(() => {})
                        .finally(() => setNameMappingSaving(false))
                    }}
                  >
                    {nameMappingSaving ? '추가 중…' : '추가'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '280px' }}>
                  {/* 좌측: 물량 데이터에서 읽어 온 명칭 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>물량 데이터에서 읽어 온 명칭</h3>
                    {!selectedRevisionId ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>리비전을 선택하면 해당 리비전의 물량 데이터 명칭 목록이 표시됩니다.</p>
                    ) : loadingDistinctNames ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>명칭 목록 불러오는 중…</p>
                    ) : (() => {
                      const registeredPatterns = new Set(nameMappings.map((m) => m.name_pattern))
                      const allNamesForLeft = [...new Set([...distinctNames, ...deletedNamePatternsToShow])].sort()
                      const namesNotMapped = allNamesForLeft.filter((name) => !registeredPatterns.has(name))
                      return namesNotMapped.length === 0 && allNamesForLeft.length > 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>물량 데이터의 모든 명칭이 이미 매핑에 등록되었습니다.</p>
                      ) : allNamesForLeft.length === 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>해당 리비전에 등록된 물량 데이터가 없거나 명칭이 비어 있습니다.</p>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                            <select
                              value={newNameCategory}
                              onChange={(e) => setNewNameCategory(e.target.value)}
                              style={{ padding: '0.35rem 0.5rem' }}
                              aria-label="분류 선택"
                            >
                              {NAME_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              disabled={selectedNamesForMapping.size === 0 || addingSelectedNames}
                              onClick={() => {
                                if (!user?.email || selectedNamesForMapping.size === 0) return
                                setAddingSelectedNames(true)
                                const toAdd = Array.from(selectedNamesForMapping)
                                Promise.all(
                                  toAdd.map((name) =>
                                    createQuantityNameMappingApi(user!.email!, name, newNameCategory)
                                  )
                                )
                                  .then((results) => {
                                    const added = results
                                      .filter((r): r is { success: true; item: QuantityNameMapping } => r.success && !!r.item)
                                      .map((r) => r.item!)
                                    if (added.length) {
                                      setNameMappings((prev) =>
                                        [...prev, ...added].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                                      )
                                      setSelectedNamesForMapping(new Set())
                                    }
                                  })
                                  .finally(() => setAddingSelectedNames(false))
                                }}
                              >
                                {addingSelectedNames ? '추가 중…' : `선택한 명칭으로 매핑 추가 (${selectedNamesForMapping.size}건)`}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => setSelectedNamesForMapping(new Set(namesNotMapped))}
                              >
                                전체 선택
                              </button>
                              {selectedNamesForMapping.size > 0 && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => setSelectedNamesForMapping(new Set())}
                                >
                                  선택 해제
                                </button>
                              )}
                            </div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--main-border)', borderRadius: '4px', padding: '0.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {namesNotMapped.map((name) => {
                                  const checked = selectedNamesForMapping.has(name)
                                  return (
                                    <label
                                      key={name}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: '0.25rem 0.5rem',
                                        background: checked ? 'var(--main-primary-light, #e8f4fc)' : 'transparent',
                                        border: `1px solid ${checked ? 'var(--main-primary, #0d6efd)' : 'var(--main-border)'}`,
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setSelectedNamesForMapping((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(name)) next.delete(name)
                                            else next.add(name)
                                            return next
                                          })
                                        }}
                                        aria-label={`명칭: ${name}`}
                                      />
                                      <span>{name}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                      )
                    })()}
                  </div>

                  {/* 우측: 추가된 매핑 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>추가된 매핑</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                        <span style={{ color: 'var(--main-text-muted)' }}>분류</span>
                        <select
                          value={nameMappingFilterCategory}
                          onChange={(e) => setNameMappingFilterCategory(e.target.value)}
                          style={{ padding: '0.35rem 0.5rem', minWidth: '90px' }}
                          aria-label="분류 필터"
                        >
                          <option value="">전체</option>
                          {NAME_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      {canManage && selectedNameMappingIds.size > 0 && (
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={nameMappingBulkDeleting}
                          onClick={() => {
                            if (!user?.email || selectedNameMappingIds.size === 0) return
                            if (!window.confirm(`선택한 ${selectedNameMappingIds.size}건의 매핑을 삭제하시겠습니까?`)) return
                            setNameMappingBulkDeleting(true)
                            const ids = Array.from(selectedNameMappingIds)
                            const toDelete = nameMappings.filter((m) => selectedNameMappingIds.has(m.id))
                            const patternsToRestore = toDelete.map((m) => m.name_pattern)
                            Promise.all(ids.map((id) => deleteQuantityNameMappingApi(user!.email!, id)))
                              .then(() => {
                                setNameMappings((prev) => prev.filter((m) => !selectedNameMappingIds.has(m.id)))
                                setSelectedNameMappingIds(new Set())
                                setDeletedNamePatternsToShow((prev) => {
                                  const next = new Set(prev)
                                  patternsToRestore.forEach((p) => next.add(p))
                                  return next
                                })
                              })
                              .finally(() => setNameMappingBulkDeleting(false))
                          }}
                        >
                          {nameMappingBulkDeleting ? '삭제 중…' : `선택 항목 일괄 삭제 (${selectedNameMappingIds.size}건)`}
                        </button>
                      )}
                    </div>
                    <div className="design-doc__table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <table className="project-mgmt__table design-doc__table">
                        <thead>
                          <tr>
                            {canManage && (
                              <th style={{ width: '2.5rem' }}>
                                <input
                                  type="checkbox"
                                  checked={sortedFilteredNameMappings.length > 0 && sortedFilteredNameMappings.every((m) => selectedNameMappingIds.has(m.id))}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedNameMappingIds((prev) => {
                                        const next = new Set(prev)
                                        sortedFilteredNameMappings.forEach((m) => next.add(m.id))
                                        return next
                                      })
                                    } else {
                                      setSelectedNameMappingIds((prev) => {
                                        const next = new Set(prev)
                                        sortedFilteredNameMappings.forEach((m) => next.delete(m.id))
                                        return next
                                      })
                                    }
                                  }}
                                  aria-label="전체 선택"
                                />
                              </th>
                            )}
                            <th>분류</th>
                            <th>명칭 키워드</th>
                            <th style={{ width: '5rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedFilteredNameMappings.length === 0 ? (
                            <tr>
                              <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>
                                {nameMappings.length === 0 ? '등록된 매핑이 없습니다.' : '해당 분류의 매핑이 없습니다.'}
                              </td>
                            </tr>
                          ) : (
                            sortedFilteredNameMappings.map((m) => (
                              <tr key={m.id}>
                                {canManage && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedNameMappingIds.has(m.id)}
                                      onChange={(e) => {
                                        setSelectedNameMappingIds((prev) => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(m.id)
                                          else next.delete(m.id)
                                          return next
                                        })
                                      }}
                                      aria-label={`${m.name_pattern} 선택`}
                                    />
                                  </td>
                                )}
                                <td>{m.category}</td>
                                <td>{m.name_pattern}</td>
                                <td>
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--danger"
                                      disabled={nameMappingDeletingId === m.id}
                                      onClick={() => {
                                        if (!user?.email || !window.confirm(`"${m.name_pattern}" 매핑을 삭제하시겠습니까?`)) return
                                        setNameMappingDeletingId(m.id)
                                        deleteQuantityNameMappingApi(user.email, m.id)
                                          .then(() => {
                                            const patternToRestore = m.name_pattern
                                            setNameMappings((prev) => prev.filter((x) => x.id !== m.id))
                                            setSelectedNameMappingIds((prev) => {
                                              const next = new Set(prev)
                                              next.delete(m.id)
                                              return next
                                            })
                                            setDeletedNamePatternsToShow((prev) => {
                                              const next = new Set(prev)
                                              next.add(patternToRestore)
                                              return next
                                            })
                                          })
                                          .finally(() => setNameMappingDeletingId(null))
                                      }}
                                    >
                                      {nameMappingDeletingId === m.id ? '삭제 중…' : '삭제'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {specModalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="spec-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="spec-modal-title" className="modal__title">규격 관리 (콘크리트 / 거푸집 / 철근)</h2>
                <button type="button" className="modal__close" onClick={() => setSpecModalOpen(false)} aria-label="닫기">×</button>
              </div>
              <div className="modal__body">
                <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  부재별산출서의 <strong>규격</strong>을 콘크리트·거푸집·철근으로 매핑합니다. 직접 입력하거나, 아래 좌측에서 물량 데이터 규격을 선택해 추가할 수 있습니다.
                </p>

                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>직접 입력</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    placeholder="규격 (예: C30)"
                    value={newSpecValue}
                    onChange={(e) => setNewSpecValue(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem', minWidth: '140px' }}
                  />
                  <select
                    value={newSpecCategory}
                    onChange={(e) => setNewSpecCategory(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem' }}
                  >
                    {NAME_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!newSpecValue.trim() || specSaving}
                    onClick={() => {
                      if (!user?.email || !newSpecValue.trim()) return
                      setSpecSaving(true)
                      createQuantitySpecApi(user.email, newSpecValue.trim(), newSpecCategory)
                        .then((res) => {
                          if (res.success && res.item) {
                            setSpecs((prev) => [...prev, res.item!].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
                            setNewSpecValue('')
                          }
                        })
                        .catch(() => {})
                        .finally(() => setSpecSaving(false))
                    }}
                  >
                    {specSaving ? '추가 중…' : '추가'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '280px', marginBottom: '1rem' }}>
                  {/* 좌측: 물량 데이터에서 읽어 온 규격 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>물량 데이터에서 읽어 온 규격</h3>
                    {!selectedRevisionId ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>리비전을 선택하면 해당 리비전의 물량 데이터 규격 목록이 표시됩니다.</p>
                    ) : loadingDistinctSpecs ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>규격 목록 불러오는 중…</p>
                    ) : (() => {
                      const registeredSpecValues = new Set(specs.map((s) => s.spec_value))
                      const allSpecsForLeft = [...new Set([...distinctSpecs, ...deletedSpecsToShow])].sort()
                      const specsNotMapped = allSpecsForLeft.filter((sv) => !registeredSpecValues.has(sv))
                      return specsNotMapped.length === 0 && allSpecsForLeft.length > 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>물량 데이터의 모든 규격이 이미 매핑에 등록되었습니다.</p>
                      ) : allSpecsForLeft.length === 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>해당 리비전에 등록된 물량 데이터가 없거나 규격이 비어 있습니다.</p>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                            <select
                              value={newSpecCategory}
                              onChange={(e) => setNewSpecCategory(e.target.value)}
                              style={{ padding: '0.35rem 0.5rem' }}
                              aria-label="분류 선택"
                            >
                              {NAME_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              disabled={selectedSpecsForMapping.size === 0 || addingSelectedSpecs}
                              onClick={() => {
                                if (!user?.email || selectedSpecsForMapping.size === 0) return
                                setAddingSelectedSpecs(true)
                                const toAdd = Array.from(selectedSpecsForMapping)
                                Promise.all(
                                  toAdd.map((specValue) =>
                                    createQuantitySpecApi(user!.email!, specValue, newSpecCategory)
                                  )
                                )
                                  .then((results) => {
                                    const added = results
                                      .filter((r): r is { success: true; item: QuantitySpec } => r.success && !!r.item)
                                      .map((r) => r.item!)
                                    if (added.length) {
                                      setSpecs((prev) =>
                                        [...prev, ...added].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                                      )
                                      setSelectedSpecsForMapping(new Set())
                                    }
                                  })
                                  .finally(() => setAddingSelectedSpecs(false))
                                }}
                              >
                                {addingSelectedSpecs ? '추가 중…' : `선택한 규격으로 매핑 추가 (${selectedSpecsForMapping.size}건)`}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => setSelectedSpecsForMapping(new Set(specsNotMapped))}
                              >
                                전체 선택
                              </button>
                              {selectedSpecsForMapping.size > 0 && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => setSelectedSpecsForMapping(new Set())}
                                >
                                  선택 해제
                                </button>
                              )}
                            </div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--main-border)', borderRadius: '4px', padding: '0.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {specsNotMapped.map((specValue) => {
                                  const checked = selectedSpecsForMapping.has(specValue)
                                  return (
                                    <label
                                      key={specValue}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: '0.25rem 0.5rem',
                                        background: checked ? 'var(--main-primary-light, #e8f4fc)' : 'transparent',
                                        border: `1px solid ${checked ? 'var(--main-primary, #0d6efd)' : 'var(--main-border)'}`,
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setSelectedSpecsForMapping((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(specValue)) next.delete(specValue)
                                            else next.add(specValue)
                                            return next
                                          })
                                        }}
                                        aria-label={`규격: ${specValue}`}
                                      />
                                      <span>{specValue}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                      )
                    })()}
                  </div>

                  {/* 우측: 추가된 규격 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>추가된 규격</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                        <span style={{ color: 'var(--main-text-muted)' }}>분류</span>
                        <select
                          value={specFilterCategory}
                          onChange={(e) => setSpecFilterCategory(e.target.value)}
                          style={{ padding: '0.35rem 0.5rem', minWidth: '90px' }}
                          aria-label="분류 필터"
                        >
                          <option value="">전체</option>
                          {NAME_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      {canManage && selectedSpecIds.size > 0 && (
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={specBulkDeleting}
                          onClick={() => {
                            if (!user?.email || selectedSpecIds.size === 0) return
                            if (!window.confirm(`선택한 ${selectedSpecIds.size}건의 매핑을 삭제하시겠습니까?`)) return
                            setSpecBulkDeleting(true)
                            const ids = Array.from(selectedSpecIds)
                            const toDelete = specs.filter((s) => selectedSpecIds.has(s.id))
                            const valuesToRestore = toDelete.map((s) => s.spec_value)
                            Promise.all(ids.map((id) => deleteQuantitySpecApi(user!.email!, id)))
                              .then(() => {
                                setSpecs((prev) => prev.filter((s) => !selectedSpecIds.has(s.id)))
                                setSelectedSpecIds(new Set())
                                setDeletedSpecsToShow((prev) => {
                                  const next = new Set(prev)
                                  valuesToRestore.forEach((v) => next.add(v))
                                  return next
                                })
                              })
                              .finally(() => setSpecBulkDeleting(false))
                          }}
                        >
                          {specBulkDeleting ? '삭제 중…' : `선택 항목 일괄 삭제 (${selectedSpecIds.size}건)`}
                        </button>
                      )}
                    </div>
                    <div className="design-doc__table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <table className="project-mgmt__table design-doc__table">
                        <thead>
                          <tr>
                            {canManage && (
                              <th style={{ width: '2.5rem' }}>
                                <input
                                  type="checkbox"
                                  checked={sortedFilteredSpecs.length > 0 && sortedFilteredSpecs.every((s) => selectedSpecIds.has(s.id))}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSpecIds((prev) => {
                                        const next = new Set(prev)
                                        sortedFilteredSpecs.forEach((s) => next.add(s.id))
                                        return next
                                      })
                                    } else {
                                      setSelectedSpecIds((prev) => {
                                        const next = new Set(prev)
                                        sortedFilteredSpecs.forEach((s) => next.delete(s.id))
                                        return next
                                      })
                                    }
                                  }}
                                  aria-label="전체 선택"
                                />
                              </th>
                            )}
                            <th>분류</th>
                            <th>규격</th>
                            <th style={{ width: '5rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedFilteredSpecs.length === 0 ? (
                            <tr>
                              <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>
                                {specs.length === 0 ? '등록된 규격 매핑이 없습니다.' : '해당 분류의 매핑이 없습니다.'}
                              </td>
                            </tr>
                          ) : (
                            sortedFilteredSpecs.map((s) => (
                              <tr key={s.id}>
                                {canManage && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedSpecIds.has(s.id)}
                                      onChange={(e) => {
                                        setSelectedSpecIds((prev) => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(s.id)
                                          else next.delete(s.id)
                                          return next
                                        })
                                      }}
                                      aria-label={`${s.spec_value} 선택`}
                                    />
                                  </td>
                                )}
                                <td>{s.category ?? '—'}</td>
                                <td>{s.spec_value}</td>
                                <td>
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--danger"
                                      disabled={specDeletingId === s.id}
                                      onClick={() => {
                                        if (!user?.email || !window.confirm(`"${s.spec_value}" 매핑을 삭제하시겠습니까?`)) return
                                        setSpecDeletingId(s.id)
                                        const valueToRestore = s.spec_value
                                        deleteQuantitySpecApi(user.email, s.id)
                                          .then(() => {
                                            setSpecs((prev) => prev.filter((x) => x.id !== s.id))
                                            setSelectedSpecIds((prev) => {
                                              const next = new Set(prev)
                                              next.delete(s.id)
                                              return next
                                            })
                                            setDeletedSpecsToShow((prev) => {
                                              const next = new Set(prev)
                                              next.add(valueToRestore)
                                              return next
                                            })
                                          })
                                          .finally(() => setSpecDeletingId(null))
                                      }}
                                    >
                                      {specDeletingId === s.id ? '삭제 중…' : '삭제'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {dongModalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="dong-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="dong-modal-title" className="modal__title">동관리</h2>
                <button type="button" className="modal__close" onClick={() => setDongModalOpen(false)} aria-label="닫기">×</button>
              </div>
              <div className="modal__body">
                <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  물량 데이터의 <strong>동</strong> 값을 등록·관리합니다. 직접 입력하거나, 아래 좌측에서 물량 데이터 동을 선택해 추가할 수 있습니다. <strong>⋮⋮</strong> 셀을 드래그하거나, 행을 선택한 뒤 <strong>↑</strong> <strong>↓</strong> 버튼으로 순서를 변경할 수 있습니다.
                </p>

                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>직접 입력</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    placeholder="동 (예: 1901A)"
                    value={newDongValue}
                    onChange={(e) => setNewDongValue(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem', minWidth: '140px' }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!newDongValue.trim() || dongSaving}
                    onClick={() => {
                      if (!user?.email || !newDongValue.trim()) return
                      setDongSaving(true)
                      createQuantityDongApi(user.email, newDongValue.trim())
                        .then((res) => {
                          if (res.success && res.item) {
                            setDongs((prev) => [...prev, res.item!].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
                            setNewDongValue('')
                          }
                        })
                        .catch(() => {})
                        .finally(() => setDongSaving(false))
                    }}
                  >
                    {dongSaving ? '추가 중…' : '추가'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '280px' }}>
                  {/* 좌측: 물량 데이터에서 읽어 온 동 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>물량 데이터에서 읽어 온 동</h3>
                    {!selectedRevisionId ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>리비전을 선택하면 해당 리비전의 동 목록이 표시됩니다.</p>
                    ) : loadingDistinctDongs ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>동 목록 불러오는 중…</p>
                    ) : (() => {
                      const registeredDongs = new Set(dongs.map((d) => d.dong_value))
                      const allDongsForLeft = [...new Set([...distinctDongs, ...deletedDongsToShow])].sort()
                      const dongsNotRegistered = allDongsForLeft.filter((v) => !registeredDongs.has(v))
                      return dongsNotRegistered.length === 0 && allDongsForLeft.length > 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>물량 데이터의 모든 동이 이미 등록되었습니다.</p>
                      ) : allDongsForLeft.length === 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>해당 리비전에 등록된 물량 데이터가 없거나 동이 비어 있습니다.</p>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              disabled={selectedDongsForMapping.size === 0 || addingSelectedDongs}
                              onClick={() => {
                                if (!user?.email || selectedDongsForMapping.size === 0) return
                                setAddingSelectedDongs(true)
                                const toAdd = Array.from(selectedDongsForMapping)
                                Promise.all(
                                  toAdd.map((dongVal) => createQuantityDongApi(user!.email!, dongVal))
                                )
                                  .then((results) => {
                                    const added = results
                                      .filter((r): r is { success: true; item: QuantityDong } => r.success && !!r.item)
                                      .map((r) => r.item!)
                                    if (added.length) {
                                      setDongs((prev) =>
                                        [...prev, ...added].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                                      )
                                      setSelectedDongsForMapping(new Set())
                                    }
                                  })
                                  .finally(() => setAddingSelectedDongs(false))
                                }}
                              >
                                {addingSelectedDongs ? '추가 중…' : `선택한 동으로 추가 (${selectedDongsForMapping.size}건)`}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => setSelectedDongsForMapping(new Set(dongsNotRegistered))}
                              >
                                전체 선택
                              </button>
                              {selectedDongsForMapping.size > 0 && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => setSelectedDongsForMapping(new Set())}
                                >
                                  선택 해제
                                </button>
                              )}
                            </div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--main-border)', borderRadius: '4px', padding: '0.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {dongsNotRegistered.map((dongVal) => {
                                  const checked = selectedDongsForMapping.has(dongVal)
                                  return (
                                    <label
                                      key={dongVal}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: '0.25rem 0.5rem',
                                        background: checked ? 'var(--main-primary-light, #e8f4fc)' : 'transparent',
                                        border: `1px solid ${checked ? 'var(--main-primary, #0d6efd)' : 'var(--main-border)'}`,
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setSelectedDongsForMapping((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(dongVal)) next.delete(dongVal)
                                            else next.add(dongVal)
                                            return next
                                          })
                                        }}
                                        aria-label={`동: ${dongVal}`}
                                      />
                                      <span>{dongVal}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                      )
                    })()}
                  </div>

                  {/* 우측: 등록된 동 목록 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>등록된 동 목록</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                      {canManage && selectedDongIds.size > 0 && (
                        <>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={
                              dongReordering ||
                              (() => {
                                const list = sortedDongs
                                const indices = list.map((d, i) => (selectedDongIds.has(d.id) ? i : -1)).filter((i) => i >= 0)
                                return indices.length === 0 || Math.min(...indices) === 0
                              })()
                            }
                            onClick={() => {
                              if (!user?.email || selectedDongIds.size === 0) return
                              const list = [...sortedDongs]
                              const indices = list.map((d, i) => (selectedDongIds.has(d.id) ? i : -1)).filter((i) => i >= 0)
                              const minIdx = Math.min(...indices)
                              if (minIdx === 0) return
                              const selected = list.filter((d) => selectedDongIds.has(d.id))
                              const maxIdx = minIdx + selected.length - 1
                              const newOrder = [
                                ...list.slice(0, minIdx - 1),
                                ...selected,
                                list[minIdx - 1],
                                ...list.slice(maxIdx + 1),
                              ]
                              const newOrderIds = newOrder.map((x) => x.id)
                              setDongReordering(true)
                              updateQuantityDongsOrderApi(user.email, newOrderIds)
                                .then(() => {
                                  setDongs(newOrder.map((item, index) => ({ ...item, sort_order: index })))
                                })
                                .finally(() => setDongReordering(false))
                            }}
                            title="선택한 항목을 위로 이동"
                            style={{ padding: '0.35rem 0.5rem', minWidth: '2rem' }}
                            aria-label="위로"
                          >
                            <span aria-hidden="true">↑</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={
                              dongReordering ||
                              (() => {
                                const list = sortedDongs
                                const indices = list.map((d, i) => (selectedDongIds.has(d.id) ? i : -1)).filter((i) => i >= 0)
                                return indices.length === 0 || Math.max(...indices) >= list.length - 1
                              })()
                            }
                            onClick={() => {
                              if (!user?.email || selectedDongIds.size === 0) return
                              const list = [...sortedDongs]
                              const indices = list.map((d, i) => (selectedDongIds.has(d.id) ? i : -1)).filter((i) => i >= 0)
                              const maxIdx = Math.max(...indices)
                              if (maxIdx === list.length - 1) return
                              const minIdx = Math.min(...indices)
                              const selected = list.filter((d) => selectedDongIds.has(d.id))
                              const newOrder = [
                                ...list.slice(0, minIdx),
                                list[maxIdx + 1],
                                ...selected,
                                ...list.slice(maxIdx + 2),
                              ]
                              const newOrderIds = newOrder.map((x) => x.id)
                              setDongReordering(true)
                              updateQuantityDongsOrderApi(user.email, newOrderIds)
                                .then(() => {
                                  setDongs(newOrder.map((item, index) => ({ ...item, sort_order: index })))
                                })
                                .finally(() => setDongReordering(false))
                            }}
                            title="선택한 항목을 아래로 이동"
                            style={{ padding: '0.35rem 0.5rem', minWidth: '2rem' }}
                            aria-label="아래로"
                          >
                            <span aria-hidden="true">↓</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={dongBulkDeleting}
                            onClick={() => {
                              if (!user?.email || selectedDongIds.size === 0) return
                              if (!window.confirm(`선택한 ${selectedDongIds.size}건의 동을 삭제하시겠습니까?`)) return
                              setDongBulkDeleting(true)
                              const ids = Array.from(selectedDongIds)
                              const toDelete = dongs.filter((d) => selectedDongIds.has(d.id))
                              const valuesToRestore = toDelete.map((d) => d.dong_value)
                              Promise.all(ids.map((id) => deleteQuantityDongApi(user!.email!, id)))
                                .then(() => {
                                  setDongs((prev) => prev.filter((d) => !selectedDongIds.has(d.id)))
                                  setSelectedDongIds(new Set())
                                  setDeletedDongsToShow((prev) => {
                                    const next = new Set(prev)
                                    valuesToRestore.forEach((v) => next.add(v))
                                    return next
                                  })
                                })
                                .finally(() => setDongBulkDeleting(false))
                            }}
                          >
                            {dongBulkDeleting ? '삭제 중…' : `선택 항목 일괄 삭제 (${selectedDongIds.size}건)`}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="design-doc__table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <table className="project-mgmt__table design-doc__table">
                        <thead>
                          <tr>
                            {canManage && (
                              <>
                                <th style={{ width: '2rem' }} title="드래그하여 순서 변경" aria-label="순서 변경"></th>
                                <th style={{ width: '2.5rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={sortedDongs.length > 0 && sortedDongs.every((d) => selectedDongIds.has(d.id))}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedDongIds((prev) => {
                                          const next = new Set(prev)
                                          sortedDongs.forEach((d) => next.add(d.id))
                                          return next
                                        })
                                      } else {
                                        setSelectedDongIds((prev) => {
                                          const next = new Set(prev)
                                          sortedDongs.forEach((d) => next.delete(d.id))
                                          return next
                                        })
                                      }
                                    }}
                                    aria-label="전체 선택"
                                  />
                                </th>
                              </>
                            )}
                            <th>동</th>
                            <th style={{ minWidth: '6rem' }}>연면적(m²)</th>
                            <th style={{ width: '5rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDongs.length === 0 ? (
                            <tr>
                              <td colSpan={canManage ? 5 : 3} style={{ color: 'var(--main-text-muted)' }}>
                                등록된 동이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            sortedDongs.map((d) => (
                              <tr
                                key={d.id}
                                data-dong-id={d.id}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  if (!canManage || draggedDongId == null) return
                                  e.dataTransfer.dropEffect = 'move'
                                  const tr = (e.target as HTMLElement).closest('tr')
                                  const id = tr ? parseInt(tr.getAttribute('data-dong-id') ?? '', 10) : null
                                  if (Number.isInteger(id)) setDongDragOverId(id)
                                }}
                                onDragLeave={() => setDongDragOverId(null)}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  if (!canManage || !user?.email || draggedDongId == null) return
                                  const tr = (e.target as HTMLElement).closest('tr')
                                  const targetId = tr ? parseInt(tr.getAttribute('data-dong-id') ?? '', 10) : null
                                  if (!Number.isInteger(targetId) || targetId === draggedDongId) {
                                    setDraggedDongId(null)
                                    setDongDragOverId(null)
                                    return
                                  }
                                  const list = [...sortedDongs]
                                  const fromIndex = list.findIndex((x) => x.id === draggedDongId)
                                  const toIndex = list.findIndex((x) => x.id === targetId)
                                  if (fromIndex === -1 || toIndex === -1) {
                                    setDraggedDongId(null)
                                    setDongDragOverId(null)
                                    return
                                  }
                                  const [removed] = list.splice(fromIndex, 1)
                                  list.splice(toIndex, 0, removed)
                                  const newOrderIds = list.map((x) => x.id)
                                  setDongReordering(true)
                                  updateQuantityDongsOrderApi(user.email, newOrderIds)
                                    .then(() => {
                                      setDongs(list.map((item, index) => ({ ...item, sort_order: index })))
                                    })
                                    .finally(() => {
                                      setDongReordering(false)
                                      setDraggedDongId(null)
                                      setDongDragOverId(null)
                                    })
                                }}
                                style={{
                                  backgroundColor: dongDragOverId === d.id ? 'var(--main-primary-light, #e8f4fc)' : undefined,
                                }}
                              >
                                {canManage && (
                                  <td
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedDongId(d.id)
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData('text/plain', String(d.id))
                                    }}
                                    onDragEnd={() => {
                                      setDraggedDongId(null)
                                      setDongDragOverId(null)
                                    }}
                                    style={{
                                      cursor: 'grab',
                                      opacity: draggedDongId === d.id ? 0.5 : 1,
                                      verticalAlign: 'middle',
                                      color: 'var(--main-text-muted)',
                                    }}
                                    title="드래그하여 순서 변경"
                                  >
                                    <span aria-hidden="true">⋮⋮</span>
                                  </td>
                                )}
                                {canManage && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedDongIds.has(d.id)}
                                      onChange={(e) => {
                                        setSelectedDongIds((prev) => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(d.id)
                                          else next.delete(d.id)
                                          return next
                                        })
                                      }}
                                      aria-label={`${d.dong_value} 선택`}
                                    />
                                  </td>
                                )}
                                <td>{d.dong_value}</td>
                                <td>
                                  {canManage ? (
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      placeholder="m²"
                                      value={d.gross_area != null && Number.isFinite(d.gross_area) ? d.gross_area : ''}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        const num = v === '' ? null : parseFloat(v)
                                        setDongs((prev) =>
                                          prev.map((x) =>
                                            x.id === d.id ? { ...x, gross_area: num != null && Number.isFinite(num) ? num : null } : x
                                          )
                                        )
                                      }}
                                      onBlur={() => {
                                        if (user?.email == null) return
                                        const val = d.gross_area != null && Number.isFinite(d.gross_area) ? d.gross_area : null
                                        updateQuantityDongApi(user.email, d.id, { gross_area: val })
                                          .then((res) => {
                                            if (res.success && res.item) {
                                              setDongs((prev) => prev.map((x) => (x.id === d.id ? { ...x, gross_area: res.item!.gross_area } : x)))
                                            }
                                          })
                                          .catch(() => {})
                                      }}
                                      style={{ width: '100%', maxWidth: '7rem', padding: '0.25rem 0.35rem', fontSize: '0.875rem' }}
                                      aria-label={`${d.dong_value} 연면적`}
                                    />
                                  ) : (
                                    d.gross_area != null && Number.isFinite(d.gross_area)
                                      ? (Number(d.gross_area) === Math.floor(Number(d.gross_area)) ? String(d.gross_area) : Number(d.gross_area).toFixed(2))
                                      : '—'
                                  )}
                                </td>
                                <td>
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--danger"
                                      disabled={dongDeletingId === d.id || dongReordering}
                                      onClick={() => {
                                        if (!user?.email || !window.confirm(`"${d.dong_value}" 동을 삭제하시겠습니까?`)) return
                                        setDongDeletingId(d.id)
                                        const valueToRestore = d.dong_value
                                        deleteQuantityDongApi(user.email, d.id)
                                          .then(() => {
                                            setDongs((prev) => prev.filter((x) => x.id !== d.id))
                                            setSelectedDongIds((prev) => {
                                              const next = new Set(prev)
                                              next.delete(d.id)
                                              return next
                                            })
                                            setDeletedDongsToShow((prev) => {
                                              const next = new Set(prev)
                                              next.add(valueToRestore)
                                              return next
                                            })
                                          })
                                          .finally(() => setDongDeletingId(null))
                                      }}
                                    >
                                      {dongDeletingId === d.id ? '삭제 중…' : '삭제'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {floorModalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="floor-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="floor-modal-title" className="modal__title">층관리</h2>
                <button type="button" className="modal__close" onClick={() => setFloorModalOpen(false)} aria-label="닫기">×</button>
              </div>
              <div className="modal__body">
                <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  물량 데이터의 <strong>층</strong> 값을 등록·관리합니다. 직접 입력하거나, 아래 좌측에서 물량 데이터 층을 선택해 추가할 수 있습니다.
                </p>

                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>직접 입력</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    placeholder="층 (예: 1F, B1)"
                    value={newFloorValue}
                    onChange={(e) => setNewFloorValue(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem', minWidth: '140px' }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!newFloorValue.trim() || floorSaving}
                    onClick={() => {
                      if (!user?.email || !newFloorValue.trim()) return
                      setFloorSaving(true)
                      createQuantityFloorApi(user.email, newFloorValue.trim())
                        .then((res) => {
                          if (res.success && res.item) {
                            setFloors((prev) => [...prev, res.item!].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
                            setNewFloorValue('')
                          }
                        })
                        .catch(() => {})
                        .finally(() => setFloorSaving(false))
                    }}
                  >
                    {floorSaving ? '추가 중…' : '추가'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '280px' }}>
                  {/* 좌측: 물량 데이터에서 읽어 온 층 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', flexShrink: 0 }}>물량 데이터에서 읽어 온 층</h3>
                    {!selectedRevisionId ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>리비전을 선택하면 해당 리비전의 층 목록이 표시됩니다.</p>
                    ) : loadingDistinctFloors ? (
                      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>층 목록 불러오는 중…</p>
                    ) : (() => {
                      const registeredFloors = new Set(floors.map((f) => f.floor_value))
                      const allFloorsForLeft = [...new Set([...distinctFloors, ...deletedFloorsToShow])].sort()
                      const floorsNotRegistered = allFloorsForLeft.filter((v) => !registeredFloors.has(v))
                      return floorsNotRegistered.length === 0 && allFloorsForLeft.length > 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>물량 데이터의 모든 층이 이미 등록되었습니다.</p>
                      ) : allFloorsForLeft.length === 0 ? (
                        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', flex: 1 }}>해당 리비전에 등록된 물량 데이터가 없거나 층이 비어 있습니다.</p>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              disabled={selectedFloorsForMapping.size === 0 || addingSelectedFloors}
                              onClick={() => {
                                if (!user?.email || selectedFloorsForMapping.size === 0) return
                                setAddingSelectedFloors(true)
                                const toAdd = Array.from(selectedFloorsForMapping)
                                Promise.all(
                                  toAdd.map((floorVal) => createQuantityFloorApi(user!.email!, floorVal))
                                )
                                  .then((results) => {
                                    const added = results
                                      .filter((r): r is { success: true; item: QuantityFloor } => r.success && !!r.item)
                                      .map((r) => r.item!)
                                    if (added.length) {
                                      setFloors((prev) =>
                                        [...prev, ...added].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
                                      )
                                      setSelectedFloorsForMapping(new Set())
                                    }
                                  })
                                  .finally(() => setAddingSelectedFloors(false))
                                }}
                              >
                                {addingSelectedFloors ? '추가 중…' : `선택한 층으로 추가 (${selectedFloorsForMapping.size}건)`}
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => setSelectedFloorsForMapping(new Set(floorsNotRegistered))}
                              >
                                전체 선택
                              </button>
                              {selectedFloorsForMapping.size > 0 && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => setSelectedFloorsForMapping(new Set())}
                                >
                                  선택 해제
                                </button>
                              )}
                            </div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--main-border)', borderRadius: '4px', padding: '0.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {floorsNotRegistered.map((floorVal) => {
                                  const checked = selectedFloorsForMapping.has(floorVal)
                                  return (
                                    <label
                                      key={floorVal}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: '0.25rem 0.5rem',
                                        background: checked ? 'var(--main-primary-light, #e8f4fc)' : 'transparent',
                                        border: `1px solid ${checked ? 'var(--main-primary, #0d6efd)' : 'var(--main-border)'}`,
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setSelectedFloorsForMapping((prev) => {
                                            const next = new Set(prev)
                                            if (next.has(floorVal)) next.delete(floorVal)
                                            else next.add(floorVal)
                                            return next
                                          })
                                        }}
                                        aria-label={`층: ${floorVal}`}
                                      />
                                      <span>{floorVal}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </>
                      )
                    })()}
                  </div>

                  {/* 우측: 등록된 층 목록 */}
                  <div style={{ border: '1px solid var(--main-border)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <h3 style={{ fontSize: '0.9rem', margin: 0, flexShrink: 0 }}>등록된 층 목록</h3>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {canManage && floors.length > 0 && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={floorReordering}
                            onClick={applyDefaultFloorOrder}
                            title="층 유형 순서(낮은 층부터)로 정렬하여 저장합니다"
                          >
                            {floorReordering ? '적용 중…' : '기본정렬'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            setFloorSortOrderEditOpen((prev) => {
                              if (!prev) setFloorSortOrderEditDraft([...floorCategoryOrder])
                              return !prev
                            })
                          }}
                        >
                          {floorSortOrderEditOpen ? '정렬 순서 편집 닫기' : '정렬 순서 편집'}
                        </button>
                      </div>
                    </div>
                    {floorSortOrderEditOpen && (
                      <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--main-bg-sub, #f5f5f5)', borderRadius: '6px', flexShrink: 0 }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--main-text-muted)', marginBottom: '0.5rem' }}>층 유형별 정렬 순서 (위에서 아래로 적용)</p>
                        {floorSortOrderEditDraft.map((key, idx) => (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.8125rem', minWidth: '1.5rem' }}>{idx + 1}.</span>
                            <span style={{ flex: 1, fontSize: '0.875rem' }}>{FLOOR_CATEGORY_LABELS[key] ?? key}</span>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={idx === 0}
                              onClick={() => {
                                setFloorSortOrderEditDraft((prev) => {
                                  const next = [...prev]
                                  ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                                  return next
                                })
                              }}
                              aria-label="위로"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={idx === floorSortOrderEditDraft.length - 1}
                              onClick={() => {
                                setFloorSortOrderEditDraft((prev) => {
                                  const next = [...prev]
                                  ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                                  return next
                                })
                              }}
                              aria-label="아래로"
                            >
                              ↓
                            </button>
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setFloorSortOrderEditDraft([...DEFAULT_FLOOR_CATEGORY_ORDER])}
                          >
                            기본값 복원
                          </button>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => {
                              setFloorCategoryOrder([...floorSortOrderEditDraft])
                              try {
                                localStorage.setItem(FLOOR_CATEGORY_ORDER_KEY, JSON.stringify(floorSortOrderEditDraft))
                              } catch {
                                // ignore
                              }
                              setFloorSortOrderEditOpen(false)
                            }}
                          >
                            적용
                          </button>
                        </div>
                      </div>
                    )}
                    <p style={{ fontSize: '0.75rem', color: 'var(--main-text-muted)', marginBottom: '0.5rem', flexShrink: 0 }}>
                      <strong>기본정렬</strong> 버튼으로 층 유형 순서(낮은 층부터)로 저장할 수 있습니다. <strong>⋮⋮</strong> 셀을 드래그하거나, 행을 선택한 뒤 <strong>↑</strong> <strong>↓</strong> 버튼으로 순서를 변경할 수 있습니다.
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', flexShrink: 0 }}>
                      {canManage && selectedFloorIds.size > 0 && (
                        <>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={
                              floorReordering ||
                              floorBulkDeleting ||
                              displayFloors.findIndex((f) => selectedFloorIds.has(f.id)) <= 0
                            }
                            onClick={() => {
                              if (!user?.email || selectedFloorIds.size === 0) return
                              const list = [...displayFloors]
                              const indices = list.map((f, i) => (selectedFloorIds.has(f.id) ? i : -1)).filter((i) => i >= 0)
                              const minIdx = Math.min(...indices)
                              if (minIdx === 0) return
                              const selected = list.filter((f) => selectedFloorIds.has(f.id))
                              const maxIdx = minIdx + selected.length - 1
                              const newOrder = [
                                ...list.slice(0, minIdx - 1),
                                ...selected,
                                list[minIdx - 1],
                                ...list.slice(maxIdx + 1),
                              ]
                              const newOrderIds = newOrder.map((x) => x.id)
                              setFloorReordering(true)
                              updateQuantityFloorsOrderApi(user.email, newOrderIds)
                                .then(() => {
                                  setFloors(newOrder.map((item, index) => ({ ...item, sort_order: index })))
                                  setFloorColumnSort('default')
                                })
                                .finally(() => setFloorReordering(false))
                            }}
                            title="선택한 항목을 위로 이동"
                            style={{ padding: '0.35rem 0.5rem', minWidth: '2rem' }}
                            aria-label="위로"
                          >
                            <span aria-hidden="true">↑</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={
                              floorReordering ||
                              floorBulkDeleting ||
                              (() => {
                                const indices = displayFloors.map((f, i) => (selectedFloorIds.has(f.id) ? i : -1)).filter((i) => i >= 0)
                                return indices.length === 0 || Math.max(...indices) >= displayFloors.length - 1
                              })()
                            }
                            onClick={() => {
                              if (!user?.email || selectedFloorIds.size === 0) return
                              const list = [...displayFloors]
                              const indices = list.map((f, i) => (selectedFloorIds.has(f.id) ? i : -1)).filter((i) => i >= 0)
                              const maxIdx = Math.max(...indices)
                              if (maxIdx === list.length - 1) return
                              const minIdx = Math.min(...indices)
                              const selected = list.filter((f) => selectedFloorIds.has(f.id))
                              const newOrder = [
                                ...list.slice(0, minIdx),
                                list[maxIdx + 1],
                                ...selected,
                                ...list.slice(maxIdx + 2),
                              ]
                              const newOrderIds = newOrder.map((x) => x.id)
                              setFloorReordering(true)
                              updateQuantityFloorsOrderApi(user.email, newOrderIds)
                                .then(() => {
                                  setFloors(newOrder.map((item, index) => ({ ...item, sort_order: index })))
                                  setFloorColumnSort('default')
                                })
                                .finally(() => setFloorReordering(false))
                            }}
                            title="선택한 항목을 아래로 이동"
                            style={{ padding: '0.35rem 0.5rem', minWidth: '2rem' }}
                            aria-label="아래로"
                          >
                            <span aria-hidden="true">↓</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={floorBulkDeleting}
                            onClick={() => {
                              if (!user?.email || selectedFloorIds.size === 0) return
                              if (!window.confirm(`선택한 ${selectedFloorIds.size}건의 층을 삭제하시겠습니까?`)) return
                              setFloorBulkDeleting(true)
                              const ids = Array.from(selectedFloorIds)
                              const toDelete = floors.filter((f) => selectedFloorIds.has(f.id))
                              const valuesToRestore = toDelete.map((f) => f.floor_value)
                              Promise.all(ids.map((id) => deleteQuantityFloorApi(user!.email!, id)))
                                .then(() => {
                                  setFloors((prev) => prev.filter((f) => !selectedFloorIds.has(f.id)))
                                  setSelectedFloorIds(new Set())
                                  setDeletedFloorsToShow((prev) => {
                                    const next = new Set(prev)
                                    valuesToRestore.forEach((v) => next.add(v))
                                    return next
                                  })
                                })
                                .finally(() => setFloorBulkDeleting(false))
                              }}
                            >
                              {floorBulkDeleting ? '삭제 중…' : `선택 항목 일괄 삭제 (${selectedFloorIds.size}건)`}
                            </button>
                        </>
                      )}
                    </div>
                    <div className="design-doc__table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                      <table className="project-mgmt__table design-doc__table">
                        <thead>
                          <tr>
                            {canManage && (
                              <>
                                <th style={{ width: '2rem' }} title="드래그하여 순서 변경" aria-label="순서 변경"></th>
                                <th style={{ width: '2.5rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={displayFloors.length > 0 && displayFloors.every((f) => selectedFloorIds.has(f.id))}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedFloorIds((prev) => {
                                          const next = new Set(prev)
                                          displayFloors.forEach((f) => next.add(f.id))
                                          return next
                                        })
                                      } else {
                                        setSelectedFloorIds((prev) => {
                                          const next = new Set(prev)
                                          displayFloors.forEach((f) => next.delete(f.id))
                                          return next
                                        })
                                      }
                                    }}
                                    aria-label="전체 선택"
                                  />
                                </th>
                              </>
                            )}
                            <th>
                              <button
                                type="button"
                                onClick={() => {
                                  setFloorColumnSort((prev) => {
                                    if (prev === 'default') return 'asc'
                                    if (prev === 'asc') return 'desc'
                                    return 'default'
                                  })
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  font: 'inherit',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  color: 'inherit',
                                }}
                                title={floorColumnSort === 'default' ? '정렬 (클릭: 오름차순)' : floorColumnSort === 'asc' ? '오름차순 (클릭: 내림차순)' : '내림차순 (클릭: 기본 순서)'}
                              >
                                층
                                {floorColumnSort === 'asc' && <span aria-hidden="true">↑</span>}
                                {floorColumnSort === 'desc' && <span aria-hidden="true">↓</span>}
                              </button>
                            </th>
                            <th style={{ width: '5rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayFloors.length === 0 ? (
                            <tr>
                              <td colSpan={canManage ? 4 : 2} style={{ color: 'var(--main-text-muted)' }}>
                                등록된 층이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            displayFloors.map((f) => (
                              <tr
                                key={f.id}
                                data-floor-id={f.id}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  if (!canManage || draggedFloorId == null) return
                                  e.dataTransfer.dropEffect = 'move'
                                  const tr = (e.target as HTMLElement).closest('tr')
                                  const id = tr ? parseInt(tr.getAttribute('data-floor-id') ?? '', 10) : null
                                  if (Number.isInteger(id)) setFloorDragOverId(id)
                                }}
                                onDragLeave={() => setFloorDragOverId(null)}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  if (!canManage || !user?.email || draggedFloorId == null) return
                                  const tr = (e.target as HTMLElement).closest('tr')
                                  const targetId = tr ? parseInt(tr.getAttribute('data-floor-id') ?? '', 10) : null
                                  if (!Number.isInteger(targetId) || targetId === draggedFloorId) {
                                    setDraggedFloorId(null)
                                    setFloorDragOverId(null)
                                    return
                                  }
                                  const list = [...displayFloors]
                                  const fromIndex = list.findIndex((x) => x.id === draggedFloorId)
                                  const toIndex = list.findIndex((x) => x.id === targetId)
                                  if (fromIndex === -1 || toIndex === -1) {
                                    setDraggedFloorId(null)
                                    setFloorDragOverId(null)
                                    return
                                  }
                                  const [removed] = list.splice(fromIndex, 1)
                                  list.splice(toIndex, 0, removed)
                                  const newOrderIds = list.map((x) => x.id)
                                  setFloorReordering(true)
                                  updateQuantityFloorsOrderApi(user.email, newOrderIds)
                                    .then(() => {
                                      setFloors(
                                        list.map((item, index) => ({ ...item, sort_order: index }))
                                      )
                                    })
                                    .finally(() => {
                                      setFloorReordering(false)
                                      setDraggedFloorId(null)
                                      setFloorDragOverId(null)
                                    })
                                }}
                                style={{
                                  backgroundColor: floorDragOverId === f.id ? 'var(--main-primary-light, #e8f4fc)' : undefined,
                                }}
                              >
                                {canManage && (
                                  <td
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedFloorId(f.id)
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData('text/plain', String(f.id))
                                    }}
                                    onDragEnd={() => {
                                      setDraggedFloorId(null)
                                      setFloorDragOverId(null)
                                    }}
                                    style={{
                                      cursor: 'grab',
                                      opacity: draggedFloorId === f.id ? 0.5 : 1,
                                      verticalAlign: 'middle',
                                      color: 'var(--main-text-muted)',
                                    }}
                                    title="드래그하여 순서 변경"
                                  >
                                    <span aria-hidden="true">⋮⋮</span>
                                  </td>
                                )}
                                {canManage && (
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedFloorIds.has(f.id)}
                                      onChange={(e) => {
                                        setSelectedFloorIds((prev) => {
                                          const next = new Set(prev)
                                          if (e.target.checked) next.add(f.id)
                                          else next.delete(f.id)
                                          return next
                                        })
                                      }}
                                      aria-label={`${f.floor_value} 선택`}
                                    />
                                  </td>
                                )}
                                <td>{f.floor_value}</td>
                                <td>
                                  {canManage && (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--danger"
                                      disabled={floorDeletingId === f.id || floorReordering}
                                      onClick={() => {
                                        if (!user?.email || !window.confirm(`"${f.floor_value}" 층을 삭제하시겠습니까?`)) return
                                        setFloorDeletingId(f.id)
                                        const valueToRestore = f.floor_value
                                        deleteQuantityFloorApi(user.email, f.id)
                                          .then(() => {
                                            setFloors((prev) => prev.filter((x) => x.id !== f.id))
                                            setSelectedFloorIds((prev) => {
                                              const next = new Set(prev)
                                              next.delete(f.id)
                                              return next
                                            })
                                            setDeletedFloorsToShow((prev) => {
                                              const next = new Set(prev)
                                              next.add(valueToRestore)
                                              return next
                                            })
                                          })
                                          .finally(() => setFloorDeletingId(null))
                                      }}
                                    >
                                      {floorDeletingId === f.id ? '삭제 중…' : '삭제'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {modalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="quantity-file-modal-title">
            <div className="modal">
              <div className="modal__header">
                <h2 id="quantity-file-modal-title" className="modal__title">
                  {editingFile ? '물량파일 수정' : '물량파일 등록'}
                </h2>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  aria-label="닫기"
                >
                  ×
                </button>
              </div>
              <div className="modal__body">
                {error && <div className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
                <div className="project-mgmt__field">
                  <label htmlFor="quantity-file-form-title" className="project-mgmt__label">
                    제목 {editingFile ? <span className="project-mgmt__required">*</span> : '(비어 있으면 파일명으로 등록)'}
                  </label>
                  <input
                    id="quantity-file-form-title"
                    type="text"
                    className="project-mgmt__input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder={editingFile ? '제목 입력' : '제목 입력 (선택, 비어 있으면 파일명 사용)'}
                  />
                </div>
                <div className="project-mgmt__field">
                  <label htmlFor="quantity-file-form-memo" className="project-mgmt__label">
                    비고
                  </label>
                  <input
                    id="quantity-file-form-memo"
                    type="text"
                    className="project-mgmt__input"
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    placeholder="비고 (선택)"
                  />
                </div>
                {!editingFile && (
                  <div className="project-mgmt__field">
                    <label htmlFor="quantity-file-form-file" className="project-mgmt__label">
                      엑셀 파일 <span className="project-mgmt__required">*</span>
                    </label>
                    <input
                      id="quantity-file-form-file"
                      type="file"
                      accept=".xlsx,.xls"
                      className="project-mgmt__input"
                      onChange={(e) => setFormFile((e.target.files && e.target.files[0]) || null)}
                      aria-label="엑셀 파일 선택"
                    />
                    {formFile && (
                      <div style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginTop: '0.5rem' }}>
                        {formFile.name}
                      </div>
                    )}
                    <p style={{ fontSize: '0.8125rem', color: 'var(--main-text-muted)', marginTop: '0.5rem', lineHeight: 1.45 }}>
                      지원 양식: <strong>부재별산출서</strong> 시트(층·부호·명칭·규격…), 반입 일정(부재번호·총물량 등),
                      <strong> 부재별 집계표</strong>(헤더에 ID·도면번호·총물량·단위물량·가로·세로·두께(길이) 및 이형철근/하드웨어 열 — 시트 이름은 자유).
                      집계표는 콘크리트 물량 행과 철근·부속 열마다 별도 행으로 읽습니다.
                    </p>
                  </div>
                )}
              </div>
              <div className="modal__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                  취소
                </button>
                <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
