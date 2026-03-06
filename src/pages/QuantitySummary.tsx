import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useLocation, NavLink } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import {
  getQuantitySummaryApi,
  getQuantityDongsApi,
  updateQuantityDongApi,
  type QuantitySummaryRow,
  type QuantitySummaryItemTypeRow,
  type QuantitySummaryData,
  type QuantityDong,
} from '../api/quantityFile'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  PieChart,
  Pie,
  Cell as RechartsCell,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts'

const M2_PER_PYEONG = 3.3058

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n === Math.floor(n)) return String(n)
  return n.toFixed(2)
}

function sumCategory(row: QuantitySummaryData, concreteCols: string[], formworkCols: string[], rebarCols: string[]) {
  let c = 0
  let f = 0
  let r = 0
  for (const s of concreteCols) c += row.concrete[s] || 0
  for (const s of formworkCols) f += row.formwork[s] || 0
  for (const s of rebarCols) r += row.rebar[s] || 0
  return { concrete: c, formwork: f, rebar: r }
}

/** 지하: FT, PIT, B+숫자+F (기초, 피트, 지하층) */
function isBasementFloor(floor: string | null | undefined): boolean {
  const u = (floor ?? '').trim().toUpperCase()
  return u.startsWith('FT') || u.startsWith('PIT') || /^B\d*F$/i.test(u)
}

/** 지상: 숫자+F, RF, PHF, F (지상층, 옥상층, 옥탑층) */
function isAboveGroundFloor(floor: string | null | undefined): boolean {
  if (isBasementFloor(floor)) return false
  const u = (floor ?? '').trim().toUpperCase()
  return /^\d+F$/i.test(u) || u.startsWith('RF') || u.startsWith('PHF') || u === 'F'
}

/** 엑셀 시트 꾸미기: 열 너비, 제목 행 병합, 숫자 서식 */
function styleExcelSheet(
  ws: XLSX.WorkSheet,
  options: {
    colWidths?: number[]
    mergeTitleRows?: number
    numberFormat?: string
  } = {}
) {
  const { colWidths, mergeTitleRows = 0, numberFormat = '#,##0.00' } = options
  if (colWidths?.length) {
    ws['!cols'] = colWidths.map((wch) => ({ wch: Math.max(8, Math.min(40, wch)) }))
  }
  if (mergeTitleRows > 0 && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref'])
    const merges: XLSX.Range[] = (ws['!merges'] as XLSX.Range[]) || []
    for (let r = 0; r < mergeTitleRows && r <= range.e.r; r++) {
      merges.push({ s: { r, c: 0 }, e: { r, c: range.e.c } })
    }
    ws['!merges'] = merges
  }
  for (const ref of Object.keys(ws)) {
    if (ref.startsWith('!')) continue
    const cell = ws[ref] as XLSX.CellObject | undefined
    if (cell && (cell.t === 'n' || (cell.t === undefined && typeof cell.v === 'number'))) {
      cell.z = numberFormat
    }
  }
}

type SummaryViewMode = 'floor' | 'floor-item' | 'total'

