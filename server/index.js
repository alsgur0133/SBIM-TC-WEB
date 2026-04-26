/**
 * BRACE API 서버
 * - 인증: /api/auth/* (회원가입, 로그인, 프로필, 사용자 관리)
 * - 프로젝트: /api/projects (목록/생성/수정/삭제)
 * - 설계일정: /api/design-schedule/phases, /api/design-schedule/revisions
 */
// iisnode: 여러 경로에서 node_modules 찾아서 npm 패키지 로드
const path = require('path')
const fs = require('fs')

/** IIS 500 시 로그가 전혀 없으면: (1) Node 미실행 (2) 이 파일 쓰기 권한 없음 — TEMP 폴백 사용 */
function appendBootLog (line) {
  const stamp = `[${new Date().toISOString()}] ${line}\n`
  try {
    fs.appendFileSync(path.join(__dirname, 'startup.log'), stamp, 'utf8')
    return
  } catch (e1) {
    try {
      const tmp = path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'sbim-tc-web-boot.log')
      fs.appendFileSync(
        tmp,
        stamp + `  (fallback: could not write server/startup.log — ${e1 && e1.message}; __dirname=${__dirname}; cwd=${process.cwd()})\n`,
        'utf8'
      )
    } catch (_) {}
  }
}
appendBootLog('[early] index.js loaded (before express/db). cwd=' + process.cwd())
process.on('uncaughtException', (err) => {
  appendBootLog('uncaughtException: ' + ((err && err.stack) || err))
})
process.on('unhandledRejection', (reason) => {
  appendBootLog('unhandledRejection: ' + ((reason && reason.stack) || String(reason)))
})

const tryPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(__dirname, '..', 'node_modules'),
  path.join(process.cwd(), 'server', 'node_modules'),
  path.join(process.cwd(), 'node_modules')
].filter(p => { try { return fs.existsSync(p) } catch (_) { return false } })
if (tryPaths.length === 0) tryPaths.push(path.join(__dirname, 'node_modules'))
function req (id) {
  for (const dir of tryPaths) {
    try { return require(require.resolve(id, { paths: [dir] })) } catch (_) {}
  }
  throw new Error("Cannot find module '" + id + "'. Run in server folder: npm install --omit=dev (or run npm run prepare-publish-iis and copy publish-iis to server).")
}
const express = req('express')
const cors = req('cors')
const bcrypt = req('bcryptjs')
const multer = req('multer')
const { exec } = require('child_process')
const crypto = require('crypto')
const XLSX = req('xlsx')
const dbModule = require('./db')
const db = dbModule
const {
  createTrimbleConnectProject,
  listTrimbleConnectProjects,
  inviteUsersToTrimbleConnectProject,
  inviteUsersViaTcApi,
} = require('./trimble-connect-projects')
const {
  resolveTrimbleProject,
  listAllConnectFiles,
  browseTrimbleFolderChildren,
  getTrimbleFileDownloadUrl,
  downloadTrimbleBinary,
  uploadFileToTrimbleFolder,
  getOrCreateConnectFolderInParent,
  resolveTrimbleFolderForDesignRevision,
  findScheduleTrimbleFolderIds,
  deleteTrimbleConnectFolderOnce,
  patchTrimbleConnectFolderName,
} = require('./trimble-connect-files')
const { extractIfcSummaryFromFile } = require('./ifc-extract-summary')
const { extractIfcProductsFromFileStream } = require('./ifc-extract-products')

/** 서버 폴더에 시작/오류 로그 기록 (IIS 500 원인 확인용) */
function logStartup (msg) {
  const text = typeof msg === 'string' ? msg : (msg && msg.stack) || String(msg)
  appendBootLog(text)
}

logStartup('index.js loaded, __dirname=' + __dirname)

const UPLOADS_DIR = path.join(__dirname, 'uploads', 'design-docs')
const MODELS_UPLOADS_DIR = path.join(__dirname, 'uploads', 'design-models')
const QUANTITY_UPLOADS_DIR = path.join(__dirname, 'uploads', 'quantity-files')
const REVIEWS_UPLOADS_DIR = path.join(__dirname, 'uploads', 'design-reviews')
const PDF_CACHE_DIR = path.join(__dirname, 'uploads', 'cache-pdf')
const DXF_CACHE_DIR = path.join(__dirname, 'uploads', 'cache-dxf')
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }) } catch (_) {}
try { fs.mkdirSync(MODELS_UPLOADS_DIR, { recursive: true }) } catch (_) {}
try { fs.mkdirSync(QUANTITY_UPLOADS_DIR, { recursive: true }) } catch (_) {}
try { fs.mkdirSync(REVIEWS_UPLOADS_DIR, { recursive: true }) } catch (_) {}
try { fs.mkdirSync(PDF_CACHE_DIR, { recursive: true }) } catch (_) {}
try { fs.mkdirSync(DXF_CACHE_DIR, { recursive: true }) } catch (_) {}

/** DWG 파일을 DXF로 변환. 환경변수 DWG2DXF_CMD 사용 (예: "dwg2dxf -o %OUTPUT% -y %INPUT%") */
function convertDwgToDxf(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const cmdTemplate = process.env.DWG2DXF_CMD || 'dwg2dxf -o %OUTPUT% -y %INPUT%'
    const cmd = (typeof cmdTemplate === 'string' ? cmdTemplate : 'dwg2dxf -o %OUTPUT% -y %INPUT%')
      .replace(/%INPUT%/g, sourcePath)
      .replace(/%OUTPUT%/g, destPath)
      .replace(/%IN%/g, sourcePath)
      .replace(/%OUT%/g, destPath)
    exec(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message || 'DWG→DXF 변환 실패'))
      }
      if (!fs.existsSync(destPath)) {
        return reject(new Error('변환된 DXF 파일이 생성되지 않았습니다.'))
      }
      resolve()
    })
  })
}

/** DWG 파일을 PDF로 변환. 환경변수 DWG2PDF_CMD 사용 (예: "dwg2pdf %INPUT% %OUTPUT%" 또는 변환 스크립트 경로) */
function convertDwgToPdf(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const cmdTemplate = process.env.DWG2PDF_CMD
    if (!cmdTemplate || typeof cmdTemplate !== 'string') {
      return reject(new Error('DWG 변환기가 설정되지 않았습니다. 환경변수 DWG2PDF_CMD를 설정하세요.'))
    }
    const cmd = cmdTemplate
      .replace(/%INPUT%/g, sourcePath)
      .replace(/%OUTPUT%/g, destPath)
      .replace(/%IN%/g, sourcePath)
      .replace(/%OUT%/g, destPath)
    exec(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message || 'DWG 변환 실패'))
      }
      if (!fs.existsSync(destPath)) {
        return reject(new Error('변환된 PDF 파일이 생성되지 않았습니다.'))
      }
      resolve()
    })
  })
}

const designDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = 'doc-' + Date.now()
    const ext = (path.extname(file.originalname) || '').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadDesignDoc = multer({ storage: designDocStorage })

const designModelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MODELS_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = `model-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const ext = (path.extname(file.originalname) || '.ifc').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadDesignModel = multer({ storage: designModelStorage })

const designReviewStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REVIEWS_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id = 'review-' + Date.now()
    const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadDesignReview = multer({ storage: designReviewStorage })

const quantityFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, QUANTITY_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = 'qty-' + Date.now()
    const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadQuantityFile = multer({ storage: quantityFileStorage })

// -----------------------------------------------------------------------------
// 초기화: 기본 관리자 계정 (이메일: sa, 비밀번호: 1234)
// -----------------------------------------------------------------------------
const ADMIN_EMAIL = 'sa'
const ADMIN_PASSWORD = '1234'
const ADMIN_NAME = '관리자'
async function ensureAdmin () {
  try {
    const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10)
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL)
    if (existing) {
      try {
        await db.prepare('UPDATE users SET password = ?, name = ?, status = ?, is_admin = ?, role = ? WHERE email = ?').run(
          hashed, ADMIN_NAME, '활성', 1, '관리자', ADMIN_EMAIL
        )
      } catch (e) {
        const m = String(e.message || e)
        if (/no such column: role/i.test(m)) {
          try {
            await db.prepare('UPDATE users SET password = ?, name = ?, status = ?, is_admin = ? WHERE email = ?').run(
              hashed, ADMIN_NAME, '활성', 1, ADMIN_EMAIL
            )
          } catch (e2) {
            if (/no such column/i.test(String(e2.message || e2))) {
              await db.prepare('UPDATE users SET password = ?, name = ? WHERE email = ?').run(hashed, ADMIN_NAME, ADMIN_EMAIL)
            } else {
              throw e2
            }
          }
        } else if (/no such column/i.test(m)) {
          await db.prepare('UPDATE users SET password = ?, name = ? WHERE email = ?').run(hashed, ADMIN_NAME, ADMIN_EMAIL)
        } else {
          throw e
        }
      }
      console.log('기본 관리자 계정 비밀번호 설정됨 (이메일: sa, 비밀번호: 1234)')
    } else {
      const id = 'admin-' + Date.now()
      try {
        await db.prepare('INSERT INTO users (id, name, email, password, status, is_admin, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          id, ADMIN_NAME, ADMIN_EMAIL, hashed, '활성', 1, '관리자'
        )
      } catch (e) {
        const m = String(e.message || e)
        if (/no such column/i.test(m)) {
          try {
            await db
              .prepare('INSERT INTO users (id, name, email, password, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(id, ADMIN_NAME, ADMIN_EMAIL, hashed, new Date().toISOString().slice(0, 19).replace('T', ' '))
          } catch (e2) {
            if (/no such column/i.test(String(e2.message || e2))) {
              await db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(
                id, ADMIN_NAME, ADMIN_EMAIL, hashed
              )
            } else {
              throw e2
            }
          }
        } else {
          throw e
        }
      }
      console.log('기본 관리자 계정 생성됨 (이메일: sa, 비밀번호: 1234)')
    }
  } catch (err) {
    console.error('관리자 계정 설정 오류:', err)
  }
}
async function ensureRoleDefaults () {
  try {
    await db.prepare("UPDATE users SET role = '관리자' WHERE is_admin = 1 AND (role IS NULL OR role = '')").run()
    await db.prepare("UPDATE users SET role = '일반 사용자' WHERE (role IS NULL OR role = '')").run()
  } catch (_) {}
}

const app = express()
/** IIS Application Request Routing(역방향 프록시) 뒤에서 HTTPS·클라이언트 IP를 맞추려면 TRUST_PROXY=1 */
if (process.env.TRUST_PROXY === '1' || process.env.BEHIND_IIS_ARR === '1') {
  app.set('trust proxy', 1)
}
/** iisnode는 PORT에 TCP 번호가 아니라 Windows named pipe 문자열을 넣습니다. 이때 host(0.0.0.0)를 넘기면 listen이 실패해 IIS 500이 납니다. */
function listenForRequests () {
  const p = process.env.PORT
  const onListen = () => {
    const isPipe = p && /pipe|\\\\/i.test(String(p))
    const hint = isPipe ? 'iisnode (named pipe)' : `http://0.0.0.0:${p || 5001}`
    console.log(`Server running (${hint})`)
    logStartup('listen OK: ' + hint)
  }
  function attachListenError (server) {
    if (!server || typeof server.on !== 'function') return
    server.on('error', (err) => {
      const code = err && err.code
      const msg = (err && err.message) || String(err)
      logStartup('listen error: ' + msg)
      appendBootLog('listen error: ' + msg)
      console.error('[listen]', msg)
      if (code === 'EADDRINUSE') {
        const portHint = /pipe|\\\\/i.test(String(p)) ? 'named pipe' : (p && String(p).trim() ? String(p).trim() : '5001')
        const tip =
          '[listen] EADDRINUSE: 포트 ' +
          portHint +
          ' 가 이미 사용 중입니다. netstat/taskkill 로 점유 프로세스를 끄거나, 수동 실행만 할 때는 publish-iis\\.env 에 PORT=5002 등 다른 포트를 넣으세요. (https://develop… 로 접속하는 건 IIS라 npm start 와 별개입니다.)'
        console.error(tip)
        appendBootLog(tip)
      }
      process.exit(1)
    })
  }
  if (p !== undefined && p !== null && String(p).trim() !== '') {
    const s = String(p).trim()
    if (/pipe/i.test(s) || /^\\\\/.test(s)) {
      attachListenError(app.listen(s, onListen))
      return
    }
    const n = Number(s)
    if (!Number.isNaN(n)) {
      attachListenError(app.listen(n, '0.0.0.0', onListen))
      return
    }
    attachListenError(app.listen(s, onListen))
    return
  }
  attachListenError(app.listen(5001, '0.0.0.0', onListen))
}

app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))

// req.body / req.query 보호 (undefined 접근 방지, 500 방지)
app.use((req, _res, next) => {
  if (typeof req.body !== 'object' || req.body === null) req.body = {}
  if (typeof req.query !== 'object' || req.query === null) req.query = {}
  next()
})

// 요청 로그
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// trailing slash 제거 (라우트 매칭 통일)
app.use((req, res, next) => {
  if (req.path.endsWith('/') && req.path.length > 1) {
    const [pathname, qs] = (req.url || '').split('?')
    req.url = (pathname.replace(/\/+$/, '') || '/') + (qs ? '?' + qs : '')
  }
  next()
})

// 서브경로 배포 시 요청 path에서 prefix 제거 (API·정적파일 라우트보다 먼저 실행되어야 함)
// BASE_PATH 환경 변수가 있으면 사용(빈 문자열이면 루트 배포), 없으면 production 시 bracetc (IIS develop)
const _envBase = process.env.BASE_PATH
const BASE_PATH = ((_envBase !== undefined && _envBase !== null ? _envBase : (process.env.NODE_ENV === 'production' ? 'bracetc' : '')) || '').replace(/\/$/, '')
const BASE_PREFIX = BASE_PATH ? '/' + BASE_PATH : ''
if (BASE_PATH) {
  app.use((req, res, next) => {
    if (req.url === BASE_PREFIX || req.url === BASE_PREFIX + '/' || req.url.startsWith(BASE_PREFIX + '/')) {
      req.url = req.url.slice(BASE_PREFIX.length) || '/'
    }
    next()
  })
}

// API 라우트를 Router에 등록 후 루트와 서브경로(BASE_PREFIX) 양쪽에 마운트 → 모든 API가 서브경로에서 동작
const apiRouter = express.Router()

// -----------------------------------------------------------------------------
// 공통 헬퍼
// -----------------------------------------------------------------------------
const normalizeEmail = (v) => (v || '').trim().toLowerCase()
const toOpt = (v) => (v === undefined || v === null ? null : (String(v).trim() || null))
const sendError = (res, status, message) => res.status(status).json({ success: false, error: message })
/** 한글 등 UTF-8 파일명을 위한 Content-Disposition (RFC 5987 filename*=UTF-8'') */
function contentDispositionFilename(name, inline = false) {
  const n = (name || 'download').trim() || 'download'
  const safe = n.replace(/[^\w.\u3131-\uD7A3-]/g, '_').slice(0, 100)
  const enc = encodeURIComponent(n)
  return (inline ? 'inline' : 'attachment') + `; filename="${safe}"; filename*=UTF-8''${enc}`
}
const send500 = (res, err) => {
  const message = err && (err.message || String(err))
  console.error('[500]', message, err)
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? '서버 오류가 발생했습니다.' : message,
  })
}

function mapDesignModelRow(r) {
  if (!r) return r
  let ifc_meta = null
  if (r.ifc_meta_json) {
    try {
      ifc_meta = JSON.parse(r.ifc_meta_json)
    } catch (_) {
      ifc_meta = null
    }
  }
  const { ifc_meta_json, ...rest } = r
  return { ...rest, ifc_meta }
}

/** 서버에 저장된 IFC 파일에서 헤더·프로젝트명 등 요약을 추출해 DB에 저장 */
async function persistDesignModelIfcMeta(modelId) {
  try {
    const row = await db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(modelId)
    if (!row || !row.file_path || typeof row.file_path !== 'string') return
    if (!/\.ifc$/i.test(row.file_path)) return
    const baseDir = path.resolve(MODELS_UPLOADS_DIR)
    const fileName = path.basename(path.normalize(row.file_path))
    if (!fileName || fileName.startsWith('.')) return
    const filePath = path.join(baseDir, fileName)
    const relative = path.relative(baseDir, path.resolve(baseDir, fileName))
    if (relative.startsWith('..') || path.isAbsolute(relative)) return
    if (!fs.existsSync(filePath)) return
    const summary = extractIfcSummaryFromFile(filePath)
    const now = new Date().toISOString()
    await db.prepare('UPDATE design_models SET ifc_meta_json = ?, ifc_meta_updated_at = ? WHERE id = ?').run(
      JSON.stringify(summary),
      now,
      modelId
    )
  } catch (e) {
    console.warn('[ifc-meta] persist failed', modelId, e && e.message)
  }
}

/** 서버 저장 IFC에서 IfcProduct 계열 목록을 스트림 추출해 DB에 JSON 저장 (web-ifc 없음) */
async function persistDesignModelIfcProducts(modelId) {
  try {
    const row = await db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(modelId)
    if (!row || !row.file_path || typeof row.file_path !== 'string') return
    if (!/\.ifc$/i.test(row.file_path)) return
    const baseDir = path.resolve(MODELS_UPLOADS_DIR)
    const fileName = path.basename(path.normalize(row.file_path))
    if (!fileName || fileName.startsWith('.')) return
    const filePath = path.join(baseDir, fileName)
    const relative = path.relative(baseDir, path.resolve(baseDir, fileName))
    if (relative.startsWith('..') || path.isAbsolute(relative)) return
    if (!fs.existsSync(filePath)) return
    const payload = await extractIfcProductsFromFileStream(filePath)
    const now = new Date().toISOString()
    await db
      .prepare('UPDATE design_models SET ifc_products_json = ?, ifc_products_updated_at = ? WHERE id = ?')
      .run(JSON.stringify(payload), now, modelId)
  } catch (e) {
    console.warn('[ifc-products] persist failed', modelId, e && e.message)
  }
}

/** 모델 POST는 즉시 응답 후 호출. 대용량 IFC·Trimble 재시도로 HTTP가 수분 걸리며 DB 풀·다른 API 500 유발하는 것을 막음 */
async function runTrimbleDesignModelUploadBackground({ modelId, fullPath, trimbleTok, tcId, uploadFileName }) {
  const nowIso = () => new Date().toISOString()
  const saveTrimbleSyncError = async (msg) => {
    const m = String(msg || 'Connect 업로드 실패').slice(0, 4000)
    try {
      await db.prepare('UPDATE design_models SET trimble_sync_error = ?, updated_at = ? WHERE id = ?').run(m, nowIso(), modelId)
    } catch (err) {
      console.warn('[design-models/trimble-bg] trimble_sync_error 저장 실패', modelId, err && err.message)
    }
  }
  try {
    if (!fs.existsSync(fullPath)) {
      console.warn('[design-models/trimble-bg] 파일 없음:', fullPath)
      await saveTrimbleSyncError('서버에 업로드된 파일을 찾을 수 없습니다.')
      return
    }
    const buf = fs.readFileSync(fullPath)
    const revRow = await db
      .prepare(
        `SELECT dp.name AS phase_name, dr.revision_name AS revision_name
         FROM design_models dm
         INNER JOIN design_revisions dr ON dm.design_revision_id = dr.id
         INNER JOIN design_phases dp ON dr.design_phase_id = dp.id
         WHERE dm.id = ?`
      )
      .get(modelId)
    if (!revRow) {
      await saveTrimbleSyncError('모델에 연결된 설계 차수·리비전 정보를 찾을 수 없습니다.')
      return
    }
    const phaseName = revRow.phase_name != null ? String(revRow.phase_name).trim() : ''
    const revisionName = revRow.revision_name != null ? String(revRow.revision_name).trim() : ''

    const resolved = await resolveTrimbleProject(trimbleTok, tcId)
    if (!resolved) {
      console.warn('[design-models/trimble-bg] Connect 프로젝트 resolve 실패', modelId)
      await saveTrimbleSyncError(
        'Trimble Connect에서 이 프로젝트를 찾지 못했습니다. 프로젝트에 연결된 Connect ID·로그인 토큰·리전을 확인하세요.'
      )
      return
    }
    const rootId = String(resolved.project.rootId || '').trim()
    const folderRes = await resolveTrimbleFolderForDesignRevision(
      trimbleTok,
      resolved.apiBase,
      rootId,
      tcId,
      phaseName,
      revisionName
    )
    if (!folderRes.ok) {
      console.warn('[design-models/trimble-bg] 차수/리비전 폴더 준비 실패', modelId, folderRes.error)
      await saveTrimbleSyncError(
        folderRes.error || 'Trimble Connect에 설계 차수·리비전 폴더를 만들 수 없습니다.'
      )
      return
    }
    const targetFolderId = folderRes.folderId
    const up = await uploadFileToTrimbleFolder(trimbleTok, resolved.apiBase, targetFolderId, uploadFileName, buf, tcId)
    if (!up.ok) {
      console.warn('[design-models/trimble-bg] 업로드 실패', modelId, up.error)
      await saveTrimbleSyncError(up.error || 'Connect 업로드가 거부되었습니다.')
      return
    }
    const upNow = nowIso()
    await db
      .prepare(
        'UPDATE design_models SET trimble_file_id = ?, trimble_version_id = ?, trimble_sync_error = NULL, updated_at = ? WHERE id = ?'
      )
      .run(up.fileId, up.versionId, upNow, modelId)
    console.log('[design-models/trimble-bg] Connect 업로드 완료', modelId, up.fileId)
  } catch (e) {
    console.warn('[design-models/trimble-bg] 예외', modelId, e && e.message)
    await saveTrimbleSyncError(e && e.message ? String(e.message) : String(e))
  }
}

/** 클라이언트 `ensureDefaultDesignRevisionId`와 동일: 기본 설계차수 + R0 (없을 때만 생성) */
async function ensureDefaultDesignRevisionServer(projectId) {
  const pid = String(projectId || '').trim()
  if (!pid) throw new Error('projectId가 없습니다.')
  let phaseRow = await db
    .prepare(
      'SELECT id FROM design_phases WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1'
    )
    .get(pid)
  const now = new Date().toISOString()
  if (!phaseRow) {
    const phaseId = 'phase-' + Date.now()
    await db.prepare(
      'INSERT INTO design_phases (id, name, sort_order, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(phaseId, '기본 설계차수', 0, pid, now, now)
    phaseRow = { id: phaseId }
  }
  let revRow = await db
    .prepare(
      'SELECT id FROM design_revisions WHERE design_phase_id = ? ORDER BY revision_name ASC, created_at ASC LIMIT 1'
    )
    .get(phaseRow.id)
  if (!revRow) {
    const revId = 'rev-' + Date.now()
    await db.prepare(
      'INSERT INTO design_revisions (id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(revId, phaseRow.id, 'R0', null, null, '예정', null, now, now)
    return revId
  }
  return revRow.id
}

// 모델 목록 GET (리비전 선택 시 호출) - 다른 :id 라우트보다 먼저 등록
const getDesignModelsListHandler = async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, trimble_file_id, trimble_version_id, trimble_sync_error, ifc_meta_json, ifc_meta_updated_at, ifc_products_updated_at, created_at, updated_at
         FROM design_models WHERE design_revision_id = ? ORDER BY created_at ASC`
      )
      .all(designRevisionId)
    // 한글 등이 깨진 file_name은 title로 보정 (설계도서와 동일)
    const hasKorean = (s) => s && /[\uAC00-\uD7A3]/.test(s)
    const models = rows.map((r) => {
      const out = mapDesignModelRow(r)
      if (out.file_path && out.title && out.file_name && !hasKorean(out.file_name) && hasKorean(out.title)) {
        out.file_name = out.title
      }
      let fileSizeBytes = null
      if (out.file_path) {
        try {
          const full = path.join(MODELS_UPLOADS_DIR, out.file_path)
          fileSizeBytes = fs.statSync(full).size
        } catch (_) {
          fileSizeBytes = null
        }
      }
      out.file_size_bytes = fileSizeBytes
      return out
    })
    res.json({ success: true, models })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.get('/api/design-models', getDesignModelsListHandler)
apiRouter.get('/api/design-model', getDesignModelsListHandler)
// 리비전 선택 시 모델 목록 요청 (trailing slash·경로 변형 대비)
apiRouter.get(/^\/api\/design-models\/?$/i, getDesignModelsListHandler)
apiRouter.get(/^\/api\/design-model\/?$/i, getDesignModelsListHandler)

// 물량파일 목록 GET (경로 충돌 방지를 위해 상단에 등록)
const getQuantityFilesListHandler = async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE design_revision_id = ? ORDER BY created_at ASC'
      )
      .all(designRevisionId)
    res.json({ success: true, files: rows })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.get('/api/quantity-files', getQuantityFilesListHandler)
apiRouter.get(/^\/api\/quantity-files\/?$/i, getQuantityFilesListHandler)

// 물량 데이터에서 사용된 명칭 목록 (매핑용)
apiRouter.get('/api/quantity-files/distinct-names', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT DISTINCT qfi.name FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE qf.design_revision_id = ? AND qfi.name IS NOT NULL AND TRIM(qfi.name) != ''`
      )
      .all(designRevisionId)
    const names = rows.map((r) => String(r.name).trim()).filter(Boolean)
    const unique = [...new Set(names)].sort()
    res.json({ success: true, names: unique })
  } catch (err) {
    send500(res, err)
  }
})

// 물량 데이터에서 사용된 규격 목록 (규격 매핑용)
apiRouter.get('/api/quantity-files/distinct-specs', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT DISTINCT qfi.spec FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE qf.design_revision_id = ? AND qfi.spec IS NOT NULL AND TRIM(qfi.spec) != ''`
      )
      .all(designRevisionId)
    const specs = rows.map((r) => String(r.spec).trim()).filter(Boolean)
    const unique = [...new Set(specs)].sort()
    res.json({ success: true, specs: unique })
  } catch (err) {
    send500(res, err)
  }
})

// 물량 데이터에서 사용된 동 목록 (동관리용)
apiRouter.get('/api/quantity-files/distinct-dongs', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT DISTINCT qfi.dong FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE qf.design_revision_id = ? AND qfi.dong IS NOT NULL AND TRIM(qfi.dong) != ''`
      )
      .all(designRevisionId)
    const dongs = rows.map((r) => String(r.dong).trim()).filter(Boolean)
    const unique = [...new Set(dongs)].sort()
    res.json({ success: true, dongs: unique })
  } catch (err) {
    send500(res, err)
  }
})

