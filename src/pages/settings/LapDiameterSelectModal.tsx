import { useEffect, useState, type CSSProperties } from 'react'
import {
  LAP_PICKER_DIAMETER_OPTIONS,
  LAP_PICKER_FCK_OPTIONS,
  LAP_PICKER_FY_OPTIONS,
} from './rebarDbColumns'

type Props = {
  open: boolean
  saving?: boolean
  onClose: () => void
  onConfirm: (payload: { fck: string; fy: string; diameters: string[] }) => void
}

const listStyle: CSSProperties = {
  border: '1px solid var(--main-border)',
  borderRadius: 'var(--radius)',
  background: 'var(--main-bg)',
  maxHeight: 280,
  overflow: 'auto',
  margin: 0,
  padding: '0.25rem 0',
  listStyle: 'none',
}

const itemStyle: CSSProperties = {
  padding: '0.35rem 0.6rem',
  cursor: 'pointer',
  fontSize: '0.875rem',
}

export default function LapDiameterSelectModal({ open, saving, onClose, onConfirm }: Props) {
  const [fck, setFck] = useState<string>(LAP_PICKER_FCK_OPTIONS[0])
  const [fy, setFy] = useState<string>(LAP_PICKER_FY_OPTIONS[0])
  const [diameters, setDiameters] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (open) {
      setFck(LAP_PICKER_FCK_OPTIONS[0])
      setFy(LAP_PICKER_FY_OPTIONS[0])
      setDiameters(new Set())
    }
  }, [open])

  if (!open) return null

  function toggleDia(d: string) {
    setDiameters((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  const titleId = 'lap-diameter-picker-modal'

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
      <div className="modal" style={{ maxWidth: 720, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            철근 직경 선택
          </h2>
          <button type="button" className="modal__close" onClick={() => !saving && onClose()} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="modal__body">
          <p style={{ fontSize: '0.85rem', color: 'var(--main-text-muted)', marginBottom: '0.75rem' }}>
            Fck·Fy를 각각 하나 선택하고, 생성할 직경을 복수 선택한 뒤 확인하세요. 선택한 직경마다 이음·정착 길이 행이 추가됩니다.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '0.75rem',
              alignItems: 'start',
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  marginBottom: '0.35rem',
                  padding: '0.25rem 0.35rem',
                  background: 'var(--main-surface)',
                  border: '1px solid var(--main-border)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'center',
                }}
              >
                Fck
              </div>
              <ul style={listStyle}>
                {LAP_PICKER_FCK_OPTIONS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      onClick={() => setFck(v)}
                      style={{
                        ...itemStyle,
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: fck === v ? 'var(--main-accent-soft, rgba(59,130,246,0.15))' : 'transparent',
                        boxShadow: fck === v ? 'inset 0 0 0 2px var(--main-accent, #3b82f6)' : 'none',
                      }}
                    >
                      {v}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  marginBottom: '0.35rem',
                  padding: '0.25rem 0.35rem',
                  background: 'var(--main-surface)',
                  border: '1px solid var(--main-border)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'center',
                }}
              >
                Fy
              </div>
              <ul style={listStyle}>
                {LAP_PICKER_FY_OPTIONS.map((v) => (
                  <li key={v}>
                    <button
                      type="button"
                      onClick={() => setFy(v)}
                      style={{
                        ...itemStyle,
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: fy === v ? 'var(--main-accent-soft, rgba(59,130,246,0.15))' : 'transparent',
                        boxShadow: fy === v ? 'inset 0 0 0 2px var(--main-accent, #3b82f6)' : 'none',
                      }}
                    >
                      {v}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  marginBottom: '0.35rem',
                  padding: '0.25rem 0.35rem',
                  background: 'var(--main-surface)',
                  border: '1px solid var(--main-border)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'center',
                }}
              >
                직경
              </div>
              <ul style={listStyle}>
                {LAP_PICKER_DIAMETER_OPTIONS.map((v) => (
                  <li key={v}>
                    <label
                      style={{
                        ...itemStyle,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={diameters.has(v)}
                        onChange={() => toggleDia(v)}
                        disabled={saving}
                      />
                      <span>{v}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
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
            disabled={saving || diameters.size === 0}
            onClick={() => onConfirm({ fck, fy, diameters: [...diameters].sort((a, b) => Number(a) - Number(b)) })}
          >
            {saving ? '추가 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
