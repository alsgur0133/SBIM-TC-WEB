/**
 * BRACE API 서버
 * - 인증: /api/auth/* (회원가입, 로그인, 프로필, 사용자 관리)
 * - 프로젝트: /api/projects (목록/생성/수정/삭제)
 * - 설계일정: /api/design-schedule/phases, /api/design-schedule/revisions
 */
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')
const XLSX = require('xlsx')
const db = require('./db')

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
const uploadDesignDoc = multer({ storage: designDocStorage, limits: { fileSize: 50 * 1024 * 1024 } })

const designModelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MODELS_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = 'model-' + Date.now()
    const ext = (path.extname(file.originalname) || '.ifc').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadDesignModel = multer({ storage: designModelStorage, limits: { fileSize: 100 * 1024 * 1024 } })

const designReviewStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REVIEWS_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const id = 'review-' + Date.now()
    const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadDesignReview = multer({ storage: designReviewStorage, limits: { fileSize: 20 * 1024 * 1024 } })

const quantityFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, QUANTITY_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = 'qty-' + Date.now()
    const ext = (path.extname(file.originalname) || '.xlsx').toLowerCase()
    cb(null, `${id}${ext}`)
  },
})
const uploadQuantityFile = multer({ storage: quantityFileStorage, limits: { fileSize: 20 * 1024 * 1024 } })

