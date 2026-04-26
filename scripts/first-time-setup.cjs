/**
 * 처음 프로젝트 받았을 때 한 번 실행.
 * - Node 버전 확인 (20 권장)
 * - npm install 실행
 * 다른 사람이 "복붙 한 번"으로 셋팅되게 하기 위한 스크립트.
 */
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const wantMajor = 20

console.log('=== SBIM-TC-WEB 첫 설정 ===\n')

const nodeVersion = process.version
const major = parseInt(nodeVersion.slice(1).split('.')[0], 10)
if (major < 18) {
  console.warn('⚠ Node 18 이상 권장 (현재: ' + nodeVersion + '). Node 20 LTS 권장.')
} else if (major >= wantMajor) {
  console.log('✓ Node 버전 OK:', nodeVersion)
} else {
  console.log('Node:', nodeVersion, '(20 권장, 계속 진행합니다)')
}

console.log('\n1. npm install 실행 중...')
const r = spawnSync('npm', ['install'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})
if (r.status !== 0) {
  process.exit(r.status || 1)
}

console.log('\n=== 설정 완료 ===')
console.log('로컬 실행: npm run dev:all')
console.log('배포 빌드: npm run deploy:iis')
console.log('자세한 순서: 배포-가이드.md 참고')
