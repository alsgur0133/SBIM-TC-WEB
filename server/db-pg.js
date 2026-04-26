/**
 * PostgreSQL — DATABASE_URL 설정 시 사용 (? 플레이스홀더 → $1..$n)
 */
const { Pool } = require('pg')

const TS_DEFAULT = "to_char(current_timestamp, 'YYYY-MM-DD HH24:MI:SS')"

const SERIAL_INSERT_TABLES = new Set([
  'quantity_file_items',
  'quantity_name_mappings',
  'quantity_specs',
  'quantity_dongs',
  'quantity_floors',
  'quantity_item_type_mappings',
  'rebar_database_rows',
])

let pool = null
let wrapper = null

function toPgQuery (sql, params = []) {
  let out = ''
  let i = 0
  let n = 0
  const len = sql.length
  while (i < len) {
    const c = sql[i]
    if (c === "'") {
      let j = i + 1
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") {
          j++
          break
        }
        j++
      }
      out += sql.slice(i, j)
      i = j
      continue
    }
    if (c === '?') {
      n++
      out += '$' + n
      i++
      continue
    }
    out += c
    i++
  }
  return { text: out, values: params.slice(0, n) }
}

function appendReturningId (sql) {
  const s = sql.trim()
  const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(s)
  if (!m) return sql
  const table = m[1].toLowerCase()
  if (!SERIAL_INSERT_TABLES.has(table)) return sql
  if (/RETURNING/i.test(s)) return sql
  const trimmed = s.replace(/;\s*$/i, '')
  return trimmed + ' RETURNING id'
}

function createQueryWrapper (queryFn) {
  return {
    async exec (sql) {
      const { text, values } = toPgQuery(sql, [])
      await queryFn(text, values)
    },
    prepare (sql) {
      return {
        async get (...params) {
          const { text, values } = toPgQuery(sql, params)
          const res = await queryFn(text, values)
          return res.rows[0]
        },
        async all (...params) {
          const { text, values } = toPgQuery(sql, params)
          const res = await queryFn(text, values)
          return res.rows
        },
        async run (...params) {
          const withRet = appendReturningId(sql)
          const { text, values } = toPgQuery(withRet, params)
          const res = await queryFn(text, values)
          const changes = res.rowCount ?? 0
          let lastInsertRowid = 0
          if (res.rows && res.rows[0] && res.rows[0].id != null) {
            lastInsertRowid = Number(res.rows[0].id)
          }
          return { changes, lastInsertRowid }
        },
      }
    },
    transaction (fn) {
      return (async () => {
        const client = await pool.connect()
        const txw = createQueryWrapper((text, vals) => client.query(text, vals))
        try {
          await client.query('BEGIN')
          const result = await fn(txw)
          await client.query('COMMIT')
          return result
        } catch (e) {
          try {
            await client.query('ROLLBACK')
          } catch (_) {}
          throw e
        } finally {
          client.release()
        }
      })()
    },
  }
}

