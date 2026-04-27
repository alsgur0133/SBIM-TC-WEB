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

/**
 * 기본: Trimble Connect 3D 임베드 뷰어.
 * BRACE에 올린 IFC만 보려면 주소에 `?viewer=ifc` (또는 `&viewer=ifc`)를 붙이세요.
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
  const useIfc = useMemo(() => viewer === 'ifc', [viewer])

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
