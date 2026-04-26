import { useCallback, useEffect, useMemo, useState } from 'react'
import SettingsEditableCell from '../../components/SettingsEditableCell'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessProjectManagement } from '../../lib/auth-access'
import {
  getQuantityFloorsApi,
  createQuantityFloorApi,
  updateQuantityFloorApi,
  deleteQuantityFloorApi,
  updateQuantityFloorsOrderApi,
  type QuantityFloor,
} from '../../api/quantityFile'

export default function CodeMappingFloorPage() {
  const { user } = useAuth()
  const canManage = user ? canAccessProjectManagement(user) : false
  const [items, setItems] = useState<QuantityFloor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newVal, setNewVal] = useState('')

  const sorted = useMemo(() => [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id), [items])

  const load = useCallback(() => {
    setLoading(true)
    getQuantityFloorsApi()
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
        <h2 className="settings-subpage__title">층 관리</h2>
        <p className="settings-subpage__desc">
          물량 데이터의 층 표기와 맞추어 등록합니다. 물량집계·필터와 동일한 마스터입니다.{' '}
          <span className="settings-subpage__edit-hint">층 이름은 더블클릭하면 수정할 수 있습니다.</span>
        </p>
      </header>
      {error && <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {canManage && (
        <div className="settings-subpage__toolbar">
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="층 (예: 1F)"
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
              createQuantityFloorApi(user.email, newVal.trim())
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
              <th>층</th>
              {canManage && <th style={{ width: 200 }}>작업</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canManage ? 3 : 2} style={{ color: 'var(--main-text-muted)' }}>불러오는 중…</td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 3 : 2} style={{ color: 'var(--main-text-muted)' }}>등록된 층이 없습니다.</td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <tr key={row.id}>
                  <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.floor_value}
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (!next || next === row.floor_value) return
                        return updateQuantityFloorApi(user.email, row.id, { floor_value: next })
                          .then((r) => {
                            if (r.success && r.item) {
                              setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                            }
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
                            updateQuantityFloorsOrderApi(user.email, order).then(load).catch((e) => setError(e.message))
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
                            updateQuantityFloorsOrderApi(user.email, order).then(load).catch((e) => setError(e.message))
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
                            deleteQuantityFloorApi(user.email, row.id)
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
