import ModelViewerLoader from '../components/ModelViewerLoader'

export interface TrimbleConnectViewerPopupProps {
  /** standalone: `/model-viewer` 새 창 전체화면 | main: 레이아웃 안 콘텐츠 영역만 */
  mode?: 'standalone' | 'main'
}

/**
 * 모델 뷰어: 기본 Trimble Connect 임베드. 로컬 IFC는 `?viewer=ifc`.
 * - `main`: 사이드바 유지 `/trimble-viewer`
 * - `standalone`: 새 창·전체화면 `/model-viewer`
 */
export default function TrimbleConnectViewerPopup({ mode = 'standalone' }: TrimbleConnectViewerPopupProps) {
  if (mode === 'main') {
    return (
      <div className="trimble-viewer-inline">
        <ModelViewerLoader />
      </div>
    )
  }
  return (
    <div className="trimble-viewer-popup">
      <ModelViewerLoader />
    </div>
  )
}
