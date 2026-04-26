import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  browseTrimbleConnectFolderApi,
  importTrimbleConnectFilesApi,
  type TrimbleBrowseItem,
  type TrimbleConnectImportSummary,
} from '../api/projects'

export interface TrimbleConnectImportButtonProps {
  projectId: string
  /** BRACE 프로젝트에 `trimble_connect_project_id`가 있을 때 true */
  trimbleProjectLinked: boolean
  designRevisionId: string | null | undefined
  userEmail: string
  canManage: boolean
  /** 가져온 뒤 목록 새로고침 */
  onImported: () => void
  /** 툴바 버튼 문구 */
  label?: string
  defaultImportModels?: boolean
  defaultImportDocuments?: boolean
  defaultImportQuantity?: boolean
}

type SelectedMeta = { name: string; versionId?: string; path: string[] }

function TreeFolderRows(props: {
  folderId: string
  folderPath: string[]
  depth: number
  cache: Record<string, TrimbleBrowseItem[] | undefined>
  expanded: Set<string>
  loadingByFolder: Record<string, boolean>
  selectedFiles: Map<string, SelectedMeta>
  onToggleFolder: (folderId: string, opening: boolean) => void
  onToggleFile: (id: string, name: string, versionId: string | undefined, path: string[]) => void
}) {
  const {
    folderId,
    folderPath,
    depth,
    cache,
    expanded,
    loadingByFolder,
    selectedFiles,
    onToggleFolder,
    onToggleFile,
  } = props
  const items = cache[folderId]

  if (items === undefined) {
    return (
      <li style={{ listStyle: 'none', paddingLeft: depth * 14, fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
        {loadingByFolder[folderId] ? '불러오는 중…' : '(내용 없음)'}
      </li>
    )
  }
  if (items.length === 0) {
    return (
      <li style={{ listStyle: 'none', paddingLeft: depth * 14, fontSize: '0.85rem', color: 'var(--main-text-muted)' }}>
        (비어 있음)
      </li>
    )
  }

  return (
    <>
      {items.map((it) =>
        it.kind === 'folder' ? (
          <li key={`f-${it.id}`} style={{ listStyle: 'none' }}>
            <div
              style={{
                paddingLeft: depth * 14,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginBottom: 2,
              }}
            >
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ padding: '0.1rem 0.35rem', minWidth: 'auto', fontSize: '0.75rem', lineHeight: 1.2 }}
                onClick={() => onToggleFolder(it.id, !expanded.has(it.id))}
                aria-expanded={expanded.has(it.id)}
              >
                {expanded.has(it.id) ? '▼' : '▶'}
              </button>
              <span
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => onToggleFolder(it.id, !expanded.has(it.id))}
                title="하위 폴더 열기"
              >
                📁 {it.name}
              </span>
            </div>
            {expanded.has(it.id) && (
              <ul style={{ margin: 0, padding: 0 }}>
                <TreeFolderRows
                  folderId={it.id}
                  folderPath={[...folderPath, it.name]}
                  depth={depth + 1}
                  cache={cache}
                  expanded={expanded}
                  loadingByFolder={loadingByFolder}
                  selectedFiles={selectedFiles}
                  onToggleFolder={onToggleFolder}
                  onToggleFile={onToggleFile}
                />
              </ul>
            )}
          </li>
        ) : (
          <li key={`fl-${it.id}`} style={{ listStyle: 'none' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                paddingLeft: depth * 14 + 22,
                marginBottom: 2,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              <input
                type="checkbox"
                checked={selectedFiles.has(it.id)}
                onChange={() => onToggleFile(it.id, it.name, it.versionId, folderPath)}
              />
              <span>{it.name}</span>
            </label>
          </li>
        )
      )}
    </>
  )
}

export function TrimbleConnectImportButton({
  projectId,
  trimbleProjectLinked,
  designRevisionId,
  userEmail,
  canManage,
  onImported,
  label = 'Connect에서 가져오기',
  defaultImportModels = true,
  defaultImportDocuments = true,
  defaultImportQuantity = false,
}: TrimbleConnectImportButtonProps) {
  const { refreshTrimbleAccessToken, trimbleTokens } = useAuth()
  const [open, setOpen] = useState(false)
  const [im, setIm] = useState(defaultImportModels)
  const [idoc, setIdoc] = useState(defaultImportDocuments)
  const [iqty, setIqty] = useState(defaultImportQuantity)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [lastSummary, setLastSummary] = useState<TrimbleConnectImportSummary | null>(null)

  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [rootFolderId, setRootFolderId] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, TrimbleBrowseItem[] | undefined>>({})
  const cacheRef = useRef<Record<string, TrimbleBrowseItem[] | undefined>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loadingByFolder, setLoadingByFolder] = useState<Record<string, boolean>>({})
  const [selectedFiles, setSelectedFiles] = useState<Map<string, SelectedMeta>>(() => new Map())

  useEffect(() => {
    cacheRef.current = cache
  }, [cache])

  useEffect(() => {
    if (!open || !trimbleProjectLinked || !designRevisionId) return
    let cancelled = false
    setBrowseError('')
    setBrowseLoading(true)
    setCache({})
    cacheRef.current = {}
    setExpanded(new Set())
    setSelectedFiles(new Map())
    setRootFolderId(null)
    setLoadingByFolder({})
    ;(async () => {
      try {
        const tok = await refreshTrimbleAccessToken({ force: false })
        const access = tok?.accessToken ?? trimbleTokens?.accessToken
        if (!access) {
          if (!cancelled) setBrowseError('Trimble Connect로 로그인한 뒤 다시 시도하세요.')
          return
        }
        const data = await browseTrimbleConnectFolderApi(projectId, userEmail, access, null)
        if (cancelled) return
        setRootFolderId(data.rootFolderId)
        const next = { [data.folderId]: data.items }
        setCache(next)
        cacheRef.current = next
      } catch (e) {
        if (!cancelled) setBrowseError(e instanceof Error ? e.message : 'Connect 목록을 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setBrowseLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, projectId, trimbleProjectLinked, designRevisionId, userEmail, refreshTrimbleAccessToken, trimbleTokens?.accessToken])

  const loadFolderIfNeeded = useCallback(
    async (fid: string) => {
      if (cacheRef.current[fid] !== undefined) return
      setLoadingByFolder((p) => ({ ...p, [fid]: true }))
      try {
        const tok = await refreshTrimbleAccessToken({ force: false })
        const access = tok?.accessToken ?? trimbleTokens?.accessToken
        if (!access) throw new Error('Trimble 토큰이 없습니다.')
        const data = await browseTrimbleConnectFolderApi(projectId, userEmail, access, fid)
        setCache((c) => ({ ...c, [data.folderId]: data.items }))
      } catch (e) {
        setBrowseError(e instanceof Error ? e.message : '하위 폴더를 불러오지 못했습니다.')
        setCache((c) => ({ ...c, [fid]: [] }))
      } finally {
        setLoadingByFolder((p) => {
          const n = { ...p }
          delete n[fid]
          return n
        })
      }
    },
    [projectId, userEmail, refreshTrimbleAccessToken, trimbleTokens?.accessToken]
  )

  const onToggleFolder = useCallback(
    (fid: string, opening: boolean) => {
      setExpanded((prev) => {
        const n = new Set(prev)
        if (opening) n.add(fid)
        else n.delete(fid)
        return n
      })
      if (opening) void loadFolderIfNeeded(fid)
    },
    [loadFolderIfNeeded]
  )

  const onToggleFile = useCallback((id: string, name: string, versionId: string | undefined, path: string[]) => {
    setSelectedFiles((prev) => {
      const n = new Map(prev)
      if (n.has(id)) n.delete(id)
      else n.set(id, { name, versionId, path: [...path] })
      return n
    })
  }, [])

  if (!canManage) return null

  const disabledReason = !trimbleProjectLinked
    ? '프로젝트에 Trimble Connect가 연결되어 있지 않습니다.'
    : !designRevisionId
      ? '설계 리비전을 선택하세요.'
      : ''

  const runImport = async () => {
    setMsg('')
    setLastSummary(null)
    if (!designRevisionId || !trimbleProjectLinked) return
    const tok = await refreshTrimbleAccessToken({ force: false })
    const access = tok?.accessToken ?? trimbleTokens?.accessToken
    if (!access) {
      setMsg('Trimble Connect로 로그인한 뒤 다시 시도하세요. (토큰이 없거나 만료되었습니다.)')
      return
    }
    if (!im && !idoc && !iqty) {
      setMsg('가져올 유형(모델·도서·물량)을 하나 이상 켜 주세요.')
      return
    }
    const selectedList = Array.from(selectedFiles.entries()).map(([id, meta]) => ({
      id,
      name: meta.name,
      versionId: meta.versionId,
      path: meta.path,
    }))
    if (selectedList.length === 0) {
      setMsg('가져올 파일을 아래 Connect 폴더 트리에서 선택하세요.')
      return
    }
    setLoading(true)
    try {
      const { summary } = await importTrimbleConnectFilesApi(
        projectId,
        userEmail,
        access,
        designRevisionId,
        {
          importModels: im,
          importDocuments: idoc,
          importQuantity: iqty,
          selectedFileEntries: selectedList,
        }
      )
      setLastSummary(summary)
      setMsg(
        `스캔 ${summary.scanned}건 — 모델 +${summary.importedModels}, 도서 +${summary.importedDocs}, 물량 +${summary.importedQuantity}, 건너뜀 ${summary.skipped}, 오류 ${summary.errors}`
      )
      onImported()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '가져오기에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        disabled={!!disabledReason}
        title={disabledReason || 'Trimble Connect 프로젝트 폴더에서 파일을 BRACE에 등록합니다.'}
        onClick={() => {
          setOpen(true)
          setMsg('')
          setLastSummary(null)
        }}
      >
        {label}
      </button>
      {open && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="trimble-import-title"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 'min(840px, 96vw)', margin: '1rem', width: '100%', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="trimble-import-title" style={{ marginTop: 0 }}>
              Trimble Connect에서 가져오기
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--main-text-muted)' }}>
              아래에서 Connect 프로젝트 폴더를 펼쳐 파일을 선택한 뒤 가져옵니다. 확장자에 따라 설계모델(IFC 등), 설계도서(DWG·PDF 등),
              물량(엑셀)로 등록하며, 위 옵션으로 유형을 제한할 수 있습니다. 이미 동일 Connect 파일 ID로 등록된 항목은 건너뜁니다.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '0.75rem 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={im} onChange={(e) => setIm(e.target.checked)} />
                설계 모델 (.ifc, .ifczip)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={idoc} onChange={(e) => setIdoc(e.target.checked)} />
                설계 도서 (.dwg, .pdf, 이미지 등)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={iqty} onChange={(e) => setIqty(e.target.checked)} />
                물량 파일 (.xlsx, .xls)
              </label>
            </div>
            <div
              style={{
                border: '1px solid var(--main-border, #ddd)',
                borderRadius: 6,
                padding: '0.5rem 0.35rem',
                minHeight: 200,
                maxHeight: 'min(420px, 45vh)',
                overflow: 'auto',
                background: 'var(--main-bg-elevated, rgba(0,0,0,0.02))',
              }}
            >
              {browseLoading && (
                <div style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--main-text-muted)' }}>Connect 구조를 불러오는 중…</div>
              )}
              {browseError && !browseLoading && (
                <div className="auth-form__error" style={{ margin: '0.5rem' }}>
                  {browseError}
                </div>
              )}
              {!browseLoading && !browseError && rootFolderId && (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--main-text-muted)', margin: '0 0.35rem 0.35rem' }}>
                    프로젝트 루트 — 선택된 파일 {selectedFiles.size}개
                  </div>
                  <ul style={{ margin: 0, padding: 0 }}>
                    <TreeFolderRows
                      folderId={rootFolderId}
                      folderPath={[]}
                      depth={0}
                      cache={cache}
                      expanded={expanded}
                      loadingByFolder={loadingByFolder}
                      selectedFiles={selectedFiles}
                      onToggleFolder={onToggleFolder}
                      onToggleFile={onToggleFile}
                    />
                  </ul>
                </>
              )}
            </div>
            {msg && (
              <div
                className={lastSummary && !msg.toLowerCase().includes('실패') ? undefined : 'auth-form__error'}
                style={{
                  marginTop: '0.75rem',
                  whiteSpace: 'pre-wrap',
                  ...(lastSummary && !msg.toLowerCase().includes('실패')
                    ? { color: 'var(--main-text-muted)' }
                    : {}),
                }}
              >
                {msg}
              </div>
            )}
            {lastSummary && lastSummary.failed.length > 0 && (
              <details style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                <summary>실패 목록 ({lastSummary.failed.length})</summary>
                <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem' }}>
                  {lastSummary.failed.slice(0, 20).map((f, i) => (
                    <li key={i}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                  {lastSummary.failed.length > 20 && <li>… 외 {lastSummary.failed.length - 20}건</li>}
                </ul>
              </details>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => setOpen(false)}>
                닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={loading || !!disabledReason || browseLoading || !!browseError || !rootFolderId}
                onClick={() => void runImport()}
              >
                {loading ? '가져오는 중…' : '가져오기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
