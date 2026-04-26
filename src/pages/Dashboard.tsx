import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { useProject } from '../contexts/ProjectContext'
import { getPhasesApi, getRevisionsApi, type DesignPhase, type DesignRevision } from '../api/designSchedule'
import { getDesignReviewsApi } from '../api/designReview'
import { getQuantityRevisionStatsApi } from '../api/quantityFile'
import './Dashboard.css'

type RevisionRow = {
  phase: DesignPhase
  revision: DesignRevision
  shortLabel: string
}

type ChartRow = {
  name: string
  answered: number
  unanswered: number
  total: number
  reflected: number
  notReflected: number
  cumulative: number
  /** 리비전별 물량: 등록 파일 수·행 수 */
  qtyFiles: number
  qtyItems: number
}

function formatDate(s: string | null | undefined) {
  if (!s) return '-'
  return s.slice(0, 10)
}

function revisionStatusBadge(status: string | undefined) {
  const s = (status || '').trim()
  if (s.includes('완')) return { className: 'dashboard-exec__badge dashboard-exec__badge--done', label: '완료' }
  if (s.includes('진행')) return { className: 'dashboard-exec__badge dashboard-exec__badge--progress', label: '진행 중' }
  return { className: 'dashboard-exec__badge dashboard-exec__badge--pending', label: '대기' }
}

