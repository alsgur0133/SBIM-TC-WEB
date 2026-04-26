/**
 * DATABASE_URL 이 가리키는 PostgreSQL DB를 Custom 형식(.dump)으로 백업합니다.
 * 요구: PATH에 pg_dump (PostgreSQL bin)
 * 실행: npm run db:dump
 */
const fs = require('fs')
const path = require('path')
const { spawnSync, execSync } = require('child_process')

function resolvePgDump () {
  const envBin = (process.env.PGBIN || process.env.PG_BIN || '').trim().replace(/[/\\]+$/, '')
  if (envBin) {
    const exe = path.join(envBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump')
    if (fs.existsSync(exe)) return exe
    console.warn('PGBIN/PG_BIN 지정됐으나 파일 없음:', exe)
  }

  const tryRun = (cmd, args = ['--version']) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true })
    if (r.status === 0) return cmd
    return null
  }
  const fromPath = tryRun('pg_dump')
  if (fromPath) return fromPath

  if (process.platform === 'win32') {
    try {
      const line = execSync('where.exe pg_dump 2>nul', { encoding: 'utf8', shell: true }).split(/\r?\n/)[0].trim()
      if (line && /\.exe$/i.test(line) && fs.existsSync(line)) return line
    } catch (_) {}

    const bases = []
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
      const p = process.env[key]
      if (p) bases.push(path.join(p, 'PostgreSQL'))
    }
    bases.push('C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL')

    const candidates = []
    for (const base of bases) {
      let names = []
      try {
        names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      } catch (_) {
        continue
      }
      for (const name of names) {
        const exe = path.join(base, name, 'bin', 'pg_dump.exe')
        if (fs.existsSync(exe)) {
          const m = name.match(/(\d+)/)
          candidates.push({ exe, ver: m ? parseInt(m[1], 10) : 0 })
        }
      }
    }
    // D:\ 등 비표준 설치 경로 + 폴더명 오타 PostgerSQL
    for (const driveRoot of ['D:\\', 'E:\\']) {
      for (const folder of ['PostgreSQL', 'PostgerSQL']) {
        try {
          const pgBase = path.join(driveRoot, folder)
          if (!fs.existsSync(pgBase)) continue
          const names = fs
            .readdirSync(pgBase, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
          for (const name of names) {
            const exe = path.join(pgBase, name, 'bin', 'pg_dump.exe')
            if (fs.existsSync(exe)) {
              const m = name.match(/(\d+)/)
              candidates.push({ exe, ver: m ? parseInt(m[1], 10) : 0 })
            }
          }
        } catch (_) {}
      }
    }
    candidates.sort((a, b) => b.ver - a.ver)
    if (candidates.length) return candidates[0].exe
  }

  return 'pg_dump'
}

function readDatabaseUrl (filePath) {
  try {
    const s = fs.readFileSync(filePath, 'utf8')
    for (const line of s.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const m = t.match(/^DATABASE_URL\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[1].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      v = v.trim()
      if (v) return v
    }
  } catch (_) {}
  return null
}

const root = path.join(__dirname, '..')
const url =
  readDatabaseUrl(path.join(root, '.env')) ||
  readDatabaseUrl(path.join(root, 'server', '.env')) ||
  (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim())

if (!url) {
  console.error('DATABASE_URL을 찾을 수 없습니다. 루트 또는 server/.env 에 설정하세요.')
  process.exit(1)
}

const outDir = path.join(root, 'backups')
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outFile = path.join(outDir, `sbim-tc-web-${stamp}.dump`)

const pgDump = resolvePgDump()
console.log('사용:', pgDump)
console.log('출력:', outFile)
const r = spawnSync(pgDump, [url, '-Fc', '-f', outFile], {
  stdio: 'inherit',
  env: { ...process.env },
  shell: false,
})

if (r.status !== 0) {
  if (r.error && r.error.code === 'ENOENT') {
    console.error('\npg_dump.exe 를 찾을 수 없습니다. (파일 이름은 pg_dump.exe — 하이픈 아님)')
    console.error('  1) 사용자 환경 변수 PGBIN = pg_dump.exe 가 있는 bin 폴더 전체 경로')
    console.error('     예: PGBIN=D:\\PostgerSQL\\18\\bin')
    console.error('  2) 또는 해당 bin 을 시스템 PATH 에 추가 후 터미널 다시 열기')
    console.error('  3) PostgreSQL 설치 시 "Command Line Tools" 포함 여부 확인')
  } else {
    console.error('\n실패 시 확인: PostgreSQL 서비스 가동, .env 의 DATABASE_URL, 방화벽')
  }
  process.exit(r.status ?? 1)
}

console.log('완료:', outFile)
console.log('서버 복원 예: pg_restore -h HOST -U USER -d "SBIM-TC-WEB" --no-owner --verbose "' + outFile + '"')
