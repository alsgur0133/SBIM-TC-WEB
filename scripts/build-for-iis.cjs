/**
 * IIS 서브경로 배포: 기본 https://develop.yunwootech.com/bracetc/
 * (다른 경로면 VITE_BASE_PATH=... 과 IIS 응용 프로그램 별칭을 반드시 동일하게.)
 * Trimble OAuth redirect URI는 iis-deploy-trimble.cjs (또는 TRIMBLE_IIS_REDIRECT_URI)와 동일해야 함.
 */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const { getViteEnv } = require('./iis-deploy-trimble.cjs')

if (process.env.VITE_BASE_PATH === undefined) process.env.VITE_BASE_PATH = 'bracetc'
Object.assign(process.env, getViteEnv())
const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')
const targetDist = path.join(root, 'publish-iis', 'dist')

console.log('VITE_BASE_PATH=', process.env.VITE_BASE_PATH)
console.log('Trimble(IIS 배포):', process.env.VITE_TRIMBLE_REDIRECT_URI, '|', process.env.VITE_TRIMBLE_APP_NAME)
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
// 서버에서 이 dist가 제대로 복사됐는지 확인용
const basePath = process.env.VITE_BASE_PATH ?? 'bracetc'
const pathNote = basePath ? `서브경로 /${basePath}/` : '루트(/)'
fs.writeFileSync(path.join(targetDist, '배포용-서브경로빌드.txt'), `${pathNote} 로 빌드됨. 이 dist 폴더를 서버에 반드시 포함해서 복사하세요.\n생성: ${new Date().toISOString()}`, 'utf8')
console.log('프론트(dist) 단계 완료. npm run build:iis 는 이어서 prepare-publish-iis 를 자동 실행합니다.')
