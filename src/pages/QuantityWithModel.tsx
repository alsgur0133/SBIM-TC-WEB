import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDesignSchedule } from '../contexts/DesignScheduleContext'
import { useProject } from '../contexts/ProjectContext'
import { getDesignModelsApi } from '../api/designModel'
import {
  getQuantitySummaryApi,
  type QuantitySummaryRow,
  type QuantitySummaryData,
} from '../api/quantityFile'
import ModelViewerLoader from '../components/ModelViewerLoader'
import { effectiveDesignRevisionIdForSync, postIfcViewerSync } from '../lib/ifcViewerSync'

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

const rowKey = (r: QuantitySummaryRow) => (r.dong ?? '') + '\t' + (r.floor ?? '')

export default function QuantityWithModel() {
  const navigate = useNavigate()
  const { selectedProject } = useProject()
  const { phases, revisions, selectedPhaseId, selectedRevisionId, loadingPhases } = useDesignSchedule()
  const selectedPhase = useMemo(() => phases.find((p) => p.id === selectedPhaseId) ?? null, [phases, selectedPhaseId])
  const selectedRevision = useMemo(() => revisions.find((r) => r.id === selectedRevisionId) ?? null, [revisions, selectedRevisionId])

  const [rows, setRows] = useState<QuantitySummaryRow[]>([])
  const [data, setData] = useState<Record<string, QuantitySummaryData>>({})
  const [concreteColumns, setConcreteColumns] = useState<string[]>([])
  const [formworkColumns, setFormworkColumns] = useState<string[]>([])
  const [rebarColumns, setRebarColumns] = useState<string[]>([])
  const [models, setModels] = useState<{ id: string; title: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null)
  const [selectedDong, setSelectedDong] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedRevisionId) {
      setRows([])
      setData({})
      setModels([])
      return
    }
    setLoading(true)
    setError('')
    Promise.all([getQuantitySummaryApi(selectedRevisionId), getDesignModelsApi(selectedRevisionId)])
      .then(([summaryRes, modelsRes]) => {
        if (summaryRes.success && summaryRes.rows) {
          setRows(summaryRes.rows)
          setData(summaryRes.data || {})
          setConcreteColumns(summaryRes.concreteColumns || [])
          setFormworkColumns(summaryRes.formworkColumns || [])
          setRebarColumns(summaryRes.rebarColumns || [])
        } else {
          setRows([])
          setData({})
          setConcreteColumns([])
          setFormworkColumns([])
          setRebarColumns([])
        }
        if (modelsRes.success && modelsRes.models) {
          setModels(modelsRes.models.map((m) => ({ id: m.id, title: m.title || m.id })))
        } else {
          setModels([])
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '데이터를 불러올 수 없습니다.')
        setRows([])
        setData({})
        setModels([])
      })
      .finally(() => setLoading(false))
  }, [selectedRevisionId])

  const handleCloseViewer = useCallback(() => {
    navigate('/quantity/summary/floor')
  }, [navigate])

  if (!selectedProject) {
    return (
      <section className="card">
        <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
        <p className="auth-form__error" style={{ marginTop: '0.5rem' }}>
          <strong>프로젝트를 선택</strong>한 후 이용할 수 있습니다.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/projects" className="btn btn--primary">프로젝트 관리에서 선택하기</Link>
        </p>
      </section>
    )
  }

  if (!selectedPhaseId && !loadingPhases) {
    return (
      <section className="card">
        <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단에서 <strong>설계 차수</strong>와 <strong>리비전</strong>을 선택하세요.
        </p>
      </section>
    )
  }

  if (selectedPhaseId && !selectedRevisionId) {
    return (
      <section className="card">
        <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          상단에서 <strong>리비전</strong>을 선택하면 해당 리비전의 물량과 모델을 함께 볼 수 있습니다.
        </p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="card">
        <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
        <p style={{ color: 'var(--main-text-muted)' }}>물량 및 모델 목록을 불러오는 중…</p>
      </section>
    )
  }

  if (models.length === 0) {
    return (
      <section className="card">
        <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
        <p style={{ color: 'var(--main-text-muted)', marginTop: '1rem' }}>
          해당 리비전에 등록된 <strong>모델이 없습니다</strong>. 모델 관리에서 IFC 모델을 등록한 뒤 이용하세요.
        </p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/design-model" className="btn btn--primary">모델 관리로 이동</Link>
          <span style={{ marginLeft: '0.5rem' }}>
            <Link to="/quantity/summary/floor" className="btn btn--secondary">물량집계표만 보기</Link>
          </span>
        </p>
      </section>
    )
  }

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 400 }}>
      <h2 className="quantity-summary-page__title-hidden">물량·모델 보기</h2>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--main-border)', background: 'var(--main-bg)', flexShrink: 0 }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--main-text-muted)', margin: 0 }}>
          프로젝트: <strong>{selectedProject.name}</strong>
          {selectedPhase && <> · 설계 차수: <strong>{selectedPhase.name}</strong></>}
          {selectedRevision && <> · 리비전: <strong>{selectedRevision.revision_name}</strong></>}
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--main-text-muted)', margin: '0.25rem 0 0 0' }}>
          오른쪽은 <strong>Trimble Connect</strong> 모델 뷰어입니다. Trimble Connect로 로그인한 뒤 이용하세요. BRACE에만 등록된 IFC를 보려면 주소에 <code>?viewer=ifc</code>를 붙인 뒤 해당 화면으로 이동하세요.
        </p>
      </div>
      {error && <p className="auth-form__error" style={{ margin: '0.5rem 1rem' }}>{error}</p>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 360, flexShrink: 0, borderRight: '1px solid var(--main-border)', display: 'flex', flexDirection: 'column', background: '#fff' }}>
          <div style={{ padding: '0.5rem 0.75rem', fontWeight: 600, fontSize: '0.875rem', borderBottom: '1px solid var(--main-border)' }}>
            층별집계표
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {rows.length === 0 && concreteColumns.length === 0 && formworkColumns.length === 0 && rebarColumns.length === 0 ? (
              <p style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--main-text-muted)' }}>
                해당 리비전에 물량 데이터가 없습니다. 물량파일 등록 후 조회하세요.
              </p>
            ) : (
              <table className="project-mgmt__table design-doc__table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0.35rem 0.5rem' }}>동</th>
                    <th style={{ padding: '0.35rem 0.5rem' }}>층</th>
                    <th style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>콘크리트</th>
                    <th style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>거푸집</th>
                    <th style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>철근</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const key = rowKey(r)
                    const rowData = data[key] || { concrete: {}, formwork: {}, rebar: {} }
                    const s = sumCategory(rowData, concreteColumns, formworkColumns, rebarColumns)
                    const isSelected = selectedDong === (r.dong ?? '') && selectedFloor === (r.floor ?? '')
                    return (
                      <tr
                        key={key}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(0, 120, 215, 0.12)' : undefined,
                        }}
                        onClick={() => {
                          setSelectedDong(r.dong ?? '')
                          setSelectedFloor(r.floor ?? '')
                          const rev = effectiveDesignRevisionIdForSync(selectedRevisionId)
                          const fl = (r.floor ?? '').trim()
                          if (rev && fl) {
                            postIfcViewerSync({
                              v: 1,
                              action: 'highlightFloor',
                              designRevisionId: rev,
                              projectId: selectedProject?.id,
                              floor: fl,
                            })
                          }
                        }}
                      >
                        <td style={{ padding: '0.35rem 0.5rem' }}>{r.dong ?? '—'}</td>
                        <td style={{ padding: '0.35rem 0.5rem' }}>{r.floor ?? '—'}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatNum(s.concrete)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatNum(s.formwork)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatNum(s.rebar)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <ModelViewerLoader
            embedded
            onClose={handleCloseViewer}
            designRevisionId={selectedRevisionId}
            highlightByFloor={selectedFloor?.trim() || undefined}
          />
        </div>
      </div>
    </section>
  )
}