// -----------------------------------------------------------------------------
// 초기화: 기본 관리자 계정 (이메일: sa, 비밀번호: 1234)
// -----------------------------------------------------------------------------
const ADMIN_EMAIL = 'sa'
const ADMIN_PASSWORD = '1234'
const ADMIN_NAME = '관리자'
;(function ensureAdmin() {
  try {
    const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL)
    if (existing) {
      try {
        db.prepare('UPDATE users SET password = ?, name = ?, status = ?, is_admin = ?, role = ? WHERE email = ?').run(
          hashed, ADMIN_NAME, '활성', 1, '관리자', ADMIN_EMAIL
        )
      } catch (e) {
        const m = String(e.message || e)
        if (/no such column: role/i.test(m)) {
          try {
            db.prepare('UPDATE users SET password = ?, name = ?, status = ?, is_admin = ? WHERE email = ?').run(
              hashed, ADMIN_NAME, '활성', 1, ADMIN_EMAIL
            )
          } catch (e2) {
            if (/no such column/i.test(String(e2.message || e2))) {
              db.prepare('UPDATE users SET password = ?, name = ? WHERE email = ?').run(hashed, ADMIN_NAME, ADMIN_EMAIL)
            } else {
              throw e2
            }
          }
        } else if (/no such column/i.test(m)) {
          db.prepare('UPDATE users SET password = ?, name = ? WHERE email = ?').run(hashed, ADMIN_NAME, ADMIN_EMAIL)
        } else {
          throw e
        }
      }
      console.log('기본 관리자 계정 비밀번호 설정됨 (이메일: sa, 비밀번호: 1234)')
    } else {
      const id = 'admin-' + Date.now()
      try {
        db.prepare('INSERT INTO users (id, name, email, password, status, is_admin, role) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          id, ADMIN_NAME, ADMIN_EMAIL, hashed, '활성', 1, '관리자'
        )
      } catch (e) {
        const m = String(e.message || e)
        if (/no such column/i.test(m)) {
          try {
            db.prepare('INSERT INTO users (id, name, email, password, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').run(
              id, ADMIN_NAME, ADMIN_EMAIL, hashed
            )
          } catch (e2) {
            if (/no such column/i.test(String(e2.message || e2))) {
              db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(
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
})()

// 기존 사용자에게 role 부여 (is_admin이면 관리자, 아니면 일반 사용자)
try {
  db.prepare("UPDATE users SET role = '관리자' WHERE is_admin = 1 AND (role IS NULL OR role = '')").run()
  db.prepare("UPDATE users SET role = '일반 사용자' WHERE (role IS NULL OR role = '')").run()
} catch (_) {}

const app = express()
const PORT = process.env.PORT || 5001

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

// 모델 목록 GET (리비전 선택 시 호출) - 다른 :id 라우트보다 먼저 등록
const getDesignModelsListHandler = (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM design_models WHERE design_revision_id = ? ORDER BY created_at ASC'
      )
      .all(designRevisionId)
    // 한글 등이 깨진 file_name은 title로 보정 (설계도서와 동일)
    const hasKorean = (s) => s && /[\uAC00-\uD7A3]/.test(s)
    const models = rows.map((r) => {
      const out = { ...r }
      if (out.file_path && out.title && out.file_name && !hasKorean(out.file_name) && hasKorean(out.title)) {
        out.file_name = out.title
      }
      return out
    })
    res.json({ success: true, models })
  } catch (err) {
    send500(res, err)
  }
}
app.get('/api/design-models', getDesignModelsListHandler)
app.get('/api/design-model', getDesignModelsListHandler)
// 리비전 선택 시 모델 목록 요청 (trailing slash·경로 변형 대비)
app.get(/^\/api\/design-models\/?$/i, getDesignModelsListHandler)
app.get(/^\/api\/design-model\/?$/i, getDesignModelsListHandler)

// 물량파일 목록 GET (경로 충돌 방지를 위해 상단에 등록)
const getQuantityFilesListHandler = (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
      .prepare(
        'SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE design_revision_id = ? ORDER BY created_at ASC'
      )
      .all(designRevisionId)
    res.json({ success: true, files: rows })
  } catch (err) {
    send500(res, err)
  }
}
app.get('/api/quantity-files', getQuantityFilesListHandler)
app.get(/^\/api\/quantity-files\/?$/i, getQuantityFilesListHandler)

// 물량 데이터에서 사용된 명칭 목록 (매핑용)
app.get('/api/quantity-files/distinct-names', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
app.get('/api/quantity-files/distinct-specs', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
app.get('/api/quantity-files/distinct-dongs', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
app.get('/api/quantity-files/distinct-floors', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
app.get('/api/quantity-files/data-modal-filters', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
app.post('/api/auth/signup', (req, res) => {
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

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)
    if (existing) {
      return res.status(400).json({ success: false, error: '이미 사용 중인 이메일입니다.' })
    }

    const id = String(Date.now())
    const hashedPassword = bcrypt.hashSync(password, 10)
    db.prepare(
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
app.post('/api/auth/login', (req, res) => {
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
      row = db.prepare(
        'SELECT id, name, email, password, status, is_admin FROM users WHERE email = ?'
      ).get(normalizedEmail)
    } catch (selectErr) {
      const msg = selectErr && String(selectErr.message || selectErr)
      if (!/no such column/i.test(msg)) {
        console.error('[로그인] SELECT 오류:', msg)
        throw selectErr
      }
      try {
        row = db.prepare(
          'SELECT id, name, email, password, created_at FROM users WHERE email = ?'
        ).get(normalizedEmail)
      } catch (e2) {
        if (/no such column/i.test(String(e2.message || e2))) {
          row = db.prepare(
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
        db.prepare('UPDATE users SET password = ?, status = ?, is_admin = ?, role = ? WHERE email = ?').run(
          hashed, '활성', 1, '관리자', ADMIN_EMAIL
        )
      } catch (updErr) {
        const msg = updErr && String(updErr.message || updErr)
        if (/no such column: role/i.test(msg)) {
          try {
            db.prepare('UPDATE users SET password = ?, status = ?, is_admin = ? WHERE email = ?').run(
              hashed, '활성', 1, ADMIN_EMAIL
            )
          } catch (e2) {
            if (/no such column: (status|is_admin)/i.test(String(e2.message || e2))) {
              db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashed, ADMIN_EMAIL)
            } else {
              throw e2
            }
          }
        } else if (/no such column: (status|is_admin)/i.test(msg)) {
          db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashed, ADMIN_EMAIL)
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
})

// 내 정보 수정
app.put('/api/auth/profile', (req, res) => {
  try {
    const body = req.body || {}
    const { email, name, company, currentPassword, newPassword } = body
    const normalizedEmail = (email || '').trim().toLowerCase()

    if (!normalizedEmail || !currentPassword) {
      return res.status(400).json({ success: false, error: '이메일과 현재 비밀번호를 입력하세요.' })
    }

    const row = db.prepare('SELECT id, name, email, password, company FROM users WHERE email = ?').get(normalizedEmail)
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
    db.prepare('UPDATE users SET name = ?, company = ?, password = ? WHERE id = ?').run(trimmedName, companyVal, hashedPassword, row.id)

    res.json({
      success: true,
      user: { id: row.id, name: trimmedName, email: row.email, company: companyVal || undefined },
    })
  } catch (err) {
    send500(res, err)
  }
})

// 전체 사용자 목록 (관리자만, 사용자 관리 화면용)
app.get('/api/auth/users', (req, res) => {
  try {
    const q = req.query || {}
    const requesterEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    if (!requesterEmail) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    if (!canManageProjects(requesterEmail)) {
      return res.status(403).json({ success: false, error: '관리자 또는 프로젝트 관리자만 조회할 수 있습니다.' })
    }
    let rows
    try {
      rows = db.prepare(
        'SELECT id, name, email, status, is_admin, role, company, created_at FROM users ORDER BY created_at ASC'
      ).all()
    } catch (colErr) {
      if (colErr && /no such column: (role|company)/i.test(String(colErr.message))) {
        rows = db.prepare('SELECT id, name, email, status, is_admin, created_at FROM users ORDER BY created_at ASC').all()
        rows = rows.map((r) => ({ ...r, role: r.is_admin ? '관리자' : '일반 사용자', company: null }))
      } else throw colErr
    }
    res.json({ success: true, users: rows })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 수정 (관리자만, DB 저장)
app.put('/api/auth/users/:userId', (req, res) => {
  try {
    const body = req.body || {}
    const { adminEmail, name, email, role, status, company } = body
    const normalizedAdmin = (adminEmail || '').trim().toLowerCase()
    if (!normalizedAdmin) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    const admin = db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizedAdmin)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 수정할 수 있습니다.' })
    }
    const { userId } = req.params
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId)
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
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, userId)
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
    db.prepare(
      'UPDATE users SET name = ?, email = ?, status = ?, is_admin = ?, role = ?, company = ? WHERE id = ?'
    ).run(trimmedName, normalizedEmail, statusVal, isAdmin, roleVal, companyVal, userId)
    res.json({ success: true, message: '저장되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// 승인 대기 사용자 목록 (관리자만)
app.get('/api/auth/pending-users', (req, res) => {
  try {
    const q = req.query || {}
    const adminEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    if (!adminEmail) {
      return res.status(400).json({ success: false, error: 'adminEmail이 필요합니다.' })
    }
    const admin = db.prepare('SELECT is_admin FROM users WHERE email = ?').get(adminEmail)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 조회할 수 있습니다.' })
    }
    const rows = db.prepare(
      "SELECT id, name, email, created_at FROM users WHERE status = '승인대기' ORDER BY created_at ASC"
    ).all()
    res.json({ success: true, users: rows })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 승인 (관리자만)
app.post('/api/auth/approve-user', (req, res) => {
  try {
    const body = req.body || {}
    const { adminEmail, userId } = body
    const normalizedAdmin = (adminEmail || '').trim().toLowerCase()
    if (!normalizedAdmin || !userId) {
      return res.status(400).json({ success: false, error: 'adminEmail과 userId가 필요합니다.' })
    }
    const admin = db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizedAdmin)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 승인할 수 있습니다.' })
    }
    const target = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId)
    if (!target) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' })
    }
    if (target.status === '활성') {
      return res.status(400).json({ success: false, error: '이미 승인된 사용자입니다.' })
    }
    db.prepare("UPDATE users SET status = '활성' WHERE id = ?").run(userId)
    res.json({ success: true, message: '승인되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// 사용자 삭제 (관리자만, 관리자 계정 sa는 삭제 불가)
app.delete('/api/auth/users/:userId', (req, res) => {
  try {
    const q = req.query || {}
    const adminEmail = (typeof q.adminEmail === 'string' ? q.adminEmail : '').trim().toLowerCase()
    const userId = req.params && req.params.userId
    if (!adminEmail || !userId) {
      return res.status(400).json({ success: false, error: 'adminEmail과 userId가 필요합니다.' })
    }
    const admin = db.prepare('SELECT is_admin FROM users WHERE email = ?').get(adminEmail)
    if (!admin || !admin.is_admin) {
      return res.status(403).json({ success: false, error: '관리자만 삭제할 수 있습니다.' })
    }
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId)
    if (!target) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' })
    }
    if (target.email === ADMIN_EMAIL) {
      return res.status(400).json({ success: false, error: '기본 관리자 계정(sa)은 삭제할 수 없습니다.' })
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 프로젝트 API (GET: 전체, POST/PUT/DELETE: 관리자·프로젝트 관리자)
// -----------------------------------------------------------------------------
function canManageProjects(email) {
  if (!email) return false
  try {
    const u = db.prepare('SELECT role, is_admin FROM users WHERE email = ?').get(normalizeEmail(email))
    return !!(u && (u.role === '프로젝트 관리자' || u.role === '관리자' || u.is_admin === 1))
  } catch (err) {
    if (err && /no such column: role/i.test(String(err.message))) {
      const u = db.prepare('SELECT is_admin FROM users WHERE email = ?').get(normalizeEmail(email))
      return !!(u && u.is_admin === 1)
    }
    throw err
  }
}

function ensureProjectExtraColumns() {
  const columns = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name)
  const need = [
    { name: 'code', sql: 'ALTER TABLE projects ADD COLUMN code TEXT' },
    { name: 'client', sql: 'ALTER TABLE projects ADD COLUMN client TEXT' },
    { name: 'start_date', sql: 'ALTER TABLE projects ADD COLUMN start_date TEXT' },
    { name: 'end_date', sql: 'ALTER TABLE projects ADD COLUMN end_date TEXT' },
    { name: 'pm', sql: 'ALTER TABLE projects ADD COLUMN pm TEXT' },
    { name: 'status', sql: 'ALTER TABLE projects ADD COLUMN status TEXT' },
  ]
  for (const { name: col, sql } of need) {
    if (!columns.includes(col)) {
      try {
        db.exec(sql)
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
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

const PROJECTS_SELECT = 'SELECT id, name, description, code, client, start_date, end_date, pm, status, created_at, updated_at FROM projects'

app.get('/api/projects', (req, res) => {
  try {
    ensureProjectExtraColumns()
    const rows = db.prepare(`${PROJECTS_SELECT} ORDER BY updated_at DESC`).all()
    res.json({ success: true, projects: rows.map(mapProjectRow) })
  } catch (err) {
    send500(res, err)
  }
})

// 다음 프로젝트 코드 조회 (YYMM-NNN, 해당 년월 순번). 팝업 미리보기용
app.get('/api/projects/next-code', (req, res) => {
  try {
    ensureProjectExtraColumns()
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const yymm = String(y).slice(-2) + String(m).padStart(2, '0')
    const startOfMonth = new Date(y, m - 1, 1)
    const endOfMonth = new Date(y, m, 1)
    const startISO = startOfMonth.toISOString()
    const endISO = endOfMonth.toISOString()
    const rows = db
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
function getNextProjectCode(createdAtISO) {
  const d = new Date(createdAtISO)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const yymm = String(y).slice(-2) + String(m).padStart(2, '0')
  const startOfMonth = new Date(y, m - 1, 1)
  const endOfMonth = new Date(y, m, 1)
  const startISO = startOfMonth.toISOString()
  const endISO = endOfMonth.toISOString()
  try {
    const rows = db
      .prepare('SELECT id FROM projects WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id')
      .all(startISO, endISO)
    const seq = rows.length + 1
    return yymm + '-' + String(seq).padStart(3, '0')
  } catch (e) {
    return yymm + '-001'
  }
}

app.post('/api/projects', (req, res) => {
  try {
    ensureProjectExtraColumns()
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
    if (!canManageProjects(userEmail)) {
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
    const insertStmt = db.prepare(
      'INSERT INTO projects (id, name, description, code, client, start_date, end_date, pm, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    let codeVal
    const run = db.transaction(() => {
      codeVal = codeFromBody || getNextProjectCode(now)
      insertStmt.run(id, trimmedName, (description || '').trim() || null, codeVal, clientVal, startVal, endVal, pmVal, statusVal, now, now)
    })
    run()
    const row = db.prepare(`${PROJECTS_SELECT} WHERE id = ?`).get(id)
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
      created_at: now,
      updated_at: now,
    }
    res.status(201).json({ success: true, project })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/projects/:id', (req, res) => {
  try {
    const body = req.body || {}
    if (!canManageProjects(body.userEmail)) {
      return sendError(res, 403, '프로젝트 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    ensureProjectExtraColumns()
    const { id } = req.params
    const trimmedName = (body.name || '').trim()
    const existing = db.prepare('SELECT id, created_at FROM projects WHERE id = ?').get(id)
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
    const statusToSet = body.status === '진행' || body.status === '완료' || body.status === '예정' ? body.status : (db.prepare('SELECT status FROM projects WHERE id = ?').get(id)?.status ?? '예정')
    db.prepare(
      'UPDATE projects SET name = ?, description = ?, code = ?, client = ?, start_date = ?, end_date = ?, pm = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, (body.description || '').trim() || null, codeVal, clientVal, startVal, endVal, pmVal, statusToSet, now, id)
    const row = db.prepare(`${PROJECTS_SELECT} WHERE id = ?`).get(id)
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

app.delete('/api/projects/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '프로젝트 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 프로젝트 참여자 API (관리자·프로젝트 관리자만)
// -----------------------------------------------------------------------------
app.get('/api/projects/:id/participants', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '참여자 조회는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id: projectId } = req.params
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    const rows = db
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

function postParticipantsHandler(req, res) {
  console.log('POST participants hit', req.method, req.path, req.params)
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '참여자 추가는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const projectId = req.params.id || req.params.projectId
    if (!projectId) {
      return sendError(res, 400, '프로젝트 ID가 없습니다.')
    }
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    const userIds = Array.isArray(body.userIds) ? body.userIds : []
    const roleInProject = (body.roleInProject || '참여자').trim() || '참여자'
    if (userIds.length === 0) {
      return sendError(res, 400, '추가할 사용자를 선택하세요.')
    }
    const now = new Date().toISOString()
    const insert = db.prepare(
      'INSERT OR IGNORE INTO project_participants (project_id, user_id, role_in_project, created_at) VALUES (?, ?, ?, ?)'
    )
    for (const userId of userIds) {
      if (userId) insert.run(projectId, userId, roleInProject, now)
    }
    const rows = db
      .prepare(
        `SELECT pp.user_id, pp.role_in_project, pp.created_at, u.name AS user_name, u.email AS user_email, u.company AS user_company
         FROM project_participants pp
         JOIN users u ON u.id = pp.user_id
         WHERE pp.project_id = ?`
      )
      .all(projectId)
    res.status(201).json({
      success: true,
      participants: rows.map((r) => ({
        user_id: r.user_id,
        role_in_project: r.role_in_project,
        created_at: r.created_at,
        user_name: r.user_name,
        user_email: r.user_email,
        user_company: r.user_company ?? null,
      })),
    })
  } catch (err) {
    send500(res, err)
  }
}

// POST 참여자 추가: /api prefix 있음/없음, trailing slash 모두 수용
app.post('/api/projects/:id/participants', postParticipantsHandler)
app.post('/api/projects/:id/participants/', postParticipantsHandler)
app.post('/projects/:id/participants', postParticipantsHandler)
app.post('/projects/:id/participants/', postParticipantsHandler)

app.delete('/api/projects/:projectId/participants/:userId', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '참여자 제거는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { projectId, userId } = req.params
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
    if (!project) {
      return sendError(res, 404, '프로젝트를 찾을 수 없습니다.')
    }
    db.prepare('DELETE FROM project_participants WHERE project_id = ? AND user_id = ?').run(projectId, userId)
    res.json({ success: true, message: '제거되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 설계일정 API (설계차수·리비전, 관리자·프로젝트 관리자만 생성/수정/삭제)
// -----------------------------------------------------------------------------

app.get('/api/design-schedule/phases', (req, res) => {
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
    const rows = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all()
    res.json({ success: true, phases: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/design-schedule/phases', (req, res) => {
  try {
    const { name, sort_order, project_id, userEmail } = req.body
    const normalizedEmail = normalizeEmail(userEmail)
    if (!canManageProjects(normalizedEmail)) {
      return res.status(403).json({ success: false, error: '설계차수 등록은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const trimmedName = (name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '설계차수명을 입력하세요.' })
    }
    const id = 'phase-' + Date.now()
    const now = new Date().toISOString()
    const order = typeof sort_order === 'number' ? sort_order : 0
    const projId = (project_id || '').trim() || null
    db.prepare(
      'INSERT INTO design_phases (id, name, sort_order, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, trimmedName, order, projId, now, now)
    res.status(201).json({
      success: true,
      phase: { id, name: trimmedName, sort_order: order, project_id: projId, created_at: now, updated_at: now },
    })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/design-schedule/phases/:id', (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail || '')
    if (!canManageProjects(normalizedEmail)) {
      return res.status(403).json({ success: false, error: '설계차수 수정은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const { name, sort_order, project_id } = req.body
    const existing = db.prepare('SELECT id, sort_order, created_at FROM design_phases WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    const trimmedName = (name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '설계차수명을 입력하세요.' })
    }
    const order = typeof sort_order === 'number' ? sort_order : (existing.sort_order ?? 0)
    const projId = (project_id || '').trim() || null
    const now = new Date().toISOString()
    db.prepare(
      'UPDATE design_phases SET name = ?, sort_order = ?, project_id = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, order, projId, now, id)
    res.json({
      success: true,
      phase: { id, name: trimmedName, sort_order: order, project_id: projId, created_at: existing.created_at, updated_at: now },
    })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/design-schedule/phases/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail)
    if (!canManageProjects(userEmail)) {
      return res.status(403).json({ success: false, error: '설계차수 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM design_phases WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    db.prepare('DELETE FROM design_revisions WHERE design_phase_id = ?').run(id)
    db.prepare('DELETE FROM design_phases WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// 리비전 목록 (설계차수별)
app.get('/api/design-schedule/phases/:phaseId/revisions', (req, res) => {
  try {
    const phaseId = req.params && req.params.phaseId
    if (!phaseId) {
      return res.status(400).json({ success: false, error: 'phaseId가 필요합니다.' })
    }
    const rows = db
      .prepare(
        'SELECT id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at FROM design_revisions WHERE design_phase_id = ? ORDER BY revision_name ASC, created_at ASC'
      )
      .all(phaseId)
    res.json({ success: true, revisions: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/design-schedule/phases/:phaseId/revisions', (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail)
    if (!canManageProjects(normalizedEmail)) {
      return res.status(403).json({ success: false, error: '리비전 등록은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { phaseId } = req.params
    const phase = db.prepare('SELECT id FROM design_phases WHERE id = ?').get(phaseId)
    if (!phase) {
      return res.status(404).json({ success: false, error: '설계차수를 찾을 수 없습니다.' })
    }
    const { revision_name, planned_date, actual_date, status, memo } = req.body
    const trimmedName = (revision_name || '').trim()
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: '리비전명을 입력하세요.' })
    }
    const id = 'rev-' + Date.now()
    const now = new Date().toISOString()
    const statusVal = (status || '예정').trim()
    const planned = (planned_date || '').trim() || null
    const actual = (actual_date || '').trim() || null
    const memoVal = (memo || '').trim() || null
    db.prepare(
      'INSERT INTO design_revisions (id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, phaseId, trimmedName, planned, actual, statusVal, memoVal, now, now)
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
    })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/design-schedule/revisions/:id', (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.userEmail)
    if (!canManageProjects(normalizedEmail)) {
      return res.status(403).json({ success: false, error: '리비전 수정은 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id, design_phase_id, created_at FROM design_revisions WHERE id = ?').get(id)
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
    db.prepare(
      'UPDATE design_revisions SET revision_name = ?, planned_date = ?, actual_date = ?, status = ?, memo = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, planned, actual, statusVal, memoVal, now, id)
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
    })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/design-schedule/revisions/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail)
    if (!canManageProjects(userEmail)) {
      return res.status(403).json({ success: false, error: '리비전 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.' })
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '리비전을 찾을 수 없습니다.' })
    }
    db.prepare('DELETE FROM design_revisions WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 설계도서 API (리비전별 등록/수정/삭제)
// -----------------------------------------------------------------------------
app.get('/api/design-docs', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, 'DXF 변환은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = (req.body && req.body.documentId || req.body && req.body.id || '').trim()
    if (!id) {
      return sendError(res, 400, 'documentId가 필요합니다.')
    }
    const row = db.prepare('SELECT id, file_path FROM design_documents WHERE id = ?').get(id)
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
    db.prepare('UPDATE design_documents SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    const updated = db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(id)
    res.json({ success: true, document: updated, message: 'DXF로 변환되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
app.post('/api/design-docs/convert-to-dxf', handleConvertDesignDocToDxf)

app.post('/api/design-docs', uploadDesignDoc.single('file'), async (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계도서 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
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
    db.prepare(
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
      const stmt = db.prepare('UPDATE design_documents SET file_path_dxf = COALESCE(?, file_path_dxf), file_path_pdf = COALESCE(?, file_path_pdf) WHERE id = ?')
      stmt.run(filePathDxf || null, filePathPdf || null, docId)
    }

    const row = db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(docId)
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

app.put('/api/design-docs/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.body.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계도서 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM design_documents WHERE id = ?').get(id)
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
    db.prepare(
      'UPDATE design_documents SET title = ?, doc_number = ?, memo = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedTitle, docNumber, memoVal, now, id)
    const row = db.prepare('SELECT id, design_revision_id, title, doc_number, memo, file_name, file_path, file_path_pdf, file_path_dxf, created_at, updated_at FROM design_documents WHERE id = ?').get(id)
    res.json({ success: true, document: row })
  } catch (err) {
    send500(res, err)
  }
})

/** 설계도서를 PDF로 반환. 원본이 PDF면 그대로, DWG면 변환 후 반환(캐드 보기용) - /file 보다 먼저 등록 */
app.get('/api/design-docs/:id/file/pdf', (req, res) => {
  const { id } = req.params
  const sendPdf = (pdfPath) => {
    const name = (req.query.name || 'view.pdf').trim() || 'view.pdf'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', contentDispositionFilename(name, true))
    res.sendFile(path.resolve(pdfPath))
  }

  const row = db.prepare('SELECT id, file_name, file_path, file_path_pdf FROM design_documents WHERE id = ?').get(id)
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
function getDxfFilePath(id) {
  const row = db.prepare('SELECT id, file_name, file_path, file_path_dxf FROM design_documents WHERE id = ?').get(id)
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

app.get('/api/design-docs/:id/file/dxf/json', (req, res) => {
  const { id } = req.params
  let dxfPath = getDxfFilePath(id)
  if (!dxfPath) {
    const row = db.prepare('SELECT id, file_name, file_path FROM design_documents WHERE id = ?').get(id)
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
          const DxfParser = require('dxf-parser')
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
    const DxfParser = require('dxf-parser')
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
app.get('/api/design-docs/:id/file/dxf', (req, res) => {
  const { id } = req.params
  const sendDxf = (dxfPath) => {
    const name = (req.query.name || 'view').trim() || 'view'
    const filename = name.toLowerCase().endsWith('.dxf') ? name : name + '.dxf'
    res.setHeader('Content-Disposition', contentDispositionFilename(filename, true))
    res.setHeader('Content-Type', 'application/dxf')
    res.sendFile(path.resolve(dxfPath))
  }
  const row = db.prepare('SELECT id, file_name, file_path, file_path_dxf FROM design_documents WHERE id = ?').get(id)
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

app.get('/api/design-docs/:id/file', (req, res) => {
  try {
    const { id } = req.params
    const inline = req.query.inline === '1' || req.query.inline === 'true'
    const row = db.prepare('SELECT id, file_name, file_path FROM design_documents WHERE id = ?').get(id)
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

app.delete('/api/design-docs/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계도서 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id, file_path, file_path_pdf, file_path_dxf FROM design_documents WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계도서를 찾을 수 없습니다.')
    }
    // DB 삭제를 먼저 수행해 잠금 시간을 짧게 유지 (이후 파일 삭제는 DB와 무관)
    db.prepare('DELETE FROM design_documents WHERE id = ?').run(id)
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
app.get('/api/design-reviews', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const rows = db
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

app.post('/api/design-reviews', uploadDesignReview.single('file'), (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계검토 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
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
    db.prepare(
      'INSERT INTO design_reviews (id, design_revision_id, title, memo, file_name, file_path, shared_participant_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, revisionId, title, memoVal, file_name, file.filename, '[]', now, now)
    const row = db
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

app.put('/api/design-reviews/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계검토 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM design_reviews WHERE id = ?').get(id)
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
    db.prepare(
      'UPDATE design_reviews SET title = ?, memo = ?, shared_participant_ids = COALESCE(?, shared_participant_ids), updated_at = ? WHERE id = ?'
    ).run(trimmedTitle, memoVal, sharedJson, now, id)
    const row = db
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

app.get('/api/design-reviews/:id/file', (req, res) => {
  try {
    const { id } = req.params
    const inline = req.query.inline === '1' || req.query.inline === 'true'
    const row = db.prepare('SELECT id, file_name, file_path FROM design_reviews WHERE id = ?').get(id)
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

app.delete('/api/design-reviews/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '설계검토 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id, file_path FROM design_reviews WHERE id = ?').get(id)
    if (!existing) {
      return sendError(res, 404, '설계검토를 찾을 수 없습니다.')
    }
    db.prepare('DELETE FROM design_reviews WHERE id = ?').run(id)
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
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, 'DXF 변환은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = (req.body && req.body.modelId || req.body && req.body.documentId || req.body && req.body.id || '').trim()
    if (!id) {
      return sendError(res, 400, 'modelId가 필요합니다.')
    }
    const row = db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(id)
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
      db.prepare('UPDATE design_models SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    } catch (e) {
      try { db.exec('ALTER TABLE design_models ADD COLUMN file_path_dxf TEXT') } catch (_) {}
      db.prepare('UPDATE design_models SET file_path_dxf = ? WHERE id = ?').run(id + '.dxf', id)
    }
    const updated = db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, file_path_dxf, created_at, updated_at FROM design_models WHERE id = ?').get(id)
    res.json({ success: true, model: updated, message: 'DXF로 변환되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
}
app.post('/api/design-models/convert-to-dxf', handleConvertDesignModelToDxf)

app.post('/api/design-models', uploadDesignModel.any(), (req, res) => {
  try {
    const body = req.body || {}
    const userEmail = normalizeEmail(body.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '모델 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = (body.designRevisionId || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
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
    db.prepare(
      'INSERT INTO design_models (id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(modelId, revisionId, trimmedTitle, memoVal, file_name, file_path, now, now)
    const row = db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM design_models WHERE id = ?').get(modelId)
    res.status(201).json({ success: true, model: row })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/design-models/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '모델 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM design_models WHERE id = ?').get(id)
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
    db.prepare('UPDATE design_models SET title = ?, memo = ?, updated_at = ? WHERE id = ?').run(trimmedTitle, memoVal, now, id)
    const row = db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM design_models WHERE id = ?').get(id)
    res.json({ success: true, model: row })
  } catch (err) {
    send500(res, err)
  }
})

app.get('/api/design-models/:id/file', (req, res) => {
  try {
    const { id } = req.params
    const row = db.prepare('SELECT id, file_name, file_path FROM design_models WHERE id = ?').get(id)
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
})

app.delete('/api/design-models/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '모델 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id, file_path FROM design_models WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '모델을 찾을 수 없습니다.' })
    }
    if (existing.file_path) {
      const filePath = path.join(MODELS_UPLOADS_DIR, existing.file_path)
      try { fs.unlinkSync(filePath) } catch (_) {}
    }
    db.prepare('DELETE FROM design_models WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 물량파일 API (리비전별 엑셀 등록/수정/삭제) - GET 목록은 상단에 등록됨
// -----------------------------------------------------------------------------
/** 엑셀 시트에서 물량 데이터 읽기: A=층, B=부호, C=명칭, D=규격, E=산출식, F=결과값, G=아이템구분, H=guid. 층·부호 비면 이전 행 값 적용. H열은 셀 주소로 직접 읽어 guid 저장 */
function parseQuantityExcelSheet(filePath) {
  const workbook = XLSX.readFile(filePath, { type: 'file', cellNF: false })
  const rowsOut = []
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
    if (!Array.isArray(rows) || rows.length < 4) continue
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
    if (rowsOut.length > 0) break
  }
  return rowsOut
}

app.post('/api/quantity-files', uploadQuantityFile.single('file'), (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '물량파일 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const revisionId = ((req.body && req.body.designRevisionId) || '').trim()
    if (!revisionId) {
      return sendError(res, 400, '리비전을 선택하세요.')
    }
    const rev = db.prepare('SELECT id FROM design_revisions WHERE id = ?').get(revisionId)
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
    db.prepare(
      'INSERT INTO quantity_files (id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, revisionId, title, memoVal, file_name, file.filename, now, now)
    const filePathFull = path.join(QUANTITY_UPLOADS_DIR, file.filename)
    if (fs.existsSync(filePathFull)) {
      try {
        const items = parseQuantityExcelSheet(filePathFull)
        const insertItem = db.prepare(
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
    const row = db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE id = ?').get(id)
    res.status(201).json({ success: true, file: row })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/quantity-files/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '물량파일 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id FROM quantity_files WHERE id = ?').get(id)
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
    db.prepare('UPDATE quantity_files SET title = ?, memo = ?, updated_at = ? WHERE id = ?').run(trimmedTitle, memoVal, now, id)
    const row = db.prepare('SELECT id, design_revision_id, title, memo, file_name, file_path, created_at, updated_at FROM quantity_files WHERE id = ?').get(id)
    res.json({ success: true, file: row })
  } catch (err) {
    send500(res, err)
  }
})

// 부재별산출서 모달용: 해당 물량파일 내에 실제 존재하는 동/층/부재유형/부호 목록 (필터 옵션 = 이 파일에만 있는 값)
app.get('/api/quantity-files/:id/data-modal-filters', (req, res) => {
  try {
    const { id } = req.params
    const fileRow = db.prepare('SELECT id FROM quantity_files WHERE id = ?').get(id)
    if (!fileRow) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    const rows = db
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

app.get('/api/quantity-files/:id/items', (req, res) => {
  try {
    const { id } = req.params
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 200), 2000)
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
    const dong = (req.query.dong != null ? String(req.query.dong).trim() : '')
    const floor = (req.query.floor != null ? String(req.query.floor).trim() : '')
    const signType = (req.query.signType != null ? String(req.query.signType).trim() : '')
    const signCode = (req.query.signCode != null ? String(req.query.signCode).trim() : '')
    const fileRow = db.prepare('SELECT id, title FROM quantity_files WHERE id = ?').get(id)
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
    const whereClause = conditions.join(' AND ')
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM quantity_file_items WHERE ${whereClause}`).get(...params)
    const total = totalRow?.total ?? 0
    const rows = db
      .prepare(
        `SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE ${whereClause} ORDER BY sort_order ASC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
    res.json({ success: true, fileTitle: fileRow.title, items: rows, total })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/quantity-files/:id/reparse', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || (req.query && req.query.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '파일에서 다시 읽기는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const fileRow = db.prepare('SELECT id, file_path FROM quantity_files WHERE id = ?').get(id)
    if (!fileRow || !fileRow.file_path) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    const filePathFull = path.join(QUANTITY_UPLOADS_DIR, fileRow.file_path)
    if (!fs.existsSync(filePathFull)) {
      return res.status(404).json({ success: false, error: '업로드된 파일이 서버에 없습니다.' })
    }
    db.prepare('DELETE FROM quantity_file_items WHERE quantity_file_id = ?').run(id)
    const items = parseQuantityExcelSheet(filePathFull)
    const insertItem = db.prepare(
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
    const rows = db
      .prepare(
        'SELECT id, quantity_file_id, sort_order, dong, floor, sign, name, spec, formula, result_value, item_type, guid FROM quantity_file_items WHERE quantity_file_id = ? ORDER BY sort_order ASC'
      )
      .all(id)
    res.json({ success: true, items: rows, message: `${rows.length}건 읽었습니다.` })
  } catch (err) {
    send500(res, err)
  }
})

app.get('/api/quantity-files/:id/file', (req, res) => {
  try {
    const { id } = req.params
    const row = db.prepare('SELECT id, file_name, file_path FROM quantity_files WHERE id = ?').get(id)
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

app.delete('/api/quantity-files/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '물량파일 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const { id } = req.params
    const existing = db.prepare('SELECT id, file_path FROM quantity_files WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '물량파일을 찾을 수 없습니다.' })
    }
    db.prepare('DELETE FROM quantity_file_items WHERE quantity_file_id = ?').run(id)
    if (existing.file_path) {
      const filePath = path.join(QUANTITY_UPLOADS_DIR, existing.file_path)
      try { fs.unlinkSync(filePath) } catch (_) {}
    }
    db.prepare('DELETE FROM quantity_files WHERE id = ?').run(id)
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 물량집계 (동/층별 콘크리트·거푸집 합계)
// -----------------------------------------------------------------------------
app.get('/api/quantity-summary', (req, res) => {
  try {
    const designRevisionId = (req.query.designRevisionId || '').trim()
    if (!designRevisionId) {
      return res.status(400).json({ success: false, error: 'designRevisionId가 필요합니다.' })
    }
    const fileIds = db.prepare('SELECT id FROM quantity_files WHERE design_revision_id = ?').all(designRevisionId)
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
    const items = db
      .prepare(
        `SELECT qfi.dong, qfi.floor, qfi.name, qfi.spec, qfi.result_value, qfi.item_type, qfi.sign
         FROM quantity_file_items qfi WHERE qfi.quantity_file_id IN (${placeholders})`
      )
      .all(...ids)
    const nameMappings = db.prepare('SELECT name_pattern, category FROM quantity_name_mappings ORDER BY sort_order ASC, id ASC').all()
    const concreteSpecRows = db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '콘크리트' ORDER BY sort_order ASC, spec_value ASC").all()
    const concreteColumns = concreteSpecRows.map((r) => r.spec_value)
    const formworkSpecRows = db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '거푸집' ORDER BY sort_order ASC, spec_value ASC").all()
    const formworkColumns = formworkSpecRows.map((r) => r.spec_value)
    const rebarSpecRows = db.prepare("SELECT spec_value FROM quantity_specs WHERE category = '철근' ORDER BY sort_order ASC, spec_value ASC").all()
    const rebarColumns = rebarSpecRows.map((r) => r.spec_value)

    const rowSet = new Map()
    for (const it of items) {
      const dong = it.dong != null ? String(it.dong).trim() : ''
      const floor = it.floor != null ? String(it.floor).trim() : ''
      const key = dong + '\t' + floor
      if (!rowSet.has(key)) rowSet.set(key, { dong, floor })
    }

    // 물량파일등록 페이지의 동관리·층관리 정렬기준(sort_order) 적용
    const dongRows = db.prepare('SELECT dong_value FROM quantity_dongs ORDER BY sort_order ASC, id ASC').all()
    const dongOrder = dongRows.map((r) => (r.dong_value != null ? String(r.dong_value).trim() : ''))
    const floorRows = db.prepare('SELECT floor_value FROM quantity_floors ORDER BY sort_order ASC, id ASC').all()
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

    const data = {}
    const itemTypeData = {}
    for (const r of rows) {
      const key = r.dong + '\t' + r.floor
      data[key] = { concrete: {}, formwork: {}, rebar: {} }
      for (const spec of concreteColumns) data[key].concrete[spec] = 0
      for (const spec of formworkColumns) data[key].formwork[spec] = 0
      for (const spec of rebarColumns) data[key].rebar[spec] = 0
    }
    for (const r of itemTypeRows) {
      const key = r.dong + '\t' + r.floor + '\t' + r.item_type
      itemTypeData[key] = { concrete: {}, formwork: {}, rebar: {} }
      for (const spec of concreteColumns) itemTypeData[key].concrete[spec] = 0
      for (const spec of formworkColumns) itemTypeData[key].formwork[spec] = 0
      for (const spec of rebarColumns) itemTypeData[key].rebar[spec] = 0
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
        if (data[key]) data[key].rebar[spec] = (data[key].rebar[spec] || 0) + val
        if (itemTypeData[itemTypeKey]) itemTypeData[itemTypeKey].rebar[spec] = (itemTypeData[itemTypeKey].rebar[spec] || 0) + val
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

app.get('/api/quantity-name-mappings', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name_pattern, category, sort_order, created_at FROM quantity_name_mappings ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/quantity-name-mappings', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
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
    const result = db.prepare('INSERT INTO quantity_name_mappings (name_pattern, category, sort_order) VALUES (?, ?, 0)').run(namePattern, category)
    const row = db.prepare('SELECT id, name_pattern, category, sort_order, created_at FROM quantity_name_mappings WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/quantity-name-mappings/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '명칭 매핑 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = db.prepare('DELETE FROM quantity_name_mappings WHERE id = ?').run(id)
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

app.get('/api/quantity-specs', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, spec_value, category, sort_order, created_at FROM quantity_specs ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/quantity-specs', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
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
    const result = db.prepare('INSERT INTO quantity_specs (spec_value, category, sort_order) VALUES (?, ?, 0)').run(specValue, category)
    const row = db.prepare('SELECT id, spec_value, category, sort_order, created_at FROM quantity_specs WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/quantity-specs/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '규격 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = db.prepare('DELETE FROM quantity_specs WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '규격을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 동 목록 (quantity_dongs)
// -----------------------------------------------------------------------------
app.get('/api/quantity-dongs', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/quantity-dongs', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '동 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const dongValue = (req.body && req.body.dong_value) != null ? String(req.body.dong_value).trim() : ''
    if (!dongValue) {
      return res.status(400).json({ success: false, error: '동 값을 입력하세요.' })
    }
    const result = db.prepare('INSERT INTO quantity_dongs (dong_value, sort_order, gross_area) VALUES (?, 0, NULL)').run(dongValue)
    const row = db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/quantity-dongs/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '동 수정은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const existing = db.prepare('SELECT id, dong_value, gross_area FROM quantity_dongs WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: '동을 찾을 수 없습니다.' })
    }
    const dongValue = (req.body && req.body.dong_value) != null ? String(req.body.dong_value).trim() : existing.dong_value
    const grossAreaRaw = req.body && req.body.gross_area
    const grossArea = grossAreaRaw === '' || grossAreaRaw === null || grossAreaRaw === undefined
      ? null
      : (typeof grossAreaRaw === 'number' && Number.isFinite(grossAreaRaw) ? grossAreaRaw : parseFloat(grossAreaRaw))
    const grossAreaFinal = grossArea != null && Number.isFinite(grossArea) && grossArea >= 0 ? grossArea : null
    db.prepare('UPDATE quantity_dongs SET dong_value = ?, gross_area = ? WHERE id = ?').run(dongValue || existing.dong_value, grossAreaFinal, id)
    const row = db.prepare('SELECT id, dong_value, sort_order, gross_area, created_at FROM quantity_dongs WHERE id = ?').get(id)
    res.json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/quantity-dongs/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '동 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = db.prepare('DELETE FROM quantity_dongs WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '동을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/quantity-dongs/reorder', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '동 순서 변경은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const order = req.body && Array.isArray(req.body.order) ? req.body.order : []
    const ids = order.filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'order 배열이 필요합니다.' })
    }
    const update = db.prepare('UPDATE quantity_dongs SET sort_order = ? WHERE id = ?')
    const run = db.transaction(() => {
      ids.forEach((id, index) => {
        update.run(index, id)
      })
    })
    run()
    res.json({ success: true, message: '순서가 변경되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 층 목록 (quantity_floors)
// -----------------------------------------------------------------------------
app.get('/api/quantity-floors', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, floor_value, sort_order, created_at FROM quantity_floors ORDER BY sort_order ASC, id ASC').all()
    res.json({ success: true, items: rows })
  } catch (err) {
    send500(res, err)
  }
})

app.post('/api/quantity-floors', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '층 등록은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const floorValue = (req.body && req.body.floor_value) != null ? String(req.body.floor_value).trim() : ''
    if (!floorValue) {
      return res.status(400).json({ success: false, error: '층 값을 입력하세요.' })
    }
    const result = db.prepare('INSERT INTO quantity_floors (floor_value, sort_order) VALUES (?, 0)').run(floorValue)
    const row = db.prepare('SELECT id, floor_value, sort_order, created_at FROM quantity_floors WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ success: true, item: row })
  } catch (err) {
    send500(res, err)
  }
})

app.delete('/api/quantity-floors/:id', (req, res) => {
  try {
    const userEmail = normalizeEmail(req.query.userEmail || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '층 삭제는 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const id = parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: '잘못된 ID입니다.' })
    }
    const result = db.prepare('DELETE FROM quantity_floors WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '층을 찾을 수 없습니다.' })
    }
    res.json({ success: true, message: '삭제되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

app.put('/api/quantity-floors/reorder', (req, res) => {
  try {
    const userEmail = normalizeEmail((req.body && req.body.userEmail) || '')
    if (!canManageProjects(userEmail)) {
      return sendError(res, 403, '층 순서 변경은 관리자 또는 프로젝트 관리자만 가능합니다.')
    }
    const order = req.body && Array.isArray(req.body.order) ? req.body.order : []
    const ids = order.filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'order 배열이 필요합니다.' })
    }
    const update = db.prepare('UPDATE quantity_floors SET sort_order = ? WHERE id = ?')
    const run = db.transaction(() => {
      ids.forEach((id, index) => {
        update.run(index, id)
      })
    })
    run()
    res.json({ success: true, message: '순서가 변경되었습니다.' })
  } catch (err) {
    send500(res, err)
  }
})

// -----------------------------------------------------------------------------
// 기타
// -----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API 서버가 실행 중입니다.' })
})

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT} (external: 0.0.0.0:${PORT})`)
})
