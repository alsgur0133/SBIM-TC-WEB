import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import { useProject } from '../contexts/ProjectContext'
import { getRevisionsApi } from '../api/designSchedule'
import type { DesignRevision } from '../api/designSchedule'
import {
  getQuantitySummaryApi,
  type QuantitySummaryRow,
  type QuantitySummaryItemTypeRow,
  type QuantitySummaryData,
} from '../api/quantityFile'

function sumCategory(row: QuantitySummaryData, concreteCols: string[], formworkCols: string[], rebarCols: string[]) {
  let c = 0
  let f = 0
  let r = 0
  for (const s of concreteCols) c += row.concrete[s] || 0
  for (const s of formworkCols) f += row.formwork[s] || 0
  for (const s of rebarCols) r += row.rebar[s] || 0
  return { concrete: c, formwork: f, rebar: r }
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n === Math.floor(n)) return String(n)
  return n.toFixed(2)
}

function formatDiff(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const s = n > 0 ? `+${n}` : String(n)
  return n === Math.floor(n) ? s : (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2))
}

function diffColor(n: number): string | undefined {
  if (!Number.isFinite(n) || n === 0) return undefined
  return n > 0 ? '#dc2626' : '#2563eb' // plus: red, minus: blue
}

type CompareTab = 'floor' | 'floor-item'

