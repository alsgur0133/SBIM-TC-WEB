import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ProjectContext } from '../contexts/ProjectContext'
import { buildTrimbleConnectWebOpenUrl } from '../api/trimble'
import { connect, getConnectEmbedUrl } from 'trimble-connect-workspace-api'
import type { WorkspaceAPI } from 'trimble-connect-workspace-api'
import type { TrimbleTokens } from '../contexts/AuthContext'
import TrimbleViewerWorkbench from '../components/TrimbleViewerWorkbench'

function looksLikeTrimbleConnectProjectId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim())
}

function resolveEmbedEnv(): 'prod' | 'stage' | 'qa' | 'int' {
  const v = String(import.meta.env.VITE_TRIMBLE_EMBED_ENV || 'prod').toLowerCase()
  if (v === 'stage' || v === 'qa' || v === 'int') return v
  return 'prod'
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback
}

/** 임베드 iframe 로드 후 connect 전 대기 (ms). 너무 짧으면 Trimble 쪽 타임아웃 가능 */
function parseEmbedReadyMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 400 && n <= 30000 ? Math.floor(n) : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise
      .then((v) => {
        window.clearTimeout(t)
        resolve(v)
      })
      .catch((e) => {
        window.clearTimeout(t)
        reject(e)
      })
  })
}

function waitForIframeLoad(iframe: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      iframe.removeEventListener('load', onLoad)
      reject(new Error('iframe 로드 시간 초과'))
    }, timeoutMs)
    const onLoad = () => {
      window.clearTimeout(t)
      resolve()
    }
    iframe.addEventListener('load', onLoad, { once: true })
  })
}

async function runTrimbleEmbedSession(
  iframe: HTMLIFrameElement,
  tokens: TrimbleTokens,
  options: {
    projectId?: string
    connectTimeoutMs: number
    iframeLoadTimeoutMs: number
    readyDelayMs: number
    embedEnv: 'prod' | 'stage' | 'qa' | 'int'
    onDevLog?: (event: string, data: unknown) => void
    onWorkspaceEvent?: (event: string, data: unknown) => void
    /**
     * true: about:blank 생략 후 바로 임베드 URL (약간 빠름, 환경에 따라 불안정).
     * false: 매번 blank → 임베드로 리셋 (안정적, 기본).
     */
    quickStart?: boolean
  }
): Promise<WorkspaceAPI> {
  const embedUrl = getConnectEmbedUrl(options.embedEnv)
  const quickStart = options.quickStart === true

  if (quickStart) {
    const loadPromise = waitForIframeLoad(iframe, options.iframeLoadTimeoutMs)
    iframe.src = embedUrl
    await loadPromise
  } else {
    iframe.src = 'about:blank'
    await sleep(150)
    const loadPromise = waitForIframeLoad(iframe, options.iframeLoadTimeoutMs)
    iframe.src = embedUrl
    await loadPromise
  }
  await sleep(options.readyDelayMs)

  const api = (await withTimeout(
    connect(
      iframe,
      (event: string, data: unknown) => {
        options.onDevLog?.(event, data)
        options.onWorkspaceEvent?.(event, data)
      },
      options.connectTimeoutMs
    ),
    options.connectTimeoutMs + 3000,
    'Trimble Workspace API 연결 시간이 초과되었습니다.'
  )) as WorkspaceAPI

  function embedReady(w: WorkspaceAPI) {
    const e = w?.embed
    return e && typeof e.setTokens === 'function' && typeof e.init3DViewer === 'function' ? e : null
  }

  let embed = embedReady(api)
  if (!embed) {
    /* iframe 스크립트가 늦게 노출되는 환경 대비 */
    await sleep(1200)
    embed = embedReady(api)
  }
  if (!embed) {
    throw new Error('EMBED_UNAVAILABLE')
  }

  const rawSec = Math.floor((tokens.expiresAt - Date.now()) / 1000)
  const expiresIn = Math.max(120, rawSec)
  await withTimeout(
    embed.setTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn,
    }),
    30000,
    'Trimble 토큰 전달 시간이 초과되었습니다.'
  )
  const initOk = await withTimeout(
    embed.init3DViewer(options.projectId ? { projectId: options.projectId } : {}),
    options.connectTimeoutMs,
    'Trimble 3D 뷰어 초기화 시간이 초과되었습니다.'
  )
  if (initOk === false) {
    throw new Error(
      '3D 뷰어 초기화에 실패했습니다. Trimble Connect 프로젝트에 접근 권한이 있는지, 프로젝트 ID가 올바른지 확인하세요.'
    )
  }
  return api
}

