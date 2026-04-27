/**
 * test1 테스트 사용자를 users 테이블에 추가합니다.
 * 실행: node server/seed-test-user.js (프로젝트 루트에서) 또는 cd server && node seed-test-user.js
 */
const bcrypt = require('bcryptjs')
const db = require('./db')

const TEST_EMAIL = 'test1@test.com'
const TEST_NAME = 'test1'
const TEST_PASSWORD = '1234'

db.init()
  .then(async () => {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_EMAIL)
    if (existing) {
      const hashed = bcrypt.hashSync(TEST_PASSWORD, 10)
      await db.prepare('UPDATE users SET name = ?, password = ?, status = ? WHERE email = ?').run(
        TEST_NAME,
        hashed,
        '활성',
        TEST_EMAIL
      )
      console.log('test1 사용자 비밀번호/이름 갱신됨 (이메일: test1@test.com, 비밀번호: 1234)')
    } else {
      const id = 'test1-' + Date.now()
      const hashed = bcrypt.hashSync(TEST_PASSWORD, 10)
      await db
        .prepare(
          "INSERT INTO users (id, name, email, password, status, is_admin) VALUES (?, ?, ?, ?, '활성', 0)"
        )
        .run(id, TEST_NAME, TEST_EMAIL, hashed)
      console.log('test1 사용자 생성됨 (이메일: test1@test.com, 비밀번호: 1234)')
    }
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
