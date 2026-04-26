/**
 * DB: PostgreSQL 전용. DATABASE_URL 또는 PGHOST·PGPORT·PGUSER·PGPASSWORD·PGDATABASE (libpq 스타일)
 * 로드 순서: 이미 설정된 process.env → 여러 경로의 .env (IIS/iisnode는 cwd가 달라질 수 있음)
 */
const path = require('path')
const fs = require('fs')

const parentDir = path.join(__dirname, '..')
const isDistServerLayout = path.basename(parentDir) === 'dist'
const DOTENV_CANDIDATES = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  // …/publish-iis/dist/server 일 때만 …/publish-iis/.env (레거시 …/publish-iis/server 에서는 ../../ 로드 안 함)
  ...(isDistServerLayout ? [path.join(__dirname, '..', '..', '.env')] : []),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'server', '.env'),
]

/** 존재하는 경로만 순서대로 로드(뒤 파일이 앞을 덮어씀). IIS는 cwd가 server 인 경우가 많음. */
function tryLoadDotenv () {
  const loaded = []
  const seen = new Set()
  for (const p of DOTENV_CANDIDATES) {
    const norm = path.normalize(p)
    if (seen.has(norm)) continue
    seen.add(norm)
    try {
      if (fs.existsSync(p)) {
        // IIS/시스템에 DATABASE_URL="" 이 있으면 기본 dotenv는 덮어쓰지 않아 .env 가 무시됨 → override
        require('dotenv').config({ path: p, override: true })
        loaded.push(p)
      }
    } catch (_) {}
  }
  return loaded
}

const loadedEnvFiles = tryLoadDotenv()

/**
 * DATABASE_URL 이 없을 때 libpq 스타일 변수로 합성 (IIS .env 에 PGHOST=... 만 두는 경우)
 */
function applyDatabaseUrlFromPgEnv () {
  const existing = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()
  if (existing) return
  const host = String(process.env.PGHOST || process.env.PG_HOST || '').trim()
  const port = String(process.env.PGPORT || process.env.PG_PORT || '5432').trim() || '5432'
  const user = String(process.env.PGUSER || process.env.PG_USER || '').trim()
  const pass = String(process.env.PGPASSWORD ?? process.env.PG_PASSWORD ?? '')
  const db = String(process.env.PGDATABASE || process.env.PG_DATABASE || '').trim()
  if (!host || !user || !db) return
  const u = encodeURIComponent(user)
  const p = encodeURIComponent(pass)
  const d = encodeURIComponent(db)
  process.env.DATABASE_URL = p === '' ? `postgresql://${u}@${host}:${port}/${d}` : `postgresql://${u}:${p}@${host}:${port}/${d}`
}
applyDatabaseUrlFromPgEnv()

const url = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()
if (!url) {
  // IIS stderr는 기본 코드페이지라 한글이 깨질 수 있어 영문으로 안내
  console.error('[db] FATAL: DATABASE_URL is not set or empty.')
  console.error('[db] IIS tip: cwd is often .../server — create a file named .env in that folder with:')
  console.error('[db]   DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/DBNAME')
  console.error('[db]   or PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (same as libpq)')
  console.error('[db] Or put .env one level up (next to web.config). Or use web.config appSettings (see web.config comments).')
  console.error('[db] __dirname=' + __dirname)
  console.error('[db] process.cwd()=' + process.cwd())
  console.error('[db] .env files checked (exists?):')
  const seenLog = new Set()
  for (const p of DOTENV_CANDIDATES) {
    const norm = path.normalize(p)
    if (seenLog.has(norm)) continue
    seenLog.add(norm)
    try {
      console.error('[db]   ' + p + ' => ' + (fs.existsSync(p) ? 'yes' : 'no'))
    } catch (_) {
      console.error('[db]   ' + p + ' => ?')
    }
  }
  if (loadedEnvFiles.length) {
    console.error('[db] Loaded ' + loadedEnvFiles.length + ' .env file(s) but DATABASE_URL still missing/empty inside.')
  }
  const stamp = `[${new Date().toISOString()}] [db] FATAL: DATABASE_URL missing. Put .env next to web.config or in server/. See console.\n`
  try {
    fs.appendFileSync(path.join(__dirname, 'startup.log'), stamp, 'utf8')
  } catch (e1) {
    try {
      fs.appendFileSync(
        path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'sbim-tc-web-boot.log'),
        stamp + `  (startup.log write failed: ${e1 && e1.message})\n`,
        'utf8'
      )
    } catch (_) {}
  }
  process.exit(1)
}
module.exports = require('./db-pg')
