# DB·API 검토 보고서

## 1. DB (server/db.js)

### 1.1 개요
- **엔진**: better-sqlite3, 단일 파일 `server/sbim-tc.db`
- **역할**: 스키마 생성·컬럼 추가(ALTER), 모듈은 `db` 객체만 export

### 1.2 테이블 구조

| 테이블 | 용도 | 비고 |
|--------|------|------|
| **users** | 사용자(이메일, 비밀번호, 역할, 승인상태) | id, name, email, password, created_at, status, is_admin + ALTER로 role, company |
| **projects** | 프로젝트 마스터 | id, name, description, created_at, updated_at + ALTER로 code, client, start_date, end_date, pm, status |
| **project_participants** | 프로젝트별 참여자 | project_id, user_id, role_in_project, created_at, PK(project_id, user_id) |
| **design_phases** | 설계 차수 | id, name, sort_order, project_id, created_at, updated_at |
| **design_revisions** | 설계 리비전(차수별) | id, design_phase_id, revision_name, planned_date, actual_date, status, memo, created_at, updated_at |
| **design_documents** | 설계도서(리비전별) | id, design_revision_id, title, doc_number, memo, file_name, file_path, created_at, updated_at |

### 1.3 스키마 관리 방식
- `CREATE TABLE IF NOT EXISTS`로 초기 생성
- **users**: `status`, `is_admin`, `role`, `company`는 `ALTER TABLE ... ADD COLUMN`으로 추가 (실패 시 catch로 무시)
- **projects**: `code`, `client`, `start_date`, `end_date`, `pm`, `status` 동일
- **design_documents**: `file_name`, `file_path` 동일

### 1.4 DB 쪽 이슈·권장사항

1. **users 기본 스키마와 불일치**  
   CREATE TABLE에는 `status`, `is_admin`가 이미 포함되어 있는데, ALTER 목록에 중복으로 들어 있음. 동작에는 문제 없으나 ALTER 순서/중복 정리 시 가독성 개선 가능.

2. **구 DB 호환**  
   예전에 생성된 DB에는 `role`, `company`가 없을 수 있음. API에서 이 컬럼을 SELECT/UPDATE하는 부분은 이미 대부분 fallback 처리됨(로그인, 사용자 목록 등). 단 **PUT /api/auth/profile**, **PUT /api/auth/users/:userId**에서 `company`/`role`을 쓰는 UPDATE는 `role`/`company` 컬럼이 없으면 500 가능 → API 쪽에서 try/catch 또는 컬럼 유무 확인 후 분기 권장.

3. **인덱스**  
   - `users.email` (UNIQUE) → 조회에 유리  
   - `projects.updated_at`, `design_revisions.design_phase_id` 등 자주 조회하는 컬럼에 인덱스 없음. 데이터가 많아지면 `ORDER BY updated_at DESC` 등에 인덱스 추가 검토.

4. **마이그레이션 이력 없음**  
   버전 파일 없이 ALTER를 try/catch로 반복 실행하는 방식. 배포/환경이 늘어나면 스키마 버전 테이블 + 마이그레이션 스크립트 도입을 고려할 수 있음.

---

## 2. API (server/index.js)

### 2.1 라우트 요약

| 구분 | 메서드 | 경로 | 설명 |
|------|--------|------|------|
| **인증** | POST | /api/auth/signup | 회원가입 |
| | POST | /api/auth/login | 로그인 |
| | PUT | /api/auth/profile | 내 정보 수정 |
| | GET | /api/auth/users | 사용자 목록(관리자) |
| | PUT | /api/auth/users/:userId | 사용자 수정(관리자) |
| | GET | /api/auth/pending-users | 승인대기 목록 |
| | POST | /api/auth/approve-user | 사용자 승인 |
| | DELETE | /api/auth/users/:userId | 사용자 삭제 |
| **프로젝트** | GET | /api/projects | 목록 |
| | GET | /api/projects/next-code | 다음 프로젝트 코드 |
| | POST | /api/projects | 생성 |
| | PUT | /api/projects/:id | 수정 |
| | DELETE | /api/projects/:id | 삭제 |
| | GET | /api/projects/:id/participants | 참여자 목록 |
| | POST | /api/projects/:id/participants | 참여자 추가 |
| | DELETE | /api/projects/:projectId/participants/:userId | 참여자 제거 |
| **설계일정** | GET | /api/design-schedule/phases | 설계차수 목록 |
| | POST | /api/design-schedule/phases | 설계차수 생성 |
| | PUT | /api/design-schedule/phases/:id | 설계차수 수정 |
| | DELETE | /api/design-schedule/phases/:id | 설계차수 삭제 |
| | GET | /api/design-schedule/phases/:phaseId/revisions | 리비전 목록 |
| | POST | /api/design-schedule/phases/:phaseId/revisions | 리비전 생성 |
| | PUT | /api/design-schedule/revisions/:id | 리비전 수정 |
| | DELETE | /api/design-schedule/revisions/:id | 리비전 삭제 |
| **설계도서** | GET | /api/design-docs | 목록(designRevisionId 쿼리) |
| | POST | /api/design-docs | 등록(multipart) |
| | PUT | /api/design-docs/:id | 수정 |
| | GET | /api/design-docs/:id/file | 파일 다운로드 |
| | DELETE | /api/design-docs/:id | 삭제 |
| **기타** | GET | /api/health | 서버 상태 |

