import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { getDesignDocDxfJsonUrl } from '../api/designDoc'
import DxfViewer from '../components/DxfViewer'

export default function CadViewer() {
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('docId')
  const fileName = searchParams.get('name')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  if (!docId) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>도서를 지정할 수 없습니다. 설계도서 관리에서 캐드 보기를 선택하세요.</p>
        <button type="button" className="btn btn--primary" style={{ marginTop: '1rem' }} onClick={() => window.close()}>
          창 닫기
        </button>
      </div>
    )
  }

  const dxfJsonUrl = getDesignDocDxfJsonUrl(docId)

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f0f0' }}>
      <div style={{ flex: '0 0 auto', padding: 8, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => window.close()}>
          창 닫기
        </button>
        <span style={{ fontSize: 12, color: '#666' }}>
          {ready ? '드래그: 이동 · 휠: 확대/축소' : 'DXF 로딩 중…'}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {error ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: '#fff', margin: 8, borderRadius: 8 }}>
            <p style={{ color: '#c00', marginBottom: '1rem' }}>{error}</p>
            <p style={{ fontSize: 12, color: '#666', marginBottom: '1rem' }}>
              DXF 뷰어는 DXF·DWG 파일만 지원합니다. PDF 등 다른 형식은 캐드 보기 대신 다운로드 후 확인하세요.
            </p>
            {(/경로를 찾을 수 없습니다|404|Failed to fetch|NetworkError|연결할 수 없습니다/i.test(error || '')) && (
              <p style={{ fontSize: 12, color: '#666', marginBottom: '1rem' }}>
                터미널에서 API 서버(5001)가 실행 중인지 확인하고, <code style={{ background: '#f0f0f0', padding: '2px 6px' }}>npm run server</code> 또는 <code style={{ background: '#f0f0f0', padding: '2px 6px' }}>npm run dev:all</code> 실행 후 다시 시도하세요.
              </p>
            )}
            <button type="button" className="btn btn--primary" onClick={() => window.close()}>
              창 닫기
            </button>
          </div>
        ) : (
          <DxfViewer
            dxfJsonUrl={dxfJsonUrl}
            onError={setError}
            onReady={() => setReady(true)}
          />
        )}
      </div>
    </div>
  )
}
