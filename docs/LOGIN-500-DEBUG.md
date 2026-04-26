# 로그인 500 오류 시 확인 방법

## 1. 서버 터미널 확인

`npm run server`를 실행한 터미널에서 **sa/1234** 로그인 직후 다음 로그가 나오는지 봅니다.

- `[로그인 500]` 또는 `[미처리 오류]` 뒤에 **실제 오류 메시지**가 출력됩니다.
- 예: `column ... does not exist`, `ECONNREFUSED`(DB 연결 실패) 등

이 메시지가 500의 원인입니다.

## 2. API 응답 본문 확인

브라우저 개발자 도구 → **Network** 탭 → 로그인 요청(POST `/api/auth/login`) 선택 → **Response** 탭을 봅니다.

- 개발 모드에서는 500 응답 body에 `error` 필드로 **서버 오류 메시지**가 포함됩니다.
- 예: `{ "success": false, "error": "..." }` (PostgreSQL·스키마·연결 오류)

프론트에서는 "요청에 실패했습니다.(500)"만 보여줄 수 있지만, 위 Response에 실제 원인이 나옵니다.

## 3. DB 스키마·연결 확인

PostgreSQL에 연결되는지 확인합니다 (`server/.env` 또는 루트 `.env`의 `DATABASE_URL`).

```bash
# psql 등으로
\d users
```

- `DATABASE_URL`이 비어 있으면 서버가 시작 시 종료할 수 있습니다.
- 마이그레이션·스키마는 `server/db-pg.js`의 `runSchema`가 기동 시 적용합니다.

## 4. 수정 사항 요약 (서버 코드)

- 로그인 시 사용자 조회를 **3단계 fallback**으로 처리:
  1. `id, name, email, password, status, is_admin` 조회
  2. 실패 시 `id, name, email, password, created_at` 조회
  3. 또 실패 시 `id, name, email, password` 만 조회
- 500 발생 시 서버 로그에 `[로그인 500]` + 오류 메시지 출력
- 미처리 예외는 Express 에러 핸들러에서 500 JSON으로 반환 (개발 시 메시지 포함)

위 1~2번으로 나온 **정확한 오류 메시지**를 알려주시면, 그에 맞춰 추가 수정 방법을 안내할 수 있습니다.
