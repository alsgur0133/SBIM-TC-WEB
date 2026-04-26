/**
 * publish-nginx 폴더를 서버 배포용으로 준비.
 * server/ → publish-nginx/server/ 복사 후 npm install --omit=dev
 * (IIS용 prepare-publish-iis와 동일, 출력만 publish-nginx)
 */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const serverDir = path.join(root, 'server')
const targetDir = path.join(root, 'publish-nginx', 'server')

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'uploads'])
function copyRecursive(src, dest, skipDirNames = SKIP_DIR_NAMES) {
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

const distIndex = path.join(root, 'publish-nginx', 'dist', 'index.html')
if (!fs.existsSync(distIndex)) {
  console.warn('⚠ publish-nginx/dist/index.html 없음. 먼저 npm run build:nginx (또는 npm run deploy:nginx) 실행하세요.')
}
console.log('1. server/ → publish-nginx/server/ 복사 (node_modules, uploads, *.db 제외)...')
copyRecursive(serverDir, targetDir)
console.log('2. publish-nginx/server 에서 npm install --omit=dev 실행...')
const r = spawnSync('npm', ['install', '--omit=dev'], { cwd: targetDir, stdio: 'inherit', shell: true })
if (r.status !== 0) process.exit(1)
console.log('완료. publish-nginx 폴더 전체를 서버에 복사한 뒤 Node(PM2) + Nginx 설정하세요.')
