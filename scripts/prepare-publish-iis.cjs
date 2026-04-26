/**
 * publish-iis 배포 패키지 준비 (IIS 실제 경로 = publish-iis\dist 권장)
 * - server/ → publish-iis/dist/server/ 만 복사 + 그 안에서 npm install --omit=dev
 * - publish-iis\server 는 만들지 않음(루트 server 는 dist 배포 시 미사용·혼동만 유발)
 * - Node 24 + iisnode 500 회피: 기본 web.config 는 ARR 역프록시(127.0.0.1:5001)용으로 생성
 * - .env 는 publish-iis 루트 + dist 복사
 */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const { getServerEnv, DEPLOY_TRIMBLE_SERVER_KEYS } = require('./iis-deploy-trimble.cjs')

const root = path.join(__dirname, '..')
const serverDir = path.join(root, 'server')
const publishRoot = path.join(root, 'publish-iis')
const distRoot = path.join(publishRoot, 'dist')
const targetDir = path.join(publishRoot, 'server')
const nestedDistServer = path.join(distRoot, 'server')

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'uploads'])
function copyRecursive (src, dest, skipDirNames = SKIP_DIR_NAMES) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    if (skipDirNames.has(path.basename(src))) return
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name), skipDirNames)
    }
  } else {
    if (path.basename(src).endsWith('.db')) return
    const destDir = path.dirname(dest)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

const distIndex = path.join(distRoot, 'index.html')
if (!fs.existsSync(distIndex)) {
  console.warn('')
  console.warn('⚠ publish-iis/dist/index.html 이 없습니다. UI(프론트)가 서버에 없으면 흰 화면만 나옵니다.')
  console.warn('   먼저 실행: npm run build:iis  (또는 npm run deploy:iis 한 번에 실행)')
  console.warn('')
}

if (fs.existsSync(targetDir)) {
  console.log('0. 기존 publish-iis/server 제거(이제 dist/server 만 사용)...')
  fs.rmSync(targetDir, { recursive: true, force: true })
}
if (fs.existsSync(nestedDistServer)) {
  fs.rmSync(nestedDistServer, { recursive: true, force: true })
}
console.log('1. server/ → publish-iis/dist/server/ 복사 (node_modules, uploads, *.db 제외)...')
copyRecursive(serverDir, nestedDistServer)
console.log('2. publish-iis/dist/server 에서 npm install --omit=dev 실행...')
const r = spawnSync('npm', ['install', '--omit=dev'], {
  cwd: nestedDistServer,
  stdio: 'inherit',
  shell: true
})
if (r.status !== 0) {
  process.exit(1)
}

const envPath = path.join(publishRoot, '.env')
const altEnv = path.join(distRoot, '.env')
let envBody = ''
if (fs.existsSync(envPath)) {
  envBody = fs.readFileSync(envPath, 'utf8')
} else if (fs.existsSync(altEnv)) {
  envBody = fs.readFileSync(altEnv, 'utf8')
  console.log('   (publish-iis/dist/.env 내용을 publish-iis/.env 로 이어 씁니다)')
}
const serverEnv = getServerEnv()
const keySet = new Set(DEPLOY_TRIMBLE_SERVER_KEYS)
const lines = envBody.split(/\r?\n/)
const trimbleBannerRe = /^#\s*Trimble\s*[—-]\s*npm run deploy:iis/i
const kept = lines.filter((line) => {
  if (trimbleBannerRe.test(line)) return false
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
  if (m && keySet.has(m[1])) return false
  return true
})
const trimBlock = [
  '# Trimble — npm run deploy:iis 시 자동 갱신 (DATABASE_URL 등 다른 줄은 유지)',
  ...DEPLOY_TRIMBLE_SERVER_KEYS.map((k) => `${k}=${serverEnv[k]}`),
].join('\n')
const trimmed = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
let out = (trimmed ? `${trimmed}\n\n` : '') + `${trimBlock}\n`

const hasDatabaseUrl = /^DATABASE_URL\s*=\s*\S/m.test(out)
if (!hasDatabaseUrl) {
  const dbHint = [
    '# ========== 필수: PostgreSQL ==========',
    '# DATABASE_URL 이 없으면 Node가 시작 직후 종료 → IIS HTTP 500 / HRESULT 0x2',
    '# publish-iis 폴더에 아래 형식으로 한 줄 추가하세요. 비밀번호 특수문자는 URL 인코딩.',
    '# DATABASE_URL=postgresql://postgres:비밀번호@127.0.0.1:5432/SBIM-TC-WEB',
    '',
  ].join('\n')
  out = dbHint + out
  console.warn('')
  console.warn('⚠ publish-iis/.env 에 DATABASE_URL 이 없습니다. IIS에 올리기 전에 반드시 설정하세요.')
  console.warn('   예: DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/DBNAME')
  console.warn('   또는 web.config 의 <appSettings><add key="DATABASE_URL" .../> 주석 해제.')
  console.warn('')
}

fs.writeFileSync(envPath, out, 'utf8')
console.log('3. publish-iis/.env 에 Trimble 서버용 키 반영:', envPath)

for (const name of ['package.json', 'IIS-SETUP.txt', 'test-iis-node.cmd', 'verify-iis-dist.cmd', 'start-node-5001.cmd', 'ecosystem.config.cjs']) {
  const src = path.join(root, name)
  const destRoot = path.join(publishRoot, name)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, destRoot)
  }
}
const webConfigSrc = path.join(root, 'web.config')
const arrWebConfigSrc = path.join(root, 'web.config.arr-proxy.example.xml')
const legacyRootWeb = path.join(publishRoot, 'web.config')
if (fs.existsSync(legacyRootWeb)) {
  fs.unlinkSync(legacyRootWeb)
  console.log('   (레거시 publish-iis/web.config 제거 — IIS 는 publish-iis\\\\dist 만 가리키면 됨)')
}
if (fs.existsSync(arrWebConfigSrc)) {
  const webXml = fs.readFileSync(arrWebConfigSrc, 'utf8')
  fs.writeFileSync(path.join(distRoot, 'web.config'), webXml, 'utf8')
  fs.writeFileSync(path.join(distRoot, 'web.config.iisnode.disabled.xml'), fs.existsSync(webConfigSrc) ? fs.readFileSync(webConfigSrc, 'utf8') : '', 'utf8')
  console.log('4. dist/web.config 를 ARR 역프록시용으로 생성(127.0.0.1:5001).')
} else if (fs.existsSync(webConfigSrc)) {
  const webXml = fs.readFileSync(webConfigSrc, 'utf8')
  fs.writeFileSync(path.join(distRoot, 'web.config'), webXml, 'utf8')
}
const iisnodeEntry = path.join(root, 'iisnode-entry.js')
if (fs.existsSync(iisnodeEntry)) {
  fs.copyFileSync(iisnodeEntry, path.join(distRoot, 'iisnode-entry.js'))
}
for (const name of ['package.json', 'IIS-SETUP.txt', 'test-iis-node.cmd', 'verify-iis-dist.cmd', 'start-node-5001.cmd']) {
  const src = path.join(root, name)
  const destDist = path.join(distRoot, name)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, destDist)
  }
}
fs.copyFileSync(envPath, path.join(distRoot, '.env'))

