/**
 * 서브도메인(루트) 배포용: 경로 없이 예) http://sbim-tc-web.dev.yunwootech.com:2421
 * VITE_BASE_PATH·BASE_PATH 를 비워서 빌드 후 publish-iis 준비.
 */
const { spawnSync } = require('child_process')
const path = require('path')

process.env.VITE_BASE_PATH = ''
process.env.BASE_PATH = ''
const root = path.join(__dirname, '..')

console.log('루트(/) 배포 빌드 - VITE_BASE_PATH=, BASE_PATH=')
const a = spawnSync('npm', ['run', 'build:iis'], { cwd: root, stdio: 'inherit', env: process.env, shell: true })
if (a.status !== 0) process.exit(a.status || 1)
const b = spawnSync('npm', ['run', 'prepare-publish-iis'], { cwd: root, stdio: 'inherit', shell: true })
process.exit(b.status !== 0 ? (b.status || 1) : 0)
