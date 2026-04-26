import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SettingsEditableCell from '../../components/SettingsEditableCell'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessProjectManagement } from '../../lib/auth-access'
import {
  getQuantitySpecsApi,
  createQuantitySpecApi,
  deleteQuantitySpecApi,
  updateQuantitySpecApi,
  type QuantitySpec,
} from '../../api/quantityFile'

const TABS = [
  { category: '콘크리트' as const, label: '콘크리트' },
  { category: '거푸집' as const, label: '폼(거푸집)' },
  { category: '철근' as const, label: '철근' },
]

export default function CodeMappingMaterialPage() {
  const { user } = useAuth()
  const canManage = user ? canAccessProjectManagement(user) : false
  const [tab, setTab] = useState<(typeof TABS)[number]['category']>('콘크리트')
  const [items, setItems] = useState<QuantitySpec[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null)
  const skipCategoryBlurRef = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    getQuantitySpecsApi()
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

  const filtered = useMemo(
    () => items.filter((x) => x.category === tab).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [items, tab]
  )

  return (
    <article className="settings-subpage">
      <header className="settings-subpage__header">
        <h2 className="settings-subpage__title">자재 코드</h2>
        <p className="settings-subpage__desc">
          물량집계표의 콘크리트·폼·철근 열 구성과 동일한 규격 마스터입니다. 여기서 바꾸면 다음 집계부터 반영됩니다.{' '}
          <span className="settings-subpage__edit-hint">
            유형·코드는 더블클릭하면 수정할 수 있습니다. 유형을 바꾸면 현재 탭 목록에서 사라질 수 있습니다.
          </span>
        </p>
      </header>
      {error && <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <div className="settings-subpage__toolbar">
        {TABS.map((t) => (
          <button
            key={t.category}
            type="button"
            className={tab === t.category ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm'}
            onClick={() => setTab(t.category)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {canManage && (
        <div className="settings-subpage__toolbar">
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="코드·규격 (예: C27, 경사거푸집, SD400_D13)"
            value={newSpec}
            onChange={(e) => setNewSpec(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 200 }}
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!newSpec.trim() || !user?.email}
            onClick={() => {
              if (!user?.email) return
              createQuantitySpecApi(user.email, newSpec.trim(), tab)
                .then((r) => {
                  if (r.success && r.item) {
                    setItems((prev) => [...prev, r.item!])
                    setNewSpec('')
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
              <th style={{ width: 72 }}>NO.</th>
              <th>유형</th>
              <th>코드</th>
              {canManage && <th style={{ width: 88 }}>삭제</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>불러오는 중…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>
                  이 분류에 등록된 규격이 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => (
                <tr key={row.id}>
                  <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                  <td>
                    {canManage && editingCategoryId === row.id ? (
                      <select
                        className="settings-inline-input"
                        defaultValue={row.category}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            skipCategoryBlurRef.current = true
                            setEditingCategoryId(null)
                          }
                        }}
                        onBlur={(e) => {
                          if (skipCategoryBlurRef.current) {
                            skipCategoryBlurRef.current = false
                            return
                          }
                          const next = e.target.value
                          setEditingCategoryId(null)
                          if (!user?.email || next === row.category) return
                          updateQuantitySpecApi(user.email, row.id, { category: next })
                            .then((r) => {
                              if (r.success && r.item) {
                                setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                              }
                            })
                            .catch(() => load())
                        }}
                      >
                        {TABS.map((t) => (
                          <option key={t.category} value={t.category}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    ) : canManage ? (
                      <span
                        className="settings-cell-view"
                        title="더블클릭하여 유형 변경"
                        role="button"
                        tabIndex={0}
                        onDoubleClick={() => setEditingCategoryId(row.id)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault()
                            setEditingCategoryId(row.id)
                          }
                        }}
                      >
                        {TABS.find((t) => t.category === row.category)?.label ?? row.category}
                      </span>
                    ) : (
                      <span>{TABS.find((t) => t.category === row.category)?.label ?? row.category}</span>
                    )}
                  </td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.spec_value}
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (!next || next === row.spec_value) return
                        return updateQuantitySpecApi(user.email, row.id, { spec_value: next })
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
                      <button
                        type="button"
                        className="settings-btn-delete"
                        disabled={!user?.email}
                        onClick={() => {
                          if (!user?.email || !window.confirm(`"${row.spec_value}" 삭제할까요?`)) return
                          deleteQuantitySpecApi(user.email, row.id)
                            .then(() => setItems((prev) => prev.filter((x) => x.id !== row.id)))
                            .catch((e) => setError(e instanceof Error ? e.message : '삭제 실패'))
                        }}
                      >
                        삭제
                      </button>
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
