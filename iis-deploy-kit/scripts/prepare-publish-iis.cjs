/**
 * 프로젝트 루트의 scripts/prepare-publish-iis.cjs 를 호출합니다.
 * (중복 로직 방지 — IIS 배포는 publish-iis\\dist 만 사용)
 */
const path = require('path')
const { spawnSync } = require('child_process')

const repoRoot = path.join(__dirname, '..', '..')
const main = path.join(repoRoot, 'scripts', 'prepare-publish-iis.cjs')
const r = spawnSync(process.execPath, [main], { cwd: repoRoot, stdio: 'inherit', shell: true })
process.exit(r.status === null ? 1 : r.status)