// 물량 데이터에서 사용된 층 목록 (층관리용)
apiRouter.get('/api/quantity-files/distinct-floors', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT DISTINCT qfi.floor FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE qf.design_revision_id = ? AND qfi.floor IS NOT NULL AND TRIM(qfi.floor) != ''`
      )
      .all(designRevisionId)
    const floors = rows.map((r) => String(r.floor).trim()).filter(Boolean)
    const unique = [...new Set(floors)].sort()
    res.json({ success: true, floors: unique })
  } catch (err) {
    send500(res, err)
  }
})

// 부재별산출서 필터용: 리비전 전체 물량 데이터 기준 동/층/부재유형/부호 목록
apiRouter.get('/api/quantity-files/data-modal-filters', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT qfi.dong, qfi.floor, qfi.sign
         FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE qf.design_revision_id = ?`
      )
      .all(designRevisionId)
    const dongSet = new Set()
    const floorSet = new Set()
    const signTypeSet = new Set()
    const signCodeSet = new Set()
    for (const r of rows) {
      const dong = r.dong != null ? String(r.dong).trim() : ''
      const floor = r.floor != null ? String(r.floor).trim() : ''
      const sign = r.sign != null ? String(r.sign).trim() : ''
      if (dong) dongSet.add(dong)
      if (floor) floorSet.add(floor)
      const parts = sign.split(/\s+/).filter(Boolean)
      if (parts[0]) signTypeSet.add(parts[0])
      if (parts[1]) signCodeSet.add(parts[1])
    }
    res.json({
      success: true,
      dongs: [...dongSet].sort(),
      floors: [...floorSet].sort(),
      signTypes: [...signTypeSet].sort(),
      signCodes: [...signCodeSet].sort(),
    })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 인증 API (회원가입, 로그인, 프로필, 사용자 관리)
// -----------------------------------------------------------------------------

// 회원가입
apiRouter.post('/api/auth/signup', async (req, res) => {
  try {
    const body = req.body || {}
    const { name, email, password } = body
    const trimmedName = (name || '').trim()
    const normalizedEmail = (email || '').trim().toLowerCase()

    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '이름을 입력하세요.' })
    }
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, error: '이메일을 입력하세요.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: '올바른 이메일 형식이 아닙니다.' })
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, error: '비밀번호는 4자 이상 입력하세요.' })
    }

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)
    if (existing) {
      return res.status(400).json({ success: false, error: '이미 사용 중인 이메일입니다.' })
    }

    const id = String(Date.now())
    const hashedPassword = bcrypt.hashSync(password, 10)
    await db.prepare(
      'INSERT INTO users (id, name, email, password, status, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, trimmedName, normalizedEmail, hashedPassword, '승인대기', 0)

    res.status(201).json({
      success: true,
      message: '가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
      user: null,
    })
  } catch (err) {
    send500(res, err)
  }
})

// 로그인 (구 DB: status/is_admin/created_at 없어도 동작. 최소 컬럼 id,name,email,password만 사용하는 fallback)
const loginHandler = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const email = body.email
    const password = body.password
    const normalizedEmail = (typeof email === 'string' ? email : '').trim().toLowerCase()
    const passwordStr = typeof password === 'string' ? password : ''

    if (!normalizedEmail || !passwordStr) {
      return res.status(400).json({ success: false, error: '이메일과 비밀번호를 입력하세요.' })
    }

    let row
    try {
      row = await db.prepare(
        'SELECT id, name, email, password, status, is_admin, role, company FROM users WHERE email = ?'
      ).get(normalizedEmail)
    } catch (selectErr) {
      const msg = selectErr && String(selectErr.message || selectErr)
      if (!/no such column/i.test(msg)) {
        console.error('[로그인] SELECT 오류:', msg)
        throw selectErr
      }
      try {
        row = await db.prepare(
          'SELECT id, name, email, password, created_at FROM users WHERE email = ?'
        ).get(normalizedEmail)
      } catch (e2) {
        if (/no such column/i.test(String(e2.message || e2))) {
          row = await db.prepare(
            'SELECT id, name, email, password FROM users WHERE email = ?'
          ).get(normalizedEmail)
        } else {
          throw e2
        }
      }
      if (row) {
        row.status = '활성'
        row.is_admin = normalizedEmail === ADMIN_EMAIL ? 1 : 0
      }
    }

    if (!row) {
      return res.status(401).json({ success: false, error: '등록되지 않은 이메일입니다.' })
    }

    const storedPassword = row.password
    const isAdmin = row.is_admin === 1 || row.is_admin === true
    const role = row.role != null ? row.role : (isAdmin ? '관리자' : '일반 사용자')
    const company = row.company !== undefined ? row.company : null

    let passwordOk = false
    if (typeof storedPassword === 'string' && storedPassword.length > 0) {
      try {
        passwordOk = bcrypt.compareSync(passwordStr, storedPassword)
      } catch (hashErr) {
        console.warn('로그인 비밀번호 검증 오류:', hashErr && hashErr.message)
      }
    }

    if (!passwordOk && normalizedEmail === ADMIN_EMAIL && passwordStr === ADMIN_PASSWORD) {
      const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10)
      try {
        await db.prepare('UPDATE users SET password = ?, status = ?, is_admin = ?, role = ? WHERE email = ?').run(
          hashed, '활성', 1, '관리자', ADMIN_EMAIL
        )
      } catch (updErr) {
        const msg = updErr && String(updErr.message || updErr)
        if (/no such column: role/i.test(msg)) {
          try {
            await db.prepare('UPDATE users SET password = ?, status = ?, is_admin = ? WHERE email = ?').run(
              hashed, '활성', 1, ADMIN_EMAIL
            )
          } catch (e2) {
            if (/no such column: (status|is_admin)/i.test(String(e2.message || e2))) {
              await db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashed, ADMIN_EMAIL)
            } else {
              throw e2
            }
          }
        } else if (/no such column: (status|is_admin)/i.test(msg)) {
          await db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashed, ADMIN_EMAIL)
        } else {
          console.error('로그인 관리자 비밀번호 갱신 실패:', updErr)
          return send500(res, updErr)
        }
      }
      passwordOk = true
    }

    if (!passwordOk) {
      return res.status(401).json({ success: false, error: '비밀번호가 일치하지 않습니다.' })
    }

    const statusVal = row.status != null ? String(row.status) : '활성'
    if (statusVal !== '활성') {
      return res.status(403).json({ success: false, error: '관리자 승인 후 로그인할 수 있습니다.' })
    }

    return res.json({
      success: true,
      user: {
        id: row.id,
        name: row.name || '',
        email: row.email,
        isAdmin: !!isAdmin,
        role,
        company: company || undefined,
      },
    })
  } catch (err) {
    const msg = err && (err.message || String(err))
    console.error('[로그인 500]', msg)
    if (err && err.stack) console.error(err.stack)
    if (!res.headersSent) {
      send500(res, err)
    }
  }
}
apiRouter.post('/api/auth/login', loginHandler)

// Trimble Identity OAuth - code를 access_token으로 교환 (PKCE, client_secret은 서버에서만 사용)
apiRouter.post('/api/auth/trimble/token', async (req, res) => {
  try {
    const body = req.body || {}
    const clientId = process.env.TRIMBLE_CLIENT_ID || '2678a42f-dc8f-4101-81b7-d4400e793cce'
    const clientSecret = process.env.TRIMBLE_CLIENT_SECRET
    const tokenUrl = 'https://id.trimble.com/oauth/token'

    const refreshTok = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : ''
    const wantsRefresh =
      body.grant_type === 'refresh_token' || (refreshTok && !body.code && !body.code_verifier)

    if (wantsRefresh) {
      if (!refreshTok) {
        return res.status(400).json({ error: 'refresh_token이 필요합니다.' })
      }
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshTok,
        client_id: clientId,
        client_secret: clientSecret,
      })
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
      })
      const tokenData = await tokenRes.json().catch(() => ({}))
      if (!tokenRes.ok) {
        const errMsg = tokenData.error_description || tokenData.error || `Trimble refresh ${tokenRes.status}`
        return res.status(400).json({ error: errMsg })
      }
      return res.json({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshTok,
        expires_in: tokenData.expires_in,
        id_token: tokenData.id_token,
      })
    }

    const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = body
    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({ error: 'code, code_verifier, redirect_uri가 필요합니다.' })
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code).trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: String(redirectUri).trim(),
      code_verifier: String(codeVerifier).trim(),
    })
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok) {
      const errMsg = tokenData.error_description || tokenData.error || `Trimble token ${tokenRes.status}`
      return res.status(400).json({ error: errMsg })
    }
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      id_token: tokenData.id_token,
    })
  } catch (err) {
    console.error('[Trimble token]', err && (err.message || err))
    send500(res, err)
  }
})

// Trimble API 존재 여부 확인 (브라우저에서 http://localhost:5001/api/auth/trimble/ping 호출 시 200 나오면 재시작된 서버)
apiRouter.get('/api/auth/trimble/ping', (_req, res) => {
  res.json({ ok: true, trimble: 'check-user, register 사용 가능' })
})

// Trimble 로그인 시 회원 여부·승인 상태 확인 (이메일 기준)
apiRouter.post('/api/auth/trimble/check-user', async (req, res) => {
  try {
    const body = req.body || {}
    const email = (body.email || '').trim().toLowerCase()
    if (!email) {
      return res.status(400).json({ success: false, error: 'email이 필요합니다.' })
    }
    let row
    try {
      row = await db.prepare('SELECT id, name, email, status, role, company FROM users WHERE email = ?').get(email)
    } catch (e) {
      if (e && /no such column: (role|company)/i.test(String(e.message))) {
        row = await db.prepare('SELECT id, name, email, status FROM users WHERE email = ?').get(email)
        if (row) {
          row.role = '일반 사용자'
          row.company = null
        }
      } else throw e
    }
    if (!row) {
      return res.json({ success: true, exists: false })
    }
    const status = row.status === '활성' ? '활성' : (row.status || '승인대기')
    const out = { success: true, exists: true, status }
    if (status === '활성') {
      out.user = {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role || '일반 사용자',
        company: row.company || undefined,
      }
    } else if (status === '승인대기') {
      // 승인 대기 안내 화면에 이름·회사 표시용 (null이어도 키 포함해 프론트에서 구분)
      out.user = {
        id: row.id,
        name: row.name != null ? row.name : '',
        email: row.email,
        company: row.company != null ? row.company : null,
      }
    }
    res.json(out)
  } catch (err) {
    send500(res, err)
  }
})