### 2.2 공통 처리
- **CORS**: `origin: true` (모든 오리진 허용)
- **body/query 보호**: `req.body`, `req.query`가 객체가 아니면 `{}`로 설정해 undefined 접근으로 인한 500 방지
- **에러 응답**: `send500(res, err)`로 500 시 JSON `{ success: false, error: 메시지 }` 반환 (production에서는 상세 메시지 숨김)
- **404**: 등록되지 않은 경로는 JSON 404 반환

### 2.3 인증·권한
- **로그인**: 이메일/비밀번호 검증, bcrypt, 기본 관리자(sa/1234) 폴백·비밀번호 재설정 처리. SELECT는 기본 컬럼만 사용해 구 스키마에서도 500 방지.
- **관리자/프로젝트 관리자**: `canManageProjects(email)` — `users.role` 또는 `is_admin`로 판단. `role` 컬럼 없을 때 fallback으로 `is_admin`만 조회.

### 2.4 API 쪽 이슈·권장사항

1. **PUT /api/auth/profile**  
   - `SELECT ... company`, `UPDATE ... company` 사용. `users`에 `company` 없으면 500 가능.  
   - **권장**: SELECT는 기본 컬럼만 쓰거나, role/company 없을 때 fallback; UPDATE는 try/catch로 감싸고 "no such column: company" 시 company 제외한 UPDATE 실행.

2. **PUT /api/auth/users/:userId**  
   - `UPDATE users SET ... role = ?, company = ?` 사용. 구 DB에서 500 가능.  
   - **권장**: role/company 컬럼 유무에 따라 UPDATE 문 분기 또는 try/catch fallback.

3. **참여자 조회 (GET participants)**  
   - `JOIN users u` 후 `u.company` 선택. `users`에 `company` 없으면 에러 가능.  
   - **권장**: PRAGMA 또는 try/catch로 컬럼 확인 후, 없으면 company 제외한 SELECT 또는 응답에서 company 제거.

4. **설계일정·설계도서**  
   - `req.body` / `req.params`는 대부분 존재하는 경우만 사용. 일부 라우트는 `req.body`가 없을 때 `req.body.userEmail` 등에서 예외는 나지 않지만, 통일을 위해 `const body = req.body || {}` 패턴 적용 권장.

5. **속도**  
   - `ensureProjectExtraColumns()`가 GET /api/projects 호출마다 PRAGMA + ALTER 시도. 컬럼이 이미 있으면 ALTER는 스킵되므로 부하는 작지만, 필요 시 앱 기동 시 1회만 호출하도록 변경 가능.

6. **인증 토큰**  
   - 현재는 세션/JWT 없이 요청 본문·쿼리의 `userEmail` / `adminEmail`로 권한만 검사. 동일 도메인 + 관리자 전용 메뉴 전제라면 실사용 가능하나, 보안 강화 시 토큰 기반 인증 도입 검토.

---

## 3. 요약

| 항목 | 상태 | 비고 |
|------|------|------|
| DB 스키마 | 양호 | ALTER로 확장, 구 DB와의 role/company 차이만 주의 |
| 로그인·사용자 목록 등 | 양호 | role/company fallback 처리됨 |
| 프로필/사용자 수정·참여자 조회 | 개선 여지 | role/company 없는 DB에서 500 가능 → fallback 권장 |
| 에러 처리·입력 보호 | 양호 | body/query 보호, send500, try/catch 사용 |
| 라우트·역할 분리 | 명확 | 인증/프로젝트/설계일정/설계도서 구분됨 |

**우선 적용 권장**: PUT /api/auth/profile, PUT /api/auth/users/:userId, GET /api/projects/:id/participants 에서 `role`/`company` 컬럼 없을 때를 대비한 fallback 또는 try/catch 추가.
