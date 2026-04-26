import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useProject } from '../../contexts/ProjectContext'
import { canAccessProjectManagement } from '../../lib/auth-access'
import type { RebarDbSection } from '../../api/settingsHub'
import {
  getRebarDatabaseRowsApi,
  createRebarDatabaseRowApi,
  updateRebarDatabaseRowApi,
  deleteRebarDatabaseRowApi,
  type RebarDatabaseRow,
} from '../../api/settingsHub'
import {
  REBAR_DB_COLUMNS,
  REBAR_DB_MODAL_TITLES,
  LENGTH_LAP_ZERO_DEFAULT_KEYS,
  type ColumnDef,
} from './rebarDbColumns'
import RebarScheduleFormModal from './RebarScheduleFormModal'
import LapDiameterSelectModal from './LapDiameterSelectModal'
import { exportRebarRowsToXlsx, parseRebarXlsxToRows } from './rebarExcel'

function emptyRowData(cols: ColumnDef[]): Record<string, string> {
  const o: Record<string, string> = {}
  for (const c of cols) o[c.key] = ''
  return o
}

function emptyLapRowFromPicker(fck: string, fy: string, diameter: string): Record<string, string> {
  const o = emptyRowData(REBAR_DB_COLUMNS.length_lap)
  o.fck = fck
  o.fy = fy
  o.diameter_mm = diameter
  for (const k of LENGTH_LAP_ZERO_DEFAULT_KEYS) o[k] = '0'
  return o
}

type Props = { section: RebarDbSection; title: string }

