# IIS 배포 — 처음부터 초보자용 (아무 설정도 없을 때)

**이 문서는** 컴퓨터에 배포 스크립트가 하나도 없고, `publish-iis` 같은 폴더도 만든 적이 없을 때 **순서대로만 따라 하면** 로컬에서 `publish-iis` 폴더까지 만드는 방법을 설명합니다.

> **서버에 IIS 설치·사이트 만들기**까지는 이 문서 끝의 **「IIS는 누가 하나요?」**만 보고, 상세는 `IIS서버-설치방법.txt`(프로젝트 루트) 를 쓰면 됩니다.

---

## 먼저 확인: 이 방식이 우리 프로젝트에 맞나요?

| 맞는 경우 | 맞지 않는 경우 |
|-----------|----------------|
| 화면은 **Vite**(또는 `npm run build` 하면 **`dist` 폴더**가 생김) | **순수 HTML**만 있거나, 빌드 도구가 없음 |
| 백엔드는 **Node.js**로, 보통 프로젝트 안에 **`server` 폴더**와 **`server/index.js`** 같은 파일이 있음 | **PHP·ASP.NET만** 있고 Node 서버가 없음 |
| IIS에서 **iisnode**로 Node를 돌릴 계획임 | **정적 파일만** IIS에 올리면 되는 경우(그때는 `dist`만 복사하는 다른 방법) |

**Node 서버가 없으면** 이 가이드의 `prepare-publish-iis`·`web.config` 내용은 그대로 쓰기 어렵습니다. 그 경우는 담당자에게 “정적 배포만 할지” 먼저 확인하세요.

---

## 0. 준비물 (한 번만)

1. **Node.js** 설치  
   - https://nodejs.org/ 에서 **LTS(권장)** 버전 받아 설치  
   - 설치 후 **Cursor** 또는 **명령 프롬프트**를 **완전히 닫았다가 다시 엽니다**.

2. **확인** (프로젝트 폴더에서):
   - Windows: 폴더 주소창에 `cmd` 입력 후 Enter → 검은 창이 뜨면  
     `node -v` 와 `npm -v` 를 치고, 버전 숫자가 나오면 성공입니다.

3. **프로젝트 열기**  
   - Cursor에서 **프로젝트 최상위 폴더**(보통 `package.json` 이 있는 곳)를 연 상태로 진행합니다.

---

## 1. 폴더 구조가 맞는지 보기

프로젝트 **맨 위**(루트)에 대략 이런 것들이 있어야 합니다.

- `package.json` ← **반드시 있어야 함**
- `vite.config.js` 또는 `vite.config.ts` ← Vite 쓸 때
- `server` 폴더 ← 이 가이드 기준 Node 서버 위치
- `server/index.js` (또는 회사 표준 진입 파일) ← IIS `web.config`에 적을 이름과 같아야 함

**서버 폴더 이름이 `server`가 아니면** (예: `backend`) 나중에 `prepare-publish-iis.cjs` 안의 경로와 `web.config`의 `server/index.js` 를 그 이름에 맞게 바꿔야 합니다. 비전공자라면 가능하면 폴더 이름을 `server` 로 통일하는 것이 가장 단순합니다.

---

## 2. “서브경로 이름” 정하기

예시 주소가 `http://회사서버/MY-APP/` 처럼 **도메인 뒤에 폴더 이름**이 붙으면, 그 **`MY-APP`**이 서브경로 이름입니다.

- 여기서는 설명용으로 **`MY-APP`** 이라고 부르겠습니다.  
- **실제로는 본인 앱 이름(영문, 대시 등)**으로 바꿔서 아래 모든 곳에 똑같이 쓰면 됩니다.
- 사이트가 **맨 루트**(`http://회사서버/`) 하나만 쓰면 `MY-APP` 대신 **빈 값** 처리가 필요합니다. 그때는 아래 4번·5번과 [빌드배포-다른프로젝트에-적용하기.md](./빌드배포-다른프로젝트에-적용하기.md) **2절·6절**을 같이 보세요.

---

## 3. `scripts` 폴더 만들고 파일 두 개 넣기

**빠른 방법:** 이 저장소 루트의 **`iis-deploy-kit`** 폴더 안 `scripts` 두 파일을 그대로 프로젝트에 넣습니다. (`iis-deploy-kit/README-복사방법.txt` 에 전체 순서가 있습니다.)

1. 프로젝트 **루트**에 `scripts` 폴더를 만듭니다. (없으면 새 폴더 생성)
2. **이미 이 방식을 쓰는 프로젝트**(예: SBIM TC WEB) 또는 `iis-deploy-kit`에서 아래 두 파일을 **복사**합니다.
   - `scripts/build-for-iis.cjs`
   - `scripts/prepare-publish-iis.cjs`
3. 복사한 프로젝트의 **루트**에 `publish-iis` 폴더가 이미 있어도, 새 프로젝트에서는 **처음엔 비어 있어도 됩니다.** 스크립트가 채워 줍니다.

**복사할 샘플이 없으면** [빌드배포-다른프로젝트에-적용하기.md](./빌드배포-다른프로젝트에-적용하기.md) **4절**에 있는 코드 블록 전체를 각각 `build-for-iis.cjs`, `prepare-publish-iis.cjs` 로 저장하면 됩니다.

---

## 4. `build-for-iis.cjs` 안의 이름 바꾸기 (한 줄)

파일을 연 뒤, **맨 위 근처**에서:

- `SBIM-TC-WEB` 이라고 적힌 곳을 **본인의 서브경로 이름**으로 바꿉니다. (위에서 정한 `MY-APP`)

