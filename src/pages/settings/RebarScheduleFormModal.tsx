import { useEffect, useState } from 'react'
import type { RebarDbSection } from '../../api/settingsHub'
import { REBAR_DB_COLUMNS } from './rebarDbColumns'

type Props = {
  section: RebarDbSection
  open: boolean
  title: string
  saving?: boolean
  onClose: () => void
  onConfirm: (data: Record<string, string>) => void
}

function emptyForm(section: RebarDbSection): Record<string, string> {
  const o: Record<string, string> = {}
  for (const c of REBAR_DB_COLUMNS[section]) o[c.key] = ''
  return o
}

export default function RebarScheduleFormModal({ section, open, title, saving, onClose, onConfirm }: Props) {
  const [form, setForm] = useState(() => emptyForm(section))

  useEffect(() => {
    if (open) setForm(emptyForm(section))
  }, [open, section])

  if (!open) return null

  const cols = REBAR_DB_COLUMNS[section]
  const titleId = `rebar-db-form-modal-${section}`
  const focusKey = cols[0]?.key

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="modal" style={{ maxWidth: 520, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="modal__close" onClick={() => !saving && onClose()} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="modal__body">
          <div
            style={{
              border: '1px solid var(--main-border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              background: 'var(--main-bg)',
            }}
          >
            {cols.map((c) => {
              const isRemarks = c.key === 'remarks'
              return (
                <div
                  key={c.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(7rem, 11rem) 1fr',
                    borderBottom: '1px solid var(--main-border)',
                  }}
                >
                  <div
                    style={{
                      padding: '0.5rem 0.65rem',
                      background: 'var(--main-surface)',
                      borderRight: '1px solid var(--main-border)',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: isRemarks ? 'flex-start' : 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      paddingTop: isRemarks ? '0.65rem' : undefined,
                    }}
                  >
                    {c.label}
                  </div>
                  <div style={{ padding: '0.35rem', background: 'var(--main-bg)' }}>
                    {isRemarks ? (
                      <textarea
                        className="form-control"
                        rows={5}
                        value={form[c.key]}
                        onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                        style={{ width: '100%', resize: 'vertical', minHeight: '5.5rem' }}
                        disabled={saving}
                      />
                    ) : (
                      <input
                        type="text"
                        className="form-control"
                        value={form[c.key]}
                        onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                        style={{ width: '100%' }}
                        disabled={saving}
                        autoFocus={c.key === focusKey}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--main-border)',
          }}
        >
          <button type="button" className="btn btn--secondary btn--sm" disabled={saving} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={saving}
            onClick={() => onConfirm({ ...form })}
          >
            {saving ? '저장 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