// Trimble 첫 로그인 시 회원정보(이름·회사) 입력 후 가입 신청 (승인대기)
apiRouter.post('/api/auth/trimble/register', async (req, res) => {
  console.log('[Trimble] POST /api/auth/trimble/register 요청 도착')
  try {
    const body = req.body || {}
    const email = (body.email || '').trim().toLowerCase()
    const name = (body.name || '').trim()
    const company = (body.company || '').trim() || null
    const trimbleId = (body.trimbleId || '').trim() || null
    if (!email) {
      return res.status(400).json({ success: false, error: '이메일을 입력하세요.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: '올바른 이메일 형식이 아닙니다.' })
    }
    if (!name) {
      return res.status(400).json({ success: false, error: '이름을 입력하세요.' })
    }
    const existing = await db.prepare('SELECT id, status FROM users WHERE email = ?').get(email)
    if (existing) {
      if (existing.status === '승인대기') {
        return res.status(400).json({ success: false, error: '이미 가입 신청 중입니다. 관리자 승인 후 Trimble Connect로 로그인해 주세요.' })
      }
      return res.status(400).json({ success: false, error: '이미 등록된 이메일입니다.' })
    }
    const id = String(Date.now())
    const randomPassword = require('crypto').randomBytes(32).toString('hex')
    const hashedPassword = bcrypt.hashSync(randomPassword, 10)
    try {
      await db.prepare(
        'INSERT INTO users (id, name, email, password, status, is_admin, role, company, trimble_subject_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, name, email, hashedPassword, '승인대기', 0, '일반 사용자', company, trimbleId)
    } catch (insErr) {
      const insMsg = String(insErr && insErr.message ? insErr.message : insErr)
      if (/no such column:\s*trimble_subject_id/i.test(insMsg)) {
        try {
          await db.exec('ALTER TABLE users ADD COLUMN trimble_subject_id TEXT')
        } catch (_) {}
        await db.prepare(
          'INSERT INTO users (id, name, email, password, status, is_admin, role, company, trimble_subject_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(id, name, email, hashedPassword, '승인대기', 0, '일반 사용자', company, trimbleId)
      } else if (/no such column: (role|company)/i.test(insMsg)) {
        await db.prepare('INSERT INTO users (id, name, email, password, status, is_admin) VALUES (?, ?, ?, ?, ?, ?)').run(
          id, name, email, hashedPassword, '승인대기', 0
        )
      } else throw insErr
    }
    res.status(201).json({
      success: true,
      message: '가입이 완료되었습니다. 관리자 승인 후 Trimble Connect로 로그인할 수 있습니다.',
      user: { id, email, name, status: '승인대기' },
    })
  } catch (err) {
    send500(res, err)
  }
})

// 내 정보 수정 (PUT + POST/update: IIS·프록시가 PUT을 막는 경우 대비)
async function handleProfileUpdate (req, res) {
  try {
    const body = req.body || {}
    const { email, name, company, currentPassword, newPassword } = body
    const normalizedEmail = (email || '').trim().toLowerCase()

    if (!normalizedEmail || !currentPassword) {
      return res.status(400).json({ success: false, error: '이메일과 현재 비밀번호를 입력하세요.' })
    }

    const row = await db.prepare('SELECT id, name, email, password, company FROM users WHERE email = ?').get(normalizedEmail)
    if (!row) {
      return res.status(404).json({ success: false, error: '사용자 정보를 찾을 수 없습니다.' })
    }
    if (!bcrypt.compareSync(currentPassword, row.password)) {
      return res.status(401).json({ success: false, error: '현재 비밀번호가 일치하지 않습니다.' })
    }

    const trimmedName = (name ?? row.name).trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '이름을 입력하세요.' })
    }

    let hashedPassword = row.password
    if (newPassword && newPassword.length >= 4) {
      hashedPassword = bcrypt.hashSync(newPassword, 10)
    }

    const companyVal = company !== undefined ? (String(company).trim() || null) : (row.company ?? null)
    await db.prepare('UPDATE users SET name = ?, company = ?, password = ? WHERE id = ?').run(trimmedName, companyVal, hashedPassword, row.id)

    res.json({
      success: true,
      user: { id: row.id, name: trimmedName, email: row.email, company: companyVal || undefined },
    })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.put('/api/auth/profile', handleProfileUpdate)
apiRouter.post('/api/auth/profile/update', handleProfileUpdate)

// 전체 사용자 목록 (관리자만, 사용자 관리 화면용)
apiRouter.get('/api/auth/users', async (req, res) => {
  try {
    const q = req.query || {}
    const requesterEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    if (!requesterEmail) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    if (!(await canManageProjects(requesterEmail))) {
      return res.status(403).json({ success: false, error: '관리자 또는 프로젝트 관리자만 조회할 수 있습니다.' })
    }
    let rows
    try {
      rows = await db.prepare(
        'SELECT id, name, email, status, is_admin, role, company, trimble_subject_id, created_at FROM users ORDER BY created_at ASC'
      ).all()
    } catch (colErr) {
      const cmsg = String(colErr && colErr.message ? colErr.message : colErr)
      if (/no such column:\s*trimble_subject_id/i.test(cmsg)) {
        rows = await db
          .prepare(
            'SELECT id, name, email, status, is_admin, role, company, created_at FROM users ORDER BY created_at ASC'
          )
          .all()
        rows = rows.map((r) => ({ ...r, trimble_subject_id: null }))
      } else if (/no such column: (role|company)/i.test(cmsg)) {
        rows = await db.prepare('SELECT id, name, email, status, is_admin, created_at FROM users ORDER BY created_at ASC').all()
        rows = rows.map((r) => ({
          ...r,
          role: r.is_admin ? '관리자' : '일반 사용자',
          company: null,
          trimble_subject_id: null,
        }))
      } else throw colErr
    }
    res.json({ success: true, users: rows })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 수정 (관리자만, DB 저장) — PUT + POST/update: IIS WebDAV 등이 PUT을 405로 막을 때 대비
async function handleAdminUserUpdate (req, res) {
  try {
    const body = req.body || {}
    const { adminEmail, name, email, role, status, company } = body
    const normalizedAdmin = (adminEmail || '').trim().toLowerCase()
    if (!normalizedAdmin) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    const admin = await db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizedAdmin)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 수정할 수 있습니다.' })
    }
    const { userId } = req.params
    const target = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId)
    if (!target) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' })
    }
    const trimmedName = (name || '').trim()
    const normalizedEmail = (email || '').trim().toLowerCase()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '이름을 입력하세요.' })
    }
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, error: '이메일을 입력하세요.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: '올바른 이메일 형식이 아닙니다.' })
    }
    if (target.email === ADMIN_EMAIL) {
      if (normalizedEmail !== ADMIN_EMAIL) {
        return res.status(400).json({ success: false, error: '기본 관리자(sa) 이메일은 변경할 수 없습니다.' })
      }
    } else {
      const existing = await db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, userId)
      if (existing) {
        return res.status(400).json({ success: false, error: '이미 사용 중인 이메일입니다.' })
      }
    }
    const roleTrimmed = String(role || '').trim()
    const roleVal =
      roleTrimmed === '관리자'
        ? '관리자'
        : roleTrimmed === '프로젝트 관리자'
          ? '프로젝트 관리자'
          : roleTrimmed === '협력업체'
            ? '협력업체'
            : '일반 사용자'
    const isAdmin = roleVal === '관리자' ? 1 : 0
    const statusVal = status === '활성' || status === '비활성' || status === '승인대기' ? status : '활성'
    if (target.email === ADMIN_EMAIL && roleVal !== '관리자') {
      return res.status(400).json({ success: false, error: '기본 관리자(sa) 역할은 변경할 수 없습니다.' })
    }
    const companyVal = company != null ? String(company).trim() || null : null
    await db.prepare(
      'UPDATE users SET name = ?, email = ?, status = ?, is_admin = ?, role = ?, company = ? WHERE id = ?'
    ).run(trimmedName, normalizedEmail, statusVal, isAdmin, roleVal, companyVal, userId)
    res.json({ success: true, message: '저장되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.put('/api/auth/users/:userId', handleAdminUserUpdate)
apiRouter.post('/api/auth/users/:userId/update', handleAdminUserUpdate)

// 승인 대기 사용자 목록 (관리자만)
apiRouter.get('/api/auth/pending-users', async (req, res) => {
  try {
    const q = req.query || {}
    const adminEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    if (!adminEmail) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    const admin = await db.prepare('SELECT is_admin FROM users WHERE email = ?').get(adminEmail)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 조회할 수 있습니다.' })
    }
    let rows
    try {
      rows = await db.prepare(
        "SELECT id, name, email, company, created_at FROM users WHERE status = '승인대기' ORDER BY created_at ASC"
      ).all()
    } catch (e) {
      if (e && /no such column: company/i.test(String(e.message))) {
        rows = await db.prepare(
          "SELECT id, name, email, created_at FROM users WHERE status = '승인대기' ORDER BY created_at ASC"
        ).all()
        rows = rows.map((r) => ({ ...r, company: null }))
      } else throw e
    }
    res.json({ success: true, users: rows })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 승인 (관리자만)
apiRouter.post('/api/auth/approve-user', async (req, res) => {
  try {
    const body = req.body || {}
    const { adminEmail, userId } = body
    const normalizedAdmin = (adminEmail || '').trim().toLowerCase()
    if (!normalizedAdmin || !userId) {
      return res.status(400).json({ success: false, error: 'adminEmail과 userId가 필요합니다.' })
    }
    const admin = await db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizedAdmin)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 승인할 수 있습니다.' })
    }
    const target = await db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId)
    if (!target) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' })
    }
    if (target.status === '활성') {
      return res.status(400).json({ success: false, error: '이미 승인된 사용자입니다.' })
    }
    await db.prepare("UPDATE users SET status = '활성' WHERE id = ?").run(userId)
    res.json({ success: true, message: '승인되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 삭제 (관리자만, 관리자 계정 sa는 삭제 불가)
apiRouter.delete('/api/auth/users/:userId', async (req, res) => {
  try {
    const q = req.query || {}
    const adminEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    const userId = req.params && req.params.userId
    if (!adminEmail || !userId) {
      return res.status(400).json({ success: false, error: 'adminEmail과 userId가 필요합니다.' })
    }
    const admin = await db.prepare('SELECT is_admin FROM users WHERE email = ?').get(adminEmail)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 삭제할 수 있습니다.' })
    }
    const target = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId)
    if (!target) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' })
    }
    if (target.email === ADMIN_EMAIL) {
      return res.status(400).json({ success: false, error: '기본 관리자 계정(sa)은 삭제할 수 없습니다.' })
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 프로젝트 API (GET: 전체, POST/PUT/DELETE: 관리자·프로젝트 관리자)
// -----------------------------------------------------------------------------
async function canManageProjects(email) {
  if (!email) return false
  try {
    const u = await db.prepare('SELECT role, is_admin FROM users WHERE email = ?').get(normalizeEmail(email))
    return !!(u && (u.role === '프로젝트 관리자' || u.role === '관리자' || u.is_admin === 1))
  } catch (err) {
    if (err && /no such column: role/i.test(String(err.message))) {
      const u = await db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizeEmail(email))
      return !!(u && u.is_admin === 1)
    }
    throw err
  }
}

async function ensureProjectExtraColumns() {
  let columns
  if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) {
    const rows = await db
      .prepare(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?"
      )
      .all('projects')
    columns = rows.map((c) => c.name)
  } else {
    columns = (await db.prepare('PRAGMA table_info(projects)').all()).map((c) => c.name)
  }
  const need = [
    { name: 'code', sql: 'ALTER TABLE projects ADD COLUMN code TEXT' },
    { name: 'client', sql: 'ALTER TABLE projects ADD COLUMN client TEXT' },
    { name: 'start_date', sql: 'ALTER TABLE projects ADD COLUMN start_date TEXT' },
    { name: 'end_date', sql: 'ALTER TABLE projects ADD COLUMN end_date TEXT' },
    { name: 'pm', sql: 'ALTER TABLE projects ADD COLUMN pm TEXT' },
    { name: 'status', sql: 'ALTER TABLE projects ADD COLUMN status TEXT' },
    { name: 'trimble_connect_project_id', sql: 'ALTER TABLE projects ADD COLUMN trimble_connect_project_id TEXT' },
  ]
  for (const { name: col, sql } of need) {
    if (!columns.includes(col)) {
      try {
        await db.exec(sql)
        console.log('[DB] projects 컬럼 추가:', col)
      } catch (e) {
        console.error('[DB] 컬럼 추가 실패:', col, e.message)
      }
    }
  }
}

function mapProjectRow(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    code: r.code ?? null,
    client: r.client ?? null,
    start_date: r.start_date ?? null,
    end_date: r.end_date ?? null,
    pm: r.pm ?? null,
    status: r.status ?? null,
    trimble_connect_project_id: r.trimble_connect_project_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

const PROJECTS_SELECT = 'SELECT id, name, description, code, client, start_date, end_date, pm, status, trimble_connect_project_id, created_at, updated_at FROM projects'

apiRouter.get('/api/projects', async (req, res) => {
  try {
    await ensureProjectExtraColumns()
    const rows = await db.prepare(`${PROJECTS_SELECT} ORDER BY updated_at DESC`).all()
    res.json({ success: true, projects: rows.map(mapProjectRow) })
  } catch (err) {
    send500(res, err)
  }
})

// 다음 프로젝트 코드 조회 (YYMM-NNN, 해당 년월 순번). 팝업 미리보기용
apiRouter.get('/api/projects/next-code', async (req, res) => {
  try {
    await ensureProjectExtraColumns()
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const yymm = String(y).slice(-2) + String(m).padStart(2, '0')
    const startOfMonth = new Date(y, m - 1, 1)
    const endOfMonth = new Date(y, m, 1)
    const startISO = startOfMonth.toISOString()
    const endISO = endOfMonth.toISOString()
    const rows = await db
      .prepare('SELECT id FROM projects WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id')
      .all(startISO, endISO)
    const seq = rows.length + 1
    const code = yymm + '-' + String(seq).padStart(3, '0')
    res.json({ success: true, code })
  } catch (err) {
    send500(res, err)
  }
})

// 해당 년월의 다음 프로젝트 코드 계산 (YYMM-NNN). INSERT 시 한 번에 저장하기 위해 사용
async function getNextProjectCode(createdAtISO) {
  const d = new Date(createdAtISO)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const yymm = String(y).slice(-2) + String(m).padStart(2, '0')
  const startOfMonth = new Date(y, m - 1, 1)
  const endOfMonth = new Date(y, m, 1)
  const startISO = startOfMonth.toISOString()
  const endISO = endOfMonth.toISOString()
  try {
    const rows = await db
      .prepare('SELECT id FROM projects WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id')
      .all(startISO, endISO)
    const seq = rows.length + 1
    return yymm + '-' + String(seq).padStart(3, '0')
  } catch (e) {
    return yymm + '-001'
  }
}

apiRouter.post('/api/projects', async (req, res) => {
  try {
    await ensureProjectExtraColumns()
    const body = req.body || {}
    const name = body.name
    const description = body.description
    const userEmail = body.userEmail
    const pm = body.pm
    const status = body.status
    const client = body.client ?? body.clientName
    const start_date = body.start_date ?? body.startDate
    const end_date = body.end_date ?? body.endDate
    const codeFromBody = (body.code || '').trim()
    const trimmedName = (name || '').trim()
    const trimbleAccessToken = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    const trimbleExistingProjectId = String(
      body.trimbleExistingProjectId ?? body.trimble_connect_existing_project_id ?? ''
    ).trim()
    const skipTrimbleConnect = body.syncTrimbleConnect === false
    const syncTrimbleConnect =
      !skipTrimbleConnect && (trimbleAccessToken || trimbleExistingProjectId)
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '프로젝트 생성은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    if (!trimmedName) {
      return sendError(res, 400, '프로젝트 이름을 입력하세요.')
    }
    const id = 'proj-' + Date.now()
    const now = new Date().toISOString()
    const clientVal = toOpt(client)
    const startVal = toOpt(start_date)
    const endVal = toOpt(end_date)
    const pmVal = toOpt(pm) || (userEmail ? normalizeEmail(userEmail) : null)
    const statusVal = status === '진행' || status === '완료' ? status : '예정'
    const insertStmt = await db.prepare(
      'INSERT INTO projects (id, name, description, code, client, start_date, end_date, pm, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    // PostgreSQL 전용: 트랜잭션은 db-pg에서 처리
    const codeVal = codeFromBody || (await getNextProjectCode(now))
    await insertStmt.run(id, trimmedName, (description || '').trim() || null, codeVal, clientVal, startVal, endVal, pmVal, statusVal, now, now)
    let trimbleConnectError = null
    if (syncTrimbleConnect) {
      if (trimbleExistingProjectId) {
        try {
          await db
            .prepare('UPDATE projects SET trimble_connect_project_id = ? WHERE id = ?')
            .run(trimbleExistingProjectId, id)
        } catch (e) {
          console.error('[Trimble] 기존 프로젝트 ID 저장 실패:', e.message)
          trimbleConnectError = 'Trimble Connect 프로젝트 ID 저장에 실패했습니다.'
        }
      } else if (trimbleAccessToken) {
        const tc = await createTrimbleConnectProject(trimbleAccessToken, {
          name: trimmedName,
          description: (description || '').trim() || undefined,
        })
        if (tc.ok && tc.projectId) {
          try {
            await db.prepare('UPDATE projects SET trimble_connect_project_id = ? WHERE id = ?').run(String(tc.projectId), id)
          } catch (e) {
            console.error('[Trimble] trimble_connect_project_id 저장 실패:', e.message)
          }
        } else {
          trimbleConnectError = tc.error || 'Trimble Connect 프로젝트 생성 실패'
          console.warn('[Trimble] 프로젝트 생성:', trimbleConnectError)
        }
      }
    }
    const row = await db.prepare(`${PROJECTS_SELECT} WHERE id = ?`).get(id)
    const project = mapProjectRow(row) || {
      id,
      name: trimmedName,
      description: (description || '').trim() || null,
      code: codeVal,
      client: clientVal,
      start_date: startVal,
      end_date: endVal,
      pm: pmVal,
      status: statusVal,
      trimble_connect_project_id: null,
      created_at: now,
      updated_at: now,
    }
    let trimbleAutoImport = null
    let trimbleAutoImportError = null
    if (!trimbleConnectError && trimbleAccessToken) {
      const tcRow = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(id)
      const tcPid = tcRow && String(tcRow.trimble_connect_project_id || '').trim()
      if (tcPid) {
        try {
          const designRevisionId = await ensureDefaultDesignRevisionServer(id)
          const imp = await runTrimbleConnectImport({
            userEmail: normalizeEmail(userEmail),
            trimbleAccessToken,
            braceProjectId: id,
            designRevisionId,
            importModels: true,
            importDocuments: false,
            importQuantity: false,
          })
          if (imp.ok) trimbleAutoImport = imp.summary
          else trimbleAutoImportError = imp.error || '모델 동기화 실패'
        } catch (e) {
          trimbleAutoImportError = e && e.message ? e.message : String(e)
          console.warn('[Trimble] 프로젝트 생성 후 자동 가져오기:', trimbleAutoImportError)
        }
      }
    }
    const payload = { success: true, project }
    if (trimbleConnectError) payload.trimbleConnectError = trimbleConnectError
    if (trimbleAutoImport) payload.trimbleAutoImport = trimbleAutoImport
    if (trimbleAutoImportError) payload.trimbleAutoImportError = trimbleAutoImportError
    res.status(201).json(payload)
  } catch (err) {
    send500(res, err)
  }
})

/** Trimble Connect — 로그인 사용자가 접근 가능한 프로젝트 목록 (기존 프로젝트 연결용) */
async function postTrimbleMyProjectsHandler(req, res) {
  try {
    const body = req.body || {}
    const userEmail = body.userEmail
    const trimbleAccessToken = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, 'Trimble 프로젝트 목록 조회는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    if (!trimbleAccessToken) {
      return sendError(res, 400, 'Trimble 액세스 토큰이 없습니다. Trimble Connect로 다시 로그인하세요.')
    }
    const result = await listTrimbleConnectProjects(trimbleAccessToken)
    if (!result.ok) {
      const st =
        typeof result.status === 'number' && result.status >= 400 && result.status < 600 ? result.status : 502
      return sendError(res, st, result.error || 'Trimble Connect 프로젝트 목록을 가져오지 못했습니다.')
    }
    res.json({ success: true, projects: result.projects })
  } catch (err) {
    send500(res, err)
  }
}
/** `/api/projects/...` 경로: 일부 프록시·구버전 서버에서 `trimble-connect` 경로만 404 나는 경우 대비 */
apiRouter.post('/api/projects/trimble-my-projects', postTrimbleMyProjectsHandler)
apiRouter.post('/api/trimble-connect/my-projects', postTrimbleMyProjectsHandler)

apiRouter.put('/api/projects/:id', async (req, res) => {
  try {
    const body = req.body || {}
    if (!(await canManageProjects(body.userEmail))) {
      return sendError(res, 403, '프로젝트 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    await ensureProjectExtraColumns()
    const { id } = req.params
    const trimmedName = (body.name || '').trim()
    const existing = await db.prepare('SELECT id, created_at FROM projects WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    if (!trimmedName) {
      return sendError(res, 400, '프로젝트 이름을 입력하세요.')
    }
    const now = new Date().toISOString()
    const codeVal = toOpt(body.code)
    const clientVal = toOpt(body.client ?? body['client'])
    const startVal = toOpt(body.start_date ?? body.startDate)
    const endVal = toOpt(body.end_date ?? body.endDate)
    const pmVal = toOpt(body.pm)
    const statusToSet = body.status === '진행' || body.status === '완료' || body.status === '예정' ? body.status : (await db.prepare('SELECT status FROM projects WHERE id = ?').get(id)?.status ?? '예정')
    await db.prepare(
      'UPDATE projects SET name = ?, description = ?, code = ?, client = ?, start_date = ?, end_date = ?, pm = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, (body.description || '').trim() || null, codeVal, clientVal, startVal, endVal, pmVal, statusToSet, now, id)
    const row = await db.prepare(`${PROJECTS_SELECT} WHERE id = ?`).get(id)
    const project = mapProjectRow(row) || {
      id,
      name: trimmedName,
      description: (body.description || '').trim() || null,
      code: codeVal,
      client: clientVal,
      start_date: startVal,
      end_date: endVal,
      pm: pmVal,
      status: statusToSet,
      created_at: existing.created_at,
      updated_at: now,
    }
    res.json({ success: true, project })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/projects/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '프로젝트 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    await db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 프로젝트 참여자 API (관리자·프로젝트 관리자만)
// -----------------------------------------------------------------------------
apiRouter.get('/api/projects/:id/participants', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '참여자 조회는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id: projectId } = req.params
    const project = await db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    const rows = await db
      .prepare(
        `SELECT pp.project_id, pp.user_id, pp.role_in_project, pp.created_at,
                u.name AS user_name, u.email AS user_email, u.company AS user_company
         FROM project_participants pp
         JOIN users u ON u.id = pp.user_id
         WHERE pp.project_id = ?
         ORDER BY pp.created_at ASC`
      )
      .all(projectId)
    res.json({
      success: true,
      participants: rows.map((r) => ({
        project_id: r.project_id,
        user_id: r.user_id,
        user_name: r.user_name,
        user_email: r.user_email,
        user_company: r.user_company ?? null,
        role_in_project: r.role_in_project,
        created_at: r.created_at,
      })),
    })
  } catch (err) {
    send500(res, err)
  }
})

async function postParticipantsHandler(req, res) {
  console.log('POST participants hit', req.method, req.path, req.params)
  try {
    await ensureProjectExtraColumns()
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '참여자 추가는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const projectId = req.params.id || req.params.projectId
    if (!projectId) {
      return sendError(res, 400, '프로젝트 ID가 없습니다.')
    }
    const projectRow = await db.prepare('SELECT id, trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
    if (!projectRow) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    const userIds = Array.isArray(body.userIds) ? body.userIds : []
    const roleInProject = (body.roleInProject || '참여자').trim() || '참여자'
    if (userIds.length === 0) {
      return sendError(res, 400, '추가할 사용자를 선택하세요.')
    }
    const trimbleAccessToken = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    const syncTrimbleConnect = trimbleAccessToken && body.syncTrimbleConnect !== false
    const now = new Date().toISOString()
    /* PostgreSQL: INSERT OR IGNORE는 미지원 → ON CONFLICT DO NOTHING (PK: project_id, user_id) */
    const insert = await db.prepare(
      'INSERT INTO project_participants (project_id, user_id, role_in_project, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id, user_id) DO NOTHING'
    )
    for (const userId of userIds) {
      if (userId) await insert.run(projectId, userId, roleInProject, now)
    }
    const inviteEmails = []
    if (syncTrimbleConnect && projectRow.trimble_connect_project_id) {
      const emailStmt = await db.prepare('SELECT email FROM users WHERE id = ?')
      for (const uid of userIds) {
        if (!uid) continue
        const u = emailStmt.get(uid)
        if (u && u.email) inviteEmails.push(normalizeEmail(u.email))
      }
    }
    let trimbleInvite = null
    if (inviteEmails.length && projectRow.trimble_connect_project_id) {
      let inv = await inviteUsersToTrimbleConnectProject(
        trimbleAccessToken,
        projectRow.trimble_connect_project_id,
        inviteEmails
      )
      if (!inv.ok) {
        const fallback = await inviteUsersViaTcApi(
          trimbleAccessToken,
          projectRow.trimble_connect_project_id,
          inviteEmails
        )
        inv = fallback.ok
          ? { ok: true, invited: fallback.invited, via: 'tc-api' }
          : { ok: false, error: inv.error + ' / ' + (fallback.error || '') }
      }
      trimbleInvite = inv
    } else if (syncTrimbleConnect && inviteEmails.length && !projectRow.trimble_connect_project_id) {
      trimbleInvite = { ok: false, skipped: true, reason: '이 프로젝트에 Trimble Connect 프로젝트 ID가 없습니다. 프로젝트 생성 시 Trimble 연동을 사용했는지 확인하세요.' }
    }
    const rows = await db
      .prepare(
        `SELECT pp.user_id, pp.role_in_project, pp.created_at, u.name AS user_name, u.email AS user_email, u.company AS user_company
         FROM project_participants pp
         JOIN users u ON u.id = pp.user_id
         WHERE pp.project_id = ?`
      )
      .all(projectId)
    const payload = {
      success: true,
      participants: rows.map((r) => ({
        user_id: r.user_id,
        role_in_project: r.role_in_project,
        created_at: r.created_at,
        user_name: r.user_name,
        user_email: r.user_email,
        user_company: r.user_company ?? null,
      })),
    }
    if (trimbleInvite) payload.trimbleConnectInvite = trimbleInvite
    res.status(201).json(payload)
  } catch (err) {
    send500(res, err)
  }
}

// POST 참여자 추가: /api prefix 있음/없음, trailing slash 모두 수용
apiRouter.post('/api/projects/:id/participants', postParticipantsHandler)
  apiRouter.post('/api/projects/:id/participants/', postParticipantsHandler)
  apiRouter.post('/projects/:id/participants', postParticipantsHandler)
  apiRouter.post('/projects/:id/participants/', postParticipantsHandler)

apiRouter.delete('/api/projects/:projectId/participants/:userId', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '참여자 제거는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { projectId, userId } = req.params
    const project = await db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    await db.prepare('DELETE FROM project_participants WHERE project_id = ? AND user_id = ?').run(projectId, userId)
    res.json({ success: true, message: '제거되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 설계일정 API (설계차수·리비전, 관리자·프로젝트 관리자만 생성/수정/삭제)
// -----------------------------------------------------------------------------

/**
 * Trimble Connect 프로젝트 루트 아래에 설계차수 폴더, 또는 설계차수/리비전 중첩 폴더 생성
 * @param {{ trimbleAccessToken?: string, projectId?: string, phaseName?: string, phaseId?: string, revisionName?: string }} opts
 */
async function syncTrimbleScheduleFolders(opts) {
  const tok = typeof opts.trimbleAccessToken === 'string' ? opts.trimbleAccessToken.trim() : ''
  if (!tok) {
    return {
      skipped: true,
      reason: 'no_trimble_token',
      hint:
        'Trimble Connect에 폴더를 만들려면 먼저 Trimble Connect로 로그인해야 합니다. 로그아웃 후 「Trimble로 로그인」으로 다시 들어온 다음, 설계 차수를 다시 추가하거나 이름을 수정·저장해 보세요.',
    }
  }

  let projectId = String(opts.projectId || '').trim()
  let phaseName = typeof opts.phaseName === 'string' ? opts.phaseName.trim() : ''
  const phaseId = typeof opts.phaseId === 'string' ? opts.phaseId.trim() : ''
  const revisionName = typeof opts.revisionName === 'string' ? opts.revisionName.trim() : ''

  if (phaseId && (!projectId || !phaseName)) {
    const row = await db.prepare('SELECT name, project_id FROM design_phases WHERE id = ?').get(phaseId)
    if (row) {
      if (!projectId) projectId = String(row.project_id || '').trim()
      if (!phaseName) phaseName = String(row.name || '').trim()
    }
  }
  const phaseNameFinal = phaseName
  if (!projectId) {
    return { skipped: true, reason: 'no_project_id', hint: '설계 차수에 프로젝트가 연결되어 있지 않습니다.' }
  }

  const proj = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
  const tcId = proj && String(proj.trimble_connect_project_id || '').trim()
  if (!tcId) {
    return {
      skipped: true,
      reason: 'no_trimble_connect_project',
      hint:
        '이 BRACE 프로젝트에 Trimble Connect 프로젝트가 연결되어 있지 않습니다. 프로젝트 관리에서 Connect 프로젝트를 연결한 뒤 다시 시도하세요.',
    }
  }

  const resolved = await resolveTrimbleProject(tok, tcId)
  if (!resolved) {
    return { ok: false, error: 'Trimble Connect에서 프로젝트를 찾지 못했습니다. 프로젝트에 연결된 Connect ID·토큰을 확인하세요.' }
  }

  const rootId = String(resolved.project.rootId || '').trim()
  const apiBase = resolved.apiBase
  if (!rootId) return { ok: false, error: 'Connect 프로젝트 루트 폴더 ID가 없습니다.' }

  if (revisionName) {
    if (!phaseNameFinal) return { ok: false, error: '설계차수명이 없어 리비전 폴더를 만들 수 없습니다.' }
    const phaseFolder = await getOrCreateConnectFolderInParent(tok, apiBase, rootId, phaseNameFinal, tcId)
    if (!phaseFolder.ok) return phaseFolder
    const revFolder = await getOrCreateConnectFolderInParent(
      tok,
      apiBase,
      phaseFolder.folderId,
      revisionName,
      tcId
    )
    if (!revFolder.ok) return revFolder
    return {
      ok: true,
      path: `${phaseNameFinal} → ${revisionName}`,
      phaseFolderId: phaseFolder.folderId,
      revisionFolderId: revFolder.folderId,
      phaseExisted: !!phaseFolder.existed,
      revisionExisted: !!revFolder.existed,
    }
  }

  if (phaseNameFinal) {
    const phaseFolder = await getOrCreateConnectFolderInParent(tok, apiBase, rootId, phaseNameFinal, tcId)
    if (!phaseFolder.ok) return phaseFolder
    return {
      ok: true,
      path: phaseNameFinal,
      phaseFolderId: phaseFolder.folderId,
      phaseExisted: !!phaseFolder.existed,
    }
  }

  return { skipped: true, reason: 'nothing_to_sync', hint: '동기화할 폴더 정보가 없습니다.' }
}

const TRIMBLE_SCHEDULE_SYNC_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.TRIMBLE_SCHEDULE_SYNC_TIMEOUT_MS) || 15000, 3000),
  120000
)

/** Trimble 폴더 동기화가 길어지면 HTTP 응답이 멈춘 것처럼 보이므로 상한 시간 후 건너뜀 */
function syncTrimbleScheduleFoldersWithTimeout(opts) {
  return Promise.race([
    syncTrimbleScheduleFolders(opts),
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            skipped: true,
            reason: 'trimble_sync_timeout',
            hint:
              'Trimble Connect 폴더 동기화가 지연되어 여기서는 중단했습니다. 설계 차수·리비전은 저장되었습니다. 잠시 후 같은 항목을 다시 저장하면 재시도됩니다.',
          }),
        TRIMBLE_SCHEDULE_SYNC_TIMEOUT_MS
      )
    ),
  ])
}

/** 이름 변경·PATCH 등 임의 Trimble 작업에 동일 타임아웃 적용 */
function runTrimbleScheduleOp(fn) {
  return Promise.race([
    fn(),
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            skipped: true,
            reason: 'trimble_sync_timeout',
            hint:
              'Trimble Connect 작업이 지연되어 여기서는 중단했습니다. 저장은 반영되었으니 잠시 후 다시 저장해 보세요.',
          }),
        TRIMBLE_SCHEDULE_SYNC_TIMEOUT_MS
      )
    ),
  ])
}

/**
 * 설계차수명 변경 시 Connect에서 동일 폴더 이름만 변경(없으면 새 이름으로 한 번 생성·동기화)
 * @param {{ trimbleAccessToken?: string, projectId?: string, oldPhaseName?: string, newPhaseName?: string }} opts
 */
async function renameTrimbleSchedulePhaseFolder(opts) {
  const tok = typeof opts.trimbleAccessToken === 'string' ? opts.trimbleAccessToken.trim() : ''
  if (!tok) {
    return {
      skipped: true,
      reason: 'no_trimble_token',
      hint:
        'Trimble Connect에서 폴더 이름을 맞추려면 Trimble로 로그인한 뒤 다시 저장해 보세요.',
    }
  }
  const projectId = String(opts.projectId || '').trim()
  const oldName = String(opts.oldPhaseName || '').trim()
  const newName = String(opts.newPhaseName || '').trim()
  if (!projectId || !oldName || !newName) return { skipped: true, reason: 'missing_context' }
  if (oldName === newName) return { skipped: true, reason: 'same_name' }

  const proj = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
  const tcId = proj && String(proj.trimble_connect_project_id || '').trim()
  if (!tcId) {
    return {
      skipped: true,
      reason: 'no_trimble_connect_project',
      hint: '이 BRACE 프로젝트에 Trimble Connect가 연결되어 있지 않습니다.',
    }
  }

  const resolved = await resolveTrimbleProject(tok, tcId)
  if (!resolved) return { ok: false, error: 'Trimble Connect에서 프로젝트를 찾을 수 없습니다.' }
  const rootId = String(resolved.project.rootId || '').trim()
  const apiBase = resolved.apiBase
  if (!rootId) return { ok: false, error: 'Connect 프로젝트 루트 폴더 ID가 없습니다.' }

  const { phaseFolderId } = await findScheduleTrimbleFolderIds(tok, apiBase, rootId, tcId, oldName, null)
  if (phaseFolderId) {
    const patched = await patchTrimbleConnectFolderName(tok, apiBase, phaseFolderId, newName, tcId)
    if (!patched.ok) return patched
    return {
      ok: true,
      path: newName,
      phaseFolderId,
      renamed: true,
      phaseExisted: true,
    }
  }
  return {
    skipped: true,
    reason: 'trimble_old_folder_not_found',
    hint:
      'Trimble Connect에서 이전 설계차수 이름과 같은 폴더를 찾지 못해 새 폴더를 만들지 않았습니다. Connect에 이미 있는 폴더 이름·공백이 앱과 같은지 확인하거나, DEBUG_TRIMBLE_FOLDERS=1 로 서버 로그를 확인해 보세요.',
  }
}

/**
 * 리비전명 변경 시 Connect에서 해당 리비전 폴더 이름만 변경
 * @param {{ trimbleAccessToken?: string, projectId?: string, phaseName?: string, oldRevisionName?: string, newRevisionName?: string }} opts
 */
async function renameTrimbleScheduleRevisionFolder(opts) {
  const tok = typeof opts.trimbleAccessToken === 'string' ? opts.trimbleAccessToken.trim() : ''
  if (!tok) {
    return {
      skipped: true,
      reason: 'no_trimble_token',
      hint:
        'Trimble Connect에서 폴더 이름을 맞추려면 Trimble로 로그인한 뒤 다시 저장해 보세요.',
    }
  }
  const projectId = String(opts.projectId || '').trim()
  const phaseName = String(opts.phaseName || '').trim()
  const oldRev = String(opts.oldRevisionName || '').trim()
  const newRev = String(opts.newRevisionName || '').trim()
  if (!projectId || !phaseName || !oldRev || !newRev) return { skipped: true, reason: 'missing_context' }
  if (oldRev === newRev) return { skipped: true, reason: 'same_name' }

  const proj = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
  const tcId = proj && String(proj.trimble_connect_project_id || '').trim()
  if (!tcId) {
    return {
      skipped: true,
      reason: 'no_trimble_connect_project',
      hint: '이 BRACE 프로젝트에 Trimble Connect가 연결되어 있지 않습니다.',
    }
  }

  const resolved = await resolveTrimbleProject(tok, tcId)
  if (!resolved) return { ok: false, error: 'Trimble Connect에서 프로젝트를 찾을 수 없습니다.' }
  const rootId = String(resolved.project.rootId || '').trim()
  const apiBase = resolved.apiBase
  if (!rootId) return { ok: false, error: 'Connect 프로젝트 루트 폴더 ID가 없습니다.' }

  const { revisionFolderId } = await findScheduleTrimbleFolderIds(tok, apiBase, rootId, tcId, phaseName, oldRev)
  if (revisionFolderId) {
    const patched = await patchTrimbleConnectFolderName(tok, apiBase, revisionFolderId, newRev, tcId)
    if (!patched.ok) return patched
    return {
      ok: true,
      path: `${phaseName} → ${newRev}`,
      revisionFolderId,
      renamed: true,
      revisionExisted: true,
    }
  }
  return {
    skipped: true,
    reason: 'trimble_old_folder_not_found',
    hint:
      'Trimble Connect에서 이전 리비전 이름과 같은 폴더를 찾지 못해 새 폴더를 만들지 않았습니다. Connect의 폴더 이름·공백이 앱과 같은지 확인하세요.',
  }
}

/**
 * 리비전 삭제 시 Trimble Connect의 해당 리비전 폴더만 삭제
 * @param {{ trimbleAccessToken?: string, projectId?: string, phaseName?: string, revisionName?: string }} opts
 */
async function deleteTrimbleFoldersForScheduleRevision(opts) {
  const tok = typeof opts.trimbleAccessToken === 'string' ? opts.trimbleAccessToken.trim() : ''
  if (!tok) {
    return {
      skipped: true,
      reason: 'no_trimble_token',
      hint:
        'Trimble Connect에서 폴더까지 지우려면 Trimble로 로그인한 뒤, 같은 항목을 다시 삭제하거나(이미 DB에는 없음) 관리자에게 문의하세요.',
    }
  }
  const projectId = String(opts.projectId || '').trim()
  const phaseName = String(opts.phaseName || '').trim()
  const revisionName = String(opts.revisionName || '').trim()
  if (!projectId || !phaseName || !revisionName) {
    return { skipped: true, reason: 'missing_context', hint: '프로젝트·차수·리비전 정보가 없어 Connect 폴더를 찾지 못했습니다.' }
  }

  const proj = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
  const tcId = proj && String(proj.trimble_connect_project_id || '').trim()
  if (!tcId) {
    return {
      skipped: true,
      reason: 'no_trimble_connect_project',
      hint: '이 BRACE 프로젝트에 Trimble Connect가 연결되어 있지 않습니다.',
    }
  }

  const resolved = await resolveTrimbleProject(tok, tcId)
  if (!resolved) return { ok: false, error: 'Trimble Connect에서 프로젝트를 찾을 수 없습니다.' }
  const rootId = String(resolved.project.rootId || '').trim()
  const apiBase = resolved.apiBase
  if (!rootId) return { ok: false, error: 'Connect 프로젝트 루트 폴더 ID가 없습니다.' }

  const { revisionFolderId } = await findScheduleTrimbleFolderIds(tok, apiBase, rootId, tcId, phaseName, revisionName)
  if (!revisionFolderId) return { ok: true, note: 'trimble_revision_folder_not_found' }

  return deleteTrimbleConnectFolderOnce(tok, apiBase, revisionFolderId, tcId)
}

/**
 * 설계차수 삭제 시 Trimble에서 차수 폴더(및 하위 리비전 폴더) 삭제 — 리비전 폴더를 먼저 비우는 순서
 * @param {{ trimbleAccessToken?: string, projectId?: string, phaseName?: string, revisionNames?: string[] }} opts
 */
async function deleteTrimbleFoldersForSchedulePhase(opts) {
  const tok = typeof opts.trimbleAccessToken === 'string' ? opts.trimbleAccessToken.trim() : ''
  if (!tok) {
    return {
      skipped: true,
      reason: 'no_trimble_token',
      hint:
        'Trimble Connect에서 폴더까지 지우려면 Trimble로 로그인한 뒤 다시 시도하세요.',
    }
  }
  const projectId = String(opts.projectId || '').trim()
  const phaseName = String(opts.phaseName || '').trim()
  const revisionNames = Array.isArray(opts.revisionNames) ? opts.revisionNames.map((s) => String(s || '').trim()).filter(Boolean) : []
  if (!projectId || !phaseName) {
    return { skipped: true, reason: 'missing_context' }
  }

  const proj = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projectId)
  const tcId = proj && String(proj.trimble_connect_project_id || '').trim()
  if (!tcId) {
    return { skipped: true, reason: 'no_trimble_connect_project' }
  }

  const resolved = await resolveTrimbleProject(tok, tcId)
  if (!resolved) return { ok: false, error: 'Trimble Connect에서 프로젝트를 찾을 수 없습니다.' }
  const rootId = String(resolved.project.rootId || '').trim()
  const apiBase = resolved.apiBase
  if (!rootId) return { ok: false, error: 'Connect 프로젝트 루트 폴더 ID가 없습니다.' }

  const { phaseFolderId } = await findScheduleTrimbleFolderIds(tok, apiBase, rootId, tcId, phaseName, null)
  if (!phaseFolderId) return { ok: true, note: 'trimble_phase_folder_not_found' }

  const errors = []
  for (const revName of revisionNames) {
    const { revisionFolderId } = await findScheduleTrimbleFolderIds(tok, apiBase, rootId, tcId, phaseName, revName)
    if (revisionFolderId) {
      const del = await deleteTrimbleConnectFolderOnce(tok, apiBase, revisionFolderId, tcId)
      if (!del.ok) errors.push(`${revName}: ${del.error}`)
    }
  }
  const delPhase = await deleteTrimbleConnectFolderOnce(tok, apiBase, phaseFolderId, tcId)
  if (!delPhase.ok) errors.push(`차수 폴더: ${delPhase.error}`)

  if (errors.length) return { ok: false, error: errors.join(' | ') }
  return { ok: true }
}

