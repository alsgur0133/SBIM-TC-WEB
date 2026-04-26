# BRACE ↔ Trimble Connect 프로젝트·참여자 연동

## 동작 요약

1. **프로젝트 생성**  
   - **Trimble Connect로 로그인**한 상태에서 프로젝트를 추가할 때, 관리 화면에서 다음 중 하나를 선택할 수 있습니다.  
     - **Connect에 새 프로젝트 만들기** — 기존과 같이 Connect에 동일 이름으로 생성을 시도합니다.  
     - **기존 Connect 프로젝트 연결** — `POST /api/projects/trimble-my-projects`로 목록을 불러와 선택하거나, 프로젝트 UUID를 직접 입력합니다. **새로 만들지 않고** `trimble_connect_project_id`만 저장합니다.  
     - **Connect 연동 안 함** — BRACE에만 프로젝트가 생기고 Connect는 호출하지 않습니다.  
   - Trimble 미로그인 시에도 **Connect 프로젝트 ID만 입력**하면(선택) 해당 ID로 연결만 할 수 있습니다.  
   - 성공 시 선택·생성에 따라 `trimble_connect_project_id`가 DB에 저장됩니다.

2. **참여자 등록**  
   - 위 Connect 프로젝트가 연결된 BRACE 프로젝트에 참여자를 추가할 때, **Trimble 로그인 토큰**이 있으면 해당 사용자 **이메일로 Connect 프로젝트 초대**를 시도합니다.  
   - 먼저 `projects-api.connect.trimble.com`의 `update-users`를 호출하고, 실패 시 TC API 2.0 후보 엔드포인트로 재시도합니다.

3. **Connect 폴더·파일 → BRACE 자동 등록**  
   - **전제:** 해당 BRACE 프로젝트에 `trimble_connect_project_id`가 있고, 사용자가 **Trimble Connect로 로그인**해 액세스 토큰이 있는 상태.  
   - **UI:** 설계 **모델 관리**, **설계도서 관리**, **물량파일 등록** 화면의 **「Connect에서 가져오기」** 버튼.  
   - **API:** `POST /api/projects/:projectId/trimble-connect/import-files`  
     - 본문: `userEmail`, `trimbleAccessToken`, `designRevisionId`, 선택적으로 `importModels`, `importDocuments`, `importQuantity`(기본 `false`), `maxDepth`, `maxFiles`, `skipExisting`  
   - 서버는 리전별 TC API로 `GET .../projects/{id}`로 프로젝트를 찾은 뒤 `rootId` 기준으로 `GET .../folders/{rootId}/items`를 **Range 페이징**으로 재귀 순회하고, `GET .../files/fs/{fileId}/downloadurl`로 받은 URL에서 바이너리를 내려받아 로컬 `uploads`에 저장한 뒤 DB에 INSERT 합니다.  
   - **확장자 매핑(요약):** `.ifc`/`.ifczip` → 설계모델, `.dwg`/`.pdf`/이미지 등 → 설계도서(DWG는 가능 시 DXF/PDF 변환 파이프라인 동일), `.xlsx`/`.xls` → 물량(옵션, 엑셀 파싱 시도).  
   - **중복 방지:** `design_models` / `design_documents` / `quantity_files`에 `trimble_file_id`(및 `trimble_version_id`)를 저장하며, 같은 리비전에 동일 `trimble_file_id`가 있으면 기본적으로 건너뜁니다.  
   - **한계:** 대용량·대량 파일은 시간·Trimble 할당량·서버 디스크에 제한이 있습니다. `maxFiles`(기본 400) 등으로 상한을 둡니다.

## 전제 조건

- 브라우저에서 **Trimble Connect로 로그인**(OAuth) 후 액세스 토큰이 앱에 저장되어 있어야 합니다.
- Connect API는 액세스 토큰이 짧게 유지되는 경우가 많습니다. **refresh_token**으로 갱신하지 않으면 `Session Invalid`가 날 수 있어, 앱은 목록 조회·프로젝트 생성 전에 `POST /api/auth/trimble/token`(grant_type `refresh_token`)으로 토큰을 갱신합니다. **서버를 최신 코드로 재시작**해야 갱신 분기가 동작합니다.
- Trimble Identity 앱에 **Connect API 사용에 필요한 스코프**가 등록되어 있어야 할 수 있습니다. 실패 시 Trimble 개발자 포털에서 앱 권한·스코프를 확인하세요.
- **프로젝트 생성**은 사용자 라이선스(개인/비즈니스 등)에 따라 Connect 쪽 정책이 다릅니다. API가 4xx를 반환하면 응답 메시지를 확인하세요.
- **`update-users` API**는 문서상 **계정 관리자** 권한이 필요할 수 있습니다. 일반 프로젝트 관리자만으로는 초대가 거절될 수 있습니다.

## 환경 변수 (선택, 서버)

- `TRIMBLE_CONNECT_TC_API_BASE` — 기본 `https://app.connect.trimble.com/tc/api/2.0` (미국 리전 등)
- `TRIMBLE_CONNECT_PROJECTS_API_BASE` — 기본 `https://projects-api.connect.trimble.com/v1`
- `TRIMBLE_CONNECT_REGIONS_URL` — 기본 `https://app.connect.trimble.com/tc/api/2.0/regions` (리전 카탈로그)

**리전:** Connect 프로젝트는 북미·유럽·**아시아**(예: `app31.connect.trimble.com/tc/api/2.0`) 등에 나뉘어 있습니다. BRACE는 `/regions`로 리전 목록을 읽은 뒤 **각 리전 TC API에서 프로젝트 목록을 합쳐** 보여 줍니다. 웹에서 리전을 「아시아」로 두고 만든 프로젝트는 북미 API만 호출하면 목록에 안 나올 수 있어, 위 병합 로직이 필요합니다.

## API 요청 필드 (참고)

- `POST /api/projects`  
  - `trimbleAccessToken` (선택): 사용자 OAuth 액세스 토큰  
  - `syncTrimbleConnect`: `false`로 두면 토큰이 있어도 Connect 생성·연결 안 함  
  - `trimbleExistingProjectId` (선택): 이미 있는 Connect 프로젝트 ID — 있으면 **새로 만들지 않고** 이 ID로 연결만 합니다. 토큰 없이 ID만 넣어도 됩니다.  

- `POST /api/projects/trimble-my-projects` (권장) 또는 `POST /api/trimble-connect/my-projects` (동일 동작)  
  - 본문: `userEmail`, `trimbleAccessToken`  
  - 응답: `{ success, projects: [{ id, name }, ...] }` — 프로젝트 추가 시 **기존 Connect 프로젝트 선택** UI용  

- `POST /api/projects/:id/participants`  
  - `trimbleAccessToken` (선택)  
  - `syncTrimbleConnect`: `false`면 Connect 초대 생략  

- `POST /api/projects/:projectId/trimble-connect/import-files`  
  - Connect 파일 트리 동기화 → 설계모델·설계도서·(선택) 물량. 위 3번 참고.

토큰은 HTTPS로만 전송하고, 서버는 로그에 남기지 않도록 운영하세요.
