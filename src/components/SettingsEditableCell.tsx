import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type Props = {
  canEdit: boolean
  /** 표시·편집에 쓰는 문자열 */
  value: string
  /** 읽기 전용일 때 다른 문자열로 보여줄 때 (숫자 포맷 등) */
  display?: string
  emptyLabel?: string
  inputType?: 'text' | 'number'
  inputProps?: InputHTMLAttributes<HTMLInputElement>
  className?: string
  onCommit: (next: string) => void | Promise<void>
}

/**
 * 기본은 일반 텍스트처럼 보이고, 더블클릭(또는 Enter/스페이스) 시 입력으로 전환합니다.
 */
export default function SettingsEditableCell({
  canEdit,
  value,
  display,
  emptyLabel = '—',
  inputType = 'text',
  inputProps,
  className,
  onCommit,
}: Props) {
  const [editing, setEditing] = useState(false)
  const skipBlurRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editing])

  const shown = display ?? value
  const looksEmpty = shown === '' || shown == null

  if (!canEdit) {
    return <span className={`settings-cell-view ${className ?? ''}`.trim()}>{looksEmpty ? emptyLabel : shown}</span>
  }

  if (!editing) {
    return (
      <span
        className={`settings-cell-view ${looksEmpty ? 'settings-cell-view--empty' : ''} ${className ?? ''}`.trim()}
        title="더블클릭하여 수정"
        role="button"
        tabIndex={0}
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setEditing(true)
          }
        }}
      >
        {looksEmpty ? emptyLabel : shown}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      type={inputType}
      className={`settings-inline-input ${className ?? ''}`.trim()}
      {...inputProps}
      defaultValue={value}
      onKeyDown={(e) => {
        inputProps?.onKeyDown?.(e)
        if (e.key === 'Escape') {
          e.preventDefault()
          skipBlurRef.current = true
          setEditing(false)
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false
          return
        }
        const next = e.target.value.trim()
        const prev = value.trim()
        setEditing(false)
        if (next !== prev) {
          void Promise.resolve(onCommit(next))
        }
      }}
    />
  )
}
