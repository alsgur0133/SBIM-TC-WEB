import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'

export interface ModelViewerLoaderProps {
  embedded?: boolean
  onClose?: () => void
  modelId?: string | null
  highlightByFloor?: string | null
}

/**
 * ModelViewer를 동적으로 불러와서 렌더링합니다.
 * three / web-ifc-three 로드 실패 시 에러 메시지를 표시합니다.
 */
export default function ModelViewerLoader({ embedded, onClose, modelId, highlightByFloor }: ModelViewerLoaderProps = {}) {
  const [Component, setComponent] = useState<ComponentType<any> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    import('../pages/ModelViewer')
      .then((m) => {
        if (!cancelled) setComponent(() => m.default)
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err?.message || String(err)
          setLoadError(msg)
        }
      })
    return () => { cancelled = true }
  }, [])

  if (loadError) {
    return (
      <div
        style={{
          padding: '2rem',
          maxWidth: '480px',
          margin: '2rem auto',
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem', color: '#dc2626' }}>모델 뷰어를 불러올 수 없습니다</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
          아래를 순서대로 확인한 뒤 개발 서버를 재시작하고 다시 시도하세요.
        </p>
        <ul style={{ margin: '1rem 0 0 1.25rem', color: '#475569', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <li>터미널에서 <code style={{ background: '#f1f5f9', padding: '0.2em 0.4em', borderRadius: 4 }}>npm install</code> 실행</li>
          <li>
            <code style={{ background: '#f1f5f9', padding: '0.2em 0.4em', borderRadius: 4 }}>public/wasm/web-ifc.wasm</code> 파일 존재 여부
            <br />
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              없으면: <code>node_modules\web-ifc\web-ifc.wasm</code> 을 <code>public\wasm\</code> 폴더에 복사
            </span>
          </li>
          <li>브라우저 콘솔(F12)에 다른 오류가 있는지 확인</li>
        </ul>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#94a3b8' }}>
          오류: {loadError}
        </p>
        <button
          type="button"
          onClick={() => window.close()}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          창 닫기
        </button>
      </div>
    )
  }

  if (!Component) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        뷰어 불러오는 중…
      </div>
    )
  }

  return (
    <Component
      embedded={embedded}
      onClose={onClose}
      modelId={modelId}
      highlightByFloor={highlightByFloor}
    />
  )
}