export default function Dashboard() {
  const { selectedProject } = useProject()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<RevisionRow[]>([])
  const [chartData, setChartData] = useState<ChartRow[]>([])
  const [search, setSearch] = useState('')
  const [rangeMode, setRangeMode] = useState<'week' | 'month'>('week')

  const load = useCallback(async () => {
    if (!selectedProject?.id) {
      setRows([])
      setChartData([])
      return
    }
    setLoading(true)
    try {
      const phRes = await getPhasesApi(selectedProject.id)
      if (!phRes.success || !phRes.phases?.length) {
        setRows([])
        setChartData([])
        return
      }
      const plist = [...phRes.phases].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const flat: RevisionRow[] = []
      for (const p of plist) {
        const revRes = await getRevisionsApi(p.id)
        const revs = revRes.success && revRes.revisions ? revRes.revisions : []
        const sorted = [...revs].sort((a, b) => a.revision_name.localeCompare(b.revision_name, 'ko'))
        for (const r of sorted) {
          const shortLabel =
            r.revision_name.length > 10 ? r.revision_name.slice(0, 9) + '…' : r.revision_name
          flat.push({ phase: p, revision: r, shortLabel })
        }
      }
      setRows(flat)

      const chartPoints: ChartRow[] = []
      let cum = 0
      for (const { revision: r, shortLabel } of flat) {
        const [revRes, qtyRes] = await Promise.all([
          getDesignReviewsApi(r.id),
          getQuantityRevisionStatsApi(r.id).catch(() => ({
            success: false as const,
            fileCount: 0,
            itemCount: 0,
            byFile: [] as { id: string; title: string; itemCount: number }[],
          })),
        ])
        const reviews = revRes.success && revRes.reviews ? revRes.reviews : []
        const answered = reviews.filter((x) => (x.memo || '').trim().length > 0).length
        const unanswered = Math.max(0, reviews.length - answered)
        const total = answered + unanswered
        const reflected = reviews.filter((x) => !!(x.file_path || x.file_name)).length
        const notReflected = Math.max(0, reviews.length - reflected)
        cum += reviews.length
        const qtyOk = qtyRes.success === true
        chartPoints.push({
          name: shortLabel,
          answered,
          unanswered,
          total,
          reflected,
          notReflected,
          cumulative: cum,
          qtyFiles: qtyOk ? Math.max(0, Math.floor(qtyRes.fileCount)) : 0,
          qtyItems: qtyOk ? Math.max(0, Math.floor(qtyRes.itemCount)) : 0,
        })
      }
      setChartData(chartPoints)
    } catch {
      setRows([])
      setChartData([])
    } finally {
      setLoading(false)
    }
  }, [selectedProject?.id])

  useEffect(() => {
    void load()
  }, [load])

  const timelineItems = useMemo(() => {
    return rows.map(({ phase, revision }) => {
      const when = revision.actual_date || revision.planned_date || revision.created_at
      const title = `${phase.name} · ${revision.revision_name}`
      const done = revision.status === '완료' || revision.status === '완납'
      const badge = revisionStatusBadge(revision.status)
      return { title, date: formatDate(when), done, badge }
    })
  }, [rows])

  const filteredTimeline = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return timelineItems
    return timelineItems.filter((t) => t.title.toLowerCase().includes(q))
  }, [timelineItems, search])

  const filteredChart = useMemo(() => {
    const q = search.trim().toLowerCase()
    let d = chartData
    if (q) d = d.filter((row) => row.name.toLowerCase().includes(q))
    if (rangeMode === 'week' && d.length > 7) d = d.slice(-7)
    return d
  }, [chartData, search, rangeMode])

  const reflectionAgg = useMemo(() => {
    const src = search.trim()
      ? chartData.filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
      : chartData
    let reflected = 0
    let notReflected = 0
    for (const r of src) {
      reflected += r.reflected
      notReflected += r.notReflected
    }
    const total = reflected + notReflected
    const pctRef = total > 0 ? (100 * reflected) / total : 0
    const pctPending = total > 0 ? 100 - pctRef : 0
    return { reflected, notReflected, total, pctRef, pctPending }
  }, [chartData, search])

  const qtyTotals = useMemo(() => {
    const src = search.trim()
      ? chartData.filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
      : chartData
    let qtyFiles = 0
    let qtyItems = 0
    for (const r of src) {
      qtyFiles += r.qtyFiles
      qtyItems += r.qtyItems
    }
    return { qtyFiles, qtyItems, revisions: src.length }
  }, [chartData, search])

  const filteredQtyChart = useMemo(() => {
    const q = search.trim().toLowerCase()
    let d = chartData
    if (q) d = d.filter((row) => row.name.toLowerCase().includes(q))
    if (rangeMode === 'week' && d.length > 7) d = d.slice(-7)
    return d
  }, [chartData, search, rangeMode])

  return (
    <div className="dashboard-exec">
      <header className="dashboard-exec__header">
        <div className="dashboard-exec__header-left">
          <h1 className="dashboard-exec__title">대시보드</h1>
          <span className="dashboard-exec__live" title="선택된 프로젝트 기준 실시간 집계">
            LIVE
          </span>
        </div>
        <div className="dashboard-exec__search-wrap">
          <span className="dashboard-exec__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="dashboard-exec__search"
            placeholder="리비전·차수 이름 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="대시보드 검색"
          />
        </div>
        <div className="dashboard-exec__header-right">
          <button type="button" className="dashboard-exec__icon-btn" title="새로고침" onClick={() => void load()}>
            ↻
          </button>
        </div>
      </header>

      {!selectedProject && (
        <p className="dashboard-exec__empty-msg">상단에서 프로젝트를 선택하면 검토·물량·일정 요약이 표시됩니다.</p>
      )}

      {selectedProject && loading && <div className="dashboard-exec__loading">불러오는 중…</div>}

      {selectedProject && !loading && (
        <div className="dashboard-exec__grid">
          <section
            className="dashboard-exec__card dashboard-exec__card--timeline dashboard-exec__cell--tl"
            aria-labelledby="dash-timeline-title"
          >
            <div className="dashboard-exec__card-head">
              <h2 id="dash-timeline-title" className="dashboard-exec__card-title">
                검토 진행
              </h2>
            </div>
            {filteredTimeline.length === 0 ? (
              <p className="dashboard-exec__muted">표시할 리비전이 없습니다. 설계일정에서 등록하세요.</p>
            ) : (
              <div className="dashboard-exec__timeline">
                <div className="dashboard-exec__timeline-rail" aria-hidden />
                <ul className="dashboard-exec__timeline-list">
                  {filteredTimeline.map((item, i) => (
                    <li key={`${item.title}-${item.date}-${i}`} className="dashboard-exec__timeline-item">
                      <span className="dashboard-exec__timeline-node" aria-hidden />
                      <div className="dashboard-exec__timeline-body">
                        <div className="dashboard-exec__timeline-top">
                          <span className={item.badge.className}>{item.badge.label}</span>
                          {item.done && <span className="dashboard-exec__timeline-check">✓</span>}
                        </div>
                        <div className="dashboard-exec__timeline-label">{item.title}</div>
                        <div className="dashboard-exec__timeline-date">{item.date}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="dashboard-exec__card dashboard-exec__card--chart dashboard-exec__cell--c1" aria-labelledby="dash-line-title">
            <div className="dashboard-exec__card-head dashboard-exec__card-head--split">
              <h2 id="dash-line-title" className="dashboard-exec__card-title">
                검토 현황
              </h2>
              <div className="dashboard-exec__toggle" role="group" aria-label="표시 범위">
                <button
                  type="button"
                  className={rangeMode === 'week' ? 'dashboard-exec__toggle-btn is-on' : 'dashboard-exec__toggle-btn'}
                  onClick={() => setRangeMode('week')}
                >
                  최근 7건
                </button>
                <button
                  type="button"
                  className={rangeMode === 'month' ? 'dashboard-exec__toggle-btn is-on' : 'dashboard-exec__toggle-btn'}
                  onClick={() => setRangeMode('month')}
                >
                  전체
                </button>
              </div>
            </div>
            <p className="dashboard-exec__card-desc">메모가 있으면 답변으로 집계합니다.</p>
            {filteredChart.length === 0 ? (
              <p className="dashboard-exec__muted">표시할 데이터가 없습니다.</p>
            ) : (
              <div className="dashboard-exec__chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={filteredChart} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf1" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-20} textAnchor="end" height={48} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ strokeDasharray: '4 4', stroke: 'var(--main-text-muted, #94a3b8)', strokeOpacity: 0.65 }}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="총 검토"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, strokeWidth: 2, stroke: '#fff', cursor: 'pointer' }}
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#2563eb', cursor: 'pointer' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="answered"
                      name="답변"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 2, stroke: '#fff', cursor: 'pointer' }}
                      activeDot={{ r: 5, strokeWidth: 0, fill: '#22c55e', cursor: 'pointer' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="unanswered"
                      name="미답변"
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={{ r: 3, strokeWidth: 2, stroke: '#fff', cursor: 'pointer' }}
                      activeDot={{ r: 5, strokeWidth: 0, fill: '#ef4444', cursor: 'pointer' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="dashboard-exec__card dashboard-exec__card--chart dashboard-exec__cell--c2" aria-labelledby="dash-bar-title">
            <div className="dashboard-exec__card-head">
              <h2 id="dash-bar-title" className="dashboard-exec__card-title">
                도면 반영
              </h2>
            </div>
            <p className="dashboard-exec__card-desc">첨부 파일이 있으면 반영으로 집계합니다.</p>
            {reflectionAgg.total === 0 ? (
              <p className="dashboard-exec__muted">집계할 검토 항목이 없습니다.</p>
            ) : (
              <div className="dashboard-exec__reflect">
                <div className="dashboard-exec__reflect-bar" role="img" aria-label={`반영 ${reflectionAgg.pctRef.toFixed(1)}%`}>
                  <div className="dashboard-exec__reflect-seg dashboard-exec__reflect-seg--ok" style={{ width: `${reflectionAgg.pctRef}%` }} />
                  <div className="dashboard-exec__reflect-seg dashboard-exec__reflect-seg--wait" style={{ width: `${reflectionAgg.pctPending}%` }} />
                </div>
                <div className="dashboard-exec__reflect-legend">
                  <span>
                    <i className="dashboard-exec__dot dashboard-exec__dot--ok" /> 반영 {reflectionAgg.pctRef.toFixed(1)}% (
                    {reflectionAgg.reflected}건)
                  </span>
                  <span>
                    <i className="dashboard-exec__dot dashboard-exec__dot--wait" /> 미반영 {reflectionAgg.pctPending.toFixed(1)}% (
                    {reflectionAgg.notReflected}건)
                  </span>
                </div>
                <Link to="/design-review" className="dashboard-exec__link-report">
                  전체 검토 화면으로 →
                </Link>
              </div>
            )}
          </section>

          <section
            className="dashboard-exec__card dashboard-exec__card--chart dashboard-exec__cell--qty"
            aria-labelledby="dash-qty-title"
          >
            <div className="dashboard-exec__card-head dashboard-exec__card-head--split">
              <h2 id="dash-qty-title" className="dashboard-exec__card-title">
                물량 현황
              </h2>
              <div className="dashboard-exec__kpi-row dashboard-exec__kpi-row--inline">
                <div className="dashboard-exec__kpi dashboard-exec__kpi--compact">
                  <span className="dashboard-exec__kpi-label">물량 행(합)</span>
                  <strong className="dashboard-exec__kpi-value">{qtyTotals.qtyItems.toLocaleString()}</strong>
                </div>
                <div className="dashboard-exec__kpi dashboard-exec__kpi--compact">
                  <span className="dashboard-exec__kpi-label">등록 파일(합)</span>
                  <strong className="dashboard-exec__kpi-value">{qtyTotals.qtyFiles.toLocaleString()}</strong>
                </div>
              </div>
            </div>
            <p className="dashboard-exec__card-desc">
              설계 리비전별 물량파일·행 수입니다. 위「검토 현황」과 동일하게 검색·최근 7건 토글이 적용됩니다.
            </p>
            {filteredQtyChart.length === 0 || filteredQtyChart.every((r) => r.qtyItems === 0 && r.qtyFiles === 0) ? (
              <p className="dashboard-exec__muted">
                표시할 물량이 없습니다. 물량파일 등록 또는 물량 데이터 화면에서 리비전별로 등록했는지 확인하세요.
              </p>
            ) : (
              <div className="dashboard-exec__chart-box dashboard-exec__chart-box--qty">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredQtyChart} margin={{ top: 6, right: 8, left: -12, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--main-border, #e2e8f0)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--main-text-muted, #64748b)' }} interval={0} angle={-18} textAnchor="end" height={42} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--main-text-muted, #64748b)' }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'color-mix(in srgb, var(--accent, #0d9488) 12%, transparent)' }}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid var(--main-border, #e2e8f0)',
                        fontSize: 12,
                        background: 'var(--main-surface, #fff)',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} />
                    <Bar
                      dataKey="qtyFiles"
                      name="등록 파일"
                      fill="#94a3b8"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                      cursor="pointer"
                    />
                    <Bar
                      dataKey="qtyItems"
                      name="물량 행"
                      fill="#0d9488"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <Link to="/quantity" className="dashboard-exec__link-report dashboard-exec__link-report--tight">
              물량 데이터로 →
            </Link>
          </section>

          <section className="dashboard-exec__card dashboard-exec__card--wide dashboard-exec__cell--wide" aria-labelledby="dash-area-title">
            <div className="dashboard-exec__wide-top">
              <div>
                <h2 id="dash-area-title" className="dashboard-exec__card-title">
                  누적 검토 추이
                </h2>
                <p className="dashboard-exec__card-desc">리비전 순 누적 검토 건수입니다.</p>
              </div>
              <div className="dashboard-exec__kpi-row">
                <div className="dashboard-exec__kpi">
                  <span className="dashboard-exec__kpi-label">총 검토</span>
                  <strong className="dashboard-exec__kpi-value">
                    {chartData.reduce((a, r) => a + r.total, 0).toLocaleString()}
                  </strong>
                </div>
                <div className="dashboard-exec__kpi">
                  <span className="dashboard-exec__kpi-label">리비전 수</span>
                  <strong className="dashboard-exec__kpi-value">{chartData.length}</strong>
                </div>
              </div>
            </div>
            {filteredChart.length === 0 ? (
              <p className="dashboard-exec__muted">표시할 데이터가 없습니다.</p>
            ) : (
              <div className="dashboard-exec__chart-box dashboard-exec__chart-box--tall">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={filteredChart} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashCumFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf1" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} interval={0} angle={-18} textAnchor="end" height={44} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip
                      cursor={{ strokeDasharray: '4 4', stroke: 'var(--main-text-muted, #94a3b8)', strokeOpacity: 0.65 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, cursor: 'pointer' }} />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      name="누적 검토"
                      stroke="#2563eb"
                      strokeWidth={2}
                      fill="url(#dashCumFill)"
                      dot={{ r: 3, strokeWidth: 2, stroke: '#fff', fill: '#2563eb', cursor: 'pointer' }}
                      activeDot={{ r: 6, strokeWidth: 0, fill: '#2563eb', cursor: 'pointer' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="dashboard-exec__wide-foot">
              <span className="dashboard-exec__muted">모델·도서 용량 집계는 추후 연동 예정입니다.</span>
              <Link to="/design-model" className="dashboard-exec__btn-ghost">
                모델 관리
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
