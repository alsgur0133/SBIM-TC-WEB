/** 서브경로 배포: VITE_BASE_PATH 로 빌드 후 dist → publish-iis/dist 복사. 기본값은 아래 MY-APP 을 본인 앱 이름으로 바꾸세요. */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

if (process.env.VITE_BASE_PATH === undefined) process.env.VITE_BASE_PATH = 'MY-APP'
const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')
const targetDist = path.join(root, 'publish-iis', 'dist')

console.log('VITE_BASE_PATH=', process.env.VITE_BASE_PATH)
console.log('1. vite build 실행...')
const r = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', env: process.env, shell: true })
if (r.status !== 0) process.exit(1)

console.log('2. dist → publish-iis/dist 복사...')
function copyDir (src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}
if (fs.existsSync(targetDist)) {
  fs.rmSync(targetDist, { recursive: true })
}
copyDir(distDir, targetDist)
const basePath = process.env.VITE_BASE_PATH ?? 'MY-APP'
const pathNote = basePath ? `서브경로 /${basePath}/` : '루트(/)'
fs.writeFileSync(path.join(targetDist, '배포용-서브경로빌드.txt'), `${pathNote} 로 빌드됨. 이 dist 폴더를 서버에 반드시 포함해서 복사하세요.\n생성: ${new Date().toISOString()}`, 'utf8')
console.log('완료. 이제 npm run prepare-publish-iis 실행 후 publish-iis 폴더를 서버에 복사하세요.')
console.log('(또는 deploy:iis 스크립트로 빌드+준비 한 번에 실행 가능)')