예시:

```js
if (process.env.VITE_BASE_PATH === undefined) process.env.VITE_BASE_PATH = 'MY-APP'
```

그리고 파일 **아래쪽**에도 같은 문자열이 있으면 **같이** 바꿉니다. (주석에 `SBIM-TC-WEB`만 있으면 주석은 안 바꿔도 됨)

---

## 5. `prepare-publish-iis.cjs` — 서버 폴더 이름

- 기본은 `server` 폴더를 `publish-iis/server` 로 복사합니다.
- 백엔드 폴더가 **`server`가 아니면** 파일 안의 `path.join(root, 'server')` 부분을 본인 폴더명으로 수정합니다.

---

## 6. `vite.config`에 `base` 연결하기

**목표:** 빌드할 때 주소가 `/MY-APP/...` 처럼 나가게 맞추기.

`vite.config.ts` 또는 `vite.config.js` **맨 위 근처**에 다음과 비슷한 코드가 **있도록** 합니다. (이미 있으면 서브경로 규칙만 맞는지 확인)

```ts
const basePath = process.env.VITE_BASE_PATH
const base = basePath ? `/${basePath.replace(/^\/|\/$/g, '')}/` : '/'

export default defineConfig({
  base,
  // ... 나머지 설정
})
```

프론트 코드에서 라우터나 API 주소를 쓸 때도 **배포 경로**와 맞는지 개발 담당자에게 확인하면 안전합니다.

---

## 7. `package.json`에 명령 세 줄 추가하기

루트의 `package.json`을 열고, `"scripts": { ... }` **안에** 아래 세 줄을 추가합니다. (쉼표 위치에 주의: 마지막 항목이 아니면 뒤에 쉼표 필요)

```json
"build:iis": "node scripts/build-for-iis.cjs",
"prepare-publish-iis": "node scripts/prepare-publish-iis.cjs",
"deploy:iis": "npm run build:iis && npm run prepare-publish-iis"
```

저장합니다.

---

## 8. `publish-iis/web.config` 만들기

1. 프로젝트 루트에 **`publish-iis`** 폴더를 만듭니다. (없으면)
2. 그 안에 **`web.config`** 파일을 만듭니다.
3. [빌드배포-다른프로젝트에-적용하기.md](./빌드배포-다른프로젝트에-적용하기.md) **5절**의 XML 전체를 복사해 넣습니다.

**체크:**

- Node 진입 파일이 `server/index.js`가 **아니면** XML 안의 `server/index.js` 두 곳을 **실제 경로**로 바꿉니다.
- IIS에 **서브경로**로 올릴 때 Node가 그 경로를 알아야 하면, 같은 문서 **6절**처럼 `BASE_PATH` 환경 변수를 `web.config`에 추가합니다. (`value="/MY-APP"` 처럼 본인 이름으로)

---

## 9. 한 번에 빌드하기 (여기까지가 “로컬 끝”)

프로젝트 **루트**에서 터미널을 연 다음 순서대로:

```bat
npm install
npm run deploy:iis
```

- 처음에는 시간이 조금 걸릴 수 있습니다.
- 끝나면 **`publish-iis`** 안에 대략 다음이 있어야 합니다.
  - `dist` (화면 파일)
  - `server` (Node 서버 + `node_modules` 등)
  - `web.config`

**안 생기면:**

- 중간에 빨간 에러 글이 있는지 끝까지 읽어 보기
- `dist`가 비어 있으면 `npm run build`만 따로 해서 에러 나는지 확인

---

## 10. 서버에 넘길 때 (비전공자 체크리스트)

다음을 **압축하거나 폴더째** 서버 담당자에게 주면 됩니다.

- [ ] **`publish-iis` 폴더 전체** (안에 `dist`, `server`, `web.config` 포함)
- [ ] 접속 주소: `http://…/MY-APP/` 처럼 **실제 URL**
- [ ] “Node는 **iisnode**로 돌아가야 함” 이라고 한 줄 적어 주기

IIS에서 물리 경로·권한·HTTPS는 **`IIS서버-설치방법.txt`** 또는 사내 매뉴얼을 따릅니다.

---

## 자주 묻는 질문

**Q. `npm run build`만 했는데 `publish-iis`가 안 생겨요.**  
A. 정상입니다. Vite는 기본적으로 **`dist`만** 만듭니다. **`npm run deploy:iis`** 를 써야 `publish-iis`가 채워집니다. ([기술 요약](./빌드배포-다른프로젝트에-적용하기.md#0-npm-run-build만-했는데-publish-폴더가-안-생길-때))

**Q. 다른 PC에서도 똑같이 하나요?**  
A. 네. `package.json`, `scripts`, `vite.config`, `server` 소스가 같으면 같은 명령으로 `publish-iis`를 다시 만들면 됩니다.

**Q. 스크립트 복사가 귀찮아요.**  
A. 회사 템플릿 저장소에 `scripts/build-for-iis.cjs` 등을 한 번 넣어 두고, 새 프로젝트 때마다 **폴더째 복사**하는 방식이 실수가 적습니다.

---

## 더 자세한 설명(개발자용)

- [빌드배포-다른프로젝트에-적용하기.md](./빌드배포-다른프로젝트에-적용하기.md) — 스크립트 전문, `web.config`, Express `BASE_PATH` 예시

이 문서만으로 **“아무 설정도 없던 새 프로젝트”**에 순서대로 적용할 수 있도록 맞춰 두었습니다.
