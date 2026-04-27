const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const MAX_GITHUB_FILE_SIZE = 100 * 1024 * 1024
const BLOCKED_PATHS = new Set([
  '.env',
  '.env.local',
  'publish-iis/.env',
  'publish-iis/dist/.env',
  'server/.env',
])

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  }).trim()
}

function runInherit(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function normalizeGitPath(file) {
  return file.replace(/\\/g, '/')
}

function getStagedFiles() {
  const out = run('git', ['diff', '--cached', '--name-only'])
  return out ? out.split(/\r?\n/).map(normalizeGitPath).filter(Boolean) : []
}

function assertNoBlockedFiles(files) {
  const blocked = files.filter((file) => {
    const name = path.posix.basename(file).toLowerCase()
    return BLOCKED_PATHS.has(file) || name === '.env' || name.endsWith('.env')
  })
  if (blocked.length) {
    console.error('Refusing to commit secret/env files:')
    for (const file of blocked) console.error(` - ${file}`)
    process.exit(1)
  }
}

function assertNoOversizedFiles(files) {
  const oversized = []
  for (const file of files) {
    const fullPath = path.resolve(file)
    if (!fs.existsSync(fullPath)) continue
    const stat = fs.statSync(fullPath)
    if (stat.isFile() && stat.size >= MAX_GITHUB_FILE_SIZE) {
      oversized.push({ file, size: stat.size })
    }
  }
  if (oversized.length) {
    console.error('Refusing to commit files over GitHub 100MB limit:')
    for (const item of oversized) {
      console.error(` - ${item.file} (${(item.size / 1024 / 1024).toFixed(1)} MB)`)
    }
    process.exit(1)
  }
}

function main() {
  const branch = run('git', ['branch', '--show-current'])
  if (!branch) {
    console.error('No current branch found.')
    process.exit(1)
  }

  runInherit('git', ['add', '-A'])

  const staged = getStagedFiles()
  if (staged.length) {
    assertNoBlockedFiles(staged)
    assertNoOversizedFiles(staged)

    const message =
      process.argv.slice(2).join(' ').trim() ||
      `Auto upload ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`
    runInherit('git', ['commit', '-m', message])
  } else {
    console.log('No changes to commit.')
  }

  runInherit('git', ['push', 'origin', branch])
}

main()