export interface TrimbleConnectViewerProps {
  embedded?: boolean
  onClose?: () => void
  /** URL·상위 컴포넌트에서 넘기는 설계 리비전 (물량 연동) */
  designRevisionId?: string | null
}

/**
 * Trimble Connect 3D 뷰어 (Workspace API 임베드).
 * dispatcher 타임아웃 완화: 토큰 선갱신, 긴 API 타임아웃, iframe 재로드 후 재시도.
 */
export default function TrimbleConnectViewer({
  embedded,
  onClose,
  designRevisionId: designRevisionIdProp,
}: TrimbleConnectViewerProps = {}) {
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusLine, setStatusLine] = useState('모델 뷰어 준비 중…')
  const [workspaceApi, setWorkspaceApi] = useState<WorkspaceAPI | null>(null)
  const [selectionRev, setSelectionRev] = useState(0)
  /** 모델 로드·탐색기 파일 클릭 등 → 워크벤치 객체 목록·WBS 재조회 */
  const [sceneReloadTick, setSceneReloadTick] = useState(0)
  /** 브라우저는 number, Node 타입 정의와 충돌 시 number로 통일 */
  const sceneReloadDebounceRef = useRef<number | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { user, trimbleTokens, refreshTrimbleAccessToken } = useAuth()
  const trimbleTokensRef = useRef<TrimbleTokens | null>(trimbleTokens)
  const refreshTrimbleRef = useRef(refreshTrimbleAccessToken)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const projectCtx = useContext(ProjectContext)
  const linkedTrimbleId = projectCtx?.selectedProject?.trimble_connect_project_id?.trim() || ''
  const paramTrimble =
    searchParams.get('trimbleConnectProjectId')?.trim() ||
    searchParams.get('connectProjectId')?.trim() ||
    ''
  const legacyParam = searchParams.get('projectId')?.trim() || ''
  const trimbleConnectProjectId = useMemo(() => {
    if (paramTrimble) return paramTrimble
    if (linkedTrimbleId) return linkedTrimbleId
    if (legacyParam && looksLikeTrimbleConnectProjectId(legacyParam)) return legacyParam
    return undefined
  }, [paramTrimble, linkedTrimbleId, legacyParam])

  const designRevisionId =
    searchParams.get('designRevisionId')?.trim() || designRevisionIdProp?.trim() || ''

  /** 토큰 유무만 구독 — 갱신으로 accessToken 문자열이 바뀌어도 true 유지 → 임베드 effect 무한 재시작 방지 */
  const hasTrimbleSession = Boolean(trimbleTokens?.accessToken)

  useEffect(() => {
    trimbleTokensRef.current = trimbleTokens
  }, [trimbleTokens])

  useEffect(() => {
    refreshTrimbleRef.current = refreshTrimbleAccessToken
  }, [refreshTrimbleAccessToken])

  const connectWebFallbackUrl = buildTrimbleConnectWebOpenUrl(
    trimbleConnectProjectId || linkedTrimbleId || null
  )

  const connectTimeoutMs = parsePositiveInt(
    import.meta.env.VITE_TRIMBLE_CONNECT_TIMEOUT_MS,
    import.meta.env.DEV ? 45000 : 120000
  )
  const iframeLoadTimeoutMs = parsePositiveInt(
    import.meta.env.VITE_TRIMBLE_IFRAME_LOAD_TIMEOUT_MS,
    import.meta.env.DEV ? 45000 : 90000
  )
  /** Trimble iframe 내부 스크립트 준비 시간 — 너무 짧으면 embed API 미노출·타임아웃 다발 */
  const readyDelayMs = parseEmbedReadyMs(import.meta.env.VITE_TRIMBLE_EMBED_READY_MS, 5500)
  const embedEnv = resolveEmbedEnv()
  const tryEmbedOnHttp =
    import.meta.env.VITE_TRIMBLE_TRY_EMBED_ON_HTTP === 'true' ||
    import.meta.env.VITE_TRIMBLE_TRY_EMBED_ON_HTTP === '1'
  const debugEmbed =
    import.meta.env.VITE_TRIMBLE_EMBED_DEBUG === 'true' || import.meta.env.VITE_TRIMBLE_EMBED_DEBUG === '1'

  const maxEmbedAttempts = useMemo(() => {
    const n = Number(import.meta.env.VITE_TRIMBLE_EMBED_MAX_ATTEMPTS)
    if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.floor(n)
    return 3
  }, [])

  const scheduleWorkbenchSceneReload = useCallback(() => {
    if (sceneReloadDebounceRef.current != null) window.clearTimeout(sceneReloadDebounceRef.current)
    sceneReloadDebounceRef.current = window.setTimeout(() => {
      sceneReloadDebounceRef.current = null
      setSceneReloadTick((t) => t + 1)
    }, 500)
  }, [])

  useEffect(() => {
    return () => {
      if (sceneReloadDebounceRef.current != null) window.clearTimeout(sceneReloadDebounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true, state: { from: { pathname: '/model-viewer' } } })
      return
    }
    if (!hasTrimbleSession) {
      setWorkspaceApi(null)
      setError('Trimble Connect 뷰어를 사용하려면 "Trimble Connect로 로그인" 후 이용해 주세요.')
      setLoading(false)
      return
    }

    if (!isSecureContext && !tryEmbedOnHttp) {
      setWorkspaceApi(null)
      setLoading(false)
      setError('HTTP')
      return
    }

    let cancelled = false
    let fallbackTimeout: number | null = null
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return
      const iframe = iframeRef.current
      if (!iframe) {
        if (!cancelled) {
          setWorkspaceApi(null)
          setLoading(false)
          setError('뷰어 iframe을 찾을 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.')
        }
        return
      }

      const refresh = refreshTrimbleRef.current
      if (!refresh) {
        if (!cancelled) {
          setLoading(false)
          setError('인증 초기화 중입니다. 잠시 후 새로고침해 주세요.')
        }
        return
      }

      const run = async () => {
        setLoading(true)
        setError(null)
        setWorkspaceApi(null)
        setStatusLine('연결 준비 중…')

        /* 만료 임박일 때만 갱신(Trimble refresh 1회용 — 불필요한 force로 소모 방지) */
        let session = (await refresh({ force: false })) || trimbleTokensRef.current || null
        if (!session?.accessToken || session.expiresAt <= Date.now() + 60_000) {
          session = (await refresh({ force: true })) || session
        }

        if (!session?.accessToken) {
          if (!cancelled) {
            setError('Trimble Connect 토큰을 갱신할 수 없습니다. 로그아웃 후 Trimble로 다시 로그인해 주세요.')
            setLoading(false)
          }
          return
        }

        const onDevLog = (event: string, data: unknown) => {
          if (event && (import.meta.env.DEV || debugEmbed)) {
            console.log('[Trimble Connect]', event, data)
          }
        }

        const onWorkspaceEvent = (event: string) => {
          if (event === 'viewer.onSelectionChanged') {
            setSelectionRev((r) => r + 1)
            return
          }
          if (
            event === 'viewer.onModelStateChanged' ||
            event === 'viewer.onModelReset' ||
            event === 'extension.fileSelected' ||
            event === 'extension.fileViewClicked' ||
            event === 'propertyPanel.onModelChanged'
          ) {
            scheduleWorkbenchSceneReload()
          }
        }

        let lastErr: unknown = null
        let connectedApi: WorkspaceAPI | null = null
        for (let attempt = 1; attempt <= maxEmbedAttempts; attempt++) {
          if (cancelled) return
          setStatusLine(
            attempt > 1
              ? `뷰어 연결 재시도 (${attempt}/${maxEmbedAttempts})…`
              : 'Trimble Connect 뷰어 연결 중…'
          )

          if (attempt > 1) {
            session = (await refresh({ force: true })) || session
            if (!session?.accessToken) break
            await sleep(400 * attempt)
          }

          try {
            connectedApi = await runTrimbleEmbedSession(iframe, session, {
              projectId: trimbleConnectProjectId,
              connectTimeoutMs,
              iframeLoadTimeoutMs,
              readyDelayMs,
              embedEnv,
              onDevLog,
              onWorkspaceEvent,
              /* 1차는 항상 안정 경로; 재시도만 빠른 경로 시도 */
              quickStart: attempt > 1,
            })
            lastErr = null
            break
          } catch (err: unknown) {
            lastErr = err
            connectedApi = null
            if (err instanceof Error && err.message === 'EMBED_UNAVAILABLE') {
              if (!cancelled) {
                setWorkspaceApi(null)
                setError('EMBED_UNAVAILABLE')
                setLoading(false)
              }
              return
            }
            const msg = err instanceof Error ? err.message : String(err)
            const isIframeLoad = /iframe 로드 시간 초과/i.test(msg)
            /* iframe 네트워크 실패 외에는 재시도 (Trimble 쪽 일시 오류 대응) */
            const canRetry = attempt < maxEmbedAttempts && !isIframeLoad
            if (!canRetry) {
              break
            }
          }
        }

        if (cancelled) return

        if (lastErr != null) {
          const msg =
            lastErr instanceof Error
              ? lastErr.message
              : 'Trimble Connect 뷰어를 불러오지 못했습니다.'
          setWorkspaceApi(null)
          setError(msg)
        } else {
          setError(null)
          if (!cancelled && connectedApi) {
            setWorkspaceApi(connectedApi)
          }
        }
        if (!cancelled) setLoading(false)
      }

      fallbackTimeout = window.setTimeout(() => {
        if (cancelled) return
        setLoading((prev) => {
          if (!prev) return prev
          setError(
            '뷰어 로딩 시간이 초과되었습니다. 아래 버튼으로 Trimble Connect를 새 탭에서 열어 이용해 주세요.'
          )
          return false
        })
      }, Math.max(connectTimeoutMs + iframeLoadTimeoutMs + readyDelayMs + 15000, import.meta.env.DEV ? 75000 : 180000))

      void run()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      if (fallbackTimeout != null) window.clearTimeout(fallbackTimeout)
      setWorkspaceApi(null)
    }
  }, [
    user,
    hasTrimbleSession,
    trimbleConnectProjectId,
    navigate,
    isSecureContext,
    tryEmbedOnHttp,
    debugEmbed,
    connectTimeoutMs,
    iframeLoadTimeoutMs,
    readyDelayMs,
    embedEnv,
    maxEmbedAttempts,
    scheduleWorkbenchSceneReload,
  ])

  if (error) {
    const isHttpFallback = error === 'HTTP'
    const isEmbedUnavailable = error === 'EMBED_UNAVAILABLE'
    const showGenericError = !isHttpFallback && !isEmbedUnavailable
    return (
      <div style={{ padding: '2rem', maxWidth: '520px', margin: embedded ? '1rem auto' : '2rem auto', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--main-text)', marginBottom: '0.5rem' }}>모델 뷰어 (Trimble Connect)</h2>
        {showGenericError && (
          <p className="auth-form__error" style={{ marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>{error}</p>
        )}
        <p style={{ fontSize: '0.9rem', color: 'var(--main-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
          {isHttpFallback
            ? 'HTTP 접속에서는 보안 컨텍스트 제한으로 임베드 뷰어를 막아 두었습니다. HTTPS로 서비스하거나, 개발·내부망에서만 .env에 VITE_TRIMBLE_TRY_EMBED_ON_HTTP=1 을 넣고 다시 빌드해 임베드 시도를 켤 수 있습니다. 그전까지는 아래 버튼으로 Trimble Connect를 새 탭에서 여세요.'
            : isEmbedUnavailable
              ? '임베드 API를 받지 못했습니다. 방화벽·광고 차단을 확인하고, .env에 VITE_TRIMBLE_EMBED_READY_MS=8000 등으로 대기 시간을 늘려 보세요. VITE_TRIMBLE_EMBED_DEBUG=1 로 콘솔 로그를 켠 뒤 F12에서 메시지를 확인할 수 있습니다. HTTP 사이트는 VITE_TRIMBLE_TRY_EMBED_ON_HTTP=1 로 임베드 시도(HTTPS 권장)를 켤 수 있습니다. 그래도 안 되면 아래에서 Connect를 새 탭으로 여세요.'
              : '네트워크가 느리거나 Trimble 쪽 응답이 지연되면 위 오류가 날 수 있습니다. 잠시 후 다시 시도하거나, 아래에서 Connect를 새 탭으로 여세요. Trimble Developer 포털에서 이 앱(리다이렉트 URI·도메인)이 등록되어 있는지 확인하세요.'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
          <a
            href={connectWebFallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--primary"
          >
            Trimble Connect에서 열기
          </a>
          {embedded && onClose ? (
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              닫기
            </button>
          ) : (
            <button type="button" className="btn btn--secondary" onClick={() => navigate('/')}>
              홈으로
            </button>
          )}
        </div>
      </div>
    )
  }

  const containerStyle: CSSProperties = embedded
    ? { position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }
    : { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }

  return (
    <div style={containerStyle}>
      {embedded && onClose && (
        <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', background: '#2d2d2d', borderBottom: '1px solid #444' }}>
          <button type="button" className="btn btn--secondary" onClick={onClose} style={{ fontSize: '0.875rem' }}>
            뷰어 닫기
          </button>
        </div>
      )}
      <TrimbleViewerWorkbench
        workspace={workspaceApi}
        selectionRev={selectionRev}
        onAfterProgrammaticSelect={() => setSelectionRev((r) => r + 1)}
        designRevisionId={designRevisionId || undefined}
        sceneReloadTick={sceneReloadTick}
        center={
          <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
            {loading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  background: '#1e1e1e',
                  color: '#fff',
                  zIndex: 1,
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <span>{statusLine}</span>
                <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>창을 닫지 말고 잠시만 기다려 주세요.</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              title="Trimble Connect 3D Viewer"
              allow="fullscreen; clipboard-read; clipboard-write"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                display: 'block',
              }}
            />
          </div>
        }
      />
    </div>
  )
}