export default function QuantityCompare() {
  const { selectedProject } = useProject()
  const { phases, loadingPhases, fetchPhases, selectedPhaseId, selectedRevisionId, selectedPhase, selectedRevision } = useDesignSchedule()

  const phaseAId = selectedPhaseId ?? ''
  const revisionAId = selectedRevisionId ?? ''
  const [phaseBId, setPhaseBId] = useState('')
  const [revisionBId, setRevisionBId] = useState('')
  const [revisionsB, setRevisionsB] = useState<DesignRevision[]>([])
  const [compareTab, setCompareTab] = useState<CompareTab>('floor')

  const [summaryA, setSummaryA] = useState<{
    rows: QuantitySummaryRow[]
    data: Record<string, QuantitySummaryData>
    itemTypeRows: QuantitySummaryItemTypeRow[]
    itemTypeData: Record<string, QuantitySummaryData>
    concreteColumns: string[]
    formworkColumns: string[]
    rebarColumns: string[]
  } | null>(null)
  const [summaryB, setSummaryB] = useState<typeof summaryA>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailFloor, setDetailFloor] = useState<{ dong: string; floor: string } | null>(null)
  const [detailSelectedMaterialSpec, setDetailSelectedMaterialSpec] = useState<{ material: string; spec: string } | null>(null)

  useEffect(() => {
    if (!selectedProject) return
    fetchPhases()
  }, [selectedProject, fetchPhases])

  useEffect(() => {
    if (!phaseBId) {
      setRevisionsB([])
      setRevisionBId('')
      return
    }
    getRevisionsApi(phaseBId).then((res) => {
      if (res.success && res.revisions) {
        setRevisionsB(res.revisions)
        setRevisionBId('')
      } else {
        setRevisionsB([])
        setRevisionBId('')
      }
    }).catch(() => {
      setRevisionsB([])
      setRevisionBId('')
    })
  }, [phaseBId])

  const canCompare = Boolean(
    revisionAId && revisionBId && (phaseAId !== phaseBId || revisionAId !== revisionBId)
  )

  const loadBoth = useCallback(() => {
    if (!canCompare) {
      setSummaryA(null)
      setSummaryB(null)
      return
    }
    setLoading(true)
    setError('')
    Promise.all([getQuantitySummaryApi(revisionAId), getQuantitySummaryApi(revisionBId)])
      .then(([resA, resB]) => {
        if (!resA.success || !resB.success) {
          setError('집계 데이터를 불러오지 못했습니다.')
          setSummaryA(null)
          setSummaryB(null)
          return
        }
        setSummaryA({
          rows: resA.rows || [],
          data: resA.data || {},
          itemTypeRows: resA.itemTypeRows || [],
          itemTypeData: resA.itemTypeData || {},
          concreteColumns: resA.concreteColumns || [],
          formworkColumns: resA.formworkColumns || [],
          rebarColumns: resA.rebarColumns || [],
        })
        setSummaryB({
          rows: resB.rows || [],
          data: resB.data || {},
          itemTypeRows: resB.itemTypeRows || [],
          itemTypeData: resB.itemTypeData || {},
          concreteColumns: resB.concreteColumns || [],
          formworkColumns: resB.formworkColumns || [],
          rebarColumns: resB.rebarColumns || [],
        })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '집계 데이터를 불러올 수 없습니다.')
        setSummaryA(null)
        setSummaryB(null)
      })
      .finally(() => setLoading(false))
  }, [revisionAId, revisionBId, canCompare])

  useEffect(() => {
    loadBoth()
  }, [loadBoth])

  const phaseA = selectedPhase ?? null
  const revisionA = selectedRevision ?? null
  const phaseB = useMemo(() => phases.find((p) => p.id === phaseBId) ?? null, [phases, phaseBId])
  const revisionB = useMemo(() => revisionsB.find((r) => r.id === revisionBId) ?? null, [revisionsB, revisionBId])

  const rowKey = (r: QuantitySummaryRow) => (r.dong ?? '') + '\t' + (r.floor ?? '')
  const itemTypeRowKey = (r: QuantitySummaryItemTypeRow) =>
    (r.dong ?? '') + '\t' + (r.floor ?? '') + '\t' + (r.item_type ?? '')

  const floorCompareRows = useMemo(() => {
    if (!summaryA || !summaryB) return []
    const keySet = new Set<string>()
    summaryA.rows.forEach((r) => keySet.add(rowKey(r)))
    summaryB.rows.forEach((r) => keySet.add(rowKey(r)))
    const keys = Array.from(keySet).sort((a, b) => a.localeCompare(b, 'ko'))
    return keys.map((key) => {
      const [dong, floor] = key.split('\t')
      const rowA = summaryA.data[key]
      const rowB = summaryB.data[key]
      const sA = rowA
        ? sumCategory(rowA, summaryA.concreteColumns, summaryA.formworkColumns, summaryA.rebarColumns)
        : { concrete: 0, formwork: 0, rebar: 0 }
      const sB = rowB
        ? sumCategory(rowB, summaryB.concreteColumns, summaryB.formworkColumns, summaryB.rebarColumns)
        : { concrete: 0, formwork: 0, rebar: 0 }
      return {
        dong: dong ?? '—',
        floor: floor ?? '—',
        concreteA: sA.concrete,
        concreteB: sB.concrete,
        concreteDiff: sB.concrete - sA.concrete,
        formworkA: sA.formwork,
        formworkB: sB.formwork,
        formworkDiff: sB.formwork - sA.formwork,
        rebarA: sA.rebar,
        rebarB: sB.rebar,
        rebarDiff: sB.rebar - sA.rebar,
      }
    })
  }, [summaryA, summaryB])

  const floorItemCompareRows = useMemo(() => {
    if (!summaryA || !summaryB) return []
    const keySet = new Set<string>()
    summaryA.itemTypeRows.forEach((r) => keySet.add(itemTypeRowKey(r)))
    summaryB.itemTypeRows.forEach((r) => keySet.add(itemTypeRowKey(r)))
    const keys = Array.from(keySet).sort((a, b) => a.localeCompare(b, 'ko'))
    return keys.map((key) => {
      const parts = key.split('\t')
      const dong = parts[0] ?? '—'
      const floor = parts[1] ?? '—'
      const itemType = parts[2] ?? '—'
      const rowA = summaryA.itemTypeData[key]
      const rowB = summaryB.itemTypeData[key]
      const sA = rowA
        ? sumCategory(rowA, summaryA.concreteColumns, summaryA.formworkColumns, summaryA.rebarColumns)
        : { concrete: 0, formwork: 0, rebar: 0 }
      const sB = rowB
        ? sumCategory(rowB, summaryB.concreteColumns, summaryB.formworkColumns, summaryB.rebarColumns)
        : { concrete: 0, formwork: 0, rebar: 0 }
      return {
        dong,
        floor,
        itemType,
        concreteA: sA.concrete,
        concreteB: sB.concrete,
        concreteDiff: sB.concrete - sA.concrete,
        formworkA: sA.formwork,
        formworkB: sB.formwork,
        formworkDiff: sB.formwork - sA.formwork,
        rebarA: sA.rebar,
        rebarB: sB.rebar,
        rebarDiff: sB.rebar - sA.rebar,
      }
    })
  }, [summaryA, summaryB])

  const getDetailSpecRows = (
    dong: string,
    floor: string
  ): { material: string; spec: string; base: number; compare: number; diff: number }[] => {
    if (!summaryA || !summaryB) return []
    const key = (dong ?? '') + '\t' + (floor ?? '')
    const rowA = summaryA.data[key]
    const rowB = summaryB.data[key]
    if (!rowA && !rowB) return []

    const makeRowsForMaterial = (
      material: 'concrete' | 'formwork' | 'rebar',
      label: string,
      colsA: string[],
      colsB: string[]
    ) => {
      const colSet = new Set<string>()
      colsA.forEach((c) => colSet.add(c))
      colsB.forEach((c) => colSet.add(c))
      const specs = Array.from(colSet)
      const rows: { material: string; spec: string; base: number; compare: number; diff: number }[] = []
      for (const spec of specs) {
        const a =
          material === 'concrete'
            ? rowA?.concrete?.[spec] ?? 0
            : material === 'formwork'
              ? rowA?.formwork?.[spec] ?? 0
              : rowA?.rebar?.[spec] ?? 0
        const b =
          material === 'concrete'
            ? rowB?.concrete?.[spec] ?? 0
            : material === 'formwork'
              ? rowB?.formwork?.[spec] ?? 0
              : rowB?.rebar?.[spec] ?? 0
        if (!a && !b) continue
        rows.push({ material: label, spec, base: a, compare: b, diff: b - a })
      }
      return rows
    }

    const rows: { material: string; spec: string; base: number; compare: number; diff: number }[] = []
    rows.push(
      ...makeRowsForMaterial('concrete', '콘크리트', summaryA.concreteColumns, summaryB.concreteColumns),
      ...makeRowsForMaterial('formwork', '거푸집', summaryA.formworkColumns, summaryB.formworkColumns),
      ...makeRowsForMaterial('rebar', '철근', summaryA.rebarColumns, summaryB.rebarColumns),
    )
    return rows
  }

  /** 상세 비교: 해당 동·층·자재분류·규격에 물량이 있는 부재유형 목록 */
  const getItemTypesForMaterialSpec = (
    dong: string,
    floor: string,
    materialLabel: string,
    spec: string
  ): string[] => {
    if (!summaryA && !summaryB) return []
    const matKey =
      materialLabel === '콘크리트' ? 'concrete' : materialLabel === '거푸집' ? 'formwork' : 'rebar'
    const keyPrefix = (dong ?? '') + '\t' + (floor ?? '') + '\t'
    const itemTypes = new Set<string>()
    for (const r of summaryA?.itemTypeRows ?? []) {
      if ((r.dong ?? '') !== dong || (r.floor ?? '') !== floor) continue
      const it = (r.item_type ?? '').trim() || '—'
      const key = keyPrefix + it
      const dataA = summaryA?.itemTypeData?.[key]
      const dataB = summaryB?.itemTypeData?.[key]
      const valA = matKey === 'concrete' ? dataA?.concrete?.[spec] : matKey === 'formwork' ? dataA?.formwork?.[spec] : dataA?.rebar?.[spec]
      const valB = matKey === 'concrete' ? dataB?.concrete?.[spec] : matKey === 'formwork' ? dataB?.formwork?.[spec] : dataB?.rebar?.[spec]
      if ((valA != null && Number(valA) !== 0) || (valB != null && Number(valB) !== 0)) itemTypes.add(it)
    }
    for (const r of summaryB?.itemTypeRows ?? []) {
      if ((r.dong ?? '') !== dong || (r.floor ?? '') !== floor) continue
      const it = (r.item_type ?? '').trim() || '—'
      const key = keyPrefix + it
      const dataA = summaryA?.itemTypeData?.[key]
      const dataB = summaryB?.itemTypeData?.[key]
      const valA = matKey === 'concrete' ? dataA?.concrete?.[spec] : matKey === 'formwork' ? dataA?.formwork?.[spec] : dataA?.rebar?.[spec]
      const valB = matKey === 'concrete' ? dataB?.concrete?.[spec] : matKey === 'formwork' ? dataB?.formwork?.[spec] : dataB?.rebar?.[spec]
      if ((valA != null && Number(valA) !== 0) || (valB != null && Number(valB) !== 0)) itemTypes.add(it)
    }
    return Array.from(itemTypes).sort((a, b) => a.localeCompare(b, 'ko'))
  }

  if (!selectedProject) {
    return (
      <section className="card quantity-compare-page">
        <h2 className="quantity-summary-page__title-hidden">물량비교</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          물량비교는 <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/projects" className="btn btn--primary">프로젝트 관리에서 선택하기</Link>
        </p>
      </section>
    )
  }

  return (
    <section className="card quantity-compare-page">
      <h2 className="quantity-summary-page__title-hidden">물량비교</h2>
      <p style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
        프로젝트: <strong>{selectedProject.name}</strong>
      </p>

      <div className="quantity-compare__toolbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, marginRight: '0.25rem' }}>기준</span>
          <span style={{ color: 'var(--main-text-muted)', fontSize: '0.875rem' }}>
            {phaseA && revisionA
              ? `${phaseA.name} / ${revisionA.revision_name} (현재 선택됨)`
              : '상단 헤더에서 설계 차수와 리비전을 선택하세요.'}
          </span>
        </div>
        <fieldset style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: '0.25rem' }}>비교</legend>
          <label htmlFor="compare-phase-b">설계 차수</label>
          <select
            id="compare-phase-b"
            value={phaseBId}
            onChange={(e) => setPhaseBId(e.target.value)}
            className="form__control"
            style={{ minWidth: 140 }}
            disabled={loadingPhases}
          >
            <option value="">선택</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label htmlFor="compare-revision-b">리비전</label>
          <select
            id="compare-revision-b"
            value={revisionBId}
            onChange={(e) => setRevisionBId(e.target.value)}
            className="form__control"
            style={{ minWidth: 140 }}
            disabled={!phaseBId}
          >
            <option value="">선택</option>
            {revisionsB.map((r) => (
              <option key={r.id} value={r.id}>{r.revision_name}</option>
            ))}
          </select>
        </fieldset>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={loadBoth}
          disabled={!canCompare || loading}
          style={{ alignSelf: 'flex-end' }}
        >
          {loading ? '불러오는 중…' : '비교하기'}
        </button>
      </div>

      {error && <p className="auth-form__error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {summaryA && summaryB && revisionA && revisionB && (
        <>
          <nav className="quantity-compare__tabs" style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }} aria-label="비교 종류">
            <button
              type="button"
              className={`btn btn--secondary ${compareTab === 'floor' ? 'quantity-summary__tab--active' : ''}`}
              onClick={() => setCompareTab('floor')}
            >
              층별집계표 비교
            </button>
            <button
              type="button"
              className={`btn btn--secondary ${compareTab === 'floor-item' ? 'quantity-summary__tab--active' : ''}`}
              onClick={() => setCompareTab('floor-item')}
            >
              층-부재별집계표 비교
            </button>
          </nav>

          <p style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', marginBottom: '0.5rem' }}>
            기준: <strong>{phaseA?.name ?? '—'} / {revisionA.revision_name}</strong> · 비교: <strong>{phaseB?.name ?? '—'} / {revisionB.revision_name}</strong> (차이 = 비교 − 기준)
          </p>

          {compareTab === 'floor' ? (
            <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ marginTop: '0.5rem', width: '100%', overflow: 'auto' }}>
              <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>동</th>
                    <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>층</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>콘크리트(m³)</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>거푸집(m²)</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>철근(ton)</th>
                  </tr>
                  <tr>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                  </tr>
                </thead>
                <tbody>
                  {floorCompareRows.map((row, i) => (
                    <tr
                      key={`${row.dong}\t${row.floor}\t${i}`}
                      onDoubleClick={() => setDetailFloor({ dong: row.dong, floor: row.floor })}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{row.dong}</td>
                      <td>{row.floor}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.concreteA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.concreteB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.concreteDiff), fontWeight: row.concreteDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.concreteDiff)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.formworkA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.formworkB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.formworkDiff), fontWeight: row.formworkDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.formworkDiff)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.rebarA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.rebarB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.rebarDiff), fontWeight: row.rebarDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.rebarDiff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ marginTop: '0.5rem', width: '100%', overflow: 'auto' }}>
              <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>동</th>
                    <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>층</th>
                    <th rowSpan={2} style={{ verticalAlign: 'middle', borderBottom: '1px solid var(--main-border)' }}>부재유형</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>콘크리트(m³)</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>거푸집(m²)</th>
                    <th colSpan={3} style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'center' }}>철근(ton)</th>
                  </tr>
                  <tr>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>기준</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>비교</th>
                    <th style={{ fontWeight: 'normal', fontSize: '0.875rem' }}>차이</th>
                  </tr>
                </thead>
                <tbody>
                  {floorItemCompareRows.map((row, i) => (
                    <tr key={`${row.dong}\t${row.floor}\t${row.itemType}\t${i}`}>
                      <td>{row.dong}</td>
                      <td>{row.floor}</td>
                      <td>{row.itemType}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.concreteA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.concreteB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.concreteDiff), fontWeight: row.concreteDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.concreteDiff)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.formworkA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.formworkB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.formworkDiff), fontWeight: row.formworkDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.formworkDiff)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.rebarA)}</td>
                      <td style={{ textAlign: 'right' }}>{formatNum(row.rebarB)}</td>
                      <td style={{ textAlign: 'right', color: diffColor(row.rebarDiff), fontWeight: row.rebarDiff !== 0 ? 600 : undefined }}>
                        {formatDiff(row.rebarDiff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailFloor && (
            <div
              className="modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="quantity-detail-modal-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) { setDetailFloor(null); setDetailSelectedMaterialSpec(null) }
              }}
            >
              <div className="modal" style={{ maxWidth: 960, width: '95%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                <header className="modal__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h2 id="quantity-detail-modal-title" className="modal__title">
                      상세 비교 - 동 {detailFloor.dong} / 층 {detailFloor.floor}
                    </h2>
                    <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
                      선택한 층에 대한 자재분류·규격별 물량 비교입니다. (차이 = 비교 − 기준)
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => { setDetailFloor(null); setDetailSelectedMaterialSpec(null) }}
                  >
                    닫기
                  </button>
                </header>
                <div className="modal__body" style={{ marginTop: '0.5rem', overflow: 'hidden', display: 'flex', flex: 1, minHeight: 0, gap: '1rem' }}>
                  <div className="design-doc__table-wrap quantity-summary__table-wrap" style={{ flex: '1 1 50%', minWidth: 0, overflow: 'auto' }}>
                    <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
                      <thead>
                        <tr>
                          <th style={{ borderBottom: '1px solid var(--main-border)' }}>자재분류</th>
                          <th style={{ borderBottom: '1px solid var(--main-border)' }}>규격</th>
                          <th style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'right' }}>기준</th>
                          <th style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'right' }}>비교</th>
                          <th style={{ borderBottom: '1px solid var(--main-border)', textAlign: 'right' }}>차이</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getDetailSpecRows(detailFloor.dong, detailFloor.floor).map((row, i) => {
                          const isSelected = detailSelectedMaterialSpec?.material === row.material && detailSelectedMaterialSpec?.spec === row.spec
                          return (
                            <tr
                              key={`${row.material}\t${row.spec}\t${i}`}
                              onClick={() => setDetailSelectedMaterialSpec({ material: row.material, spec: row.spec })}
                              style={{
                                cursor: 'pointer',
                                background: isSelected ? 'var(--sidebar-active-bg)' : undefined,
                              }}
                            >
                              <td>{row.material}</td>
                              <td>{row.spec}</td>
                              <td style={{ textAlign: 'right' }}>{formatNum(row.base)}</td>
                              <td style={{ textAlign: 'right' }}>{formatNum(row.compare)}</td>
                              <td style={{ textAlign: 'right', color: diffColor(row.diff), fontWeight: row.diff !== 0 ? 600 : undefined }}>
                                {formatDiff(row.diff)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div
                    style={{
                      flex: '0 0 280px',
                      display: 'flex',
                      flexDirection: 'column',
                      border: '1px solid var(--main-border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--main-surface)',
                      minHeight: 0,
                    }}
                  >
                    <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--main-border)', fontWeight: 600, fontSize: '0.9rem' }}>
                      해당 부재
                      {detailSelectedMaterialSpec && (
                        <span style={{ fontWeight: 'normal', color: 'var(--main-text-muted)', fontSize: '0.85rem' }}>
                          {' '}({detailSelectedMaterialSpec.material} – {detailSelectedMaterialSpec.spec})
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                      {!detailSelectedMaterialSpec ? (
                        <p style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--main-text-muted)' }}>
                          왼쪽 표에서 자재분류·규격을 클릭하면 해당 부재 목록이 여기에 표시됩니다.
                        </p>
                      ) : getItemTypesForMaterialSpec(detailFloor.dong, detailFloor.floor, detailSelectedMaterialSpec.material, detailSelectedMaterialSpec.spec).length === 0 ? (
                        <p style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--main-text-muted)' }}>
                          해당 자재·규격에 대한 부재가 없습니다.
                        </p>
                      ) : (
                        <table className="project-mgmt__table design-doc__table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ width: 48, borderBottom: '1px solid var(--main-border)', padding: '0.35rem 0.5rem', textAlign: 'center' }}>순번</th>
                              <th style={{ borderBottom: '1px solid var(--main-border)', padding: '0.35rem 0.5rem' }}>부재유형</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getItemTypesForMaterialSpec(detailFloor.dong, detailFloor.floor, detailSelectedMaterialSpec.material, detailSelectedMaterialSpec.spec).map((itemType, idx) => (
                              <tr key={itemType}>
                                <td style={{ padding: '0.35rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--main-border)' }}>{idx + 1}</td>
                                <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--main-border)' }}>{itemType}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!summaryA && !summaryB && !loading && !error && (
        <p style={{ color: 'var(--main-text-muted)' }}>
          <strong>기준</strong>은 상단에서 선택한 설계 차수·리비전입니다. <strong>비교</strong>할 설계 차수와 리비전을 선택한 뒤 비교하기를 누르세요.
        </p>
      )}
    </section>
  )
}
