import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ModelViewer from '../pages/ModelViewer'
import TrimbleConnectViewer from '../pages/TrimbleConnectViewer'

export interface ModelViewerLoaderProps {
  embedded?: boolean
  onClose?: () => void
  modelId?: string | null
  highlightByFloor?: string | null
  /** URL에 없을 때 물량·모델 화면 등에서 리비전 강제 전달 */
  designRevisionId?: string | null
}

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

/**
 * 기본: 배포/HTTPS는 Trimble Connect 3D 임베드, 로컬 개발은 안정적인 IFC 뷰어.
 * - 로컬에서 Trimble 임베드를 강제로 쓰려면 `?viewer=trimble`
 * - BRACE에 올린 IFC만 보려면 `?viewer=ifc`
 */
export default function ModelViewerLoader({
  embedded,
  onClose,
  modelId: modelIdProp,
  highlightByFloor,
  designRevisionId: designRevisionIdProp,
}: ModelViewerLoaderProps = {}) {
  const [mounted, setMounted] = useState(false)
  const [searchParams] = useSearchParams()

  const viewer = searchParams.get('viewer')?.toLowerCase() || ''
  const useIfc = useMemo(() => {
    if (viewer === 'ifc') return true
    if (viewer === 'trimble') return false
    return import.meta.env.DEV && isLocalDevHost()
  }, [viewer])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        뷰어 불러오는 중…
      </div>
    )
  }

  if (useIfc) {
    return (
      <ModelViewer
        embedded={embedded}
        onClose={onClose}
        modelId={modelIdProp ?? undefined}
        highlightByFloor={highlightByFloor ?? undefined}
        designRevisionId={designRevisionIdProp?.trim() || undefined}
      />
    )
  }

  const designRevisionIdMerged =
    searchParams.get('designRevisionId')?.trim() || designRevisionIdProp?.trim() || ''
  return (
    <TrimbleConnectViewer
      embedded={embedded}
      onClose={onClose}
      designRevisionId={designRevisionIdMerged || undefined}
    />
  )
}