export default function QuantitySummary() {
  const location = useLocation()
  const viewMode: SummaryViewMode = location.pathname.includes('/floor-item')
    ? 'floor-item'
    : location.pathname.includes('/total')
      ? 'total'
      : 'floor'

  const { selectedProject } = useProject()
  const {
    selectedPhaseId,
    selectedRevisionId,
    selectedPhase,
    selectedRevision,
    loadingPhases,
  } = useDesignSchedule()

  const [rows, setRows] = useState<QuantitySummaryRow[]>([])
  const [concreteColumns, setConcreteColumns] = useState<string[]>([])
  const [formworkColumns, setFormworkColumns] = useState<string[]>([])
  const [rebarColumns, setRebarColumns] = useState<string[]>([])
  const [data, setData] = useState<Record<string, QuantitySummaryData>>({})
  const [itemTypeRows, setItemTypeRows] = useState<QuantitySummaryItemTypeRow[]>([])
  const [itemTypeData, setItemTypeData] = useState<Record<string, QuantitySummaryData>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedDongForFloor, setSelectedDongForFloor] = useState<string>('')
  const [selectedDongForFloorItem, setSelectedDongForFloorItem] = useState<string>('')
  const [selectedDongForTotal, setSelectedDongForTotal] = useState<string>('')
  const [dongList, setDongList] = useState<{ dong_value: string; gross_area?: number | null }[]>([])
  const [grossAreaModalOpen, setGrossAreaModalOpen] = useState(false)
  const [grossAreaModalDongs, setGrossAreaModalDongs] = useState<QuantityDong[]>([])
  const [grossAreaModalLoading, setGrossAreaModalLoading] = useState(false)
  const [grossAreaSaving, setGrossAreaSaving] = useState(false)
  const [totalChartMode, setTotalChartMode] = useState<'all' | 'concrete' | 'formwork' | 'rebar'>('all')
  const [totalChartStack, setTotalChartStack] = useState<boolean>(true)
  const [totalShowConcrete, setTotalShowConcrete] = useState(true)
  const [totalShowFormwork, setTotalShowFormwork] = useState(true)
  const [totalShowRebar, setTotalShowRebar] = useState(true)
  const [heatmapMaterial, setHeatmapMaterial] = useState<'concrete' | 'formwork' | 'rebar'>('concrete')
  const [heatmapScope, setHeatmapScope] = useState<'all' | 'ground' | 'basement'>('all')
  const [showFloorChart, setShowFloorChart] = useState(false)
  const [showFloorConcrete, setShowFloorConcrete] = useState(true)
  const [showFloorFormwork, setShowFloorFormwork] = useState(true)
  const [showFloorRebar, setShowFloorRebar] = useState(true)
  const [showFloorItemChart, setShowFloorItemChart] = useState(false)
  const [floorItemMaterial, setFloorItemMaterial] = useState<'concrete' | 'formwork' | 'rebar'>('concrete')
  const [visibleFloorItemTypes, setVisibleFloorItemTypes] = useState<Record<string, boolean>>({})
  const [showTotalChart, setShowTotalChart] = useState(false)

  const { user } = useAuth()

  useEffect(() => {
    if (!selectedRevisionId) {
      setRows([])
      setConcreteColumns([])
      setFormworkColumns([])
      setRebarColumns([])
      setData({})
      setItemTypeRows([])
      setItemTypeData({})
      return
    }
    setLoading(true)
    setError('')
    getQuantitySummaryApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.rows) {
          setRows(res.rows)
          setConcreteColumns(res.concreteColumns || [])
          setFormworkColumns(res.formworkColumns || [])
          setRebarColumns(res.rebarColumns || [])
          setData(res.data || {})
          setItemTypeRows(res.itemTypeRows || [])
          setItemTypeData(res.itemTypeData || {})
        } else {
          setRows([])
          setConcreteColumns([])
          setFormworkColumns([])
          setRebarColumns([])
          setData({})
          setItemTypeRows([])
          setItemTypeData({})
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '집계 데이터를 불러올 수 없습니다.')
        setRows([])
        setConcreteColumns([])
        setFormworkColumns([])
        setRebarColumns([])
        setData({})
        setItemTypeRows([])
        setItemTypeData({})
      })
      .finally(() => setLoading(false))
  }, [selectedRevisionId])

  const fetchDongsForTotal = useCallback(() => {
    getQuantityDongsApi()
      .then((r) => {
        if (r.success && r.items) setDongList(r.items.map((d) => ({ dong_value: d.dong_value ?? '', gross_area: d.gross_area })))
        else setDongList([])
      })
      .catch(() => setDongList([]))
  }, [])

  useEffect(() => {
    if (viewMode !== 'total') return
    fetchDongsForTotal()
  }, [viewMode, fetchDongsForTotal])

  useEffect(() => {
    if (!grossAreaModalOpen) return
    setGrossAreaModalLoading(true)
    getQuantityDongsApi()
      .then((r) => {
        if (r.success && r.items) setGrossAreaModalDongs(r.items)
        else setGrossAreaModalDongs([])
      })
      .catch(() => setGrossAreaModalDongs([]))
      .finally(() => setGrossAreaModalLoading(false))
  }, [grossAreaModalOpen])

  const handleRefreshTotal = useCallback(() => {
    if (!selectedRevisionId) return
    setLoading(true)
    setError('')
    getQuantitySummaryApi(selectedRevisionId)
      .then((res) => {
        if (res.success && res.rows) {
          setRows(res.rows)
          setConcreteColumns(res.concreteColumns || [])
          setFormworkColumns(res.formworkColumns || [])
          setRebarColumns(res.rebarColumns || [])
          setData(res.data || {})
          setItemTypeRows(res.itemTypeRows || [])
          setItemTypeData(res.itemTypeData || {})
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '집계 데이터를 불러올 수 없습니다.')
      })
      .finally(() => setLoading(false))
    fetchDongsForTotal()
  }, [selectedRevisionId, fetchDongsForTotal])

  const rowKey = (r: QuantitySummaryRow) => (r.dong ?? '') + '\t' + (r.floor ?? '')
  const itemTypeRowKey = (r: QuantitySummaryItemTypeRow) =>
    (r.dong ?? '') + '\t' + (r.floor ?? '') + '\t' + (r.item_type ?? '')

  const dongOptions = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => {
      const d = (r.dong ?? '').trim()
      if (d) set.add(d)
    })
    itemTypeRows.forEach((r) => {
      const d = (r.dong ?? '').trim()
      if (d) set.add(d)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows, itemTypeRows])

  const filteredFloorRows = useMemo(
    () =>
      !selectedDongForFloor
        ? rows
        : rows.filter((r) => (r.dong ?? '').trim() === selectedDongForFloor),
    [rows, selectedDongForFloor]
  )

  const filteredItemTypeRows = useMemo(
    () =>
      !selectedDongForFloorItem
        ? itemTypeRows
        : itemTypeRows.filter((r) => (r.dong ?? '').trim() === selectedDongForFloorItem),
    [itemTypeRows, selectedDongForFloorItem]
  )

  const totalAnalysisByDong = useMemo(() => {
    const dongSet = new Set<string>()
    rows.forEach((r) => { if (r.dong != null && String(r.dong).trim()) dongSet.add(String(r.dong).trim()) })
    itemTypeRows.forEach((r) => { if (r.dong != null && String(r.dong).trim()) dongSet.add(String(r.dong).trim()) })
    const dongList = Array.from(dongSet).sort((a, b) => a.localeCompare(b, 'ko'))
    const result: { dong: string; total: { concrete: number; formwork: number; rebar: number }; byItem: { item_type: string; concrete: number; formwork: number; rebar: number }[] }[] = []
    for (const dong of dongList) {
      let tc = 0
      let tf = 0
      let tr = 0
      for (const r of rows) {
        if ((r.dong ?? '').trim() !== dong) continue
        const key = rowKey(r)
        const rowData = data[key]
        if (!rowData) continue
        const s = sumCategory(rowData, concreteColumns, formworkColumns, rebarColumns)
        tc += s.concrete
        tf += s.formwork
        tr += s.rebar
      }
      const byItemMap = new Map<string, { concrete: number; formwork: number; rebar: number }>()
      for (const r of itemTypeRows) {
        if ((r.dong ?? '').trim() !== dong) continue
        const key = itemTypeRowKey(r)
        const rowData = itemTypeData[key]
        if (!rowData) continue
        const s = sumCategory(rowData, concreteColumns, formworkColumns, rebarColumns)
        const it = (r.item_type ?? '').trim() || '—'
        const prev = byItemMap.get(it) || { concrete: 0, formwork: 0, rebar: 0 }
        byItemMap.set(it, { concrete: prev.concrete + s.concrete, formwork: prev.formwork + s.formwork, rebar: prev.rebar + s.rebar })
      }
      const byItem = Array.from(byItemMap.entries())
        .map(([item_type, v]) => ({ item_type, concrete: v.concrete, formwork: v.formwork, rebar: v.rebar }))
        .sort((a, b) => (a.item_type || '').localeCompare(b.item_type || '', 'ko'))
      result.push({ dong, total: { concrete: tc, formwork: tf, rebar: tr }, byItem })
    }
    return result
  }, [rows, data, itemTypeRows, itemTypeData, concreteColumns, formworkColumns, rebarColumns])

  type ScopeBlock = { total: { concrete: number; formwork: number; rebar: number }; byItem: { item_type: string; concrete: number; formwork: number; rebar: number }[] }
  const totalAnalysisByDongWithScope = useMemo(() => {
    const dongSet = new Set<string>()
    rows.forEach((r) => { if (r.dong != null && String(r.dong).trim()) dongSet.add(String(r.dong).trim()) })
    itemTypeRows.forEach((r) => { if (r.dong != null && String(r.dong).trim()) dongSet.add(String(r.dong).trim()) })
    const dongList = Array.from(dongSet).sort((a, b) => a.localeCompare(b, 'ko'))
    const result: { dong: string; ground: ScopeBlock; basement: ScopeBlock }[] = []
    for (const dong of dongList) {
      const buildBlock = (floorFilter: (floor: string | null | undefined) => boolean): ScopeBlock => {
        let tc = 0
        let tf = 0
        let tr = 0
        for (const r of rows) {
          if ((r.dong ?? '').trim() !== dong || !floorFilter(r.floor)) continue
          const key = rowKey(r)
          const rowData = data[key]
          if (!rowData) continue
          const s = sumCategory(rowData, concreteColumns, formworkColumns, rebarColumns)
          tc += s.concrete
          tf += s.formwork
          tr += s.rebar
        }
        const byItemMap = new Map<string, { concrete: number; formwork: number; rebar: number }>()
        for (const r of itemTypeRows) {
          if ((r.dong ?? '').trim() !== dong || !floorFilter(r.floor)) continue
          const key = itemTypeRowKey(r)
          const rowData = itemTypeData[key]
          if (!rowData) continue
          const s = sumCategory(rowData, concreteColumns, formworkColumns, rebarColumns)
          const it = (r.item_type ?? '').trim() || '—'
          const prev = byItemMap.get(it) || { concrete: 0, formwork: 0, rebar: 0 }
          byItemMap.set(it, { concrete: prev.concrete + s.concrete, formwork: prev.formwork + s.formwork, rebar: prev.rebar + s.rebar })
        }
        const byItem = Array.from(byItemMap.entries())
          .map(([item_type, v]) => ({ item_type, concrete: v.concrete, formwork: v.formwork, rebar: v.rebar }))
          .sort((a, b) => (a.item_type || '').localeCompare(b.item_type || '', 'ko'))
        return { total: { concrete: tc, formwork: tf, rebar: tr }, byItem }
      }
      result.push({
        dong,
        ground: buildBlock(isAboveGroundFloor),
        basement: buildBlock(isBasementFloor),
      })
    }
    return result
  }, [rows, data, itemTypeRows, itemTypeData, concreteColumns, formworkColumns, rebarColumns])

  const totalGroundChartData = useMemo(
    () =>
      totalAnalysisByDongWithScope.map(({ dong, ground }) => {
        const c = ground.total.concrete
        const f = ground.total.formwork
        const r = ground.total.rebar
        return {
          dong: dong || '—',
          concrete: c,
          formwork: f,
          rebar: r,
          total: c + f + r,
        }
      }),
    [totalAnalysisByDongWithScope]
  )

  const totalBasementChartData = useMemo(
    () =>
      totalAnalysisByDongWithScope.map(({ dong, basement }) => {
        const c = basement.total.concrete
        const f = basement.total.formwork
        const r = basement.total.rebar
        return {
          dong: dong || '—',
          concrete: c,
          formwork: f,
          rebar: r,
          total: c + f + r,
        }
      }),
    [totalAnalysisByDongWithScope]
  )

  const donutDataForSelectedDong = useMemo(() => {
    const effectiveDong =
      totalAnalysisByDongWithScope.some((d) => d.dong === selectedDongForTotal)
        ? selectedDongForTotal
        : (totalAnalysisByDongWithScope[0]?.dong ?? '')
    const current = totalAnalysisByDongWithScope.find((d) => d.dong === effectiveDong)
    if (!current) return []
    const c = current.ground.total.concrete + current.basement.total.concrete
    const f = current.ground.total.formwork + current.basement.total.formwork
    const r = current.ground.total.rebar + current.basement.total.rebar
    return [
      { name: '콘크리트', value: c, key: 'concrete' },
      { name: '거푸집', value: f, key: 'formwork' },
      { name: '철근', value: r, key: 'rebar' },
    ].filter((d) => d.value > 0)
  }, [totalAnalysisByDongWithScope, selectedDongForTotal])

  const heatmapData = useMemo(() => {
    // floor-index 매핑
    const floors = Array.from(
      new Set(
        rows
          .map((r) => (r.floor ?? '').trim())
          .filter((f) => f)
      )
    ).sort((a, b) => a.localeCompare(b, 'ko'))
    const dongs = dongOptions
    const valueByKey = new Map<string, number>()
    const addValue = (dong: string, floor: string, val: number) => {
      const key = `${dong}\t${floor}`
      valueByKey.set(key, (valueByKey.get(key) || 0) + val)
    }
    for (const r of rows) {
      const dong = (r.dong ?? '').trim()
      const floor = (r.floor ?? '').trim()
      if (!dong || !floor) continue
      if (heatmapScope === 'ground' && !isAboveGroundFloor(r.floor)) continue
      if (heatmapScope === 'basement' && !isBasementFloor(r.floor)) continue
      const key = rowKey(r)
      const rowData = data[key]
      if (!rowData) continue
      let v = 0
      if (heatmapMaterial === 'concrete') {
        for (const s of concreteColumns) v += rowData.concrete[s] || 0
      } else if (heatmapMaterial === 'formwork') {
        for (const s of formworkColumns) v += rowData.formwork[s] || 0
      } else {
        for (const s of rebarColumns) v += rowData.rebar[s] || 0
      }
      addValue(dong, floor, v)
    }
    const result: { dong: string; floor: string; xIndex: number; yIndex: number; value: number }[] = []
    dongs.forEach((dong, y) => {
      floors.forEach((floor, x) => {
        const key = `${dong}\t${floor}`
        const value = valueByKey.get(key) || 0
        if (value > 0) {
          result.push({ dong, floor, xIndex: x, yIndex: y, value })
        }
      })
    })
    return { floors, dongs, points: result }
  }, [rows, data, concreteColumns, formworkColumns, rebarColumns, dongOptions, heatmapMaterial, heatmapScope])

  const floorChartData = useMemo(() => {
    const map = new Map<
      string,
      { floor: string; concrete: number; formwork: number; rebar: number }
    >()
    for (const r of filteredFloorRows) {
      const rawFloor = (r.floor ?? '').trim()
      const floor = rawFloor || '—'
      const key = floor
      const rowData = data[rowKey(r)]
      if (!rowData) continue
      let entry = map.get(key)
      if (!entry) {
        entry = { floor, concrete: 0, formwork: 0, rebar: 0 }
        map.set(key, entry)
      }
      for (const s of concreteColumns) entry.concrete += rowData.concrete[s] || 0
      for (const s of formworkColumns) entry.formwork += rowData.formwork[s] || 0
      for (const s of rebarColumns) entry.rebar += rowData.rebar[s] || 0
    }
    return Array.from(map.values()).sort((a, b) => a.floor.localeCompare(b.floor, 'ko'))
  }, [filteredFloorRows, data, concreteColumns, formworkColumns, rebarColumns])

  const floorItemChartData = useMemo(() => {
    const map = new Map<string, { floor: string }>()
    const itemTypesSet = new Set<string>()
    const cols =
      floorItemMaterial === 'concrete'
        ? concreteColumns
        : floorItemMaterial === 'formwork'
          ? formworkColumns
          : rebarColumns

    for (const r of filteredItemTypeRows) {
      const rawFloor = (r.floor ?? '').trim()
      const floor = rawFloor || '—'
      const itemType = (r.item_type ?? '').trim() || '—'
      const key = floor

      const rowData = itemTypeData[itemTypeRowKey(r)]
      if (!rowData) continue

      let entry = map.get(key)
      if (!entry) {
        entry = { floor }
        map.set(key, entry)
      }

      let sum = 0
      if (floorItemMaterial === 'concrete') {
        for (const s of cols) sum += rowData.concrete[s] || 0
      } else if (floorItemMaterial === 'formwork') {
        for (const s of cols) sum += rowData.formwork[s] || 0
      } else {
        for (const s of cols) sum += rowData.rebar[s] || 0
      }

      entry[itemType] = (entry[itemType] || 0) + sum
      itemTypesSet.add(itemType)
    }

    const itemTypes = Array.from(itemTypesSet).sort((a, b) => a.localeCompare(b, 'ko'))
    const dataArr = Array.from(map.values()).sort((a, b) => a.floor.localeCompare(b.floor, 'ko'))
    return { data: dataArr, itemTypes }
  }, [filteredItemTypeRows, itemTypeData, concreteColumns, formworkColumns, rebarColumns, floorItemMaterial])

  /** 층별집계표 엑셀 내보내기 */
  const handleExportFloorExcel = useCallback(() => {
    const header1 = ['동', '층', ...(concreteColumns.length > 0 ? ['콘크리트(m³)', ...concreteColumns.map(() => ''), '소계'] : []), ...(formworkColumns.length > 0 ? ['거푸집(m²)', ...formworkColumns.map(() => ''), '소계'] : []), ...(rebarColumns.length > 0 ? ['철근(ton)', ...rebarColumns.map(() => ''), '소계'] : [])]
    const header2 = ['', '', ...(concreteColumns.length > 0 ? ['', ...concreteColumns, ''] : []), ...(formworkColumns.length > 0 ? ['', ...formworkColumns, ''] : []), ...(rebarColumns.length > 0 ? ['', ...rebarColumns, ''] : [])]
    const aoa: (string | number)[][] = [
      ['층별집계표'],
      [],
      header1,
      header2,
    ]
    const targetRows = filteredFloorRows
    for (const r of targetRows) {
      const key = rowKey(r)
      const rowData = data[key] || { concrete: {}, formwork: {}, rebar: {} }
      let subC = 0, subF = 0, subR = 0
      for (const s of concreteColumns) subC += rowData.concrete[s] || 0
      for (const s of formworkColumns) subF += rowData.formwork[s] || 0
      for (const s of rebarColumns) subR += rowData.rebar[s] || 0
      aoa.push([
        r.dong ?? '—',
        r.floor ?? '—',
        ...(concreteColumns.length > 0 ? [...concreteColumns.map((spec) => rowData.concrete[spec] ?? 0), subC] : []),
        ...(formworkColumns.length > 0 ? [...formworkColumns.map((spec) => rowData.formwork[spec] ?? 0), subF] : []),
        ...(rebarColumns.length > 0 ? [...rebarColumns.map((spec) => rowData.rebar[spec] ?? 0), subR] : []),
      ])
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const nConcrete = concreteColumns.length ? concreteColumns.length + 2 : 0
    const nFormwork = formworkColumns.length ? formworkColumns.length + 2 : 0
    const nRebar = rebarColumns.length ? rebarColumns.length + 2 : 0
    const colWidths = [
      10, 14,
      ...Array(nConcrete).fill(12),
      ...Array(nFormwork).fill(12),
      ...Array(nRebar).fill(12),
    ]
    styleExcelSheet(ws, { colWidths, mergeTitleRows: 1, numberFormat: '#,##0.00' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '층별집계표')
    XLSX.writeFile(wb, `층별집계표_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filteredFloorRows, data, concreteColumns, formworkColumns, rebarColumns])

  /** 층-부재별집계표 엑셀 내보내기 */
  const handleExportFloorItemExcel = useCallback(() => {
    const header1 = ['동', '층', '부재유형', ...(concreteColumns.length > 0 ? ['콘크리트(m²)', ...concreteColumns.map(() => ''), '소계'] : []), ...(formworkColumns.length > 0 ? ['거푸집(m²)', ...formworkColumns.map(() => ''), '소계'] : []), ...(rebarColumns.length > 0 ? ['철근(ton)', ...rebarColumns.map(() => ''), '소계'] : [])]
    const header2 = ['', '', '', ...(concreteColumns.length > 0 ? ['', ...concreteColumns, ''] : []), ...(formworkColumns.length > 0 ? ['', ...formworkColumns, ''] : []), ...(rebarColumns.length > 0 ? ['', ...rebarColumns, ''] : [])]
    const aoa: (string | number)[][] = [
      ['층-부재별집계표'],
      [],
      header1,
      header2,
    ]
    const targetRows = filteredItemTypeRows
    for (const r of targetRows) {
      const key = itemTypeRowKey(r)
      const rowData = itemTypeData[key] || { concrete: {}, formwork: {}, rebar: {} }
      let subC = 0, subF = 0, subR = 0
      for (const s of concreteColumns) subC += rowData.concrete[s] || 0
      for (const s of formworkColumns) subF += rowData.formwork[s] || 0
      for (const s of rebarColumns) subR += rowData.rebar[s] || 0
      aoa.push([
        r.dong ?? '—',
        r.floor ?? '—',
        r.item_type ?? '—',
        ...(concreteColumns.length > 0 ? [...concreteColumns.map((spec) => rowData.concrete[spec] ?? 0), subC] : []),
        ...(formworkColumns.length > 0 ? [...formworkColumns.map((spec) => rowData.formwork[spec] ?? 0), subF] : []),
        ...(rebarColumns.length > 0 ? [...rebarColumns.map((spec) => rowData.rebar[spec] ?? 0), subR] : []),
      ])
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const nConcrete = concreteColumns.length ? concreteColumns.length + 2 : 0
    const nFormwork = formworkColumns.length ? formworkColumns.length + 2 : 0
    const nRebar = rebarColumns.length ? rebarColumns.length + 2 : 0
    const colWidths = [
      10, 14, 14,
      ...Array(nConcrete).fill(12),
      ...Array(nFormwork).fill(12),
      ...Array(nRebar).fill(12),
    ]
    styleExcelSheet(ws, { colWidths, mergeTitleRows: 1, numberFormat: '#,##0.00' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '층-부재별집계표')
    XLSX.writeFile(wb, `층-부재별집계표_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filteredItemTypeRows, itemTypeData, concreteColumns, formworkColumns, rebarColumns])

  /** 총괄분석표 엑셀 내보내기 (선택 동 기준 지상/지하) */
  const handleExportTotalExcel = useCallback(() => {
    const effectiveDong = totalAnalysisByDongWithScope.some((d) => d.dong === selectedDongForTotal) ? selectedDongForTotal : (totalAnalysisByDongWithScope[0]?.dong ?? '')
    const current = totalAnalysisByDongWithScope.find((d) => d.dong === effectiveDong)
    if (!current) return
    const dong = current.dong
    const grossArea = dongList.find((x) => (x.dong_value || '').trim() === dong)?.gross_area
    const pyeong = grossArea != null && grossArea > 0 ? grossArea / M2_PER_PYEONG : null
    const allItemTypes = (() => {
      const set = new Set<string>()
      current.ground.byItem.forEach((r) => set.add(r.item_type))
      current.basement.byItem.forEach((r) => set.add(r.item_type))
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
    })()
    const colHeaders = ['구분', '콘크리트(m³) 수량', '콘크리트(%)', '거푸집(m²) 수량', '거푸집(%)', '철근(ton) 수량', '철근(%)', '비고']
    const buildBlockRows = (scope: 'ground' | 'basement') => {
      const block = scope === 'ground' ? current.ground : current.basement
      const { total, byItem } = block
      const tc = total.concrete
      const tf = total.formwork
      const tr = total.rebar
      const byItemMap = new Map(byItem.map((r) => [r.item_type, r]))
      const rows: (string | number)[][] = [
        ['총물량', tc, 100, tf, 100, tr, 100, ''],
        ['연면적(m²)', grossArea != null && Number.isFinite(grossArea) ? grossArea : '—', '—', '—', '—', '—', '—', ''],
        ['평당', pyeong != null && pyeong > 0 ? tc / pyeong : '—', '—', pyeong != null && pyeong > 0 ? tf / pyeong : '—', '—', pyeong != null && pyeong > 0 ? tr / pyeong : '—', '—', ''],
        ['콘크리트', tc, 100, '—', '—', '—', '—', ''],
      ]
      for (const itemType of allItemTypes) {
        const row = byItemMap.get(itemType)
        const c = row?.concrete ?? 0
        const f = row?.formwork ?? 0
        const r = row?.rebar ?? 0
        const pc = tc > 0 ? (c / tc * 100) : 0
        const pf = tf > 0 ? (f / tf * 100) : 0
        const pr = tr > 0 ? (r / tr * 100) : 0
        rows.push([itemType, c, pc, f, pf, r, pr, ''])
      }
      return rows
    }
    const colWidths = [14, 16, 10, 16, 10, 14, 10, 10]
    const wb = XLSX.utils.book_new()
    const wsGround = XLSX.utils.aoa_to_sheet([
      ['산출집계(' + (dong || '—') + ') - 지상'],
      [],
      colHeaders,
      ...buildBlockRows('ground'),
    ])
    const wsBasement = XLSX.utils.aoa_to_sheet([
      ['산출집계(' + (dong || '—') + ') - 지하'],
      [],
      colHeaders,
      ...buildBlockRows('basement'),
    ])
    styleExcelSheet(wsGround, { colWidths, mergeTitleRows: 1, numberFormat: '#,##0.00' })
    styleExcelSheet(wsBasement, { colWidths, mergeTitleRows: 1, numberFormat: '#,##0.00' })
    XLSX.utils.book_append_sheet(wb, wsGround, '지상')
    XLSX.utils.book_append_sheet(wb, wsBasement, '지하')
    XLSX.writeFile(wb, `총괄분석표_${(dong || '전체').replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [totalAnalysisByDongWithScope, selectedDongForTotal, dongList])

  if (!selectedProject) {
    return (
      <section className="card quantity-summary-page">
        <h2 className="quantity-summary-page__title-hidden">물량집계표</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          물량집계표는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
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
      <section className="card quantity-summary-page">
        <h2 className="quantity-summary-page__title-hidden">물량집계표</h2>
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
      <section className="card quantity-summary-page">
        <h2 className="quantity-summary-page__title-hidden">물량집계표</h2>
        <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          프로젝트: <strong>{selectedProject.name}</strong> · 설계 차수: <strong>{selectedPhase?.name ?? '선택됨'}</strong>
        </p>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단 헤더에서 <strong>리비전</strong>을 선택하면 해당 리비전 기준 물량집계표를 조회할 수 있습니다.
        </p>
      </section>
    )
  }

  return (
    <section className="card quantity-summary-page">
      <h2 className="quantity-summary-page__title-hidden">물량집계표</h2>

      <div style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
        <nav className="quantity-summary__tabs" style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }} aria-label="집계표 종류">
          <NavLink
            to="/quantity/summary/floor"
            className={() => `btn btn--secondary quantity-summary__tab ${viewMode === 'floor' ? 'quantity-summary__tab--active' : ''}`}
          >
            층별집계표
          </NavLink>
          <NavLink
            to="/quantity/summary/floor-item"
            className={() => `btn btn--secondary quantity-summary__tab ${viewMode === 'floor-item' ? 'quantity-summary__tab--active' : ''}`}
          >
            층-부재별집계표
          </NavLink>
          <NavLink
            to="/quantity/summary/total"
            className={() => `btn btn--secondary quantity-summary__tab ${viewMode === 'total' ? 'quantity-summary__tab--active' : ''}`}
          >
            총괄분석표
          </NavLink>
        </nav>
      </div>

      {error && (
        <p className="auth-form__error" style={{ marginBottom: '1rem' }}>{error}</p>
      )}

      {viewMode === 'total' ? (
        loading ? (
          <p style={{ color: 'var(--main-text-muted)' }}>집계 데이터를 불러오는 중…</p>
        ) : totalAnalysisByDong.length === 0 && rows.length === 0 && itemTypeRows.length === 0 ? (
          <p style={{ color: 'var(--main-text-muted)' }}>
            해당 리비전에 등록된 물량 데이터가 없습니다. 물량파일 등록 후 조회할 수 있습니다.
          </p>
        ) : (
          <div className="quantity-summary-total">
            <div
              className="quantity-summary-total__toolbar"
              style={{
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label htmlFor="quantity-total-dong-select" style={{ fontWeight: 500 }}>
                    동 선택
                  </label>
                  <select
                    id="quantity-total-dong-select"
                    value={
                      totalAnalysisByDongWithScope.some((d) => d.dong === selectedDongForTotal)
                        ? selectedDongForTotal
                        : (totalAnalysisByDongWithScope[0]?.dong ?? '')
                    }
                    onChange={(e) => setSelectedDongForTotal(e.target.value)}
                    className="form-control"
                    style={{ minWidth: 160 }}
                  >
                    {totalAnalysisByDongWithScope.map(({ dong }) => (
                      <option key={dong} value={dong}>
                        {dong || '—'}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {(['all', 'concrete', 'formwork', 'rebar'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`btn btn--secondary btn--sm ${
                        totalChartMode === mode ? 'quantity-summary__tab--active' : ''
                      }`}
                      onClick={() => setTotalChartMode(mode)}
                    >
                      {mode === 'all'
                        ? '전체'
                        : mode === 'concrete'
                          ? '콘크리트'
                          : mode === 'formwork'
                            ? '거푸집'
                            : '철근'}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => setTotalChartStack((v) => !v)}
                    title="막대 정렬 방식 전환"
                  >
                    {totalChartStack ? '스택' : '그룹'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setShowTotalChart((v) => !v)}
                  title={showTotalChart ? '차트 숨기기' : '차트 보기'}
                  aria-label={showTotalChart ? '차트 숨기기' : '차트 보기'}
                >
                  <span aria-hidden="true">📊</span>
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setGrossAreaModalOpen(true)}
                >
                  연면적
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleRefreshTotal}
                  disabled={loading || !selectedRevisionId}
                >
                  {loading ? '새로고침 중…' : '새로고침'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleExportTotalExcel}
                  disabled={loading || totalAnalysisByDongWithScope.length === 0}
                >
                  엑셀 내보내기
                </button>
              </div>
            </div>
            <div
              className="quantity-summary-total__tables"
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'stretch' }}
            >
              {showTotalChart && (
                <section
                  className="card"
                  style={{ width: '100%' }}
                >
                  <h2 style={{ marginBottom: '0.25rem' }}>동별 물량 개요</h2>
                  <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                    지상·지하 각각에 대한 동별 콘크리트·거푸집·철근 물량을 비교합니다.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: '0.75rem', height: 260 }}>
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <h3 style={{ margin: 0, marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                        지상
                      </h3>
                      {totalGroundChartData.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: 'var(--main-text-muted)' }}>표시할 데이터가 없습니다.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={totalGroundChartData}
                            margin={{ top: 4, right: 8, left: 0, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="dong" />
                            <YAxis />
                            <RechartsTooltip />
                            <RechartsLegend
                              verticalAlign="top"
                              align="right"
                              content={() => (
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: '0.75rem',
                                    fontSize: '0.8rem',
                                    paddingTop: '0.25rem',
                                    justifyContent: 'flex-end',
                                  }}
                                >
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowConcrete}
                                      onChange={(e) => setTotalShowConcrete(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#0ea5e9', borderRadius: 2 }} />
                                      콘크리트
                                    </span>
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowFormwork}
                                      onChange={(e) => setTotalShowFormwork(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#22c55e', borderRadius: 2 }} />
                                      거푸집
                                    </span>
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowRebar}
                                      onChange={(e) => setTotalShowRebar(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#f97316', borderRadius: 2 }} />
                                      철근
                                    </span>
                                  </label>
                                </div>
                              )}
                            />
                            {totalShowConcrete && (totalChartMode === 'all' || totalChartMode === 'concrete') && (
                              <Bar
                                dataKey="concrete"
                                name="콘크리트"
                                stackId={totalChartStack ? 'ground' : undefined}
                                fill="#0ea5e9"
                                radius={totalChartStack ? [4, 4, 0, 0] : [4, 4, 4, 4]}
                              />
                            )}
                            {totalShowFormwork && (totalChartMode === 'all' || totalChartMode === 'formwork') && (
                              <Bar
                                dataKey="formwork"
                                name="거푸집"
                                stackId={totalChartStack ? 'ground' : undefined}
                                fill="#22c55e"
                              />
                            )}
                            {totalShowRebar && (totalChartMode === 'all' || totalChartMode === 'rebar') && (
                              <Bar
                                dataKey="rebar"
                                name="철근"
                                stackId={totalChartStack ? 'ground' : undefined}
                                fill="#f97316"
                                radius={totalChartStack ? [0, 0, 4, 4] : [4, 4, 4, 4]}
                              />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <h3 style={{ margin: 0, marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                        지하
                      </h3>
                      {totalBasementChartData.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: 'var(--main-text-muted)' }}>표시할 데이터가 없습니다.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={totalBasementChartData}
                            margin={{ top: 4, right: 8, left: 0, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="dong" />
                            <YAxis />
                            <RechartsTooltip />
                            <RechartsLegend
                              verticalAlign="top"
                              align="right"
                              content={() => (
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: '0.75rem',
                                    fontSize: '0.8rem',
                                    paddingTop: '0.25rem',
                                    justifyContent: 'flex-end',
                                  }}
                                >
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowConcrete}
                                      onChange={(e) => setTotalShowConcrete(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#0ea5e9', borderRadius: 2 }} />
                                      콘크리트
                                    </span>
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowFormwork}
                                      onChange={(e) => setTotalShowFormwork(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#22c55e', borderRadius: 2 }} />
                                      거푸집
                                    </span>
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                                    <input
                                      type="checkbox"
                                      checked={totalShowRebar}
                                      onChange={(e) => setTotalShowRebar(e.target.checked)}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: '#f97316', borderRadius: 2 }} />
                                      철근
                                    </span>
                                  </label>
                                </div>
                              )}
                            />
                            {totalShowConcrete && (totalChartMode === 'all' || totalChartMode === 'concrete') && (
                              <Bar
                                dataKey="concrete"
                                name="콘크리트"
                                stackId={totalChartStack ? 'basement' : undefined}
                                fill="#0ea5e9"
                                radius={totalChartStack ? [4, 4, 0, 0] : [4, 4, 4, 4]}
                              />
                            )}
                            {totalShowFormwork && (totalChartMode === 'all' || totalChartMode === 'formwork') && (
                              <Bar
                                dataKey="formwork"
                                name="거푸집"
                                stackId={totalChartStack ? 'basement' : undefined}
                                fill="#22c55e"
                              />
                            )}
                            {totalShowRebar && (totalChartMode === 'all' || totalChartMode === 'rebar') && (
                              <Bar
                                dataKey="rebar"
                                name="철근"
                                stackId={totalChartStack ? 'basement' : undefined}
                                fill="#f97316"
                                radius={totalChartStack ? [0, 0, 4, 4] : [4, 4, 4, 4]}
                              />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </section>
              )}
              {(() => {
                const effectiveDong =
                  totalAnalysisByDongWithScope.some((d) => d.dong === selectedDongForTotal)
                    ? selectedDongForTotal
                    : (totalAnalysisByDongWithScope[0]?.dong ?? '')
                const current = totalAnalysisByDongWithScope.find((d) => d.dong === effectiveDong)
                if (!current) return null
                const { dong } = current
                const grossArea = dongList.find((x) => (x.dong_value || '').trim() === dong)?.gross_area
                const pyeong = grossArea != null && grossArea > 0 ? grossArea / M2_PER_PYEONG : null

                const allItemTypes = (() => {
                  const set = new Set<string>()
                  current.ground.byItem.forEach((r) => set.add(r.item_type))
                  current.basement.byItem.forEach((r) => set.add(r.item_type))
                  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
                })()

                const renderBlock = (scope: 'ground' | 'basement', label: string) => {
                  const block = scope === 'ground' ? current.ground : current.basement
                  const { total, byItem } = block
                  const byItemMap = new Map(byItem.map((r) => [r.item_type, r]))
                  const tc = total.concrete
                  const tf = total.formwork
                  const tr = total.rebar
                  return (
                    <div key={scope} className="quantity-summary-total__table-wrap" style={{ flex: '1 1 320px', minWidth: 320, border: '1px solid var(--main-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                      <div style={{ padding: '0.5rem 0.75rem', fontWeight: 600, borderBottom: '1px solid var(--main-border)', background: 'var(--main-surface)' }}>
                        산출집계({dong || '—'}) - {label}
                      </div>
                      <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ marginTop: 0, maxHeight: 'min(60vh, 500px)', overflow: 'auto' }}>
                        <table className="project-mgmt__table design-doc__table" style={{ width: '100%', minWidth: 400 }}>
                          <thead>
                            <tr>
                              <th style={{ width: '28%', borderBottom: '1px solid var(--main-border)' }}>구분</th>
                              <th colSpan={2} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>콘크리트(m³)</th>
                              <th colSpan={2} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>거푸집(m²)</th>
                              <th colSpan={2} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>철근(ton)</th>
                              <th style={{ width: '10%', borderBottom: '1px solid var(--main-border)' }}>비고</th>
                            </tr>
                            <tr>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }} />
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>수량</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>%</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>수량</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>%</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>수량</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem', textAlign: 'right' }}>%</th>
                              <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }} />
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ padding: '0.35rem 0.75rem', paddingLeft: '1.5rem', borderBottom: '1px solid var(--main-border)' }}>총물량</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(tc)}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>100</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(tf)}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>100</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(tr)}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>100</td>
                              <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }} />
                            </tr>
                            <tr>
                              <td style={{ padding: '0.35rem 0.75rem', paddingLeft: '1.5rem', borderBottom: '1px solid var(--main-border)' }}>연면적(m²)</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{grossArea != null && Number.isFinite(grossArea) ? formatNum(grossArea) : '—'}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }} />
                            </tr>
                            <tr>
                              <td style={{ padding: '0.35rem 0.75rem', paddingLeft: '1.5rem', borderBottom: '1px solid var(--main-border)' }}>평당</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{pyeong != null && pyeong > 0 ? formatNum(tc / pyeong) : '—'}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{pyeong != null && pyeong > 0 ? formatNum(tf / pyeong) : '—'}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{pyeong != null && pyeong > 0 ? formatNum(tr / pyeong) : '—'}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }} />
                            </tr>
                            <tr>
                              <td style={{ padding: '0.35rem 0.75rem', paddingLeft: '1.5rem', borderBottom: '1px solid var(--main-border)' }}>콘크리트</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(tc)}</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>100</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>—</td>
                              <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }} />
                            </tr>
                            {allItemTypes.map((itemType) => {
                              const row = byItemMap.get(itemType)
                              const c = row?.concrete ?? 0
                              const f = row?.formwork ?? 0
                              const r = row?.rebar ?? 0
                              const pc = tc > 0 ? (c / tc * 100) : 0
                              const pf = tf > 0 ? (f / tf * 100) : 0
                              const pr = tr > 0 ? (r / tr * 100) : 0
                              return (
                                <tr key={itemType}>
                                  <td style={{ padding: '0.35rem 0.75rem', paddingLeft: '1.5rem', borderBottom: '1px solid var(--main-border)' }}>{itemType}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(c)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(pc)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(f)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(pf)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(r)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', borderBottom: '1px solid var(--main-border)' }}>{formatNum(pr)}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }} />
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
                    {renderBlock('ground', '지상')}
                    {renderBlock('basement', '지하')}
                  </div>
                )
              })()}
            </div>

            {grossAreaModalOpen && (
              <div
                className="modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gross-area-modal-title"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setGrossAreaModalOpen(false)
                    fetchDongsForTotal()
                  }
                }}
              >
                <div className="modal">
                  <div className="modal__header">
                    <h2 id="gross-area-modal-title" className="modal__title">연면적</h2>
                    <button
                      type="button"
                      className="modal__close"
                      onClick={() => {
                        setGrossAreaModalOpen(false)
                        fetchDongsForTotal()
                      }}
                      aria-label="닫기"
                    >
                      ×
                    </button>
                  </div>
                  <div className="modal__body">
                    <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                      등록된 동의 연면적(m²)을 입력·수정합니다. 저장 후 창을 닫으면 총괄분석표에 반영됩니다.
                    </p>
                    {grossAreaModalLoading ? (
                      <p style={{ color: 'var(--main-text-muted)' }}>동 목록을 불러오는 중…</p>
                    ) : grossAreaModalDongs.length === 0 ? (
                      <p style={{ color: 'var(--main-text-muted)' }}>등록된 동이 없습니다. 물량파일 등록 페이지의 동관리에서 동을 등록하세요.</p>
                    ) : (
                      <>
                        <div className="design-doc__table-wrap" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                          <table className="project-mgmt__table design-doc__table" style={{ width: '100%' }}>
                            <thead>
                              <tr>
                                <th style={{ borderBottom: '1px solid var(--main-border)' }}>동</th>
                                <th style={{ borderBottom: '1px solid var(--main-border)', minWidth: '8rem' }}>연면적(m²)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {grossAreaModalDongs.map((d) => (
                                <tr key={d.id}>
                                  <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }}>{d.dong_value ?? '—'}</td>
                                  <td style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--main-border)' }}>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      placeholder="m²"
                                      value={d.gross_area != null && Number.isFinite(d.gross_area) ? d.gross_area : ''}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        const num = v === '' ? null : parseFloat(v)
                                        setGrossAreaModalDongs((prev) =>
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
                                              setGrossAreaModalDongs((prev) => prev.map((x) => (x.id === d.id ? { ...x, gross_area: res.item!.gross_area } : x)))
                                            }
                                          })
                                          .catch(() => {})
                                      }}
                                      style={{ width: '100%', maxWidth: '8rem', padding: '0.25rem 0.35rem', fontSize: '0.875rem' }}
                                      aria-label={`${d.dong_value ?? ''} 연면적`}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={grossAreaSaving || !user?.email}
                            onClick={() => {
                              if (!user?.email) return
                              setGrossAreaSaving(true)
                              Promise.all(
                                grossAreaModalDongs.map((d) =>
                                  updateQuantityDongApi(user.email!, d.id, {
                                    gross_area: d.gross_area != null && Number.isFinite(d.gross_area) ? d.gross_area : null,
                                  })
                                )
                              )
                                .then((results) => {
                                  const updated = results.filter((r): r is { success: true; item: QuantityDong } => r.success && !!r.item)
                                  if (updated.length) {
                                    setGrossAreaModalDongs((prev) =>
                                      prev.map((p) => {
                                        const u = updated.find((r) => r.item.id === p.id)
                                        return u ? { ...p, gross_area: u.item.gross_area } : p
                                      })
                                    )
                                  }
                                })
                                .finally(() => {
                                  setGrossAreaSaving(false)
                                  setGrossAreaModalOpen(false)
                                  fetchDongsForTotal()
                                })
                            }}
                          >
                            {grossAreaSaving ? '저장 중…' : '확인'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      ) : viewMode === 'floor-item' ? (
        loading ? (
          <p style={{ color: 'var(--main-text-muted)' }}>집계 데이터를 불러오는 중…</p>
        ) : itemTypeRows.length === 0 && concreteColumns.length === 0 && formworkColumns.length === 0 && rebarColumns.length === 0 ? (
          <p style={{ color: 'var(--main-text-muted)' }}>
            해당 리비전에 등록된 물량 데이터가 없거나, 명칭·규격 매핑(콘크리트/거푸집/철근)이 없습니다. 물량파일 등록 후 명칭 매핑·규격 관리를 설정하세요.
          </p>
        ) : (
          <>
            <div
              style={{
                marginBottom: '0.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="quantity-floor-item-dong-select" style={{ fontWeight: 500 }}>
                  동 선택
                </label>
                <select
                  id="quantity-floor-item-dong-select"
                  value={selectedDongForFloorItem}
                  onChange={(e) => setSelectedDongForFloorItem(e.target.value)}
                  className="form-control"
                  style={{ minWidth: 160 }}
                >
                  <option value="">전체</option>
                  {dongOptions.map((dong) => (
                    <option key={dong} value={dong}>
                      {dong}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setShowFloorItemChart((v) => !v)}
                  title={showFloorItemChart ? '차트 숨기기' : '차트 보기'}
                  aria-label={showFloorItemChart ? '차트 숨기기' : '차트 보기'}
                >
                  <span aria-hidden="true">📊</span>
                </button>
                <select
                  value={floorItemMaterial}
                  onChange={(e) => setFloorItemMaterial(e.target.value as 'concrete' | 'formwork' | 'rebar')}
                  className="form-control"
                  style={{ minWidth: 110, fontSize: '0.8rem' }}
                  aria-label="재료 선택"
                >
                  <option value="concrete">콘크리트</option>
                  <option value="formwork">거푸집</option>
                  <option value="rebar">철근</option>
                </select>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleExportFloorItemExcel}
                  disabled={filteredItemTypeRows.length === 0}
                >
                  엑셀 내보내기
                </button>
              </div>
            </div>

            {showFloorItemChart && (
              <section className="card" style={{ marginBottom: '0.5rem' }}>
                <h2 style={{ marginBottom: '0.25rem' }}>층-부재별 물량 개요</h2>
                <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                  선택된 동(또는 전체) 기준으로 층·부재유형별{' '}
                  {floorItemMaterial === 'concrete' ? '콘크리트(m³)' : floorItemMaterial === 'formwork' ? '거푸집(m²)' : '철근(ton)'}{' '}
                  물량을 한눈에 봅니다.
                </p>
                <div style={{ height: 260 }}>
                  {floorItemChartData.data.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>표시할 데이터가 없습니다.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={floorItemChartData.data}
                        margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="floor" />
                        <YAxis />
                        <RechartsTooltip />
                        <RechartsLegend
                          verticalAlign="bottom"
                          align="center"
                          content={() => (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '1rem',
                                fontSize: '0.8rem',
                                paddingTop: '0.25rem',
                                flexWrap: 'wrap',
                              }}
                            >
                              {floorItemChartData.itemTypes.map((itemType, index) => {
                                const colors = ['#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#eab308']
                                const fill = colors[index % colors.length]
                                const checked = visibleFloorItemTypes[itemType] ?? true
                                return (
                                  <label
                                    key={itemType}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      color: 'var(--main-text-muted)',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        const next = { ...visibleFloorItemTypes }
                                        next[itemType] = e.target.checked
                                        setVisibleFloorItemTypes(next)
                                      }}
                                    />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span style={{ width: 10, height: 10, background: fill, borderRadius: 2 }} />
                                      {itemType}
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        />
                        {floorItemChartData.itemTypes.map((itemType, index) => {
                          const colors = ['#0ea5e9', '#22c55e', '#f97316', '#a855f7', '#eab308']
                          const fill = colors[index % colors.length]
                          const visible = visibleFloorItemTypes[itemType] ?? true
                          if (!visible) return null
                          return (
                            <Bar
                              key={itemType}
                              dataKey={itemType}
                              name={itemType}
                              stackId="itemType"
                              fill={fill}
                            />
                          )
                        })}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>
            )}
            <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ marginTop: '0.5rem', width: '100%' }}>
            <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>동</th>
                  <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>층</th>
                  <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>부재유형</th>
                  {concreteColumns.length > 0 && (
                    <th colSpan={concreteColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                      콘크리트(m²)
                    </th>
                  )}
                  {formworkColumns.length > 0 && (
                    <th colSpan={formworkColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                      거푸집(m²)
                    </th>
                  )}
                  {rebarColumns.length > 0 && (
                    <th colSpan={rebarColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                      철근(ton)
                    </th>
                  )}
                </tr>
                <tr>
                  {concreteColumns.map((spec) => (
                    <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                  ))}
                  {concreteColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
                  {formworkColumns.map((spec) => (
                    <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                  ))}
                  {formworkColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
                  {rebarColumns.map((spec) => (
                    <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                  ))}
                  {rebarColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItemTypeRows.map((r) => {
                  const key = itemTypeRowKey(r)
                  const rowData = itemTypeData[key] || { concrete: {}, formwork: {}, rebar: {} }
                  let subConcrete = 0
                  for (const spec of concreteColumns) subConcrete += rowData.concrete[spec] || 0
                  let subFormwork = 0
                  for (const spec of formworkColumns) subFormwork += rowData.formwork[spec] || 0
                  let subRebar = 0
                  for (const spec of rebarColumns) subRebar += rowData.rebar[spec] || 0
                  return (
                    <tr key={key}>
                      <td>{r.dong ?? '—'}</td>
                      <td>{r.floor ?? '—'}</td>
                      <td>{r.item_type ?? '—'}</td>
                      {concreteColumns.map((spec) => (
                        <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.concrete[spec] || 0)}</td>
                      ))}
                      {concreteColumns.length > 0 && (
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subConcrete)}</td>
                      )}
                      {formworkColumns.map((spec) => (
                        <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.formwork[spec] || 0)}</td>
                      ))}
                      {formworkColumns.length > 0 && (
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subFormwork)}</td>
                      )}
                      {rebarColumns.map((spec) => (
                        <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.rebar[spec] || 0)}</td>
                      ))}
                      {rebarColumns.length > 0 && (
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subRebar)}</td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )
      ) : loading ? (
        <p style={{ color: 'var(--main-text-muted)' }}>집계 데이터를 불러오는 중…</p>
      ) : rows.length === 0 && concreteColumns.length === 0 && formworkColumns.length === 0 && rebarColumns.length === 0 ? (
        <p style={{ color: 'var(--main-text-muted)' }}>
          해당 리비전에 등록된 물량 데이터가 없거나, 명칭·규격 매핑(콘크리트/거푸집/철근)이 없습니다. 물량파일 등록 후 명칭 매핑·규격 관리를 설정하세요.
        </p>
      ) : (
        <>
          <div
            style={{
              marginBottom: '0.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label htmlFor="quantity-floor-dong-select" style={{ fontWeight: 500 }}>
                동 선택
              </label>
              <select
                id="quantity-floor-dong-select"
                value={selectedDongForFloor}
                onChange={(e) => setSelectedDongForFloor(e.target.value)}
                className="form-control"
                style={{ minWidth: 160 }}
              >
                <option value="">전체</option>
                {dongOptions.map((dong) => (
                  <option key={dong} value={dong}>
                    {dong}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setShowFloorChart((v) => !v)}
                title={showFloorChart ? '차트 숨기기' : '차트 보기'}
                aria-label={showFloorChart ? '차트 숨기기' : '차트 보기'}
              >
                <span aria-hidden="true">📊</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleExportFloorExcel}
                disabled={filteredFloorRows.length === 0}
              >
                엑셀 내보내기
              </button>
            </div>
          </div>

          {showFloorChart && (
            <section className="card" style={{ marginBottom: '0.5rem' }}>
              <h2 style={{ marginBottom: '0.25rem' }}>층별 물량 개요</h2>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                선택된 동(또는 전체) 기준으로 층별 콘크리트·거푸집·철근 물량을 한눈에 봅니다.
              </p>
              <div style={{ height: 260 }}>
                {floorChartData.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>표시할 데이터가 없습니다.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={floorChartData}
                      margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="floor" />
                      <YAxis />
                      <RechartsTooltip />
                      <RechartsLegend
                        verticalAlign="bottom"
                        align="center"
                        content={() => (
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'center',
                              gap: '1rem',
                              fontSize: '0.8rem',
                              paddingTop: '0.25rem',
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                              <input
                                type="checkbox"
                                checked={showFloorConcrete}
                                onChange={(e) => setShowFloorConcrete(e.target.checked)}
                              />
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span style={{ width: 10, height: 10, background: '#0ea5e9', borderRadius: 2 }} />
                                콘크리트
                              </span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                              <input
                                type="checkbox"
                                checked={showFloorFormwork}
                                onChange={(e) => setShowFloorFormwork(e.target.checked)}
                              />
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span style={{ width: 10, height: 10, background: '#22c55e', borderRadius: 2 }} />
                                거푸집
                              </span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--main-text-muted)' }}>
                              <input
                                type="checkbox"
                                checked={showFloorRebar}
                                onChange={(e) => setShowFloorRebar(e.target.checked)}
                              />
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span style={{ width: 10, height: 10, background: '#f97316', borderRadius: 2 }} />
                                철근
                              </span>
                            </label>
                          </div>
                        )}
                      />
                      {showFloorConcrete && (
                        <Bar dataKey="concrete" name="콘크리트" stackId="total" fill="#0ea5e9" />
                      )}
                      {showFloorFormwork && (
                        <Bar dataKey="formwork" name="거푸집" stackId="total" fill="#22c55e" />
                      )}
                      {showFloorRebar && (
                        <Bar dataKey="rebar" name="철근" stackId="total" fill="#f97316" />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          )}

          <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ marginTop: '0.5rem', width: '100%' }}>
          <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>동</th>
                <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>층</th>
                {concreteColumns.length > 0 && (
                  <th colSpan={concreteColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                    콘크리트(m²)
                  </th>
                )}
                {formworkColumns.length > 0 && (
                  <th colSpan={formworkColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                    거푸집(m²)
                  </th>
                )}
                {rebarColumns.length > 0 && (
                  <th colSpan={rebarColumns.length + 1} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>
                    철근(ton)
                  </th>
                )}
              </tr>
              <tr>
                {concreteColumns.map((spec) => (
                  <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                ))}
                {concreteColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
                {formworkColumns.map((spec) => (
                  <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                ))}
                {formworkColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
                {rebarColumns.map((spec) => (
                  <th key={spec} style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>{spec}</th>
                ))}
                {rebarColumns.length > 0 && <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>소계</th>}
              </tr>
            </thead>
            <tbody>
              {filteredFloorRows.map((r) => {
                const key = rowKey(r)
                const rowData = data[key] || { concrete: {}, formwork: {}, rebar: {} }
                let subConcrete = 0
                for (const spec of concreteColumns) subConcrete += rowData.concrete[spec] || 0
                let subFormwork = 0
                for (const spec of formworkColumns) subFormwork += rowData.formwork[spec] || 0
                let subRebar = 0
                for (const spec of rebarColumns) subRebar += rowData.rebar[spec] || 0
                return (
                  <tr key={key}>
                    <td>{r.dong ?? '—'}</td>
                    <td>{r.floor ?? '—'}</td>
                    {concreteColumns.map((spec) => (
                      <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.concrete[spec] || 0)}</td>
                    ))}
                    {concreteColumns.length > 0 && (
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subConcrete)}</td>
                    )}
                    {formworkColumns.map((spec) => (
                      <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.formwork[spec] || 0)}</td>
                    ))}
                    {formworkColumns.length > 0 && (
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subFormwork)}</td>
                    )}
                    {rebarColumns.map((spec) => (
                      <td key={spec} style={{ textAlign: 'right' }}>{formatNum(rowData.rebar[spec] || 0)}</td>
                    ))}
                    {rebarColumns.length > 0 && (
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNum(subRebar)}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  )
}
