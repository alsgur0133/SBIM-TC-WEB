import { useCallback, useEffect, useState } from 'react'
import SettingsEditableCell from '../../components/SettingsEditableCell'
import { useAuth } from '../../contexts/AuthContext'
import { canAccessProjectManagement } from '../../lib/auth-access'
import {
  getQuantityItemTypeMappingsApi,
  createQuantityItemTypeMappingApi,
  updateQuantityItemTypeMappingApi,
  deleteQuantityItemTypeMappingApi,
  type QuantityItemTypeMapping,
} from '../../api/settingsHub'

const DEFAULT_ROWS: Pick<QuantityItemTypeMapping, 'item_label' | 'model_property' | 'segment'>[] = [
  { segment: '', item_label: '버림콘크리트', model_property: 'FOUNDATION' },
  { segment: '', item_label: '기초', model_property: 'FOOTING' },
  { segment: '', item_label: '기둥', model_property: 'COLUMN' },
  { segment: '', item_label: '독립기초', model_property: 'P_FOOTING' },
  { segment: '', item_label: '보', model_property: 'BEAM' },
  { segment: '', item_label: '벽체', model_property: 'WALL' },
  { segment: '', item_label: '데크슬래브', model_property: 'D_SLAB' },
  { segment: '', item_label: '슬래브', model_property: 'SLAB' },
  { segment: '', item_label: '전이기둥', model_property: 'T_COLUMN' },
  { segment: '', item_label: '전이보', model_property: 'T_BEAM' },
  { segment: '', item_label: '특수전단벽체', model_property: 'SH_WALL' },
  { segment: '', item_label: '전이플레이트', model_property: 'T_SLAB' },
  { segment: '', item_label: '계단', model_property: 'STAIR' },
  { segment: '', item_label: '잡', model_property: 'ETC' },
]

export default function CodeMappingMemberPage() {
  const { user } = useAuth()
  const canManage = user ? canAccessProjectManagement(user) : false
  const [items, setItems] = useState<QuantityItemTypeMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newSeg, setNewSeg] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newModel, setNewModel] = useState('')
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getQuantityItemTypeMappingsApi()
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

  async function seedDefaults() {
    if (!user?.email || !canManage) return
    if (!window.confirm('비어 있지 않은 부재명은 건너뜁니다. 기본 부재 매핑을 일괄 등록할까요?')) return
    setSeeding(true)
    setError('')
    try {
      const existing = new Set(items.map((x) => x.item_label.trim()))
      for (const row of DEFAULT_ROWS) {
        if (existing.has(row.item_label.trim())) continue
        const res = await createQuantityItemTypeMappingApi(user.email, {
          item_label: row.item_label,
          model_property: row.model_property,
          segment: row.segment || undefined,
        })
        if (res.success && res.item) existing.add(res.item.item_label.trim())
      }
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <article className="settings-subpage">
      <header className="settings-subpage__header">
        <h2 className="settings-subpage__title">부재 매핑</h2>
        <p className="settings-subpage__desc">
          물량 데이터의 <strong>부재유형</strong>과 같은 이름을 쓰면 집계·표시와 일치하기 쉽습니다. (모델 속성은 IFC/속성 연계·표준화 참고용){' '}
          <span className="settings-subpage__edit-hint">표 셀은 더블클릭하면 수정할 수 있습니다.</span>
        </p>
      </header>
      {error && <p className="auth-form__error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      {canManage && (
        <div className="settings-subpage__toolbar">
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="구분"
            value={newSeg}
            onChange={(e) => setNewSeg(e.target.value)}
            style={{ maxWidth: 120 }}
          />
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="부재명"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <input
            className="form-control project-mgmt__input settings-toolbar-field"
            placeholder="부재명(모델 속성)"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!newLabel.trim() || !newModel.trim() || !user?.email}
            onClick={() => {
              if (!user?.email) return
              createQuantityItemTypeMappingApi(user.email, {
                item_label: newLabel.trim(),
                model_property: newModel.trim(),
                segment: newSeg.trim() || undefined,
              })
                .then((r) => {
                  if (r.success && r.item) {
                    setItems((prev) => [...prev, r.item!].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
                    setNewLabel('')
                    setNewModel('')
                    setNewSeg('')
                  }
                })
                .catch((e) => setError(e instanceof Error ? e.message : '추가 실패'))
            }}
          >
            추가
          </button>
          <button type="button" className="btn btn--secondary btn--sm" disabled={seeding || !user?.email} onClick={seedDefaults}>
            {seeding ? '등록 중…' : '기본 목록 넣기'}
          </button>
        </div>
      )}
      <div className="settings-subpage__table-wrap settings-subpage__table-wrap--editable">
        <table className="project-mgmt__table design-doc__table settings-table-inline">
          <thead>
            <tr>
              <th>구분</th>
              <th>부재명</th>
              <th>부재명(모델 속성)</th>
              {canManage && <th style={{ width: 72 }}>삭제</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>
                  불러오는 중…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} style={{ color: 'var(--main-text-muted)' }}>
                  등록된 매핑이 없습니다.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.segment ?? ''}
                      emptyLabel="—"
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (next === (row.segment ?? '').trim()) return
                        return updateQuantityItemTypeMappingApi(user.email, row.id, { segment: next || null })
                          .then((r) => {
                            if (r.success && r.item) {
                              setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                            }
                          })
                          .catch(() => load())
                      }}
                    />
                  </td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.item_label}
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (!next || next === row.item_label) return
                        return updateQuantityItemTypeMappingApi(user.email, row.id, { item_label: next })
                          .then((r) => {
                            if (r.success && r.item) {
                              setItems((prev) => prev.map((x) => (x.id === row.id ? r.item! : x)))
                            }
                          })
                          .catch(() => load())
                      }}
                    />
                  </td>
                  <td>
                    <SettingsEditableCell
                      canEdit={!!canManage && !!user?.email}
                      value={row.model_property}
                      className="settings-cell-mono"
                      onCommit={(v) => {
                        if (!user?.email) return
                        const next = v.trim()
                        if (!next || next === row.model_property) return
                        return updateQuantityItemTypeMappingApi(user.email, row.id, { model_property: next })
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
                          if (!user?.email || !window.confirm('이 매핑을 삭제할까요?')) return
                          deleteQuantityItemTypeMappingApi(user.email, row.id)
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