apiRouter.get('/api/design-schedule/phases', async (req, res) => {
  try {
    const q = req.query || {}
    const projectId = (typeof q.projectId === 'string' ? q.projectId : '').trim() || null
    let sql = 'SELECT id, name, sort_order, project_id, created_at, updated_at FROM design_phases'
    const params = []
    if (projectId) {
      sql += ' WHERE project_id = ?'
      params.push(projectId)
    }
    sql += ' ORDER BY sort_order ASC, created_at ASC'
    const rows = params.length ? await db.prepare(sql).all(...params) : await db.prepare(sql).all()
    res.json({ success: true, phases: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/design-schedule/phases', async (req, res) => {
  try {
    const { name, project_id, userEmail } = req.body
    const normalizedEmail = normalizeEmail(userEmail)
    if (!(await canManageProjects(normalizedEmail))) {
      return res.status(403).json({ success: false, error: '설계차수 등록은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const trimmedName = (name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '설계차수명을 입력하세요.' })
    }
    const id = 'phase-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const now = new Date().toISOString()
    const projId = (project_id || '').trim() || null
    let order = 0
    if (projId) {
      const maxRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM design_phases WHERE project_id = ?').get(projId)
      order = Number(maxRow && maxRow.m != null ? maxRow.m : -1) + 1
    } else {
      const maxRow = await db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM design_phases WHERE project_id IS NULL')
        .get()
      order = Number(maxRow && maxRow.m != null ? maxRow.m : -1) + 1
    }
    await db.prepare(
      'INSERT INTO design_phases (id, name, sort_order, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, trimmedName, order, projId, now, now)
    let trimbleFolders = null
    try {
      trimbleFolders = await syncTrimbleScheduleFoldersWithTimeout({
        trimbleAccessToken: req.body.trimbleAccessToken,
        projectId: projId,
        phaseName: trimmedName,
      })
    } catch (e) {
      console.warn('[design-schedule/phases POST] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.status(201).json({
      success: true,
      phase: { id, name: trimmedName, sort_order: order, project_id: projId, created_at: now, updated_at: now },
      trimbleFolders,
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/design-schedule/phases/:id', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail || '')
    if (!(await canManageProjects(normalizedEmail))) {
      return res.status(403).json({ success: false, error: '설계차수 수정은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const { name, sort_order, project_id } = req.body
    const existing = await db.prepare('SELECT id, name, sort_order, created_at FROM design_phases WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    const trimmedName = (name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '설계차수명을 입력하세요.' })
    }
    const order = typeof sort_order === 'number' ? sort_order : (existing.sort_order ?? 0)
    const projId = (project_id || '').trim() || null
    const prevPhaseName = String(existing.name || '').trim()
    const now = new Date().toISOString()
    await db.prepare(
      'UPDATE design_phases SET name = ?, sort_order = ?, project_id = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, order, projId, now, id)
    let trimbleFolders = null
    try {
      if (prevPhaseName === trimmedName) {
        trimbleFolders = { skipped: true, reason: 'name_unchanged' }
      } else {
        trimbleFolders = await runTrimbleScheduleOp(() =>
          renameTrimbleSchedulePhaseFolder({
            trimbleAccessToken: req.body.trimbleAccessToken,
            projectId: projId,
            oldPhaseName: prevPhaseName,
            newPhaseName: trimmedName,
          })
        )
      }
    } catch (e) {
      console.warn('[design-schedule/phases PUT] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.json({
      success: true,
      phase: { id, name: trimmedName, sort_order: order, project_id: projId, created_at: existing.created_at, updated_at: now },
      trimbleFolders,
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/design-schedule/phases/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail)
    if (!(await canManageProjects(userEmail))) {
      return res.status(403).json({ success: false, error: '설계차수 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, name, project_id FROM design_phases WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    const revRows = await db.prepare('SELECT revision_name FROM design_revisions WHERE design_phase_id = ?').all(id)
    const revisionNames = (revRows || []).map((r) => String(r.revision_name || '').trim()).filter(Boolean)
    await db.prepare('DELETE FROM design_revisions WHERE design_phase_id = ?').run(id)
    await db.prepare('DELETE FROM design_phases WHERE id = ?').run(id)
    let trimbleFolders = null
    const trimbleTok =
      typeof (req.query && req.query.trimbleAccessToken) === 'string' ? String(req.query.trimbleAccessToken).trim() : ''
    try {
      trimbleFolders = await deleteTrimbleFoldersForSchedulePhase({
        trimbleAccessToken: trimbleTok,
        projectId: existing.project_id != null ? String(existing.project_id).trim() : '',
        phaseName: String(existing.name || '').trim(),
        revisionNames,
      })
    } catch (e) {
      console.warn('[design-schedule/phases DELETE] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.json({ success: true, message: '삭제되었습니다.', trimbleFolders })
  } catch (err) {
    send500(res, err)
  }
})

// 리비전 목록 (설계차수별)
apiRouter.get('/api/design-schedule/phases/:phaseId/revisions', async (req, res) => {
  try {
    const phaseId = req.params && req.params.phaseId
    if (!phaseId) {
      return res.status(400).json({ success: false, error: 'phaseId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        'SELECT id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at FROM design_revisions WHERE design_phase_id = ? ORDER BY revision_name ASC, created_at ASC'
      )
      .all(phaseId)
    res.json({ success: true, revisions: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/design-schedule/phases/:phaseId/revisions', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail)
    if (!(await canManageProjects(normalizedEmail))) {
      return res.status(403).json({ success: false, error: '리비전 등록은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { phaseId } = req.params
    const phase = await db.prepare('SELECT id, name, project_id FROM design_phases WHERE id = ?').get(phaseId)
    if (!phase) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    const { revision_name, planned_date, actual_date, status, memo } = req.body
    const trimmedName = (revision_name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '리비전명을 입력하세요.' })
    }
    const id = 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
    const now = new Date().toISOString()
    const statusVal = (status || '예정').trim()
    const planned = (planned_date || '').trim() || null
    const actual = (actual_date || '').trim() || null
    const memoVal = (memo || '').trim() || null
    await db.prepare(
      'INSERT INTO design_revisions (id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, phaseId, trimmedName, planned, actual, statusVal, memoVal, now, now)
    let trimbleFolders = null
    try {
      trimbleFolders = await syncTrimbleScheduleFoldersWithTimeout({
        trimbleAccessToken: req.body.trimbleAccessToken,
        projectId: phase.project_id != null ? String(phase.project_id).trim() : '',
        phaseId,
        phaseName: String(phase.name || '').trim(),
        revisionName: trimmedName,
      })
    } catch (e) {
      console.warn('[design-schedule/revisions POST] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.status(201).json({
      success: true,
      revision: {
        id,
        design_phase_id: phaseId,
        revision_name: trimmedName,
        planned_date: planned,
        actual_date: actual,
        status: statusVal,
        memo: memoVal,
        created_at: now,
        updated_at: now,
      },
      trimbleFolders,
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/design-schedule/revisions/:id', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail)
    if (!(await canManageProjects(normalizedEmail))) {
      return res.status(403).json({ success: false, error: '리비전 수정은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const existing = await db
      .prepare(
        `SELECT dr.id, dr.revision_name, dr.design_phase_id, dr.created_at,
                dp.name AS phase_name, dp.project_id AS project_id
         FROM design_revisions dr
         INNER JOIN design_phases dp ON dr.design_phase_id = dp.id
         WHERE dr.id = ?`
      )
      .get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '리비전을 찾을 수 없습니다.' })
    }
    const { revision_name, planned_date, actual_date, status, memo } = req.body
    const trimmedName = (revision_name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '리비전명을 입력하세요.' })
    }
    const now = new Date().toISOString()
    const statusVal = (status || '예정').trim()
    const planned = (planned_date || '').trim() || null
    const actual = (actual_date || '').trim() || null
    const memoVal = (memo || '').trim() || null
    const prevRevName = String(existing.revision_name || '').trim()
    await db.prepare(
      'UPDATE design_revisions SET revision_name = ?, planned_date = ?, actual_date = ?, status = ?, memo = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, planned, actual, statusVal, memoVal, now, id)
    let trimbleFolders = null
    try {
      if (prevRevName === trimmedName) {
        trimbleFolders = { skipped: true, reason: 'name_unchanged' }
      } else {
        trimbleFolders = await runTrimbleScheduleOp(() =>
          renameTrimbleScheduleRevisionFolder({
            trimbleAccessToken: req.body.trimbleAccessToken,
            projectId: existing.project_id != null ? String(existing.project_id).trim() : '',
            phaseName: String(existing.phase_name || '').trim(),
            oldRevisionName: prevRevName,
            newRevisionName: trimmedName,
          })
        )
      }
    } catch (e) {
      console.warn('[design-schedule/revisions PUT] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.json({
      success: true,
      revision: {
        id,
        design_phase_id: existing.design_phase_id,
        revision_name: trimmedName,
        planned_date: planned,
        actual_date: actual,
        status: statusVal,
        memo: memoVal,
        created_at: existing.created_at,
        updated_at: now,
      },
      trimbleFolders,
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/design-schedule/revisions/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail)
    if (!(await canManageProjects(userEmail))) {
      return res.status(403).json({ success: false, error: '리비전 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const row = await db
      .prepare(
        `SELECT dr.id, dr.revision_name, dp.name AS phase_name, dp.project_id AS project_id
         FROM design_revisions dr
         INNER JOIN design_phases dp ON dr.design_phase_id = dp.id
         WHERE dr.id = ?`
      )
      .get(id)
    if (!row) {
      return res.status(404).json({ success: false, error: '리비전을 찾을 수 없습니다.' })
    }
    await db.prepare('DELETE FROM design_revisions WHERE id = ?').run(id)
    let trimbleFolders = null
    const trimbleTok =
      typeof (req.query && req.query.trimbleAccessToken) === 'string' ? String(req.query.trimbleAccessToken).trim() : ''
    try {
      trimbleFolders = await deleteTrimbleFoldersForScheduleRevision({
        trimbleAccessToken: trimbleTok,
        projectId: row.project_id != null ? String(row.project_id).trim() : '',
        phaseName: String(row.phase_name || '').trim(),
        revisionName: String(row.revision_name || '').trim(),
      })
    } catch (e) {
      console.warn('[design-schedule/revisions DELETE] Trimble 폴더:', e && e.message ? e.message : e)
      trimbleFolders = { ok: false, error: e && e.message ? String(e.message) : String(e) }
    }
    res.json({ success: true, message: '삭제되었습니다.', trimbleFolders })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 설계도서 API (리비전별 등록/수정/삭제)
// -----------------------------------------------------------------------------
apiRouter.get('/api/design-docs', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        'SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE design_revision_id = ? ORDER BY created_at ASC'
      )
      .all(designRevisionId)
    // 한글 등이 깨진 file_name은 title로 보정 (응답만, DB는 변경하지 않음)
    const hasKorean = (s) => s && /[\uAC00-\uD7A3]/.test(s)
    const docs = rows.map((r) => {
      const out = { ...r }
      if (out.file_path && out.title && out.file_name && !hasKorean(out.file_name) && hasKorean(out.title)) {
        out.file_name = out.title
      }
      return out
    })
    res.json({ success: true, documents: docs })
  } catch (err) {
    send500(res, err)
  }
})

/** 등록된 DWG 설계도서를 DXF로 변환 (고정 경로, documentId는 body로 전달) */
async function handleConvertDesignDocToDxf(req, res) {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || (req.query && req.query.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, 'DXF 변환은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = (req.body && req.body.documentId || req.body && req.body.id || '').trim()
    if (!id) {
      return sendError(res, 400, 'documentId가 필요합니다.')
    }
    const row = await db.prepare('SELECT id, file_path FROM design_documents WHERE id = ?').get(id)
    if (!row || !row.file_path) {
      return sendError(res, 404, '설계도서 또는 원본 파일을 찾을 수 없습니다.')
    }
    const ext = (path.extname(row.file_path) || '').toLowerCase()
    if (ext !== '.dwg') {
      return sendError(res, 400, 'DWG 파일만 DXF로 변환할 수 있습니다.')
    }
    const sourcePath = path.join(UPLOADS_DIR, row.file_path)
    if (!fs.existsSync(sourcePath)) {
      return sendError(res, 404, '원본 DWG 파일이 서버에 없습니다.')
    }
    const dxfPath = path.join(DXF_CACHE_DIR, id + '.dxf')
    try {
      await convertDwgToDxf(sourcePath, dxfPath)
    } catch (err) {
      return sendError(res, 500, err && err.message ? err.message : 'DWG→DXF 변환에 실패했습니다.')
    }
    await db.prepare('UPDATE design_documents SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    const updated = await db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(id)
    res.json({ success: true, document: updated, message: 'DXF로 변환되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.post('/api/design-docs/convert-to-dxf', handleConvertDesignDocToDxf)

apiRouter.post('/api/design-docs', uploadDesignDoc.single('file'), async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계도서 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = await db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
    if (!rev) {
      return sendError(res, 404, '해당 리비전을 찾을 수 없습니다.')
    }
    let file_name = null
    let file_path = null
    if (req.file && req.file.filename) {
      if (req.body && req.body.fileNameB64) {
        try {
          file_name = Buffer.from(req.body.fileNameB64, 'base64').toString('utf-8').trim()
        } catch (_) {}
      }
      if (!file_name) {
        const bodyFileName = (req.body && (req.body.fileName || req.body.file_name || '')).trim()
        file_name = bodyFileName || req.file.originalname || req.file.filename
      }
      if (file_name && /[\/\\]/.test(file_name)) file_name = path.basename(file_name)
      file_path = req.file.filename
    }
    let title = ((req.body && req.body.title) || '').trim()
    if (!title && file_name) title = file_name
    if (!title) {
      return sendError(res, 400, '도서명을 입력하세요.')
    }
    const docId = 'doc-' + Date.now()
    const now = new Date().toISOString()
    const docNumber = ((req.body && req.body.doc_number) || '').trim() || null
    const memoVal = ((req.body && req.body.memo) || '').trim() || null
    await db.prepare(
      'INSERT INTO design_documents (id, design_revision_id, title, doc_number, memo, file_name, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(docId, revisionId, title, docNumber, memoVal, file_name, file_path, now, now)

    // DWG일 경우 DXF/PDF 변환 후 한 번에 DB 업데이트 (DB 잠금 시간 최소화)
    let dxfConverted = null
    let dxfError = null
    let filePathDxf = null
    let filePathPdf = null
    if (file_path) {
      const ext = (path.extname(file_path) || path.extname(file_name || '') || '').toLowerCase()
      if (ext === '.dwg') {
        const sourcePath = path.join(UPLOADS_DIR, file_path)
        const dxfPath = path.join(DXF_CACHE_DIR, docId + '.dxf')
        const pdfPath = path.join(PDF_CACHE_DIR, docId + '.pdf')
        if (fs.existsSync(sourcePath)) {
          try {
            await convertDwgToDxf(sourcePath, dxfPath)
            filePathDxf = docId + '.dxf'
            dxfConverted = true
          } catch (err) {
            console.error('설계도서 업로드 후 DXF 변환 실패:', err.message)
            dxfConverted = false
            dxfError = err && (err.message || String(err))
          }
          try {
            await convertDwgToPdf(sourcePath, pdfPath)
            filePathPdf = docId + '.pdf'
          } catch (err) {
            console.error('설계도서 업로드 후 PDF 변환 실패:', err.message)
          }
        }
      }
    }
    if (filePathDxf || filePathPdf) {
      const stmt = await db.prepare('UPDATE design_documents SET file_path_dxf = COALESCE(?, file_path_dxf), file_path_pdf = COALESCE(?, file_path_pdf) WHERE id = ?')
      stmt.run(filePathDxf || null, filePathPdf || null, docId)
    }

    const row = await db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(docId)
    const payload = { success: true, document: row }
    if (dxfConverted !== null) {
      payload.dxf_converted = dxfConverted
      if (dxfError) payload.dxf_error = dxfError
    }
    res.status(201).json(payload)
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/design-docs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.body.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계도서 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id FROM design_documents WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계도서를 찾을 수 없습니다.')
    }
    const { title, doc_number, memo } = req.body
    const trimmedTitle = (title || '').trim()
    if (!trimmedTitle) {
      return sendError(res, 400, '도서명을 입력하세요.')
    }
    const docNumber = (doc_number || '').trim() || null
    const memoVal = (memo || '').trim() || null
    const now = new Date().toISOString()
    await db.prepare(
      'UPDATE design_documents SET title = ?, doc_number = ?, memo = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedTitle, docNumber, memoVal, now, id)
    const row = await db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(id)
    res.json({ success: true, document: row })
  } catch (err) {
    send500(res, err)
  }
})

/** 설계도서를 PDF로 반환. 원본이 PDF면 그대로, DWG면 변환 후 반환(캐드 보기용) - /file 보다 먼저 등록 */
apiRouter.get('/api/design-docs/:id/file/pdf', async (req, res) => {
  const { id } = req.params
  const sendPdf = (pdfPath) => {
    const name = (req.query.name || 'view.pdf').trim() || 'view.pdf'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', contentDispositionFilename(name, true))
    res.sendFile(path.resolve(pdfPath))
  }

  const row = await db.prepare('SELECT id, file_name, file_path, file_path_pdf FROM design_documents WHERE id = ?').get(id)
  if (!row || !row.file_path) {
    return res.status(404).send('파일을 찾을 수 없습니다.')
  }
  const sourcePath = path.join(UPLOADS_DIR, row.file_path)
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).send('파일을 찾을 수 없습니다.')
  }

  const ext = (path.extname(row.file_path) || path.extname(row.file_name || '') || '').toLowerCase()
  const baseName = (row.file_name || row.file_path || 'download').replace(/[^\w.\u3131-\uD7A3-]/g, '_')

  // 업로드 시 변환해 둔 PDF가 있으면 우선 사용
  if (row.file_path_pdf) {
    const storedPdfPath = path.join(PDF_CACHE_DIR, row.file_path_pdf)
    if (fs.existsSync(storedPdfPath)) {
      return sendPdf(storedPdfPath)
    }
  }

  if (ext === '.pdf') {
    return sendPdf(sourcePath)
  }

  if (ext !== '.dwg') {
    return res.status(400).json({
      success: false,
      error: 'PDF 또는 DWG 파일만 변환할 수 있습니다. 현재: ' + (ext || '확장자 없음'),
    })
  }

  const cachePath = path.join(PDF_CACHE_DIR, id + '.pdf')
  const sourceMtime = fs.statSync(sourcePath).mtimeMs

  const trySendCached = () => {
    try {
      if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= sourceMtime) {
        sendPdf(cachePath)
        return true
      }
    } catch (_) {}
    return false
  }

  if (trySendCached()) return

  convertDwgToPdf(sourcePath, cachePath)
    .then(() => {
      sendPdf(cachePath)
    })
    .catch((err) => {
      console.error('DWG to PDF conversion failed:', err.message)
      res.status(501).json({
        success: false,
        error: err.message || 'DWG를 PDF로 변환하지 못했습니다. 서버에 DWG2PDF_CMD 환경변수가 설정되어 있는지 확인하세요.',
      })
    })
})

/** 설계도서 DXF 경로 반환. 업로드 시 저장된 file_path_dxf 우선 사용 */
async function getDxfFilePath(id) {
  const row = await db.prepare('SELECT id, file_name, file_path, file_path_dxf FROM design_documents WHERE id = ?').get(id)
  if (!row || !row.file_path) return null
  const sourcePath = path.join(UPLOADS_DIR, row.file_path)
  if (!fs.existsSync(sourcePath)) return null
  const ext = (path.extname(row.file_path) || path.extname(row.file_name || '') || '').toLowerCase()
  if (ext === '.dxf') return sourcePath
  if (ext === '.dwg') {
    if (row.file_path_dxf) {
      const storedDxf = path.join(DXF_CACHE_DIR, row.file_path_dxf)
      if (fs.existsSync(storedDxf)) return storedDxf
    }
    const cachePath = path.join(DXF_CACHE_DIR, id + '.dxf')
    const sourceMtime = fs.statSync(sourcePath).mtimeMs
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= sourceMtime) return cachePath
    return null
  }
  return null
}

apiRouter.get('/api/design-docs/:id/file/dxf/json', async (req, res) => {
  const { id } = req.params
  let dxfPath = await getDxfFilePath(id)
  if (!dxfPath) {
    const row = await db.prepare('SELECT id, file_name, file_path FROM design_documents WHERE id = ?').get(id)
    if (!row || !row.file_path) {
      return res.status(404).json({ success: false, error: '파일을 찾을 수 없습니다.' })
    }
    const sourcePath = path.join(UPLOADS_DIR, row.file_path)
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ success: false, error: '파일을 찾을 수 없습니다.' })
    }
    const ext = (path.extname(row.file_path) || path.extname(row.file_name || '') || '').toLowerCase()
    if (ext === '.dwg') {
      const cachePath = path.join(DXF_CACHE_DIR, id + '.dxf')
      return convertDwgToDxf(sourcePath, cachePath)
        .then(() => {
          const DxfParser = req('dxf-parser')
          const parser = new DxfParser()
          const dxfText = fs.readFileSync(cachePath, 'utf8')
          const dxf = parser.parseSync(dxfText)
          if (!dxf || !dxf.entities) {
            return res.status(422).json({ success: false, error: 'DXF 파싱 결과가 비어 있습니다.' })
          }
          res.json({ success: true, entities: dxf.entities })
        })
        .catch((err) => {
          console.error('DWG to DXF or parse failed:', err.message)
          res.status(501).json({ success: false, error: err.message || '변환 또는 파싱에 실패했습니다.' })
        })
    }
    return res.status(400).json({
      success: false,
      error: 'DXF 뷰어는 DXF 또는 DWG 파일만 지원합니다. 현재: ' + (ext || '확장자 없음'),
    })
  }
  try {
    const DxfParser = req('dxf-parser')
    const parser = new DxfParser()
    const dxfText = fs.readFileSync(dxfPath, 'utf8')
    const dxf = parser.parseSync(dxfText)
    if (!dxf || !dxf.entities) {
      return res.status(422).json({ success: false, error: 'DXF 파싱 결과가 비어 있습니다.' })
    }
    res.json({ success: true, entities: dxf.entities })
  } catch (err) {
    console.error('DXF parse failed:', err.message)
    res.status(500).json({ success: false, error: err.message || 'DXF 파싱에 실패했습니다.' })
  }
})

/** 설계도서를 DXF 파일로 반환. 원본이 DXF면 그대로, DWG면 변환 후 반환 */
apiRouter.get('/api/design-docs/:id/file/dxf', async (req, res) => {
  const { id } = req.params
  const sendDxf = (dxfPath) => {
    const name = (req.query.name || 'view').trim() || 'view'
    const filename = name.toLowerCase().endsWith('.dxf') ? name : name + '.dxf'
    res.setHeader('Content-Disposition', contentDispositionFilename(filename, true))
    res.setHeader('Content-Type', 'application/dxf')
    res.sendFile(path.resolve(dxfPath))
  }
  const row = await db.prepare('SELECT id, file_name, file_path, file_path_dxf FROM design_documents WHERE id = ?').get(id)
  if (!row || !row.file_path) {
    return res.status(404).send('파일을 찾을 수 없습니다.')
  }
  const sourcePath = path.join(UPLOADS_DIR, row.file_path)
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).send('파일을 찾을 수 없습니다.')
  }
  const ext = (path.extname(row.file_path) || path.extname(row.file_name || '') || '').toLowerCase()
  if (ext === '.dxf') return sendDxf(sourcePath)
  if (ext === '.dwg') {
    if (row.file_path_dxf) {
      const storedDxf = path.join(DXF_CACHE_DIR, row.file_path_dxf)
      try {
        if (fs.existsSync(storedDxf)) return sendDxf(storedDxf)
      } catch (_) {}
    }
    const cachePath = path.join(DXF_CACHE_DIR, id + '.dxf')
    const sourceMtime = fs.statSync(sourcePath).mtimeMs
    try {
      if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= sourceMtime) return sendDxf(cachePath)
    } catch (_) {}
    return convertDwgToDxf(sourcePath, cachePath)
      .then(() => sendDxf(cachePath))
      .catch((err) => {
        console.error('DWG to DXF conversion failed:', err.message)
        res.status(501).json({ success: false, error: err.message || 'DWG를 DXF로 변환하지 못했습니다.' })
      })
  }
  return res.status(400).json({ success: false, error: 'DXF 뷰어는 DXF 또는 DWG 파일만 지원합니다.' })
})

apiRouter.get('/api/design-docs/:id/file', async (req, res) => {
  try {
    const { id } = req.params
    const inline = req.query.inline === '1' || req.query.inline === 'true'
    const row = await db.prepare('SELECT id, file_name, file_path FROM design_documents WHERE id = ?').get(id)
    if (!row || !row.file_path) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const filePath = path.join(UPLOADS_DIR, row.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    res.setHeader('Content-Disposition', contentDispositionFilename(row.file_name || row.file_path || 'download', inline))
    res.sendFile(path.resolve(filePath))
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/design-docs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계도서 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, file_path, file_path_pdf, file_path_dxf FROM design_documents WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계도서를 찾을 수 없습니다.')
    }
    // DB 삭제를 먼저 수행해 잠금 시간을 짧게 유지 (이후 파일 삭제는 DB와 무관)
    await db.prepare('DELETE FROM design_documents WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
    // 파일 삭제는 응답 후 비동기로 처리 (database is locked 방지)
    setImmediate(() => {
      try {
        if (existing.file_path) {
          const filePath = path.join(UPLOADS_DIR, existing.file_path)
          try { fs.unlinkSync(filePath) } catch (_) {}
        }
        if (existing.file_path_pdf) {
          const pdfPath = path.join(PDF_CACHE_DIR, existing.file_path_pdf)
          try { fs.unlinkSync(pdfPath) } catch (_) {}
        }
        if (existing.file_path_dxf) {
          const dxfPath = path.join(DXF_CACHE_DIR, existing.file_path_dxf)
          try { fs.unlinkSync(dxfPath) } catch (_) {}
        } else {
          const dxfCachePath = path.join(DXF_CACHE_DIR, id + '.dxf')
          try { fs.unlinkSync(dxfCachePath) } catch (_) {}
        }
      } catch (_) {}
    })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 설계검토 API (리비전별 엑셀 등록/수정/삭제/공유)
// -----------------------------------------------------------------------------
apiRouter.get('/api/design-reviews', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = await db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, shared_participant_ids, created_at, updated_at FROM design_reviews WHERE design_revision_id = ? ORDER BY created_at ASC'
      )
      .all(designRevisionId)
    const reviews = rows.map((r) => {
      let shared = []
      try {
        shared = r.shared_participant_ids ? JSON.parse(r.shared_participant_ids) : []
        if (!Array.isArray(shared)) shared = []
      } catch (_) {
        shared = []
      }
      const { shared_participant_ids, ...rest } = r
      return { ...rest, shared_participant_ids: shared }
    })
    res.json({ success: true, reviews })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/design-reviews', uploadDesignReview.single('file'), async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계검토 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = await db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
    if (!rev) {
      return sendError(res, 404, '해당 리비전을 찾을 수 없습니다.')
    }
    const file = req.file
    if (!file || !file.filename) {
      return sendError(res, 400, '엑셀 파일을 선택하세요.')
    }
    const ext = (path.extname(file.filename) || path.extname(file.originalname || '') || '').toLowerCase()
    if (ext !== '.xlsx' && ext !== '.xls') {
      return sendError(res, 400, '엑셀 파일(.xlsx, .xls)만 등록할 수 있습니다.')
    }

    let file_name = (req.body && req.body.fileNameB64) ? (() => {
      try { return Buffer.from(req.body.fileNameB64, 'base64').toString('utf-8').trim() } catch (_) { return null }
    })() : null
    if (!file_name) {
      const bodyFileName = (req.body && (req.body.fileName || req.body.file_name || '')).trim()
      file_name = bodyFileName || file.originalname || file.filename
    }
    if (file_name && /[\/\\]/.test(file_name)) file_name = path.basename(file_name)

    let title = ((req.body && req.body.title) || '').trim()
    if (!title) title = file_name || file.originalname || file.filename
    if (!title) {
      return sendError(res, 400, '제목을 입력하세요.')
    }
    const memoVal = ((req.body && req.body.memo) || '').trim() || null
    const id = path.basename(file.filename, path.extname(file.filename))
    const now = new Date().toISOString()
    await db.prepare(
      'INSERT INTO design_reviews (id, design_revision_id, title, memo, file_name, file_path, shared_participant_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, revisionId, title, memoVal, file_name, file.filename, '[]', now, now)
    const row = await db
      .prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, shared_participant_ids, created_at, updated_at FROM design_reviews WHERE id = ?')
      .get(id)
    res.status(201).json({
      success: true,
      review: { ...row, shared_participant_ids: [] },
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/design-reviews/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계검토 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id FROM design_reviews WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계검토를 찾을 수 없습니다.')
    }
    const { title, memo, shared_participant_ids } = req.body || {}
    const trimmedTitle = (title || '').trim()
    if (!trimmedTitle) {
      return sendError(res, 400, '제목을 입력하세요.')
    }
    const memoVal = (memo || '').trim() || null
    const sharedJson = Array.isArray(shared_participant_ids) ? JSON.stringify(shared_participant_ids) : null
    const now = new Date().toISOString()
    await db.prepare(
      'UPDATE design_reviews SET title = ?, memo = ?, shared_participant_ids = COALESCE(?, shared_participant_ids), updated_at = ? WHERE id = ?'
    ).run(trimmedTitle, memoVal, sharedJson, now, id)
    const row = await db
      .prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, shared_participant_ids, created_at, updated_at FROM design_reviews WHERE id = ?')
      .get(id)
    let shared = []
    try {
      shared = row.shared_participant_ids ? JSON.parse(row.shared_participant_ids) : []
      if (!Array.isArray(shared)) shared = []
    } catch (_) {
      shared = []
    }
    const { shared_participant_ids: _raw, ...rest } = row
    res.json({ success: true, review: { ...rest, shared_participant_ids: shared } })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.get('/api/design-reviews/:id/file', async (req, res) => {
  try {
    const { id } = req.params
    const inline = req.query.inline === '1' || req.query.inline === 'true'
    const row = await db.prepare('SELECT id, file_name, file_path FROM design_reviews WHERE id = ?').get(id)
    if (!row || !row.file_path) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const filePath = path.join(REVIEWS_UPLOADS_DIR, row.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    res.setHeader('Content-Disposition', contentDispositionFilename(row.file_name || row.file_path || 'download', inline))
    res.sendFile(path.resolve(filePath))
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/design-reviews/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '설계검토 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, file_path FROM design_reviews WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계검토를 찾을 수 없습니다.')
    }
    await db.prepare('DELETE FROM design_reviews WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
    setImmediate(() => {
      try {
        if (existing.file_path) {
          const filePath = path.join(REVIEWS_UPLOADS_DIR, existing.file_path)
          try { fs.unlinkSync(filePath) } catch (_) {}
        }
      } catch (_) {}
    })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 모델(IFC) API (리비전별 등록/수정/삭제) - GET 목록은 상단에 이미 등록됨
// -----------------------------------------------------------------------------
/** 등록된 DWG 모델을 DXF로 변환 (고정 경로, modelId는 body로 전달) */
async function handleConvertDesignModelToDxf(req, res) {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || (req.query && req.query.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, 'DXF 변환은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = (req.body && req.body.modelId || req.body && req.body.documentId || req.body && req.body.id || '').trim()
    if (!id) {
      return sendError(res, 400, 'modelId가 필요합니다.')
    }
    const row = await db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(id)
    if (!row || !row.file_path) {
      return sendError(res, 404, '설계 모델 또는 원본 파일을 찾을 수 없습니다.')
    }
    const ext = (path.extname(row.file_path) || '').toLowerCase()
    if (ext !== '.dwg') {
      return sendError(res, 400, 'DWG 파일만 DXF로 변환할 수 있습니다.')
    }
    const sourcePath = path.join(MODELS_UPLOADS_DIR, row.file_path)
    if (!fs.existsSync(sourcePath)) {
      return sendError(res, 404, '원본 DWG 파일이 서버에 없습니다.')
    }
    const dxfPath = path.join(DXF_CACHE_DIR, id + '.dxf')
    try {
      await convertDwgToDxf(sourcePath, dxfPath)
    } catch (err) {
      return sendError(res, 500, err && err.message ? err.message : 'DWG→DXF 변환에 실패했습니다.')
    }
    try {
      await db.prepare('UPDATE design_models SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    } catch (e) {
      try { await db.exec('ALTER TABLE design_models ADD COLUMN file_path_dxf TEXT') } catch (_) {}
      await db.prepare('UPDATE design_models SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    }
    const updated = await db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, created_at, updated_at FROM design_models WHERE id = ?').get(id)
    res.json({ success: true, model: updated, message: 'DXF로 변환되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.post('/api/design-models/convert-to-dxf', handleConvertDesignModelToDxf)

apiRouter.post('/api/design-models', uploadDesignModel.any(), async (req, res) => {
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '모델 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = (body.designRevisionId || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = await db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
    if (!rev) {
      return sendError(res, 404, '해당 리비전을 찾을 수 없습니다.')
    }
    const trimmedTitle = (body.title || '').trim()
    if (!trimmedTitle) {
      return sendError(res, 400, '모델명을 입력하세요.')
    }
    const now = new Date().toISOString()
    const memoVal = (body.memo || '').trim() || null
    const files = req.files && Array.isArray(req.files) ? req.files : []
    const file = files.find((f) => f.fieldname === 'file') || files[0]
    let file_name = null
    let file_path = null
    if (file && file.filename) {
      if (body.fileNameB64 || body.filenameb64) {
        const b64 = (body.fileNameB64 || body.filenameb64 || '').trim()
        if (b64) {
          try {
            file_name = Buffer.from(b64, 'base64').toString('utf-8').trim()
          } catch (_) {}
        }
      }
      if (!file_name) {
        const bodyFileName = (body.fileName || body.file_name || '').trim()
        file_name = bodyFileName || file.originalname || file.filename
      }
      if (file_name && /[\/\\]/.test(file_name)) file_name = path.basename(file_name)
      file_path = file.filename
    }
    const modelId = file_path ? path.basename(file_path, path.extname(file_path)) : 'model-' + Date.now()
    await db.prepare(
      'INSERT INTO design_models (id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(modelId, revisionId, trimmedTitle, memoVal, file_name, file_path, now, now)
    if (file_path && /\.ifc$/i.test(file_path)) {
      await persistDesignModelIfcMeta(modelId)
      setImmediate(() => {
        void persistDesignModelIfcProducts(modelId)
      })
    }

    const trimbleTok = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    /** @type {{ status: string, reason?: string, message?: string, trimble_file_id?: string, trimble_version_id?: string | null } | null} */
    let trimbleUpload = null
    if (!file_path) {
      trimbleUpload = { status: 'skipped', reason: 'no_file' }
    } else {
      const revScope = await db
        .prepare(
          `SELECT dp.project_id AS project_id FROM design_revisions dr
           INNER JOIN design_phases dp ON dr.design_phase_id = dp.id
           WHERE dr.id = ?`
        )
        .get(revisionId)
      const projId = revScope && String(revScope.project_id || '').trim()
      const pRow = projId ? await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(projId) : null
      const tcId = pRow && String(pRow.trimble_connect_project_id || '').trim()
      if (!tcId) {
        trimbleUpload = { status: 'skipped', reason: 'no_trimble_project' }
      } else if (!trimbleTok) {
        trimbleUpload = {
          status: 'skipped',
          reason: 'no_token',
          message: 'Trimble 액세스 토큰이 없어 Connect 업로드를 건너뛰었습니다. Trimble Connect로 로그인한 뒤 다시 시도하세요.',
        }
      } else {
        const fullPath = path.join(MODELS_UPLOADS_DIR, file_path)
        if (!fs.existsSync(fullPath)) {
          trimbleUpload = {
            status: 'failed',
            reason: 'file_missing',
            message: '업로드한 파일을 서버에서 찾을 수 없습니다.',
          }
        } else {
          const extFromPath = path.extname(file_path) || path.extname(file_name || '') || ''
          const baseForName =
            file_name && extFromPath ? path.basename(file_name, extFromPath) : trimmedTitle
          const uploadFileName =
            `${baseForName}${extFromPath}` || file_name || trimmedTitle + (extFromPath || '')
          trimbleUpload = {
            status: 'queued',
            message:
              '서버에 저장되었습니다. Trimble Connect 업로드는 백그라운드에서 진행됩니다. 잠시 후 목록을 새로고침하면 Connect 연동을 확인할 수 있습니다.',
          }
          setImmediate(() => {
            void runTrimbleDesignModelUploadBackground({
              modelId,
              fullPath,
              trimbleTok,
              tcId,
              uploadFileName,
            })
          })
        }
      }
    }

    const row = await db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, trimble_file_id, trimble_version_id, trimble_sync_error, ifc_meta_json, ifc_meta_updated_at, created_at, updated_at FROM design_models WHERE id = ?'
      )
      .get(modelId)
    res.status(201).json({ success: true, model: mapDesignModelRow(row), trimbleUpload })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/design-models/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '모델 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id FROM design_models WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '모델을 찾을 수 없습니다.' })
    }
    const { title, memo } = req.body || {}
    const trimmedTitle = (title || '').trim()
    if (!trimmedTitle) {
      return res.status(400).json({ success: false, error: '모델명을 입력하세요.' })
    }
    const memoVal = (memo || '').trim() || null
    const now = new Date().toISOString()
    await db.prepare('UPDATE design_models SET title = ?, memo = ?, updated_at = ? WHERE id = ?').run(trimmedTitle, memoVal, now, id)
    const row = await db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, trimble_file_id, trimble_version_id, trimble_sync_error, ifc_meta_json, ifc_meta_updated_at, ifc_products_updated_at, created_at, updated_at FROM design_models WHERE id = ?'
      )
      .get(id)
    res.json({ success: true, model: mapDesignModelRow(row) })
  } catch (err) {
    send500(res, err)
  }
})

/** IFC products JSON 파싱 비용 절감(동일 모델 반복 요청). updated_at 변경 시 키가 달라져 자연 무효. */
const ifcProductsParseCache = new Map()
const IFC_PRODUCTS_PARSE_CACHE_MAX = 48
function getParsedIfcProductsPayload(modelId, updatedAt, rawJson) {
  const key = `${String(modelId)}\t${updatedAt || ''}`
  if (ifcProductsParseCache.has(key)) return ifcProductsParseCache.get(key)
  const data = JSON.parse(rawJson)
  if (ifcProductsParseCache.size >= IFC_PRODUCTS_PARSE_CACHE_MAX) {
    const first = ifcProductsParseCache.keys().next().value
    ifcProductsParseCache.delete(first)
  }
  ifcProductsParseCache.set(key, data)
  return data
}

apiRouter.get('/api/design-models/:id/ifc-products', async (req, res) => {
  try {
    const { id } = req.params
    const row = await db
      .prepare('SELECT id, file_path, ifc_products_json, ifc_products_updated_at FROM design_models WHERE id = ?')
      .get(id)
    if (!row) {
      return res.status(404).json({ success: false, error: '모델을 찾을 수 없습니다.' })
    }
    if (!row.file_path || !/\.ifc$/i.test(String(row.file_path))) {
      return res.status(400).json({ success: false, error: 'IFC(.ifc) 모델만 지원합니다.' })
    }
    const raw = row.ifc_products_json
    const updatedAt = row.ifc_products_updated_at || null
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return res.json({ success: true, cached: false, updated_at: updatedAt, data: null })
    }
    let data
    try {
      data = getParsedIfcProductsPayload(id, updatedAt, raw)
    } catch (_) {
      return res.json({ success: true, cached: false, updated_at: updatedAt, data: null })
    }
    const rows = Array.isArray(data.rows) ? data.rows : []
    const total =
      typeof data.total === 'number' && Number.isFinite(data.total) ? Math.max(0, Math.floor(data.total)) : rows.length

    const q = req.query || {}
    const hasLimit = q.limit !== undefined && String(q.limit).trim() !== ''
    const hasOffset = q.offset !== undefined && String(q.offset).trim() !== ''
    const paged = hasLimit || hasOffset

    if (!paged) {
      return res.json({ success: true, cached: true, updated_at: updatedAt, data })
    }

    const offset = Math.max(0, parseInt(String(q.offset), 10) || 0)
    const limit = Math.min(Math.max(parseInt(String(q.limit), 10) || 3000, 1), 10000)
    const sliced = rows.slice(offset, offset + limit)
    const hasMore = offset + sliced.length < total
    return res.json({
      success: true,
      cached: true,
      updated_at: updatedAt,
      pagination: {
        total,
        offset,
        limit: sliced.length,
        hasMore,
        nextOffset: hasMore ? offset + sliced.length : null,
      },
      data: { ...data, rows: sliced, total, storedCount: data.storedCount },
    })
  } catch (err) {
    send500(res, err)
  }
})

const designModelFileHandler = async (req, res) => {
  try {
    const { id } = req.params
    const row = await db.prepare('SELECT id, file_name, file_path FROM design_models WHERE id = ?').get(id)
    if (!row || !row.file_path || typeof row.file_path !== 'string') {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const baseDir = path.resolve(MODELS_UPLOADS_DIR)
    const safeBase = path.normalize(baseDir)
    const fileName = path.basename(path.normalize(row.file_path))
    if (!fileName || fileName.startsWith('.')) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const filePath = path.join(safeBase, fileName)
    const relative = path.relative(safeBase, path.resolve(safeBase, fileName))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    if (!fs.existsSync(filePath)) {
      console.warn('[design-models/file] 파일 없음:', filePath, '(baseDir:', baseDir, ', row.file_path:', row.file_path, ')')
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    try {
      res.setHeader('Content-Disposition', contentDispositionFilename(row.file_name || row.file_path || 'download', false))
    } catch (headerErr) {
      console.warn('[design-models/file] Content-Disposition 설정 실패:', headerErr.message)
    }
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('[design-models/file] sendFile 오류:', err.message, 'path:', filePath)
        if (!res.headersSent) send500(res, err)
      }
    })
  } catch (err) {
    console.error('[design-models/file] 처리 중 예외:', err.message, err)
    send500(res, err)
  }
}
apiRouter.get('/api/design-models/:id/file', designModelFileHandler)

const designModelDeleteHandler = async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '모델 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '모델을 찾을 수 없습니다.' })
    }
    // 파일이 서버에 없어도(이동/미배포 등) DB 레코드만 삭제
    if (existing.file_path) {
      const baseDir = path.resolve(MODELS_UPLOADS_DIR)
      const fileName = path.basename(path.normalize(existing.file_path))
      if (fileName && !fileName.startsWith('.')) {
        const filePath = path.join(baseDir, fileName)
        const relative = path.relative(baseDir, path.resolve(baseDir, fileName))
        if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath) } catch (_) {}
        }
      }
    }
    await db.prepare('DELETE FROM design_models WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
apiRouter.delete('/api/design-models/:id', designModelDeleteHandler)

apiRouter.post('/api/design-models/:id/extract-ifc', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, 'IFC 정보 갱신은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '모델을 찾을 수 없습니다.' })
    }
    if (!existing.file_path || !/\.ifc$/i.test(String(existing.file_path))) {
      return res.status(400).json({ success: false, error: 'IFC(.ifc) 파일이 있는 모델만 추출할 수 있습니다.' })
    }
    await persistDesignModelIfcMeta(id)
    await persistDesignModelIfcProducts(id)
    const row = await db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, trimble_file_id, trimble_version_id, trimble_sync_error, ifc_meta_json, ifc_meta_updated_at, ifc_products_updated_at, created_at, updated_at FROM design_models WHERE id = ?'
      )
      .get(id)
    res.json({ success: true, model: mapDesignModelRow(row) })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 물량파일 API (리비전별 엑셀 등록/수정/삭제) - GET 목록은 상단에 등록됨
// -----------------------------------------------------------------------------

/** 헤더에 공백 제거 후 비교 */
function quantityExcelCompactHeader(s) {
  return String(s == null ? '' : s)
    .replace(/\s/g, '')
    .trim()
}

/**
 * 반입·차량 일정 등: 헤더 행에 "부재번호" + ("총물량" 또는 "단위물량")가 있으면 true
 * (부재별산출서와 열 구조가 달라 기존 파서로는 명칭/규격/결과값이 뒤섞임)
 */
function findImportScheduleHeaderRowIndex(rows) {
  const max = Math.min(rows.length, 45)
  for (let r = 0; r < max; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue
    const flat = row.map((c) => quantityExcelCompactHeader(c)).join('\t')
    if (flat.includes('부재번호') && (flat.includes('총물량') || flat.includes('단위물량'))) {
      return r
    }
  }
  return -1
}

/**
 * 구분 | 부재번호 | 수량 | 가로 | 세로 | 길이 | 단위물량 | 총물량 | 중량 | 하차시간 | 비고
 * → 명칭=부재번호, 규격=가로×세로×길이, 결과값=총물량(없으면 단위물량), item_type=반입부재
 */
function parseImportScheduleSheetRows(rows, headerRowIndex) {
  const getCell = (row, colIndex) => {
    if (!Array.isArray(row) || colIndex < 0) return ''
    const v = row[colIndex]
    if (v == null) return ''
    return String(v).trim()
  }
  const header = rows[headerRowIndex]
  const colIndex = (label) => {
    const L = quantityExcelCompactHeader(label)
    if (!L) return -1
    for (let i = 0; i < header.length; i++) {
      if (quantityExcelCompactHeader(header[i]) === L) return i
    }
    return -1
  }
  const iCat = colIndex('구분')
  const iPart = colIndex('부재번호')
  const iQty = colIndex('수량')
  const iW = colIndex('가로')
  const iH = colIndex('세로')
  const iLen = colIndex('길이')
  const iUnit = colIndex('단위물량')
  const iTotal = colIndex('총물량')
  const iWeight = colIndex('중량')
  const iTime = colIndex('하차시간')
  const iNote = colIndex('비고')
  if (iPart < 0) return []

  const rowsOut = []
  let order = 0
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r]
    const partNo = getCell(row, iPart)
    const totalVal = iTotal >= 0 ? getCell(row, iTotal) : ''
    const unitVal = iUnit >= 0 ? getCell(row, iUnit) : ''
    if (!partNo && !totalVal && !unitVal) continue
    const g = (idx) => (idx >= 0 ? getCell(row, idx) : '')
    const w = g(iW)
    const h = g(iH)
    const len = g(iLen)
    const dimParts = [w, h, len].filter((x) => x !== '')
    const spec = dimParts.length ? dimParts.join('×') : unitVal
    const formulaParts = []
    if (iQty >= 0 && g(iQty)) formulaParts.push(`수량=${g(iQty)}`)
    if (iUnit >= 0 && unitVal) formulaParts.push(`단위물량=${unitVal}`)
    if (iWeight >= 0 && g(iWeight)) formulaParts.push(`중량=${g(iWeight)}`)
    if (iTime >= 0 && g(iTime)) formulaParts.push(`하차=${g(iTime)}`)
    if (iNote >= 0 && g(iNote)) formulaParts.push(`비고=${g(iNote)}`)
    const resultValue = totalVal || unitVal
    rowsOut.push({
      sort_order: order++,
      dong: '',
      floor: '',
      sign: iCat >= 0 ? g(iCat) : '',
      name: partNo,
      spec,
      formula: formulaParts.join(', '),
      result_value: resultValue,
      item_type: '반입부재',
      guid: '',
    })
  }
  return rowsOut
}

/**
 * 부재별 집계표(물량집계 + SIZE + 이형철근/하드웨어): 헤더 행에 ID·도면번호·총물량·단위물량·가로·세로·두께(길이)
 */
function findMemberAggregateHeaderRowIndex(rows, startRow = 0) {
  const from = Math.max(0, startRow)
  for (let r = from; r < rows.length; r++) {
    const row = rows[r]
    if (!Array.isArray(row) || row.length < 10) continue
    const h = row.map((c) => quantityExcelCompactHeader(c))
    if (h[0] !== 'ID' || h[2] !== '도면번호') continue
    if (h[5] !== '총물량' || h[6] !== '단위물량') continue
    if (h[7] !== '가로' || h[8] !== '세로') continue
    const h9 = h[9] || ''
    if (!h9.includes('두께') && !h9.includes('길이')) continue
    return r
  }
  return -1
}

/** "1F","2F","B1","지하1" 등 층 라벨 */
function looksLikeFloorLabel(s) {
  const t = String(s == null ? '' : s).trim()
  if (!t || t === '-') return false
  if (/^\d+F$/i.test(t)) return true
  if (/^B\d+$/i.test(t)) return true
  if (/^P\d+$/i.test(t)) return true
  if (/지하|PH|옥탑|RF|ROOF/i.test(t)) return true
  return false
}

/** 엑셀 셀 원값(숫자 우선) — 표시 형식(raw:false)으로 잃는 소수 자릿수 방지 */
function readQuantitySheetCellNumber(ws, rowIndex0Based, colIndex) {
  if (!ws || colIndex < 0 || rowIndex0Based < 0) return null
  try {
    const addr = XLSX.utils.encode_col(colIndex) + (rowIndex0Based + 1)
    const cell = ws[addr]
    if (!cell || cell.v == null) return null
    if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v
    const t = String(cell.w != null ? cell.w : cell.v)
      .replace(/,/g, '')
      .trim()
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : null
  } catch (_) {
    return null
  }
}

function formatQuantityExcelNumber(n) {
  if (n == null || !Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  const s = String(n)
  if (/e/i.test(s)) return n.toFixed(8).replace(/\.?0+$/, '')
  return s
}

/**
 * 부재별 집계표 → DB 행 (콘크리트 1행 + 이형철근/하드웨어 열마다 0 초과 시 1행)
 * 콘크리트 집계: 명칭에 "콘크리트" 포함, 규격=CON'C 강도(C30 등). 철근: 명칭에 "철근", 규격=열 헤더명.
 */
function parseMemberAggregateSheetRows(rows, headerRowIndex, ws) {
  const getCell = (row, colIndex) => {
    if (!Array.isArray(row) || colIndex < 0) return ''
    const v = row[colIndex]
    if (v == null) return ''
    return String(v).trim()
  }
  const header = rows[headerRowIndex]
  const colIndex = (label) => {
    const L = quantityExcelCompactHeader(label)
    if (!L) return -1
    for (let i = 0; i < header.length; i++) {
      if (quantityExcelCompactHeader(header[i]) === L) return i
    }
    return -1
  }
  const iId = colIndex('ID')
  const iConc =
    colIndex("CON'C 강도") >= 0
      ? colIndex("CON'C 강도")
      : colIndex('CONC강도') >= 0
        ? colIndex('CONC강도')
        : -1
  const iDraw = colIndex('도면번호')
  const iStruct = colIndex('구조번호')
  const iQty = 4
  const iTotal = colIndex('총물량')
  const iUnit = colIndex('단위물량')
  const iW = colIndex('가로')
  const iH = colIndex('세로')
  const iT = colIndex('두께(길이)')
  if (iDraw < 0 || iTotal < 0 || iUnit < 0 || iW < 0 || iH < 0 || iT < 0) return []

  const extraLabels = []
  for (let c = iT + 1; c < header.length; c++) {
    const lab = String(header[c] == null ? '' : header[c]).trim()
    if (lab) extraLabels.push({ col: c, label: lab })
  }

  let sectionFloor = ''
  if (headerRowIndex >= 1) {
    const prev = rows[headerRowIndex - 1]
    if (Array.isArray(prev) && looksLikeFloorLabel(getCell(prev, 4))) {
      sectionFloor = getCell(prev, 4)
    }
  }
  if (!sectionFloor && looksLikeFloorLabel(getCell(header, 4))) {
    sectionFloor = getCell(header, 4)
  }

  const rowsOut = []
  let order = 0
  const toNum = (v) => {
    if (v == null || v === '') return NaN
    const n = parseFloat(String(v).replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : NaN
  }

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!Array.isArray(row)) continue
    const flat = row.map((c) => quantityExcelCompactHeader(c)).join('\t')
    if (flat.includes('도면번호') && quantityExcelCompactHeader(row[0]) === 'ID' && quantityExcelCompactHeader(row[2]) === '도면번호') {
      break
    }
    const drawNo = iDraw >= 0 ? getCell(row, iDraw) : ''
    const structNo = iStruct >= 0 ? getCell(row, iStruct) : ''
    const totalStr = iTotal >= 0 ? getCell(row, iTotal) : ''
    const totalNumRaw = ws ? readQuantitySheetCellNumber(ws, r, iTotal) : null
    const totalNum = totalNumRaw != null ? totalNumRaw : toNum(totalStr)
    if (!drawNo && !structNo && (totalStr === '' || Number.isNaN(totalNum))) continue

    const conc = iConc >= 0 ? getCell(row, iConc) : ''
    const qtyNum = ws ? readQuantitySheetCellNumber(ws, r, iQty) : null
    const qty = qtyNum != null ? formatQuantityExcelNumber(qtyNum) : getCell(row, iQty)
    const unitNum = ws && iUnit >= 0 ? readQuantitySheetCellNumber(ws, r, iUnit) : null
    const unitVal = unitNum != null ? formatQuantityExcelNumber(unitNum) : iUnit >= 0 ? getCell(row, iUnit) : ''
    const wN = ws && iW >= 0 ? readQuantitySheetCellNumber(ws, r, iW) : null
    const hN = ws && iH >= 0 ? readQuantitySheetCellNumber(ws, r, iH) : null
    const tN = ws && iT >= 0 ? readQuantitySheetCellNumber(ws, r, iT) : null
    const w = wN != null ? formatQuantityExcelNumber(wN) : iW >= 0 ? getCell(row, iW) : ''
    const h = hN != null ? formatQuantityExcelNumber(hN) : iH >= 0 ? getCell(row, iH) : ''
    const t = tN != null ? formatQuantityExcelNumber(tN) : iT >= 0 ? getCell(row, iT) : ''
    const dimParts = [w, h, t].filter((x) => x !== '')
    const specSize = dimParts.length ? dimParts.join('×') : ''
    const idVal = iId >= 0 ? getCell(row, iId) : ''

    const formulaParts = []
    if (conc) formulaParts.push(`CON'C=${conc}`)
    if (qty !== '') formulaParts.push(`수량=${qty}`)
    if (unitVal !== '') formulaParts.push(`단위물량=${unitVal}`)
    if (specSize) formulaParts.push(`SIZE(㎜)=${specSize}`)
    for (const { col, label } of extraLabels) {
      const nCell = ws ? readQuantitySheetCellNumber(ws, r, col) : null
      const n = nCell != null ? nCell : toNum(getCell(row, col))
      if (!Number.isNaN(n) && n !== 0) formulaParts.push(`${label}=${formatQuantityExcelNumber(n)}`)
    }
    const formula = formulaParts.join(', ')

    const concSpec = conc || '—'
    const hasConcrete =
      (drawNo || structNo) &&
      !Number.isNaN(totalNum) &&
      (totalNumRaw != null || String(totalStr).trim() !== '')
    if (hasConcrete) {
      rowsOut.push({
        sort_order: order++,
        dong: '',
        floor: sectionFloor,
        sign: structNo,
        name: drawNo ? `콘크리트 ${drawNo}` : '콘크리트',
        spec: concSpec,
        formula,
        result_value: formatQuantityExcelNumber(totalNum),
        item_type: '부재별집계표',
        guid: idVal,
      })
    }

    for (const { col, label } of extraLabels) {
      const nCell = ws ? readQuantitySheetCellNumber(ws, r, col) : null
      const n = nCell != null ? nCell : toNum(getCell(row, col))
      if (Number.isNaN(n) || n === 0) continue
      rowsOut.push({
        sort_order: order++,
        dong: '',
        floor: sectionFloor,
        sign: structNo,
        name: `철근·부속 ${drawNo || structNo || label}`.trim(),
        spec: label,
        formula: `${label}=${formatQuantityExcelNumber(n)}`,
        result_value: formatQuantityExcelNumber(n),
        item_type: '부재별집계표',
        guid: '',
      })
    }
  }
  return rowsOut
}

/**
 * 엑셀 시트에서 물량 데이터 읽기
 * 1) 부재별산출서 형: A=층, B=부호, C=명칭, D=규격, E=산출식, F=결과값, G=아이템구분, H=guid. 4행부터. 층·부호 빈칸은 위 행 유지.
 * 2) 반입/부재번호 형: 헤더에 "부재번호"+"총물량"(또는 단위물량) 있으면 그 다음 행부터 위 표 구조로 파싱.
 * 3) 부재별 집계표 형: ID·도면번호·총물량·단위물량·가로·세로·두께(길이) 헤더 + 이형철근/하드웨어 열 (시트명 자유, 예: Sheet)
 *
 * 물량집계 화면은 명칭(키워드)→콘크리트/거푸집/철근 매핑과 규격값이 DB 규격 목록과 일치할 때만 합산합니다. 부재별 집계표는 콘크리트 행에 명칭에 "콘크리트", 규격에 강도(C30 등)를 넣어 집계에 맞춥니다.
 */
function parseQuantityExcelSheet(filePath) {
  const workbook = XLSX.readFile(filePath, { type: 'file', cellNF: false })
  const getCell = (row, colIndex) => {
    if (!Array.isArray(row) || colIndex < 0) return ''
    const v = row[colIndex]
    if (v == null) return ''
    return String(v).trim()
  }
  const getCellByAddress = (ws, colLetter, rowIndex0Based) => {
    const excelRow = rowIndex0Based + 1
    const addr = colLetter + excelRow
    const cell = ws[addr]
    if (!cell || cell.v == null) return ''
    return String(cell.v).trim()
  }
  const sheetNames = workbook.SheetNames || []
  const prefer = sheetNames.filter((n) => n && String(n).includes('부재별산출서'))
  const fallback = sheetNames.filter((n) => n && (String(n).includes('부재별') || String(n).includes('산출서')))
  const cand = prefer.length > 0 ? prefer : (fallback.length > 0 ? fallback : sheetNames)
  /** 시트 이름에서 괄호 안의 값을 동으로 사용. 예: "부재별산출서(1동)" → "1동" */
  const extractDongFromSheetName = (name) => {
    if (!name || typeof name !== 'string') return ''
    const m = name.match(/\(([^)]*)\)/)
    return m ? m[1].trim() : ''
  }
  for (const sheetName of cand) {
    if (!sheetName) continue
    const ws = workbook.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
    if (!Array.isArray(rows) || rows.length < 2) continue

    /** 부재별 집계표 (ID·도면번호·총물량… / 시트명 Sheet 등) — 동일 시트에 블록이 여러 개면 순차 파싱 */
    const mergedMember = []
    for (let s = 0; s < rows.length; ) {
      const mh = findMemberAggregateHeaderRowIndex(rows, s)
      if (mh < 0) break
      const block = parseMemberAggregateSheetRows(rows, mh, ws)
      mergedMember.push(...block)
      s = mh + 1
    }
    if (mergedMember.length > 0) return mergedMember

    const importHdr = findImportScheduleHeaderRowIndex(rows)
    if (importHdr >= 0) {
      const imported = parseImportScheduleSheetRows(rows, importHdr)
      if (imported.length > 0) return imported
    }

    if (rows.length < 4) continue
    const rowsOut = []
    const dong = extractDongFromSheetName(sheetName)
    let lastFloor = ''
    let lastSign = ''
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r]
      let floor = getCell(row, 0)
      let sign = getCell(row, 1)
      if (floor === '') floor = lastFloor
      else lastFloor = floor
      if (sign === '') sign = lastSign
      else lastSign = sign
      const name = getCell(row, 2)
      const spec = getCell(row, 3)
      const formula = getCell(row, 4)
      const resultValue = getCell(row, 5)
      const itemType = getCell(row, 6)
      const guid = getCellByAddress(ws, 'H', r) || getCell(row, 7)
      rowsOut.push({
        sort_order: r - 3,
        dong,
        floor,
        sign,
        name,
        spec,
        formula,
        result_value: resultValue,
        item_type: itemType,
        guid,
      })
    }
    if (rowsOut.length > 0) return rowsOut
  }
  return []
}

apiRouter.post('/api/quantity-files', uploadQuantityFile.single('file'), async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량파일 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = await db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
    if (!rev) {
      return sendError(res, 404, '해당 리비전을 찾을 수 없습니다.')
    }
    const file = req.file
    if (!file || !file.filename) {
      return sendError(res, 400, '엑셀 파일을 선택하세요.')
    }
    const ext = (path.extname(file.filename) || path.extname(file.originalname || '') || '').toLowerCase()
    if (ext !== '.xlsx' && ext !== '.xls') {
      return sendError(res, 400, '엑셀 파일(.xlsx, .xls)만 등록할 수 있습니다.')
    }
    let file_name = (req.body && req.body.fileNameB64) ? (() => {
      try { return Buffer.from(req.body.fileNameB64, 'base64').toString('utf-8').trim() } catch (_) { return null }
    })() : null
    if (!file_name) {
      const bodyFileName = (req.body && (req.body.fileName || req.body.file_name || '')).trim()
      file_name = bodyFileName || file.originalname || file.filename
    }
    if (file_name && /[\/\\]/.test(file_name)) file_name = path.basename(file_name)
    const title = ((req.body && req.body.title) || '').trim() || file_name || file.filename
    const memoVal = ((req.body && req.body.memo) || '').trim() || null
    const id = path.basename(file.filename, path.extname(file.filename))
    const now = new Date().toISOString()
    await db.prepare(
      'INSERT INTO quantity_files (id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, revisionId, title, memoVal, file_name, file.filename, now, now)
    const filePathFull = path.join(QUANTITY_UPLOADS_DIR, file.filename)
    if (fs.existsSync(filePathFull)) {
      try {
        const items = parseQuantityExcelSheet(filePathFull)
        const insertItem = await db.prepare(
          'INSERT INTO quantity_file_items (quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        for (const it of items) {
          insertItem.run(
            id,
            it.sort_order,
            it.dong || null,
            it.floor || null,
            it.sign || null,
            it.name || null,
            it.spec || null,
            it.formula || null,
            it.result_value || null,
            it.item_type || null,
            it.guid || null
          )
        }
      } catch (parseErr) {
        console.error('[quantity-files] 엑셀 파싱 오류:', parseErr.message)
      }
    }
    const row = await db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE id = ?').get(id)
    res.status(201).json({ success: true, file: row })
  } catch (err) {
    send500(res, err)
  }
})

/**
 * Trimble Connect → BRACE 설계모델·도서·(선택) 물량 등록 (HTTP 핸들러·프로젝트 생성 자동 동기화 공용)
 * @returns {Promise<{ ok: true, summary: object } | { ok: false, status?: number, error: string }>}
 */
function normalizeTrimbleSelectedFileEntries(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { entries: null }
  const max = 500
  if (raw.length > max) {
    return { error: `한 번에 가져올 수 있는 파일은 최대 ${max}개입니다.` }
  }
  const out = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const id = String(row.id || '').trim()
    if (!id) continue
    const name = String(row.name || 'file').trim() || 'file'
    const versionId = row.versionId != null ? String(row.versionId).trim() : ''
    const path = Array.isArray(row.path) ? row.path.map((p) => String(p || '').trim()).filter(Boolean) : []
    out.push({ id, name, versionId, path })
  }
  if (out.length === 0) return { entries: null }
  return { entries: out }
}

async function runTrimbleConnectImport(opts) {
  const {
    userEmail,
    trimbleAccessToken,
    braceProjectId,
    designRevisionId,
    importModels = true,
    importDocuments = true,
    importQuantity = false,
    maxDepth: maxDepthOpt,
    maxFiles: maxFilesOpt,
    skipExisting = true,
    selectedFileEntries: selectedRaw,
  } = opts
  const maxDepth = Math.min(Math.max(Number(maxDepthOpt) || 25, 1), 50)
  const maxFiles = Math.min(Math.max(Number(maxFilesOpt) || 400, 1), 5000)

  const selectedNorm = normalizeTrimbleSelectedFileEntries(selectedRaw)
  if (selectedNorm.error) {
    return { ok: false, status: 400, error: selectedNorm.error }
  }
  const selectedEntries = selectedNorm.entries

  try {
    if (!(await canManageProjects(userEmail))) {
      return {
        ok: false,
        status: 403,
        error: 'Connect에서 파일 가져오기는 관리자 또는 프로젝트 관리자만 가능합니다.',
      }
    }
    const token = String(trimbleAccessToken || '').trim()
    if (!token) {
      return { ok: false, status: 400, error: 'Trimble 액세스 토큰이 없습니다. Trimble Connect로 다시 로그인하세요.' }
    }
    const braceId = String(braceProjectId || '').trim()
    const revId = String(designRevisionId || '').trim()
    if (!braceId) return { ok: false, status: 400, error: '프로젝트 ID가 없습니다.' }
    if (!revId) return { ok: false, status: 400, error: 'designRevisionId(설계 리비전)가 필요합니다.' }
    const projRow = await db.prepare('SELECT id, trimble_connect_project_id FROM projects WHERE id = ?').get(braceId)
    if (!projRow) return { ok: false, status: 404, error: '프로젝트를 찾을 수 없습니다.' }
    const tcId = projRow.trimble_connect_project_id
    if (!tcId) {
      return {
        ok: false,
        status: 400,
        error:
          '이 BRACE 프로젝트에 Trimble Connect가 연결되어 있지 않습니다. 프로젝트에 Connect 프로젝트 ID를 먼저 연결하세요.',
      }
    }
    const revOk = await db
      .prepare(
        `SELECT dr.id FROM design_revisions dr
         INNER JOIN design_phases dp ON dr.design_phase_id = dp.id
         WHERE dr.id = ? AND dp.project_id = ?`
      )
      .get(revId, braceId)
    if (!revOk) {
      return { ok: false, status: 400, error: '선택한 설계 리비전이 이 프로젝트에 속하지 않습니다.' }
    }

    const resolved = await resolveTrimbleProject(token, tcId)
    if (!resolved) {
      return {
        ok: false,
        status: 502,
        error: 'Trimble 프로젝트를 찾을 수 없습니다. 토큰을 갱신했는지, 올바른 Connect 프로젝트가 연결됐는지 확인하세요.',
      }
    }
    const { apiBase, project } = resolved
    const rootId = String(project.rootId || '').trim()
    if (!rootId) {
      return { ok: false, status: 502, error: 'Trimble 프로젝트에 루트 폴더 ID(rootId)가 없습니다.' }
    }

    let files
    if (selectedEntries && selectedEntries.length > 0) {
      files = selectedEntries.map((s) => ({
        path: Array.isArray(s.path) ? s.path : [],
        name: s.name,
        id: s.id,
        versionId: s.versionId || '',
        item: {},
      }))
    } else {
      files = await listAllConnectFiles(token, apiBase, rootId, { maxDepth, maxFiles })
    }

    const MODEL_EXT = new Set(['.ifc', '.ifczip'])
    const DOC_EXT = new Set(['.dwg', '.pdf', '.dxf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp'])
    const QTY_EXT = new Set(['.xlsx', '.xls'])

    const summary = {
      scanned: files.length,
      importedModels: 0,
      importedDocs: 0,
      importedQuantity: 0,
      skipped: 0,
      errors: 0,
      failed: [],
    }

    function uniqueId(prefix) {
      return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    }

    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase()
      let category = null
      if (importModels && MODEL_EXT.has(ext)) category = 'model'
      else if (importDocuments && DOC_EXT.has(ext)) category = 'doc'
      else if (importQuantity && QTY_EXT.has(ext)) category = 'qty'
      if (!category) {
        summary.skipped += 1
        continue
      }

      if (skipExisting) {
        const table =
          category === 'model' ? 'design_models' : category === 'doc' ? 'design_documents' : 'quantity_files'
        const ex = await db
          .prepare(`SELECT id FROM ${table} WHERE design_revision_id = ? AND trimble_file_id = ?`)
          .get(revId, f.id)
        if (ex) {
          summary.skipped += 1
          continue
        }
      }

      let dl
      try {
        dl = await getTrimbleFileDownloadUrl(token, apiBase, f.id, f.versionId || undefined)
      } catch (e) {
        summary.errors += 1
        summary.failed.push({ name: f.name, error: e.message || String(e) })
        continue
      }
      if (!dl.ok) {
        summary.errors += 1
        summary.failed.push({ name: f.name, error: dl.error || 'downloadurl 요청 실패' })
        continue
      }

      let buf
      try {
        buf = await downloadTrimbleBinary(token, dl.url)
      } catch (e) {
        summary.errors += 1
        summary.failed.push({ name: f.name, error: e.message || String(e) })
        continue
      }

      const now = new Date().toISOString()
      const pathMemo = f.path.length ? f.path.join(' / ') : '(루트)'
      const memoConnect = `Trimble Connect: ${pathMemo}`
      const safeName = f.name.replace(/[\/\\:*?"<>|]/g, '_') || 'file'
      const ver = f.versionId || null

      try {
        if (category === 'model') {
          const modelId = uniqueId('model')
          const storedName = `${modelId}${ext}`
          fs.writeFileSync(path.join(MODELS_UPLOADS_DIR, storedName), buf)
          const title = path.basename(safeName, ext) || safeName
          await db.prepare(
            `INSERT INTO design_models (id, design_revision_id, title, memo, file_name, file_path, trimble_file_id, trimble_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(modelId, revId, title, memoConnect, safeName, storedName, f.id, ver, now, now)
          if (ext === '.ifc') {
            await persistDesignModelIfcMeta(modelId)
            setImmediate(() => {
              void persistDesignModelIfcProducts(modelId)
            })
          }
          summary.importedModels += 1
        } else if (category === 'doc') {
          const docId = uniqueId('doc')
          const storedName = `${docId}${ext}`
          fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buf)
          const title = path.basename(safeName, ext) || safeName
          await db.prepare(
            `INSERT INTO design_documents (id, design_revision_id, title, doc_number, memo, file_name, file_path, trimble_file_id, trimble_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(docId, revId, title, null, memoConnect, safeName, storedName, f.id, ver, now, now)

          let filePathDxf = null
          let filePathPdf = null
          if (ext === '.dwg') {
            const sourcePath = path.join(UPLOADS_DIR, storedName)
            const dxfPath = path.join(DXF_CACHE_DIR, docId + '.dxf')
            const pdfPath = path.join(PDF_CACHE_DIR, docId + '.pdf')
            try {
              await convertDwgToDxf(sourcePath, dxfPath)
              filePathDxf = docId + '.dxf'
            } catch (err) {
              console.warn('[trimble-import] DWG→DXF 실패:', f.name, err.message)
            }
            try {
              await convertDwgToPdf(sourcePath, pdfPath)
              filePathPdf = docId + '.pdf'
            } catch (err) {
              console.warn('[trimble-import] DWG→PDF 실패:', f.name, err.message)
            }
            if (filePathDxf || filePathPdf) {
              await db.prepare(
                'UPDATE design_documents SET file_path_dxf = COALESCE(?, file_path_dxf), file_path_pdf = COALESCE(?, file_path_pdf), updated_at = ? WHERE id = ?'
              ).run(filePathDxf || null, filePathPdf || null, now, docId)
            }
          }
          summary.importedDocs += 1
        } else if (category === 'qty') {
          const qtyId = uniqueId('qty')
          const storedName = `${qtyId}${ext}`
          fs.writeFileSync(path.join(QUANTITY_UPLOADS_DIR, storedName), buf)
          const title = path.basename(safeName, ext) || safeName
          await db.prepare(
            `INSERT INTO quantity_files (id, design_revision_id, title, memo, file_name, file_path, trimble_file_id, trimble_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(qtyId, revId, title, memoConnect, safeName, storedName, f.id, ver, now, now)
          const filePathFull = path.join(QUANTITY_UPLOADS_DIR, storedName)
          try {
            const items = parseQuantityExcelSheet(filePathFull)
            const insertItem = await db.prepare(
              'INSERT INTO quantity_file_items (quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )
            for (const it of items) {
              insertItem.run(
                qtyId,
                it.sort_order,
                it.dong || null,
                it.floor || null,
                it.sign || null,
                it.name || null,
                it.spec || null,
                it.formula || null,
                it.result_value || null,
                it.item_type || null,
                it.guid || null
              )
            }
          } catch (parseErr) {
            console.error('[trimble-import] 물량 엑셀 파싱 오류:', parseErr.message)
          }
          summary.importedQuantity += 1
        }
      } catch (e) {
        summary.errors += 1
        summary.failed.push({ name: f.name, error: e.message || String(e) })
      }
    }

    return { ok: true, summary }
  } catch (err) {
    console.error('[trimble-import]', err)
    return { ok: false, status: 500, error: err && err.message ? err.message : String(err) }
  }
}

/**
 * POST /api/projects/:projectId/trimble-connect/import-files
 */
async function postTrimbleBrowseFolderHandler(req, res) {
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    const trimbleAccessToken = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    const braceProjectId = String(req.params.projectId || '').trim()
    const folderIdReq = typeof body.folderId === 'string' ? body.folderId.trim() : ''
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, 'Trimble 폴더 조회는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    if (!trimbleAccessToken) {
      return sendError(res, 400, 'Trimble 액세스 토큰이 없습니다. Trimble Connect로 다시 로그인하세요.')
    }
    if (!braceProjectId) {
      return sendError(res, 400, '프로젝트 ID가 없습니다.')
    }
    const projRow = await db.prepare('SELECT trimble_connect_project_id FROM projects WHERE id = ?').get(braceProjectId)
    if (!projRow) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    const tcId = projRow.trimble_connect_project_id
    if (!tcId) {
      return sendError(res, 400, '이 BRACE 프로젝트에 Trimble Connect가 연결되어 있지 않습니다.')
    }
    const resolved = await resolveTrimbleProject(trimbleAccessToken, String(tcId).trim())
    if (!resolved) {
      return sendError(res, 502, 'Trimble 프로젝트를 찾을 수 없습니다. 토큰을 갱신했는지 확인하세요.')
    }
    const rootId = String(resolved.project.rootId || '').trim()
    if (!rootId) {
      return sendError(res, 502, 'Trimble 프로젝트에 루트 폴더 ID가 없습니다.')
    }
    const parentId = folderIdReq || rootId
    const items = await browseTrimbleFolderChildren(trimbleAccessToken, resolved.apiBase, parentId)
    res.json({
      success: true,
      rootFolderId: rootId,
      folderId: parentId,
      items,
    })
  } catch (err) {
    send500(res, err)
  }
}

async function postTrimbleConnectImportFilesHandler(req, res) {
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    const trimbleAccessToken = typeof body.trimbleAccessToken === 'string' ? body.trimbleAccessToken.trim() : ''
    const braceProjectId = String(req.params.projectId || '').trim()
    const designRevisionId = String(body.designRevisionId || '').trim()
    const result = await runTrimbleConnectImport({
      userEmail,
      trimbleAccessToken,
      braceProjectId,
      designRevisionId,
      importModels: body.importModels !== false,
      importDocuments: body.importDocuments !== false,
      importQuantity: body.importQuantity === true,
      maxDepth: body.maxDepth,
      maxFiles: body.maxFiles,
      skipExisting: body.skipExisting !== false,
      selectedFileEntries: body.selectedFileEntries,
    })
    if (!result.ok) {
      return sendError(res, result.status || 400, result.error || '가져오기 실패')
    }
    res.json({ success: true, summary: result.summary })
  } catch (err) {
    send500(res, err)
  }
}

apiRouter.post('/api/projects/:projectId/trimble-connect/browse-folder', postTrimbleBrowseFolderHandler)
apiRouter.post('/api/projects/:projectId/trimble-connect/import-files', postTrimbleConnectImportFilesHandler)

apiRouter.put('/api/quantity-files/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량파일 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id FROM quantity_files WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '물량파일을 찾을 수 없습니다.')
    }
    const { title, memo } = req.body || {}
    const trimmedTitle = (title || '').trim()
    if (!trimmedTitle) {
      return sendError(res, 400, '제목을 입력하세요.')
    }
    const memoVal = (memo || '').trim() || null
    const now = new Date().toISOString()
    await db.prepare('UPDATE quantity_files SET title = ?, memo = ?, updated_at = ? WHERE id = ?').run(trimmedTitle, memoVal, now, id)
    const row = await db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE id = ?').get(id)
    res.json({ success: true, file: row })
  } catch (err) {
    send500(res, err)
  }
})

// 부재별산출서 모달용: 해당 물량파일 내에 실제 존재하는 동/층/부재유형/부호 목록 (필터 옵션 = 이 파일에만 있는 값)
apiRouter.get('/api/quantity-files/:id/data-modal-filters', async (req, res) => {
  try {
    const { id } = req.params
    const fileRow = await db.prepare('SELECT id FROM quantity_files WHERE id = ?').get(id)
    if (!fileRow) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT dong, floor, sign FROM quantity_file_items WHERE quantity_file_id = ?`
      )
      .all(id)
    const dongSet = new Set()
    const floorSet = new Set()
    const signTypeSet = new Set()
    const signCodeSet = new Set()
    for (const r of rows) {
      const dong = r.dong != null ? String(r.dong).trim() : ''
      const floor = r.floor != null ? String(r.floor).trim() : ''
      const sign = r.sign != null ? String(r.sign).trim() : ''
      if (dong) dongSet.add(dong)
      if (floor) floorSet.add(floor)
      const parts = sign.split(/\s+/).filter(Boolean)
      if (parts[0]) signTypeSet.add(parts[0])
      if (parts[1]) signCodeSet.add(parts[1])
    }
    res.json({
      success: true,
      dongs: [...dongSet].sort(),
      floors: [...floorSet].sort(),
      signTypes: [...signTypeSet].sort(),
      signCodes: [...signCodeSet].sort(),
    })
  } catch (err) {
    send500(res, err)
  }
})

/** 물량 항목 텍스트 필드 LIKE 검색용 (SQL 와일드카드 제거) */
function quantitySearchPattern(raw) {
  const s = (raw != null ? String(raw) : '').trim().slice(0, 200).replace(/%/g, '')
  if (!s) return ''
  return '%' + s + '%'
}

/** 리비전별 물량 통계 (물량 관리 대시보드) */
apiRouter.get('/api/quantity-revision/stats', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return sendError(res, 400, 'designRevisionId가 필요합니다.')
    }
    const files = await db
      .prepare('SELECT id, title FROM quantity_files WHERE design_revision_id = ? ORDER BY created_at ASC')
      .all(designRevisionId)
    const byFile = []
    let itemCount = 0
    for (const f of files) {
      const c = await db.prepare('SELECT COUNT(*) as n FROM quantity_file_items WHERE quantity_file_id = ?').get(f.id)
      const n = c && typeof c.n === 'number' ? c.n : 0
      itemCount += n
      byFile.push({ id: f.id, title: f.title, itemCount: n })
    }
    res.json({ success: true, fileCount: files.length, itemCount, byFile })
  } catch (err) {
    send500(res, err)
  }
})

/**
 * 리비전 단위 물량 행 목록 (파일 통합 보기 + 검색 + 페이지)
 * query: designRevisionId, quantityFileId(선택), search, limit, offset
 */
apiRouter.get('/api/quantity-revision/items', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return sendError(res, 400, 'designRevisionId가 필요합니다.')
    }
    const quantityFileId = (req.query.quantityFileId || '').trim()
    const searchRaw = req.query.search != null ? String(req.query.search) : ''
    /** 단일 파일 전체 조회(B.O.M) 시 한 번에 많이 가져올 수 있게 상한 확대 */
    const maxCap = quantityFileId ? 20000 : 500
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), maxCap)
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)

    const conditions = ['qf.design_revision_id = ?']
    const params = [designRevisionId]
    if (quantityFileId) {
      conditions.push('qfi.quantity_file_id = ?')
      params.push(quantityFileId)
    }
    const sp = quantitySearchPattern(searchRaw)
    if (sp) {
      conditions.push(
        '(COALESCE(CAST(qfi.name AS TEXT), \'\') LIKE ? OR COALESCE(CAST(qfi.spec AS TEXT), \'\') LIKE ? OR COALESCE(CAST(qfi.sign AS TEXT), \'\') LIKE ? OR COALESCE(CAST(qfi.formula AS TEXT), \'\') LIKE ? OR COALESCE(CAST(qfi.result_value AS TEXT), \'\') LIKE ? OR COALESCE(CAST(qf.title AS TEXT), \'\') LIKE ?)'
      )
      params.push(sp, sp, sp, sp, sp, sp)
    }
    const whereClause = conditions.join(' AND ')
    const totalRow = await db
      .prepare(
        `SELECT COUNT(*) as total FROM quantity_file_items qfi INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id WHERE ${whereClause}`
      )
      .get(...params)
    const total = totalRow?.total ?? 0
    const rows = await db
      .prepare(
        `SELECT qfi.id, qfi.quantity_file_id, qf.title as file_title, qfi.sort_order,
          qfi.dong, qfi.floor, qfi.sign, qfi.name, qfi.spec, qfi.formula, qfi.result_value, qfi.item_type, qfi.guid
         FROM quantity_file_items qfi
         INNER JOIN quantity_files qf ON qf.id = qfi.quantity_file_id
         WHERE ${whereClause}
         ORDER BY qf.created_at ASC, qfi.sort_order ASC, qfi.id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
    res.json({ success: true, items: rows, total })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.get('/api/quantity-files/:id/items', async (req, res) => {
  try {
    const { id } = req.params
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 200), 20000)
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
    const dong = (req.query.dong != null ? String(req.query.dong).trim() : '')
    const floor = (req.query.floor != null ? String(req.query.floor).trim() : '')
    const signType = (req.query.signType != null ? String(req.query.signType).trim() : '')
    const signCode = (req.query.signCode != null ? String(req.query.signCode).trim() : '')
    const searchRaw = req.query.search != null ? String(req.query.search) : ''
    const fileRow = await db.prepare('SELECT id, title FROM quantity_files WHERE id = ?').get(id)
    if (!fileRow) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    const conditions = ['quantity_file_id = ?']
    const params = [id]
    if (dong) {
      conditions.push("TRIM(COALESCE(CAST(dong AS TEXT), '')) = ?")
      params.push(dong)
    }
    if (floor) {
      conditions.push("TRIM(COALESCE(CAST(floor AS TEXT), '')) = ?")
      params.push(floor)
    }
    if (signType) {
      conditions.push("(TRIM(COALESCE(sign, '')) = ? OR TRIM(COALESCE(sign, '')) LIKE ? || ' %')")
      params.push(signType, signType)
    }
    if (signCode) {
      conditions.push("(COALESCE(sign, '') LIKE '% ' || ? || ' %' OR COALESCE(sign, '') LIKE '% ' || ?)")
      params.push(signCode, signCode)
    }
    const sp = quantitySearchPattern(searchRaw)
    if (sp) {
      conditions.push(
        "(COALESCE(CAST(name AS TEXT), '') LIKE ? OR COALESCE(CAST(spec AS TEXT), '') LIKE ? OR COALESCE(CAST(sign AS TEXT), '') LIKE ? OR COALESCE(CAST(formula AS TEXT), '') LIKE ? OR COALESCE(CAST(result_value AS TEXT), '') LIKE ?)"
      )
      params.push(sp, sp, sp, sp, sp)
    }
    const whereClause = conditions.join(' AND ')
    const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM quantity_file_items WHERE ${whereClause}`).get(...params)
    const total = totalRow?.total ?? 0
    const rows = await db
      .prepare(
        `SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE ${whereClause} ORDER BY sort_order ASC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
    res.json({ success: true, fileTitle: fileRow.title, items: rows, total })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-files/:id/reparse', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || (req.query && req.query.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '파일에서 다시 읽기는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const fileRow = await db.prepare('SELECT id, file_path FROM quantity_files WHERE id = ?').get(id)
    if (!fileRow || !fileRow.file_path) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    const filePathFull = path.join(QUANTITY_UPLOADS_DIR, fileRow.file_path)
    if (!fs.existsSync(filePathFull)) {
      return res.status(404).json({ success: false, error: '업로드된 파일이 서버에 없습니다.' })
    }
    await db.prepare('DELETE FROM quantity_file_items WHERE quantity_file_id = ?').run(id)
    const items = parseQuantityExcelSheet(filePathFull)
    const insertItem = await db.prepare(
      'INSERT INTO quantity_file_items (quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const it of items) {
      insertItem.run(
        id,
        it.sort_order,
        it.dong || null,
        it.floor || null,
        it.sign || null,
        it.name || null,
        it.spec || null,
        it.formula || null,
        it.result_value || null,
        it.item_type || null,
        it.guid || null
      )
    }
    const rows = await db
      .prepare(
        'SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE quantity_file_id = ? ORDER BY sort_order ASC'
      )
      .all(id)
    res.json({ success: true, items: rows, message: `${rows.length}건 읽었습니다.` })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.get('/api/quantity-files/:id/file', async (req, res) => {
  try {
    const { id } = req.params
    const row = await db.prepare('SELECT id, file_name, file_path FROM quantity_files WHERE id = ?').get(id)
    if (!row || !row.file_path || typeof row.file_path !== 'string') {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const baseDir = path.resolve(QUANTITY_UPLOADS_DIR)
    const safeBase = path.normalize(baseDir)
    const fileName = path.basename(path.normalize(row.file_path))
    if (!fileName || fileName.startsWith('.')) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    const filePath = path.join(safeBase, fileName)
    const relative = path.relative(safeBase, path.resolve(safeBase, fileName))
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('파일을 찾을 수 없습니다.')
    }
    try {
      res.setHeader('Content-Disposition', contentDispositionFilename(row.file_name || row.file_path || 'download.xlsx', false))
    } catch (_) {}
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) send500(res, err)
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-files/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량파일 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = await db.prepare('SELECT id, file_path FROM quantity_files WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    await db.prepare('DELETE FROM quantity_file_items WHERE quantity_file_id = ?').run(id)
    if (existing.file_path) {
      const filePath = path.join(QUANTITY_UPLOADS_DIR, existing.file_path)
      try { fs.unlinkSync(filePath) } catch (_) {}
    }
    await db.prepare('DELETE FROM quantity_files WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

function quantityItemNullableString(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** 물량 행 수정 */
apiRouter.put('/api/quantity-file-items/:itemId', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량 데이터 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const itemId = parseInt(req.params.itemId, 10)
    if (!Number.isFinite(itemId) || itemId < 1) {
      return sendError(res, 400, '유효한 항목 ID가 필요합니다.')
    }
    const existing = await db.prepare('SELECT id FROM quantity_file_items WHERE id = ?').get(itemId)
    if (!existing) {
      return sendError(res, 404, '해당 물량 행을 찾을 수 없습니다.')
    }
    const b = req.body || {}
    const dong = quantityItemNullableString(b.dong)
    const floor = quantityItemNullableString(b.floor)
    const sign = quantityItemNullableString(b.sign)
    const name = quantityItemNullableString(b.name)
    const spec = quantityItemNullableString(b.spec)
    const formula = quantityItemNullableString(b.formula)
    const resultValue = quantityItemNullableString(b.result_value ?? b.resultValue)
    const itemType = quantityItemNullableString(b.item_type ?? b.itemType)
    const guid = quantityItemNullableString(b.guid)
    await db.prepare(
      `UPDATE quantity_file_items SET dong = ?, floor = ?, sign = ?, name = ?, spec = ?, formula = ?, result_value = ?, item_type = ?, guid = ? WHERE id = ?`
    ).run(dong, floor, sign, name, spec, formula, resultValue, itemType, guid, itemId)
    const row = await db
      .prepare(
        'SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE id = ?'
      )
      .get(itemId)
    res.json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

/** 물량 행 삭제 */
apiRouter.delete('/api/quantity-file-items/:itemId', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량 데이터 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const itemId = parseInt(req.params.itemId, 10)
    if (!Number.isFinite(itemId) || itemId < 1) {
      return sendError(res, 400, '유효한 항목 ID가 필요합니다.')
    }
    const result = await db.prepare('DELETE FROM quantity_file_items WHERE id = ?').run(itemId)
    const changes = typeof result.changes === 'number' ? result.changes : 0
    if (changes === 0) {
      return sendError(res, 404, '해당 물량 행을 찾을 수 없습니다.')
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

/** 물량 행 일괄 삭제 */
apiRouter.post('/api/quantity-file-items/bulk-delete', async (req, res) => {
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량 데이터 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0) : []
    const unique = [...new Set(ids)]
    if (unique.length === 0) {
      return sendError(res, 400, '삭제할 항목 ID가 없습니다.')
    }
    if (unique.length > 500) {
      return sendError(res, 400, '한 번에 최대 500건까지 삭제할 수 있습니다.')
    }
    const placeholders = unique.map(() => '?').join(',')
    const result = await db.prepare(`DELETE FROM quantity_file_items WHERE id IN (${placeholders})`).run(...unique)
    const deleted = typeof result.changes === 'number' ? result.changes : 0
    res.json({ success: true, deleted, message: `${deleted}건 삭제되었습니다.` })
  } catch (err) {
    send500(res, err)
  }
})

/** 물량파일에 행 추가 (수동 보정) */
apiRouter.post('/api/quantity-files/:id/items', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '물량 행 추가는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const fileId = String(req.params.id || '').trim()
    const fileRow = await db.prepare('SELECT id FROM quantity_files WHERE id = ?').get(fileId)
    if (!fileRow) {
      return sendError(res, 404, '물량파일을 찾을 수 없습니다.')
    }
    const b = req.body || {}
    const maxRow = await db.prepare('SELECT MAX(sort_order) as m FROM quantity_file_items WHERE quantity_file_id = ?').get(fileId)
    const nextOrder = (maxRow && typeof maxRow.m === 'number' ? maxRow.m : -1) + 1
    const dong = quantityItemNullableString(b.dong)
    const floor = quantityItemNullableString(b.floor)
    const sign = quantityItemNullableString(b.sign)
    const name = quantityItemNullableString(b.name)
    const spec = quantityItemNullableString(b.spec)
    const formula = quantityItemNullableString(b.formula)
    const resultValue = quantityItemNullableString(b.result_value ?? b.resultValue)
    const itemType = quantityItemNullableString(b.item_type ?? b.itemType)
    const guid = quantityItemNullableString(b.guid)
    const ins = await db
      .prepare(
        `INSERT INTO quantity_file_items (quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(fileId, nextOrder, dong, floor, sign, name, spec, formula, resultValue, itemType, guid)
    const newId = ins.lastInsertRowid
    const row = await db
      .prepare(
        'SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE id = ?'
      )
      .get(newId)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 물량집계 (동/층별 콘크리트·거푸집 합계)
// -----------------------------------------------------------------------------
apiRouter.get('/api/quantity-summary', async (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const fileIds = await db.prepare('SELECT id FROM quantity_files WHERE design_revision_id = ?').all(designRevisionId)
    const ids = fileIds.map((f) => f.id)
    if (ids.length === 0) {
      return res.json({
        success: true,
        rows: [],
        concreteColumns: [],
        formworkColumns: [],
        rebarColumns: [],
        data: {},
        itemTypeRows: [],
        itemTypeData: {},
      })
    }
    const placeholders = ids.map(() => '?').join(',')
    const items = await db
      .prepare(
        `SELECT qfi.dong, qfi.floor, qfi.name, qfi.spec, qfi.result_value, qfi.item_type, qfi.sign
         FROM quantity_file_items qfi WHERE qfi.quantity_file_id IN (${placeholders})`
      )
      .all(...ids)
    const nameMappings = await db.prepare('SELECT name_pattern, category FROM quantity_name_mappings ORDER BY sort_order ASC, id ASC').all()
    const concreteSpecRows = await db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '콘크리트' ORDER BY sort_order ASC, spec_value ASC").all()
    const concreteColumns = concreteSpecRows.map((r) => r.spec_value)
    const formworkSpecRows = await db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '거푸집' ORDER BY sort_order ASC, spec_value ASC").all()
    const formworkColumns = formworkSpecRows.map((r) => r.spec_value)
    const rebarSpecRows = await db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '철근' ORDER BY sort_order ASC, spec_value ASC").all()
    const rebarColumns = rebarSpecRows.map((r) => r.spec_value)

    const rowSet = new Map()
    for (const it of items) {
      const dong = it.dong != null ? String(it.dong).trim() : ''
      const floor = it.floor != null ? String(it.floor).trim() : ''
      const key = dong + '\t' + floor
      if (!rowSet.has(key)) rowSet.set(key, { dong, floor })
    }

    // 물량파일등록 페이지의 동관리·층관리 정렬기준(sort_order) 적용
    const dongRows = await db.prepare('SELECT dong_value FROM quantity_dongs ORDER BY sort_order ASC, id ASC').all()
    const dongOrder = dongRows.map((r) => (r.dong_value != null ? String(r.dong_value).trim() : ''))
    const floorRows = await db.prepare('SELECT floor_value FROM quantity_floors ORDER BY sort_order ASC, id ASC').all()
    const floorOrder = floorRows.map((r) => (r.floor_value != null ? String(r.floor_value).trim() : ''))

    const dongIdx = (v) => {
      const s = (v != null ? String(v).trim() : '')
      const i = dongOrder.indexOf(s)
      return i >= 0 ? i : dongOrder.length
    }
    const floorIdx = (v) => {
      const s = (v != null ? String(v).trim() : '')
      const i = floorOrder.indexOf(s)
      return i >= 0 ? i : floorOrder.length
    }
    const rows = Array.from(rowSet.values()).sort((a, b) => {
      const dA = dongIdx(a.dong)
      const dB = dongIdx(b.dong)
      if (dA !== dB) return dA - dB
      const fA = floorIdx(a.floor)
      const fB = floorIdx(b.floor)
      if (fA !== fB) return fA - fB
      return (a.dong || '').localeCompare(b.dong || '') || (a.floor || '').localeCompare(b.floor || '')
    })

    const itemTypeRowSet = new Map()
    const getEffectiveItemType = (it) => {
      const t = it.item_type != null ? String(it.item_type).trim() : ''
      if (t) return t
      const sign = it.sign != null ? String(it.sign).trim() : ''
      const first = sign.split(/\s+/).filter(Boolean)[0]
      return first || ''
    }
    for (const it of items) {
      const dong = it.dong != null ? String(it.dong).trim() : ''
      const floor = it.floor != null ? String(it.floor).trim() : ''
      const itemType = getEffectiveItemType(it)
      const key = dong + '\t' + floor + '\t' + itemType
      if (!itemTypeRowSet.has(key)) itemTypeRowSet.set(key, { dong, floor, item_type: itemType })
    }
    const itemTypeRows = Array.from(itemTypeRowSet.values()).sort((a, b) => {
      const dA = dongIdx(a.dong)
      const dB = dongIdx(b.dong)
      if (dA !== dB) return dA - dB
      const fA = floorIdx(a.floor)
      const fB = floorIdx(b.floor)
      if (fA !== fB) return fA - fB
      return (a.item_type || '').localeCompare(b.item_type || '', 'ko')
    })

    const initSummaryRow = () => {
      const o = { concrete: {}, formwork: {}, rebar: {}, rebarStructural: {}, rebarConstruction: {} }
      for (const spec of concreteColumns) o.concrete[spec] = 0
      for (const spec of formworkColumns) o.formwork[spec] = 0
      for (const spec of rebarColumns) {
        o.rebar[spec] = 0
        o.rebarStructural[spec] = 0
        o.rebarConstruction[spec] = 0
      }
      return o
    }
    const data = {}
    const itemTypeData = {}
    for (const r of rows) {
      const key = r.dong + '\t' + r.floor
      data[key] = initSummaryRow()
    }
    for (const r of itemTypeRows) {
      const key = r.dong + '\t' + r.floor + '\t' + r.item_type
      itemTypeData[key] = initSummaryRow()
    }

    const getCategoryFromName = (nameStr) => {
      if (!nameStr) return ''
      for (const m of nameMappings) {
        if (m.name_pattern && nameStr.includes(m.name_pattern)) return m.category || ''
      }
      return ''
    }

    const toNum = (v) => {
      if (v == null || v === '') return NaN
      const n = parseFloat(String(v).replace(/,/g, '').trim())
      return Number.isFinite(n) ? n : NaN
    }

    for (const it of items) {
      const dong = it.dong != null ? String(it.dong).trim() : ''
      const floor = it.floor != null ? String(it.floor).trim() : ''
      const itemType = getEffectiveItemType(it)
      const key = dong + '\t' + floor
      const itemTypeKey = dong + '\t' + floor + '\t' + itemType
      const val = toNum(it.result_value)
      if (Number.isNaN(val)) continue
      const name = it.name != null ? String(it.name).trim() : ''
      const spec = it.spec != null ? String(it.spec).trim() : ''
      const category = getCategoryFromName(name)
      if (category === '콘크리트' && concreteColumns.includes(spec)) {
        if (data[key]) data[key].concrete[spec] = (data[key].concrete[spec] || 0) + val
        if (itemTypeData[itemTypeKey]) itemTypeData[itemTypeKey].concrete[spec] = (itemTypeData[itemTypeKey].concrete[spec] || 0) + val
      } else if (category === '거푸집' && formworkColumns.includes(spec)) {
        if (data[key]) data[key].formwork[spec] = (data[key].formwork[spec] || 0) + val
        if (itemTypeData[itemTypeKey]) itemTypeData[itemTypeKey].formwork[spec] = (itemTypeData[itemTypeKey].formwork[spec] || 0) + val
      } else if (category === '철근' && rebarColumns.includes(spec)) {
        const itLabel = itemType
        let rebarField = 'rebar'
        if (itLabel && /구조/.test(itLabel)) rebarField = 'rebarStructural'
        else if (itLabel && /시공/.test(itLabel)) rebarField = 'rebarConstruction'
        if (data[key] && data[key][rebarField]) {
          data[key][rebarField][spec] = (data[key][rebarField][spec] || 0) + val
        }
        if (itemTypeData[itemTypeKey] && itemTypeData[itemTypeKey][rebarField]) {
          itemTypeData[itemTypeKey][rebarField][spec] = (itemTypeData[itemTypeKey][rebarField][spec] || 0) + val
        }
      }
    }

    res.json({ success: true, rows, concreteColumns, formworkColumns, rebarColumns, data, itemTypeRows, itemTypeData })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 명칭 매핑 (명칭 → 콘크리트/거푸집/철근)
// -----------------------------------------------------------------------------
const NAME_CATEGORIES = ['콘크리트', '거푸집', '철근']

apiRouter.get('/api/quantity-name-mappings', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT id, name_pattern, category, sort_order, created_at FROM quantity_name_mappings ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-name-mappings', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '명칭 매핑 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const namePattern = (req.body && req.body.name_pattern) != null ? String(req.body.name_pattern).trim() : ''
    const category = (req.body && req.body.category) != null ? String(req.body.category).trim() : ''
    if (!namePattern) {
      return res.status(400).json({ success: false, error: '명칭(키워드)을 입력하세요.' })
    }
    if (!NAME_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: '분류는 콘크리트, 거푸집, 철근 중 하나여야 합니다.' })
    }
    const result = await db.prepare('INSERT INTO quantity_name_mappings (name_pattern, category, sort_order) VALUES (?, ?, 0)').run(namePattern, category)
    const row = await db.prepare('SELECT id, name_pattern, category, sort_order, created_at FROM quantity_name_mappings WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-name-mappings/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '명칭 매핑 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM quantity_name_mappings WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '매핑을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 규격 마스터
// -----------------------------------------------------------------------------
const SPEC_CATEGORIES = ['콘크리트', '거푸집', '철근']

apiRouter.get('/api/quantity-specs', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT id, spec_value, category, sort_order, created_at FROM quantity_specs ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-specs', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '규격 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const specValue = (req.body && req.body.spec_value) != null ? String(req.body.spec_value).trim() : ''
    const category = (req.body && req.body.category) != null ? String(req.body.category).trim() : ''
    if (!specValue) {
      return res.status(400).json({ success: false, error: '규격을 입력하세요.' })
    }
    if (!SPEC_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: '분류는 콘크리트, 거푸집, 철근 중 하나여야 합니다.' })
    }
    const result = await db.prepare('INSERT INTO quantity_specs (spec_value, category, sort_order) VALUES (?, ?, 0)').run(specValue, category)
    const row = await db.prepare('SELECT id, spec_value, category, sort_order, created_at FROM quantity_specs WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-specs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '규격 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = await db.prepare('SELECT id, spec_value, category FROM quantity_specs WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '규격을 찾을 수 없습니다.' })
    }
    const specValue = (req.body && req.body.spec_value) != null ? String(req.body.spec_value).trim() : existing.spec_value
    let category = existing.category
    if (req.body && req.body.category != null) {
      const c = String(req.body.category).trim()
      if (!SPEC_CATEGORIES.includes(c)) {
        return res.status(400).json({ success: false, error: '분류는 콘크리트, 거푸집, 철근 중 하나여야 합니다.' })
      }
      category = c
    }
    if (!specValue) {
      return res.status(400).json({ success: false, error: '규격을 입력하세요.' })
    }
    await db.prepare('UPDATE quantity_specs SET spec_value = ?, category = ? WHERE id = ?').run(specValue, category, id)
    const row = await db.prepare('SELECT id, spec_value, category, sort_order, created_at FROM quantity_specs WHERE id = ?').get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-specs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '규격 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM quantity_specs WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '규격을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 부재 매핑 (부재명 ↔ 모델 속성) — 물량 부재유형(item_type) 표준화 참고용
// -----------------------------------------------------------------------------
apiRouter.get('/api/quantity-item-type-mappings', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        'SELECT id, item_label, model_property, segment, sort_order, created_at FROM quantity_item_type_mappings ORDER BY sort_order ASC, id ASC'
      )
      .all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-item-type-mappings', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '부재 매핑 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const itemLabel = (req.body && req.body.item_label) != null ? String(req.body.item_label).trim() : ''
    const modelProperty = (req.body && req.body.model_property) != null ? String(req.body.model_property).trim() : ''
    const segment = (req.body && req.body.segment) != null ? String(req.body.segment).trim() : ''
    if (!itemLabel || !modelProperty) {
      return res.status(400).json({ success: false, error: '부재명과 모델 속성을 입력하세요.' })
    }
    const result = await db
      .prepare('INSERT INTO quantity_item_type_mappings (item_label, model_property, segment, sort_order) VALUES (?, ?, ?, 0)')
      .run(itemLabel, modelProperty, segment || null)
    const row = await db
      .prepare('SELECT id, item_label, model_property, segment, sort_order, created_at FROM quantity_item_type_mappings WHERE id = ?')
      .get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    if (err && /unique|duplicate/i.test(String(err.message))) {
      return res.status(409).json({ success: false, error: '이미 등록된 부재명입니다.' })
    }
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-item-type-mappings/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '부재 매핑 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = await db.prepare('SELECT id, item_label, model_property, segment, sort_order FROM quantity_item_type_mappings WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '매핑을 찾을 수 없습니다.' })
    }
    const itemLabel =
      (req.body && req.body.item_label) != null ? String(req.body.item_label).trim() : existing.item_label
    const modelProperty =
      (req.body && req.body.model_property) != null ? String(req.body.model_property).trim() : existing.model_property
    const segmentRaw = req.body && req.body.segment
    const segment =
      segmentRaw === undefined ? existing.segment : segmentRaw === null || segmentRaw === '' ? null : String(segmentRaw).trim()
    const sortOrder =
      req.body && req.body.sort_order != null && Number.isFinite(Number(req.body.sort_order))
        ? Math.max(0, Math.floor(Number(req.body.sort_order)))
        : existing.sort_order
    if (!itemLabel || !modelProperty) {
      return res.status(400).json({ success: false, error: '부재명과 모델 속성을 입력하세요.' })
    }
    await db
      .prepare('UPDATE quantity_item_type_mappings SET item_label = ?, model_property = ?, segment = ?, sort_order = ? WHERE id = ?')
      .run(itemLabel, modelProperty, segment, sortOrder, id)
    const row = await db
      .prepare('SELECT id, item_label, model_property, segment, sort_order, created_at FROM quantity_item_type_mappings WHERE id = ?')
      .get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    if (err && /unique|duplicate/i.test(String(err.message))) {
      return res.status(409).json({ success: false, error: '이미 등록된 부재명입니다.' })
    }
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-item-type-mappings/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '부재 매핑 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM quantity_item_type_mappings WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '매핑을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 철근 데이터베이스 (프로젝트별 일람표·길이·공통속성)
// -----------------------------------------------------------------------------
const REBAR_DB_SECTIONS = new Set([
  'schedule_wall',
  'schedule_lintel',
  'schedule_column',
  'length_stock',
  'length_lap',
  'common_wall',
  'common_lintel',
  'common_column',
])

apiRouter.get('/api/rebar-database-rows', async (req, res) => {
  try {
    const projectId = req.query.projectId != null ? String(req.query.projectId).trim() : ''
    const section = req.query.section != null ? String(req.query.section).trim() : ''
    if (!projectId || !REBAR_DB_SECTIONS.has(section)) {
      return res.status(400).json({ success: false, error: 'projectId와 유효한 section이 필요합니다.' })
    }
    const rows = await db
      .prepare(
        'SELECT id, project_id, section, sort_order, data, created_at, updated_at FROM rebar_database_rows WHERE project_id = ? AND section = ? ORDER BY sort_order ASC, id ASC'
      )
      .all(projectId, section)
    const items = rows.map((r) => ({
      ...r,
      data: r.data && typeof r.data === 'object' ? r.data : {},
    }))
    res.json({ success: true, items })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/rebar-database-rows', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '철근 DB 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const projectId = (req.body && req.body.projectId) != null ? String(req.body.projectId).trim() : ''
    const section = (req.body && req.body.section) != null ? String(req.body.section).trim() : ''
    const data = (req.body && req.body.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data)) ? req.body.data : {}
    if (!projectId || !REBAR_DB_SECTIONS.has(section)) {
      return res.status(400).json({ success: false, error: 'projectId와 유효한 section이 필요합니다.' })
    }
    const proj = await db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!proj) {
      return res.status(404).json({ success: false, error: '프로젝트를 찾을 수 없습니다.' })
    }
    const maxRow = await db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM rebar_database_rows WHERE project_id = ? AND section = ?')
      .get(projectId, section)
    const nextOrder = (maxRow && Number.isFinite(Number(maxRow.m)) ? Number(maxRow.m) : -1) + 1
    const dataJson = JSON.stringify(data)
    const result = await db
      .prepare('INSERT INTO rebar_database_rows (project_id, section, sort_order, data) VALUES (?, ?, ?, ?::jsonb)')
      .run(projectId, section, nextOrder, dataJson)
    const row = await db
      .prepare('SELECT id, project_id, section, sort_order, data, created_at, updated_at FROM rebar_database_rows WHERE id = ?')
      .get(result.lastInsertRowid)
    res.status(201).json({
      success: true,
      item: { ...row, data: row.data && typeof row.data === 'object' ? row.data : {} },
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/rebar-database-rows/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '철근 DB 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = await db
      .prepare('SELECT id, project_id, section, sort_order, data FROM rebar_database_rows WHERE id = ?')
      .get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '행을 찾을 수 없습니다.' })
    }
    let data = existing.data && typeof existing.data === 'object' ? { ...existing.data } : {}
    if (req.body && req.body.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data)) {
      data = { ...data, ...req.body.data }
    }
    const sortOrder =
      req.body && req.body.sort_order != null && Number.isFinite(Number(req.body.sort_order))
        ? Math.max(0, Math.floor(Number(req.body.sort_order)))
        : existing.sort_order
    const dataJson = JSON.stringify(data)
    await db
      .prepare(
        'UPDATE rebar_database_rows SET data = ?::jsonb, sort_order = ?, updated_at = to_char(current_timestamp, \'YYYY-MM-DD HH24:MI:SS\') WHERE id = ?'
      )
      .run(dataJson, sortOrder, id)
    const row = await db
      .prepare('SELECT id, project_id, section, sort_order, data, created_at, updated_at FROM rebar_database_rows WHERE id = ?')
      .get(id)
    res.json({
      success: true,
      item: { ...row, data: row.data && typeof row.data === 'object' ? row.data : {} },
    })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/rebar-database-rows/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '철근 DB 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM rebar_database_rows WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '행을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 객체 분류 체계 (MMS 코드관리: 작업 분류 / 내역 분류 — 계층형 분류·코드·속성)
// -----------------------------------------------------------------------------
const OBJECT_SCHEME_TYPES = ['work', 'detail']

function newObjectClassificationId() {
  return `oc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

async function deleteObjectClassificationCascade(id) {
  const kids = await db.prepare('SELECT id FROM object_classifications WHERE parent_id = ?').all(id)
  for (const k of kids) {
    await deleteObjectClassificationCascade(k.id)
  }
  await db.prepare('DELETE FROM object_classifications WHERE id = ?').run(id)
}

/** nodeId가 ancestorId의 하위(본인 포함)인지 */
async function isUnderAncestor(ancestorId, nodeId) {
  let cur = nodeId
  const seen = new Set()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (cur === ancestorId) return true
    const row = await db.prepare('SELECT parent_id FROM object_classifications WHERE id = ?').get(cur)
    if (!row) break
    cur = row.parent_id || ''
    if (!cur) break
  }
  return false
}

async function validateObjectParent(schemeType, parentId) {
  const pid = parentId || ''
  if (!pid) return { ok: true }
  const p = await db.prepare('SELECT id, scheme_type FROM object_classifications WHERE id = ?').get(pid)
  if (!p) {
    return { ok: false, error: '상위 분류가 없습니다.' }
  }
  if (p.scheme_type !== schemeType) {
    return { ok: false, error: '같은 체계(작업/내역) 내에서만 상·하위를 설정할 수 있습니다.' }
  }
  return { ok: true }
}

apiRouter.get('/api/object-classifications', async (req, res) => {
  try {
    const schemeType = String(req.query.schemeType || '').trim()
    if (!OBJECT_SCHEME_TYPES.includes(schemeType)) {
      return res.status(400).json({ success: false, error: 'schemeType은 work(작업 분류) 또는 detail(내역 분류)이어야 합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT id, scheme_type, parent_id, code, name, sort_order, attributes, memo, created_at, updated_at
         FROM object_classifications WHERE scheme_type = ? ORDER BY parent_id ASC, sort_order ASC, code ASC`
      )
      .all(schemeType)
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/object-classifications', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '분류 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const schemeType = String((req.body && req.body.scheme_type) || '').trim()
    if (!OBJECT_SCHEME_TYPES.includes(schemeType)) {
      return res.status(400).json({ success: false, error: 'scheme_type은 work 또는 detail이어야 합니다.' })
    }
    const parentId = (req.body && req.body.parent_id) != null ? String(req.body.parent_id).trim() : ''
    const code = (req.body && req.body.code) != null ? String(req.body.code).trim() : ''
    const name = (req.body && req.body.name) != null ? String(req.body.name).trim() : ''
    if (!code) {
      return res.status(400).json({ success: false, error: '분류 코드를 입력하세요.' })
    }
    if (!name) {
      return res.status(400).json({ success: false, error: '분류명을 입력하세요.' })
    }
    const vp = await validateObjectParent(schemeType, parentId)
    if (!vp.ok) {
      return res.status(400).json({ success: false, error: vp.error })
    }
    const sortOrder = Number(req.body && req.body.sort_order)
    const attributes = (req.body && req.body.attributes) != null ? String(req.body.attributes).trim() : ''
    const memo = (req.body && req.body.memo) != null ? String(req.body.memo).trim() : ''
    const id = newObjectClassificationId()
    const now = new Date().toISOString()
    await db.prepare(
      `INSERT INTO object_classifications (id, scheme_type, parent_id, code, name, sort_order, attributes, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      schemeType,
      parentId || '',
      code,
      name,
      Number.isFinite(sortOrder) ? sortOrder : 0,
      attributes || null,
      memo || null,
      now,
      now
    )
    const row = await db
      .prepare(
        'SELECT id, scheme_type, parent_id, code, name, sort_order, attributes, memo, created_at, updated_at FROM object_classifications WHERE id = ?'
      )
      .get(id)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    if (err && String(err.message || err).includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '같은 상위 아래에 동일 분류 코드가 이미 있습니다.' })
    }
    send500(res, err)
  }
})

apiRouter.put('/api/object-classifications/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '분류 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = String(req.params.id || '').trim()
    const ex = await db.prepare('SELECT id, scheme_type FROM object_classifications WHERE id = ?').get(id)
    if (!ex) {
      return sendError(res, 404, '분류를 찾을 수 없습니다.')
    }
    const schemeType = ex.scheme_type
    const parentId = (req.body && req.body.parent_id) != null ? String(req.body.parent_id).trim() : ''
    const code = (req.body && req.body.code) != null ? String(req.body.code).trim() : ''
    const name = (req.body && req.body.name) != null ? String(req.body.name).trim() : ''
    if (!code) {
      return res.status(400).json({ success: false, error: '분류 코드를 입력하세요.' })
    }
    if (!name) {
      return res.status(400).json({ success: false, error: '분류명을 입력하세요.' })
    }
    if (parentId === id) {
      return res.status(400).json({ success: false, error: '자기 자신을 상위로 지정할 수 없습니다.' })
    }
    if (parentId && (await isUnderAncestor(id, parentId))) {
      return res.status(400).json({ success: false, error: '하위 분류를 상위로 지정할 수 없습니다.' })
    }
    const vp = await validateObjectParent(schemeType, parentId)
    if (!vp.ok) {
      return res.status(400).json({ success: false, error: vp.error })
    }
    const sortOrder = Number(req.body && req.body.sort_order)
    const attributes = (req.body && req.body.attributes) != null ? String(req.body.attributes).trim() : ''
    const memo = (req.body && req.body.memo) != null ? String(req.body.memo).trim() : ''
    const now = new Date().toISOString()
    await db.prepare(
      'UPDATE object_classifications SET parent_id = ?, code = ?, name = ?, sort_order = ?, attributes = ?, memo = ?, updated_at = ? WHERE id = ?'
    ).run(
      parentId || '',
      code,
      name,
      Number.isFinite(sortOrder) ? sortOrder : 0,
      attributes || null,
      memo || null,
      now,
      id
    )
    const row = await db
      .prepare(
        'SELECT id, scheme_type, parent_id, code, name, sort_order, attributes, memo, created_at, updated_at FROM object_classifications WHERE id = ?'
      )
      .get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    if (err && String(err.message || err).includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '같은 상위 아래에 동일 분류 코드가 이미 있습니다.' })
    }
    send500(res, err)
  }
})

apiRouter.delete('/api/object-classifications/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '분류 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = String(req.params.id || '').trim()
    const ex = await db.prepare('SELECT id FROM object_classifications WHERE id = ?').get(id)
    if (!ex) {
      return sendError(res, 404, '분류를 찾을 수 없습니다.')
    }
    await deleteObjectClassificationCascade(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 코드 관리 — 매개변수 목록 + 분류체계(OBS/MBS/WBS/CBS/UBS) 구성
// -----------------------------------------------------------------------------
const CODE_MGMT_SYSTEMS = ['OBS', 'MBS', 'WBS', 'CBS', 'UBS']

function newCodeMgmtId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

apiRouter.get('/api/code-mgmt/parameters', async (req, res) => {
  try {
    const rows = await db
      .prepare(
        'SELECT id, code, param_group, param_key, memo, sort_order, created_at, updated_at FROM code_mgmt_parameters ORDER BY sort_order ASC, code ASC'
      )
      .all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/code-mgmt/parameters', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '매개변수 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const code = (req.body && req.body.code) != null ? String(req.body.code).trim() : ''
    const paramGroup = (req.body && req.body.param_group) != null ? String(req.body.param_group).trim() : 'HITBIM'
    const paramKey = (req.body && req.body.param_key) != null ? String(req.body.param_key).trim() : ''
    if (!code) {
      return res.status(400).json({ success: false, error: '코드를 입력하세요.' })
    }
    if (!paramKey) {
      return res.status(400).json({ success: false, error: '매개변수를 입력하세요.' })
    }
    const sortOrder = Number(req.body && req.body.sort_order)
    const memo = (req.body && req.body.memo) != null ? String(req.body.memo).trim() : ''
    const id = newCodeMgmtId('cmp')
    const now = new Date().toISOString()
    await db.prepare(
      `INSERT INTO code_mgmt_parameters (id, code, param_group, param_key, memo, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, code, paramGroup || 'HITBIM', paramKey, memo || null, Number.isFinite(sortOrder) ? sortOrder : 0, now, now)
    const row = await db
      .prepare('SELECT id, code, param_group, param_key, memo, sort_order, created_at, updated_at FROM code_mgmt_parameters WHERE id = ?')
      .get(id)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    if (err && String(err.message || err).includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '같은 매개변수 그룹·키 조합이 이미 있습니다.' })
    }
    send500(res, err)
  }
})

apiRouter.put('/api/code-mgmt/parameters/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '매개변수 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = String(req.params.id || '').trim()
    const ex = await db.prepare('SELECT id FROM code_mgmt_parameters WHERE id = ?').get(id)
    if (!ex) {
      return sendError(res, 404, '매개변수를 찾을 수 없습니다.')
    }
    const code = (req.body && req.body.code) != null ? String(req.body.code).trim() : ''
    const paramGroup = (req.body && req.body.param_group) != null ? String(req.body.param_group).trim() : 'HITBIM'
    const paramKey = (req.body && req.body.param_key) != null ? String(req.body.param_key).trim() : ''
    if (!code) {
      return res.status(400).json({ success: false, error: '코드를 입력하세요.' })
    }
    if (!paramKey) {
      return res.status(400).json({ success: false, error: '매개변수를 입력하세요.' })
    }
    const sortOrder = Number(req.body && req.body.sort_order)
    const memo = (req.body && req.body.memo) != null ? String(req.body.memo).trim() : ''
    const now = new Date().toISOString()
    await db.prepare(
      'UPDATE code_mgmt_parameters SET code = ?, param_group = ?, param_key = ?, memo = ?, sort_order = ?, updated_at = ? WHERE id = ?'
    ).run(code, paramGroup || 'HITBIM', paramKey, memo || null, Number.isFinite(sortOrder) ? sortOrder : 0, now, id)
    const row = await db
      .prepare('SELECT id, code, param_group, param_key, memo, sort_order, created_at, updated_at FROM code_mgmt_parameters WHERE id = ?')
      .get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    if (err && String(err.message || err).includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '같은 매개변수 그룹·키 조합이 이미 있습니다.' })
    }
    send500(res, err)
  }
})

apiRouter.delete('/api/code-mgmt/parameters/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '매개변수 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = String(req.params.id || '').trim()
    const ex = await db.prepare('SELECT id FROM code_mgmt_parameters WHERE id = ?').get(id)
    if (!ex) {
      return sendError(res, 404, '매개변수를 찾을 수 없습니다.')
    }
    const touchedSystems = await db.prepare('SELECT DISTINCT system_type FROM code_mgmt_compositions WHERE parameter_id = ?').all(id)
    await db.prepare('DELETE FROM code_mgmt_compositions WHERE parameter_id = ?').run(id)
    for (const { system_type: sys } of touchedSystems) {
      const rest = await db.prepare('SELECT id FROM code_mgmt_compositions WHERE system_type = ? ORDER BY sort_index ASC').all(sys)
      for (let i = 0; i < rest.length; i++) {
        await db.prepare('UPDATE code_mgmt_compositions SET sort_index = ? WHERE id = ?').run(i, rest[i].id)
      }
    }
    await db.prepare('DELETE FROM code_mgmt_parameters WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.get('/api/code-mgmt/compositions', async (req, res) => {
  try {
    const systemType = String(req.query.systemType || '').trim().toUpperCase()
    if (!CODE_MGMT_SYSTEMS.includes(systemType)) {
      return res.status(400).json({ success: false, error: 'systemType은 OBS, MBS, WBS, CBS, UBS 중 하나여야 합니다.' })
    }
    const rows = await db
      .prepare(
        `SELECT c.id AS composition_id, c.sort_index, c.parameter_id,
                p.code, p.param_group, p.param_key, p.memo
         FROM code_mgmt_compositions c
         INNER JOIN code_mgmt_parameters p ON p.id = c.parameter_id
         WHERE c.system_type = ?
         ORDER BY c.sort_index ASC`
      )
      .all(systemType)
    res.json({ success: true, systemType, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/code-mgmt/compositions', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '구성 추가는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const systemType = String((req.body && req.body.systemType) || '').trim().toUpperCase()
    if (!CODE_MGMT_SYSTEMS.includes(systemType)) {
      return res.status(400).json({ success: false, error: 'systemType이 올바르지 않습니다.' })
    }
    const parameterId = (req.body && req.body.parameterId) != null ? String(req.body.parameterId).trim() : ''
    if (!parameterId) {
      return res.status(400).json({ success: false, error: '매개변수를 선택하세요.' })
    }
    const pOk = await db.prepare('SELECT id FROM code_mgmt_parameters WHERE id = ?').get(parameterId)
    if (!pOk) {
      return res.status(400).json({ success: false, error: '매개변수가 없습니다.' })
    }
    const dup = await db.prepare('SELECT id FROM code_mgmt_compositions WHERE system_type = ? AND parameter_id = ?').get(systemType, parameterId)
    if (dup) {
      return res.status(400).json({ success: false, error: '이 체계에 이미 포함된 매개변수입니다.' })
    }
    const maxRow = await db.prepare('SELECT MAX(sort_index) AS m FROM code_mgmt_compositions WHERE system_type = ?').get(systemType)
    const nextIdx = (maxRow && Number.isFinite(maxRow.m) ? maxRow.m : -1) + 1
    const id = newCodeMgmtId('cmc')
    const now = new Date().toISOString()
    await db.prepare(
      'INSERT INTO code_mgmt_compositions (id, system_type, sort_index, parameter_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, systemType, nextIdx, parameterId, now)
    const row = await db
      .prepare(
        `SELECT c.id AS composition_id, c.sort_index, c.parameter_id,
                p.code, p.param_group, p.param_key, p.memo
         FROM code_mgmt_compositions c
         INNER JOIN code_mgmt_parameters p ON p.id = c.parameter_id
         WHERE c.id = ?`
      )
      .get(id)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/code-mgmt/compositions/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '구성 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = String(req.params.id || '').trim()
    const row = await db.prepare('SELECT id, system_type, sort_index FROM code_mgmt_compositions WHERE id = ?').get(id)
    if (!row) {
      return sendError(res, 404, '구성 행을 찾을 수 없습니다.')
    }
    const sys = row.system_type
    await db.prepare('DELETE FROM code_mgmt_compositions WHERE id = ?').run(id)
    const rest = await db.prepare('SELECT id FROM code_mgmt_compositions WHERE system_type = ? ORDER BY sort_index ASC').all(sys)
    for (let i = 0; i < rest.length; i++) {
      await db.prepare('UPDATE code_mgmt_compositions SET sort_index = ? WHERE id = ?').run(i, rest[i].id)
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/code-mgmt/compositions/reset', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '초기화는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const systemType = String((req.body && req.body.systemType) || '').trim().toUpperCase()
    if (!CODE_MGMT_SYSTEMS.includes(systemType)) {
      return res.status(400).json({ success: false, error: 'systemType이 올바르지 않습니다.' })
    }
    await db.prepare('DELETE FROM code_mgmt_compositions WHERE system_type = ?').run(systemType)
    res.json({ success: true, message: '초기화되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 동 목록 (quantity_dongs)
// -----------------------------------------------------------------------------
apiRouter.get('/api/quantity-dongs', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-dongs', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '동 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const dongValue = (req.body && req.body.dong_value) != null ? String(req.body.dong_value).trim() : ''
    if (!dongValue) {
      return res.status(400).json({ success: false, error: '동 값을 입력하세요.' })
    }
    const result = await db.prepare('INSERT INTO quantity_dongs (dong_value, sort_order, gross_area) VALUES (?, 0, NULL)').run(dongValue)
    const row = await db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-dongs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '동 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = await db.prepare('SELECT id, dong_value, gross_area FROM quantity_dongs WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '동을 찾을 수 없습니다.' })
    }
    const dongValue = (req.body && req.body.dong_value) != null ? String(req.body.dong_value).trim() : existing.dong_value
    const grossAreaRaw = req.body && req.body.gross_area
    const grossArea = grossAreaRaw === '' || grossAreaRaw === null || grossAreaRaw === undefined
      ? null
      : (typeof grossAreaRaw === 'number' && Number.isFinite(grossAreaRaw) ? grossAreaRaw : parseFloat(grossAreaRaw))
    const grossAreaFinal = grossArea != null && Number.isFinite(grossArea) && grossArea >= 0 ? grossArea : null
    await db.prepare('UPDATE quantity_dongs SET dong_value = ?, gross_area = ? WHERE id = ?').run(dongValue || existing.dong_value, grossAreaFinal, id)
    const row = await db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs WHERE id = ?').get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-dongs/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '동 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM quantity_dongs WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '동을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-dongs/reorder', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '동 순서 변경은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const order = req.body && Array.isArray(req.body.order) ? req.body.order : []
    const ids = order.filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'order 배열이 필요합니다.' })
    }
    await db.transaction(async (tx) => {
      const update = await tx.prepare('UPDATE quantity_dongs SET sort_order = ? WHERE id = ?')
      for (let index = 0; index < ids.length; index++) {
        await update.run(index, ids[index])
      }
    })
    res.json({ success: true, message: '순서가 변경되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 층 목록 (quantity_floors)
// -----------------------------------------------------------------------------
apiRouter.get('/api/quantity-floors', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT id, floor_value, sort_order, created_at FROM quantity_floors ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.post('/api/quantity-floors', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '층 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const floorValue = (req.body && req.body.floor_value) != null ? String(req.body.floor_value).trim() : ''
    if (!floorValue) {
      return res.status(400).json({ success: false, error: '층 값을 입력하세요.' })
    }
    const result = await db.prepare('INSERT INTO quantity_floors (floor_value, sort_order) VALUES (?, 0)').run(floorValue)
    const row = await db.prepare('SELECT id, floor_value, sort_order, created_at FROM quantity_floors WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-floors/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '층 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = await db.prepare('SELECT id, floor_value FROM quantity_floors WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '층을 찾을 수 없습니다.' })
    }
    const floorValue = (req.body && req.body.floor_value) != null ? String(req.body.floor_value).trim() : existing.floor_value
    if (!floorValue) {
      return res.status(400).json({ success: false, error: '층 값을 입력하세요.' })
    }
    await db.prepare('UPDATE quantity_floors SET floor_value = ? WHERE id = ?').run(floorValue, id)
    const row = await db.prepare('SELECT id, floor_value, sort_order, created_at FROM quantity_floors WHERE id = ?').get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.delete('/api/quantity-floors/:id', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '층 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = await db.prepare('DELETE FROM quantity_floors WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '층을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

apiRouter.put('/api/quantity-floors/reorder', async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!(await canManageProjects(userEmail))) {
      return sendError(res, 403, '층 순서 변경은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const order = req.body && Array.isArray(req.body.order) ? req.body.order : []
    const ids = order.filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'order 배열이 필요합니다.' })
    }
    await db.transaction(async (tx) => {
      const update = await tx.prepare('UPDATE quantity_floors SET sort_order = ? WHERE id = ?')
      for (let index = 0; index < ids.length; index++) {
        await update.run(index, ids[index])
      }
    })
    res.json({ success: true, message: '순서가 변경되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 기타
// -----------------------------------------------------------------------------
apiRouter.get('/api/health', async (req, res) => {
  res.json({ ok: true, message: 'API 서버가 실행 중입니다.'   })
})

// API 라우터 마운트: 루트와 서브경로(BASE_PREFIX) 양쪽에서 동작
app.use(apiRouter)
if (BASE_PREFIX) app.use(BASE_PREFIX, apiRouter)

// 404 직전: GET 목록 요청 폴백 (경로가 어긋나 들어온 경우 처리)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  const p = (req.path || '').replace(/\/+$/, '')
  if (p === '/api/design-models' || p === '/api/design-model') {
    return getDesignModelsListHandler(req, res)
  }
  if (p === '/api/quantity-files') {
    return getQuantityFilesListHandler(req, res)
  }
  next()
})

// 배포 시 빌드된 프론트(dist) 서빙 (BASE_PATH/BASE_PREFIX는 상단에서 이미 정의됨)
// IIS 기본: publish-iis 루트 — …/server 와 …/dist 형제이면 …/dist 의 index.html·assets 서빙
function resolveFrontendDist (serverDir) {
  const parent = path.join(serverDir, '..')
  const nested = path.join(parent, 'dist')
  if (fs.existsSync(path.join(nested, 'index.html'))) return nested
  if (fs.existsSync(path.join(parent, 'index.html'))) return parent
  return nested
}
const DIST = resolveFrontendDist(__dirname)
const distExists = fs.existsSync(path.join(DIST, 'index.html'))
// 배포 확인: 브라우저에서 /bracetc/api/deploy-info 호출해 basePath·dist·스크립트 경로 확인
apiRouter.get('/api/deploy-info', (_req, res) => {
  let scriptHint = ''
  try {
    const htmlPath = path.join(DIST, 'index.html')
    if (fs.existsSync(htmlPath)) scriptHint = (fs.readFileSync(htmlPath, 'utf8').match(/src="([^"]+)"/) || [])[1] || '(없음)'
  } catch (_) {}
  res.json({
    basePath: BASE_PATH || '(없음)',
    distExists,
    distPath: DIST,
    scriptSrcInIndex: scriptHint,
    hint: !BASE_PATH && /^\/(assets\/|favicon)/.test(scriptHint) ? 'OK (루트 빌드됨)' : BASE_PATH && scriptHint.startsWith('/' + BASE_PATH + '/') ? 'OK (서브경로 빌드됨)' : '오류: 배포 방식에 맞게 deploy:iis 또는 deploy:iis:root 로 다시 빌드 후 publish-iis 복사 필요'
  })
})
if (distExists) {
  app.use(express.static(DIST, { index: false }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    const indexPath = path.join(DIST, 'index.html')
    if (!BASE_PREFIX) {
      return res.sendFile(indexPath, (err) => { if (err) next() })
    }
    // 서브경로 배포 시: asset 경로 수정 + 프론트가 라우트/API에 쓸 수 있게 window.__BASE_PATH__ 주입
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) return next()
      html = html.replace(/(\s(src|href)=["'])(\/)(assets\/|favicon)/g, '$1' + BASE_PREFIX + '/$4')
      const baseScript = '<script>window.__BASE_PATH__="' + BASE_PREFIX.replace(/"/g, '\\"') + '";</script>'
      html = html.replace('</head>', baseScript + '\n</head>')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.send(html)
    })
  })
}

app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.originalUrl} (path: ${req.path})`)
  res.status(404).json({ success: false, error: '요청한 경로를 찾을 수 없습니다.' })
})

// 미처리 예외 시 500 JSON 반환 (로그인 등에서 원인 확인용)
app.use((err, req, res, next) => {
  const msg = err && (err.message || String(err))
  console.error('[미처리 오류]', msg, err)
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? '서버 오류가 발생했습니다.' : msg,
    })
  }
})

dbModule.init().then(async () => {
  logStartup('DB init OK, about to listen. process.env.PORT=' + String(process.env.PORT ?? '(unset)'))
  console.log(
    '[API] Trimble: POST /api/auth/trimble/check-user, POST /api/auth/trimble/register, POST /api/projects/:id/trimble-connect/import-files'
  )
  await ensureAdmin()
  await ensureRoleDefaults()
  listenForRequests()
}).catch(err => {
  const msg = (err && err.stack) || String(err)
  console.error('DB 초기화 실패:', err)
  logStartup('DB init FAILED: ' + msg)
  process.exit(1)
})
