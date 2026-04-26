import { useCallback, useEffect, useMemo, useState } from 'react'
import SettingsEditableCell from '../../components/SettingsEditableCell'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessProjectManagement } from '../../lib/auth-access'
import {
  getQuantityDongsApi,
  createQuantityDongApi,
  updateQuantityDongApi,
  deleteQuantityDongApi,
  updateQuantityDongsOrderApi,
  type QuantityDong,
} from '../../api/quantityFile'

export default function CodeMappingDongPage() {
  const { user } = useAuth()
  const canManage = user ? canAccessProjectManagement(user) : false
  const [items, setItems] = useState<QuantityDong[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newVal, setNewVal] = useState('')

  const sorted = useMemo(() => [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id), [items])

  const load = useCallback(() => {
    setLoading(true)
    getQuantityDongsApi()
      .then((r) => {
        if (r.success && r.items) setItems(r.items)
        else setItems([])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '불러오기 실패'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <article className="settings-subpage">
      <header className="settings-subpage__header">
        <h2 className="settings-subpage__title">동 관리</h2>
        <p className="settings-subpage__desc">
          물량집계·물량파일과 동일한 동 목록입니다. 연면적(m²)은 총괄분석표 평당 산출에 사용됩니다.{' '}
          <span className="settings-subpage__edit-hint">동·연면적 셀은 더블클릭하면 수정할 수 있습니다.</span>
        </p>
      </header>
      {error && <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {canManage && (
        <div className="settings-subpage__toolbar">
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="동 (예: P)"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!newVal.trim() || !user?.email}
            onClick={() => {
              if (!user?.email) return
              createQuantityDongApi(user.email, newVal.trim())
                .then((r) => {
                  if (r.success && r.item) {
                    setItems((prev) => [...prev, r.item!])
                    setNewVal('')
                  }
                })
                .catch((e) => setError(e instanceof Error ? e.message : '추가 실패'))
            }}
          >
            추가
          </button>
        </div>
      )}
      <div className="settings-subpage__table-wrap settings-subpage__table-wrap--editable">
        <table className="project-mgmt__table design-doc__table settings-table-inline">
          <thead>
            <tr>
              <th style={{ width: 64 }}>정렬</th>
              <th>동</th>
              <th>연면적(m²)</th>
              {canManage && <th style={{ width: 200 }}>작업</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>불러오는 중…</td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>등록된 동이 없습니다.</td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <tr key={row.id}>
                  <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.dong_value}
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (!next || next === row.dong_value) return
                        return updateQuantityDongApi(user.email, row.id, { dong_value: next })
                          .then((r) => {
                            if (r.success && r.item) setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                          })
                          .catch(() => load())
                      }}
                    />
                  </td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={
                        row.gross_area != null && Number.isFinite(row.gross_area) ? String(row.gross_area) : ''
                      }
                      display={
                        row.gross_area != null && Number.isFinite(row.gross_area)
                          ? String(row.gross_area)
                          : undefined
                      }
                      emptyLabel="—"
                      inputType="number"
                      inputProps={{ min: 0, step: 0.01, placeholder: '0' }}
                      onCommit={(raw) => {
                        if (!user?.email) return
                        const num = raw === '' ? null : parseFloat(raw)
                        const gross = num != null && Number.isFinite(num) && num >= 0 ? num : null
                        if (gross === (row.gross_area ?? null)) return
                        return updateQuantityDongApi(user.email, row.id, { gross_area: gross })
                          .then((r) => {
                            if (r.success && r.item) setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                          })
                          .catch(() => load())
                      }}
                    />
                  </td>
                  {canManage && (
                    <td className="settings-table-actions">
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={idx === 0 || !user?.email}
                          onClick={() => {
                            if (!user?.email || idx === 0) return
                            const order = sorted.map((x) => x.id)
                            const t = order[idx - 1]
                            order[idx - 1] = order[idx]
                            order[idx] = t
                            updateQuantityDongsOrderApi(user.email, order).then(load).catch((e) => setError(e.message))
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={idx >= sorted.length - 1 || !user?.email}
                          onClick={() => {
                            if (!user?.email || idx >= sorted.length - 1) return
                            const order = sorted.map((x) => x.id)
                            const t = order[idx + 1]
                            order[idx + 1] = order[idx]
                            order[idx] = t
                            updateQuantityDongsOrderApi(user.email, order).then(load).catch((e) => setError(e.message))
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="settings-btn-delete"
                          disabled={!user?.email}
                          onClick={() => {
                            if (!user?.email || !window.confirm('삭제할까요?')) return
                            deleteQuantityDongApi(user.email, row.id)
                              .then(() => setItems((prev) => prev.filter((x) => x.id !== row.id)))
                              .catch((e) => setError(e instanceof Error ? e.message : '삭제 실패'))
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  )
}
