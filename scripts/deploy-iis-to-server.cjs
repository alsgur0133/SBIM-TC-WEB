/**
 * IIS 배포: deploy:iis 실행 후, 선택적으로 서버 경로로 복사합니다.
 * 사용법:
 *   node scripts/deploy-iis-to-server.cjs                    → 빌드만
 *   node scripts/deploy-iis-to-server.cjs E:\WebApps\sbim-tc-web
 *   set DEPLOY_PATH=E:\WebApps\sbim-tc-web && node scripts/deploy-iis-to-server.cjs
 */
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const publishDir = path.join(root, 'publish-iis')
const deployPath = process.argv[2] || process.env.DEPLOY_PATH || ''

console.log('1. npm run deploy:iis 실행 중...')
const deploy = spawnSync('npm', ['run', 'deploy:iis'], {
  cwd: root,
  stdio: 'inherit',
  shell: true
})
if (deploy.status !== 0) {
  process.exit(deploy.status || 1)
}

if (!deployPath.trim()) {
  console.log('완료. 서버로 복사하려면 경로를 지정하세요.')
  console.log('  예: node scripts/deploy-iis-to-server.cjs E:\\WebApps\\sbim-tc-web')
  console.log('  또는 DEPLOY_PATH 환경 변수 설정')
  process.exit(0)
}

const dest = deployPath.trim()
console.log('2. publish-iis →', dest, '복사 중... (서버의 DB·uploads 폴더는 유지)')
// /E: 하위 폴더 포함 복사. /MIR 대신 사용 → 서버에 있는 uploads 등은 삭제하지 않음
const robocopy = spawnSync('robocopy', [
  publishDir,
  dest,
  '/E',
  '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'
], { shell: true, stdio: 'inherit' })
// robocopy exit: 0=없음, 1=복사됨, 2+ = 추가 의미 (8 = 일부 실패 등)
if (robocopy.status >= 8) {
  process.exit(1)
}
console.log('배포 완료.')