if (fs.existsSync(arrWebConfigSrc)) {
  fs.copyFileSync(arrWebConfigSrc, path.join(distRoot, 'IIS-ARR-web.config.EXAMPLE.xml'))
}

const mustHave = [
  [path.join(distRoot, 'index.html'), 'dist/index.html'],
  [path.join(distRoot, 'web.config'), 'dist/web.config'],
  [path.join(distRoot, 'start-node-5001.cmd'), 'dist/start-node-5001.cmd'],
  [path.join(distRoot, 'server', 'index.js'), 'dist/server/index.js'],
]
for (const [p, label] of mustHave) {
  if (!fs.existsSync(p)) {
    console.error('')
    console.error('배포 불완전: 없음 — ' + label)
    console.error('')
    process.exit(1)
  }
}

const iisHintPath = path.join(publishRoot, 'IIS-POINT-TO-DIST-FOLDER.txt')
fs.writeFileSync(
  iisHintPath,
  [
    'IIS "실제 경로" = THIS publish-iis folder is WRONG.',
    'IIS physical path MUST be the "dist" subfolder next to this file, e.g.:',
    path.resolve(distRoot),
    '',
    'Inside dist you must have: index.html, web.config, start-node-5001.cmd, server/, assets/ (after npm run build:iis).',
    'If you only copy publish-iis from git without running build:iis, dist may be missing — that breaks deploy.',
  ].join('\r\n'),
  'utf8'
)
console.log('5. IIS 경로 안내 파일:', iisHintPath)

console.log('완료. IIS 사이트/응용 프로그램 "실제 경로"는 반드시 아래만 쓰세요.')
console.log('   …\\\\publish-iis\\\\dist  (web.config·index.html·server·assets 동일 폴더)')
console.log('※ publish-iis 루트에는 server 가 없습니다. Node API 는 dist\\\\server 만 해당됩니다.')
console.log('※ IIS 런타임만 쓸 때: 서버에서 npm install 할 필요 없습니다 (dist\\\\server 에 node_modules 포함).')
console.log('※ prepare 시 *.db 는 복사하지 않음 → 배포로 서버 기존 DB/업로드가 덮어쓰이지 않음.')
console.log('※ PostgreSQL: publish-iis/.env 또는 dist/.env 또는 server/.env 에 DATABASE_URL.')
console.log('※ ARR 모드: 서버에서 dist\\\\start-node-5001.cmd 실행(또는 pm2/nssm 서비스화) + IIS ARR "프록시 사용" 필요.')
