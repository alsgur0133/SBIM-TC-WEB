/**
 * SQLite DB 초기화 (users, projects, design_phases, design_revisions)
 */
const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(__dirname, 'sbim-tc.db')
const db = new Database(dbPath, { timeout: 15000 })
// 동시 접근 시 대기 후 재시도 (삭제/등록 시 "database is locked" 방지)
db.pragma('busy_timeout = 15000')
db.pragma('journal_mode = WAL')
// 물량파일 삭제 시 quantity_file_items CASCADE 삭제를 위해 외래키 활성화
db.pragma('foreign_keys = ON')

// -----------------------------------------------------------------------------
// users
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT '활성',
    is_admin INTEGER NOT NULL DEFAULT 0
  )
`)

const alterUserCols = [
  'ALTER TABLE users ADD COLUMN status TEXT DEFAULT \'활성\'',
  'ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN role TEXT DEFAULT \'일반 사용자\'',
  'ALTER TABLE users ADD COLUMN company TEXT',
]
alterUserCols.forEach((sql) => { try { db.exec(sql) } catch (_) {} })

// -----------------------------------------------------------------------------
// projects
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

;['code', 'client', 'start_date', 'end_date', 'pm', 'status'].forEach((col) => {
  try { db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`) } catch (_) {}
})
;(function checkProjectsColumns() {
  try {
    const names = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name)
    const required = ['code', 'client', 'start_date', 'end_date', 'pm', 'status']
    const missing = required.filter((col) => !names.includes(col))
    if (missing.length) console.warn('[DB] projects 컬럼 부족:', missing.join(', '))
    else console.log('[DB] projects 컬럼:', names.join(', '))
  } catch (err) {
    console.error('[DB] PRAGMA 실패:', err.message)
  }
})()

// -----------------------------------------------------------------------------
// project_participants (프로젝트별 참여자: 사용자 관리 사용자 검색·선택으로 등록)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS project_participants (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_in_project TEXT NOT NULL DEFAULT '참여자',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`)

// -----------------------------------------------------------------------------
// design_phases, design_revisions
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS design_phases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    project_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS design_revisions (
    id TEXT PRIMARY KEY,
    design_phase_id TEXT NOT NULL,
    revision_name TEXT NOT NULL,
    planned_date TEXT,
    actual_date TEXT,
    status TEXT NOT NULL DEFAULT '예정',
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (design_phase_id) REFERENCES design_phases(id) ON DELETE CASCADE
  )
`)

// -----------------------------------------------------------------------------
// design_documents (설계도서: 리비전별)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS design_documents (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    doc_number TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )
`)

;['file_name', 'file_path', 'file_path_pdf', 'file_path_dxf'].forEach((col) => {
  try { db.exec(`ALTER TABLE design_documents ADD COLUMN ${col} TEXT`) } catch (_) {}
})

// -----------------------------------------------------------------------------
// design_models (모델 IFC: 리비전별)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS design_models (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )
`)

try { db.exec('ALTER TABLE design_models ADD COLUMN file_path_dxf TEXT') } catch (_) {}

// -----------------------------------------------------------------------------
// design_reviews (설계검토 엑셀: 리비전별)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS design_reviews (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    shared_participant_ids TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )
`)

;['memo', 'file_name', 'file_path', 'shared_participant_ids'].forEach((col) => {
  try { db.exec(`ALTER TABLE design_reviews ADD COLUMN ${col} TEXT`) } catch (_) {}
})

// -----------------------------------------------------------------------------
// quantity_files (물량파일 엑셀: 리비전별)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_files (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )
`)

// -----------------------------------------------------------------------------
// quantity_file_items (물량파일 시트 데이터: 부재별산출서 행, dong=시트명 괄호 안 값)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_file_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quantity_file_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    dong TEXT,
    floor TEXT,
    sign TEXT,
    name TEXT,
    spec TEXT,
    formula TEXT,
    result_value TEXT,
    item_type TEXT,
    guid TEXT,
    FOREIGN KEY (quantity_file_id) REFERENCES quantity_files(id) ON DELETE CASCADE
  )
`)
try { db.exec('ALTER TABLE quantity_file_items ADD COLUMN dong TEXT') } catch (_) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_quantity_file_items_file ON quantity_file_items(quantity_file_id)') } catch (_) {}

// -----------------------------------------------------------------------------
// quantity_name_mappings (명칭 → 콘크리트/거푸집/철근 분류 매핑)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_name_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
try { db.exec('CREATE INDEX IF NOT EXISTS idx_quantity_name_mappings_category ON quantity_name_mappings(category)') } catch (_) {}

// -----------------------------------------------------------------------------
// quantity_specs (규격 → 콘크리트/거푸집/철근 분류 매핑)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spec_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '콘크리트',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
try { db.exec('ALTER TABLE quantity_specs ADD COLUMN category TEXT NOT NULL DEFAULT \'콘크리트\'') } catch (_) {}

// -----------------------------------------------------------------------------
// quantity_dongs (동 목록 관리)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_dongs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dong_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
try { db.exec('CREATE INDEX IF NOT EXISTS idx_quantity_dongs_sort ON quantity_dongs(sort_order)') } catch (_) {}
try { db.exec('ALTER TABLE quantity_dongs ADD COLUMN gross_area REAL') } catch (_) {}

// -----------------------------------------------------------------------------
// quantity_floors (층 목록 관리)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS quantity_floors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
try { db.exec('CREATE INDEX IF NOT EXISTS idx_quantity_floors_sort ON quantity_floors(sort_order)') } catch (_) {}

module.exports = db