export default function RebarDatabasePage({ section, title }: Props) {
  const { user } = useAuth()
  const { selectedProject } = useProject()
  const canManage = user ? canAccessProjectManagement(user) : false
  const cols = REBAR_DB_COLUMNS[section]
  const [rows, setRows] = useState<RebarDatabaseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [lapPickerOpen, setLapPickerOpen] = useState(false)
  const [lapPickerSaving, setLapPickerSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const projectId = selectedProject?.id ?? ''

  const load = useCallback(() => {
    if (!projectId) {
      setRows([])
      return
    }
    setLoading(true)
    setError('')
    getRebarDatabaseRowsApi(projectId, section)
      .then((r) => {
        if (r.success && r.items) setRows(r.items)
        else setRows([])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'))
      .finally(() => setLoading(false))
  }, [projectId, section])

  useEffect(() => {
    load()
  }, [load])

  function mergeData(row: RebarDatabaseRow): Record<string, string> {
    const base = emptyRowData(cols)
    const d = row.data && typeof row.data === 'object' ? row.data : {}
    for (const k of Object.keys(base)) {
      base[k] = d[k] != null ? String(d[k]) : ''
    }
    return base
  }

  function persistRowAfterEdit(rowId: number) {
    if (!user?.email || !canManage) return
    window.setTimeout(() => {
      const cur = rowsRef.current.find((r) => r.id === rowId)
      if (!cur) return
      const data = mergeData(cur)
      updateRebarDatabaseRowApi(user.email!, cur.id, { data })
        .then((r) => {
          if (r.success && r.item) {
            setRows((prev) => prev.map((x) => (x.id === rowId ? r.item! : x)))
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '저장 실패')
          load()
        })
    }, 0)
  }

  const hasRemarksCol = cols.some((c) => c.key === 'remarks')

  return (
    <>
    <article className="settings-subpage">
      <header className="settings-subpage__header">
        <h2 className="settings-subpage__title">{title}</h2>
        <p className="settings-subpage__desc">
          프로젝트 <strong>{selectedProject ? selectedProject.name : '미선택'}</strong> 전용 철근 DB입니다. 엑셀보내기·가져오기는
          첫 시트 1행을 한글 헤더(표 헤더와 동일)로 맞추면 됩니다.
        </p>
      </header>
      {!projectId && (
        <p style={{ color: 'var(--main-text-muted)' }}>왼쪽에서 프로젝트를 선택한 뒤 사용하세요.</p>
      )}
      {error && <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {projectId && canManage && (
        <div className="settings-subpage__toolbar">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!user?.email || addSaving}
            onClick={() => {
              setError('')
              setAddModalOpen(true)
            }}
          >
            추가
          </button>
          {section === 'length_lap' && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!user?.email || lapPickerSaving}
              onClick={() => setLapPickerOpen(true)}
            >
              이음/정착 직경 선택
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              const dataRows = rows.length > 0 ? rows.map((r) => mergeData(r)) : [emptyRowData(cols)]
              const base = `철근DB_${section}_${selectedProject?.name || projectId}`
              exportRebarRowsToXlsx(cols, dataRows, base)
            }}
          >
            엑셀보내기
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!user?.email || importing}
            onClick={() => importInputRef.current?.click()}
          >
            {importing ? '가져오는 중…' : '엑셀 가져오기'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file || !user?.email || !projectId) return
              setImporting(true)
              setError('')
              try {
                const parsed = await parseRebarXlsxToRows(file, cols)
                if (parsed.length === 0) {
                  setError('가져올 유효한 데이터 행이 없습니다. 1행 헤더가 표와 같은지 확인하세요.')
                  return
                }
                const newItems: RebarDatabaseRow[] = []
                for (const data of parsed) {
                  const r = await createRebarDatabaseRowApi(user.email, projectId, section, data)
                  if (r.success && r.item) newItems.push(r.item)
                }
                setRows((prev) => [...prev, ...newItems])
              } catch (err) {
                setError(err instanceof Error ? err.message : '엑셀 읽기 실패')
              } finally {
                setImporting(false)
              }
            }}
          />
        </div>
      )}
      {projectId && (
        <div className="settings-subpage__table-wrap">
          <table className="project-mgmt__table design-doc__table" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {canManage && <th style={{ width: 80 }}>삭제</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={cols.length + (canManage ? 1 : 0)} style={{ color: 'var(--main-text-muted)' }}>
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + (canManage ? 1 : 0)} style={{ color: 'var(--main-text-muted)' }}>
                    데이터가 없습니다. 추가 버튼으로 입력하거나 엑셀을 가져오세요.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const data = mergeData(row)
                  return (
                    <tr key={row.id}>
                      {cols.map((c) => (
                        <td key={c.key} style={{ padding: 0, minWidth: 96 }}>
                          {canManage ? (
                            c.key === 'remarks' && hasRemarksCol ? (
                              <textarea
                                className="form-control"
                                value={data[c.key]}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setRows((prev) =>
                                    prev.map((x) => {
                                      if (x.id !== row.id) return x
                                      const nextD = { ...(typeof x.data === 'object' && x.data ? x.data : {}), [c.key]: v }
                                      return { ...x, data: nextD }
                                    })
                                  )
                                }}
                                onBlur={() => persistRowAfterEdit(row.id)}
                                rows={3}
                                style={{ border: 'none', borderRadius: 0, minWidth: 120, resize: 'vertical', width: '100%' }}
                              />
                            ) : (
                              <input
                                className="form-control"
                                value={data[c.key]}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setRows((prev) =>
                                    prev.map((x) => {
                                      if (x.id !== row.id) return x
                                      const nextD = { ...(typeof x.data === 'object' && x.data ? x.data : {}), [c.key]: v }
                                      return { ...x, data: nextD }
                                    })
                                  )
                                }}
                                onBlur={() => persistRowAfterEdit(row.id)}
                                style={{ border: 'none', borderRadius: 0, minWidth: 88 }}
                              />
                            )
                          ) : c.key === 'remarks' && hasRemarksCol ? (
                            <span style={{ whiteSpace: 'pre-wrap' }}>{data[c.key] || '—'}</span>
                          ) : (
                            data[c.key] || '—'
                          )}
                        </td>
                      ))}
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={!user?.email}
                            onClick={() => {
                              if (!user?.email || !window.confirm('이 행을 삭제할까요?')) return
                              deleteRebarDatabaseRowApi(user.email, row.id)
                                .then(() => setRows((prev) => prev.filter((x) => x.id !== row.id)))
                                .catch((err) => setError(err instanceof Error ? err.message : '삭제 실패'))
                            }}
                          >
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </article>

      {addModalOpen && (
        <RebarScheduleFormModal
          section={section}
          open
          title={REBAR_DB_MODAL_TITLES[section]}
          saving={addSaving}
          onClose={() => !addSaving && setAddModalOpen(false)}
          onConfirm={(data) => {
            if (!user?.email || !projectId) return
            setAddSaving(true)
            setError('')
            createRebarDatabaseRowApi(user.email, projectId, section, data)
              .then((r) => {
                if (r.success && r.item) {
                  setRows((prev) => [...prev, r.item!])
                  setAddModalOpen(false)
                }
              })
              .catch((err) => setError(err instanceof Error ? err.message : '저장 실패'))
              .finally(() => setAddSaving(false))
          }}
        />
      )}

      {section === 'length_lap' && (
        <LapDiameterSelectModal
          open={lapPickerOpen}
          saving={lapPickerSaving}
          onClose={() => !lapPickerSaving && setLapPickerOpen(false)}
          onConfirm={({ fck, fy, diameters }) => {
            if (!user?.email || !projectId) return
            setLapPickerSaving(true)
            setError('')
            ;(async () => {
              try {
                const newItems: RebarDatabaseRow[] = []
                for (const d of diameters) {
                  const rowData = emptyLapRowFromPicker(fck, fy, d)
                  const r = await createRebarDatabaseRowApi(user.email!, projectId, 'length_lap', rowData)
                  if (r.success && r.item) newItems.push(r.item)
                }
                setRows((prev) => [...prev, ...newItems])
                setLapPickerOpen(false)
              } catch (err) {
                setError(err instanceof Error ? err.message : '추가 실패')
              } finally {
                setLapPickerSaving(false)
              }
            })()
          }}
        />
      )}
    </>
  )
}
