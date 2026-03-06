# 로그인 500 오류 시 확인 방법

## 1. 서버 터미널 확인

`npm run server`를 실행한 터미널에서 **sa/1234** 로그인 직후 다음 로그가 나오는지 봅니다.

- `[로그인 500]` 또는 `[미처리 오류]` 뒤에 **실제 오류 메시지**가 출력됩니다.
- 예: `no such column: status`, `SQLITE_ERROR: ...` 등

이 메시지가 500의 원인입니다.

## 2. API 응답 본문 확인

브라우저 개발자 도구 → **Network** 탭 → 로그인 요청(POST `/api/auth/login`) 선택 → **Response** 탭을 봅니다.

- 개발 모드에서는 500 응답 body에 `error` 필드로 **서버 오류 메시지**가 포함됩니다.
- 예: `{ "success": false, "error": "no such column: status" }`

프론트에서는 "요청에 실패했습니다.(500)"만 보여줄 수 있지만, 위 Response에 실제 원인이 나옵니다.

## 3. DB 스키마 확인

SQLite DB(`server/sbim-tc.db`)의 `users` 테이블 컬럼을 확인합니다.

```bash
cd server
node -e "const db = require('better-sqlite3')('sbim-tc.db'); console.log(db.prepare('PRAGMA table_info(users)').all());"
```

또는 SQLite 클라이언트로:

```sql
PRAGMA table_info(users);
```

- 최소한 `id`, `name`, `email`, `password` 4개 컬럼이 있으면 로그인 코드는 동작하도록 수정되어 있습니다.
- `status`, `is_admin`, `role`, `company`, `created_at`이 없어도 fallback으로 처리합니다.

## 4. 수정 사항 요약 (서버 코드)

- 로그인 시 사용자 조회를 **3단계 fallback**으로 처리:
  1. `id, name, email, password, status, is_admin` 조회
  2. 실패 시 `id, name, email, password, created_at` 조회
  3. 또 실패 시 `id, name, email, password` 만 조회
- 500 발생 시 서버 로그에 `[로그인 500]` + 오류 메시지 출력
- 미처리 예외는 Express 에러 핸들러에서 500 JSON으로 반환 (개발 시 메시지 포함)

위 1~2번으로 나온 **정확한 오류 메시지**를 알려주시면, 그에 맞춰 추가 수정 방법을 안내할 수 있습니다.
