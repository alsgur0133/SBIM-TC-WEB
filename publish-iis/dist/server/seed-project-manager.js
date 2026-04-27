/**
 * 지정 이메일 사용자를 프로젝트 관리자(role)로 설정합니다.
 * 실행: node server/seed-project-manager.js [이메일]
 * 이메일 생략 시 test2@test.com 사용
 */
const db = require('./db')

const email = (process.argv[2] || 'test2@test.com').trim().toLowerCase()
if (!email) {
  console.error('사용법: node server/seed-project-manager.js [이메일]')
  process.exit(1)
}

db.init()
  .then(async () => {
    const row = await db.prepare('SELECT id, role FROM users WHERE email = ?').get(email)
    if (!row) {
      console.error('해당 이메일 사용자가 없습니다:', email)
      process.exit(1)
    }
    await db.prepare("UPDATE users SET role = '프로젝트 관리자' WHERE email = ?").run(email)
    console.log(`"${email}" 사용자를 프로젝트 관리자로 설정했습니다. 로그아웃 후 다시 로그인하면 반영됩니다.`)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
