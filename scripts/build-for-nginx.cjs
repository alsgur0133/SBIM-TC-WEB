/** Nginx 배포: 서브경로 빌드 후 dist → publish-nginx/dist (IIS용과 동일한 빌드) */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

if (process.env.VITE_BASE_PATH === undefined) process.env.VITE_BASE_PATH = 'bracetc'
const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')
const targetDist = path.join(root, 'publish-nginx', 'dist')

console.log('VITE_BASE_PATH=', process.env.VITE_BASE_PATH)
console.log('1. vite build 실행...')
const r = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', env: process.env, shell: true })
if (r.status !== 0) process.exit(1)

console.log('2. dist → publish-nginx/dist 복사...')
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}
if (fs.existsSync(targetDist)) fs.rmSync(targetDist, { recursive: true })
copyDir(distDir, targetDist)
const basePath = process.env.VITE_BASE_PATH ?? 'bracetc'
fs.writeFileSync(
  path.join(targetDist, '배포용-서브경로빌드.txt'),
  `서브경로 /${basePath}/ 로 빌드됨. Nginx 배포용.\n${new Date().toISOString()}`,
  'utf8'
)
console.log('완료. npm run prepare-publish-nginx 실행 후 publish-nginx 폴더를 서버에 복사하세요.')