async function runSchema (q) {
  const exec = async (sql) => {
    try {
      await q(sql, [])
    } catch (e) {
      const msg = String(e.message || e)
      if (/already exists|duplicate key/i.test(msg)) return
      throw e
    }
  }
  const execIgnore = async (sql) => {
    try {
      await q(sql, [])
    } catch (_) {}
  }

  await exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    status TEXT NOT NULL DEFAULT '활성',
    is_admin INTEGER NOT NULL DEFAULT 0
  )`)
  await execIgnore("ALTER TABLE users ADD COLUMN status TEXT DEFAULT '활성'")
  await execIgnore('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0')
  await execIgnore("ALTER TABLE users ADD COLUMN role TEXT DEFAULT '일반 사용자'")
  await execIgnore('ALTER TABLE users ADD COLUMN company TEXT')
  await execIgnore('ALTER TABLE users ADD COLUMN trimble_subject_id TEXT')

  await exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  for (const col of ['code', 'client', 'start_date', 'end_date', 'pm', 'status', 'trimble_connect_project_id']) {
    await execIgnore(`ALTER TABLE projects ADD COLUMN ${col} TEXT`)
  }

  await exec(`
  CREATE TABLE IF NOT EXISTS project_participants (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_in_project TEXT NOT NULL DEFAULT '참여자',
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`)

  await exec(`
  CREATE TABLE IF NOT EXISTS design_phases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    project_id TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )`)
  await exec(`
  CREATE TABLE IF NOT EXISTS design_revisions (
    id TEXT PRIMARY KEY,
    design_phase_id TEXT NOT NULL,
    revision_name TEXT NOT NULL,
    planned_date TEXT,
    actual_date TEXT,
    status TEXT NOT NULL DEFAULT '예정',
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (design_phase_id) REFERENCES design_phases(id) ON DELETE CASCADE
  )`)

  await exec(`
  CREATE TABLE IF NOT EXISTS design_documents (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    doc_number TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )`)
  for (const col of ['file_name', 'file_path', 'file_path_pdf', 'file_path_dxf']) {
    await execIgnore(`ALTER TABLE design_documents ADD COLUMN ${col} TEXT`)
  }

  await exec(`
  CREATE TABLE IF NOT EXISTS design_models (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )`)
  await execIgnore('ALTER TABLE design_models ADD COLUMN file_path_dxf TEXT')
  for (const col of [
    'trimble_file_id',
    'trimble_version_id',
    'ifc_meta_json',
    'ifc_meta_updated_at',
    'trimble_sync_error',
    'ifc_products_json',
    'ifc_products_updated_at',
  ]) {
    await execIgnore(`ALTER TABLE design_models ADD COLUMN ${col} TEXT`)
  }

  await exec(`
  CREATE TABLE IF NOT EXISTS design_reviews (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    shared_participant_ids TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )`)

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_files (
    id TEXT PRIMARY KEY,
    design_revision_id TEXT NOT NULL,
    title TEXT NOT NULL,
    memo TEXT,
    file_name TEXT,
    file_path TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (design_revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
  )`)
  for (const col of ['trimble_file_id', 'trimble_version_id']) {
    await execIgnore(`ALTER TABLE quantity_files ADD COLUMN ${col} TEXT`)
  }

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_file_items (
    id SERIAL PRIMARY KEY,
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
  )`)
  await execIgnore('ALTER TABLE quantity_file_items ADD COLUMN dong TEXT')
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_quantity_file_items_file ON quantity_file_items(quantity_file_id)')

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_name_mappings (
    id SERIAL PRIMARY KEY,
    name_pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_quantity_name_mappings_category ON quantity_name_mappings(category)')

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_specs (
    id SERIAL PRIMARY KEY,
    spec_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '콘크리트',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore("ALTER TABLE quantity_specs ADD COLUMN category TEXT NOT NULL DEFAULT '콘크리트'")

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_dongs (
    id SERIAL PRIMARY KEY,
    dong_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_quantity_dongs_sort ON quantity_dongs(sort_order)')
  await execIgnore('ALTER TABLE quantity_dongs ADD COLUMN gross_area DOUBLE PRECISION')

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_floors (
    id SERIAL PRIMARY KEY,
    floor_value TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_quantity_floors_sort ON quantity_floors(sort_order)')

  await exec(`
  CREATE TABLE IF NOT EXISTS quantity_item_type_mappings (
    id SERIAL PRIMARY KEY,
    item_label TEXT NOT NULL,
    model_property TEXT NOT NULL,
    segment TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE UNIQUE INDEX IF NOT EXISTS idx_quantity_item_type_label ON quantity_item_type_mappings(item_label)')

  await exec(`
  CREATE TABLE IF NOT EXISTS rebar_database_rows (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_rebar_db_project_section ON rebar_database_rows(project_id, section)')

  await exec(`
  CREATE TABLE IF NOT EXISTS code_orgs (
    id TEXT PRIMARY KEY,
    org_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT})
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_code_orgs_sort ON code_orgs(sort_order)')

  await exec(`
  CREATE TABLE IF NOT EXISTS code_registry (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    item_code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (org_id) REFERENCES code_orgs(id) ON DELETE CASCADE,
    UNIQUE(org_id, item_code)
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_code_registry_org ON code_registry(org_id)')

  await exec(`
  CREATE TABLE IF NOT EXISTS object_classifications (
    id TEXT PRIMARY KEY,
    scheme_type TEXT NOT NULL,
    parent_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    attributes TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    UNIQUE(scheme_type, parent_id, code)
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_object_class_scheme ON object_classifications(scheme_type)')
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_object_class_parent ON object_classifications(parent_id)')

  await exec(`
  CREATE TABLE IF NOT EXISTS code_mgmt_parameters (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    param_group TEXT NOT NULL DEFAULT 'HITBIM',
    param_key TEXT NOT NULL,
    memo TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    UNIQUE(param_group, param_key)
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_code_mgmt_param_sort ON code_mgmt_parameters(sort_order)')

  await exec(`
  CREATE TABLE IF NOT EXISTS code_mgmt_compositions (
    id TEXT PRIMARY KEY,
    system_type TEXT NOT NULL,
    sort_index INTEGER NOT NULL,
    parameter_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${TS_DEFAULT}),
    FOREIGN KEY (parameter_id) REFERENCES code_mgmt_parameters(id) ON DELETE CASCADE,
    UNIQUE(system_type, sort_index),
    UNIQUE(system_type, parameter_id)
  )`)
  await execIgnore('CREATE INDEX IF NOT EXISTS idx_code_mgmt_comp_system ON code_mgmt_compositions(system_type)')
}

async function init () {
  if (wrapper) return wrapper
  const url = process.env.DATABASE_URL
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL이 설정되지 않았습니다.')
  }
  pool = new Pool({ connectionString: url.trim(), max: 15 })
  await runSchema((sql, vals) => pool.query(sql, vals))
  try {
    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' ORDER BY ordinal_position"
    )
    console.log('[DB] projects 컬럼:', r.rows.map((x) => x.column_name).join(', '))
  } catch (_) {}
  wrapper = createQueryWrapper((text, values) => pool.query(text, values))
  return wrapper
}

function _noInit () {
  throw new Error('DB not initialized. Call require("./db").init() first.')
}

const proxy = {
  init,
  async exec (sql) {
    if (!wrapper) _noInit()
    return wrapper.exec(sql)
  },
  prepare (sql) {
    if (!wrapper) _noInit()
    return wrapper.prepare(sql)
  },
  transaction (fn) {
    if (!wrapper) _noInit()
    return wrapper.transaction(fn)
  },
}

module.exports = proxy
