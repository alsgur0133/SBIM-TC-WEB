# IIS / 카페24 / 내부 서버 PC 배포 방법

---

## 1. 내부 서버 PC에 배포 (가장 단순)

Node만 설치되어 있으면 됩니다. IIS 없이 사용 가능합니다.

### 1) 서버 PC에 할 일

1. **Node.js 설치**  
   - https://nodejs.org 에서 LTS 버전 설치 (예: 22)

2. **프로젝트 복사**  
   - 이 폴더 전체를 서버 PC로 복사 (USB, 네트워크 공유, Git clone 등)

3. **빌드 및 실행**  
   - 프로젝트 폴더에서:
   ```cmd
   npm install
   npm run build
   cd server
   npm install
   cd ..
   node server/index.js
   ```
   - 또는 한 번에: `npm run build:all` 후 `npm run start:prod`

4. **접속 주소**  
   - 같은 PC: `http://localhost:5001`  
   - 같은 네트워크 다른 PC: `http://서버PC의IP:5001` (예: `http://192.168.0.10:5001`)  
   - 방화벽에서 **5001 포트** 허용 필요

5. **계속 켜 두기 (선택)**  
   - 서버 PC를 꺼도 안 꺼지게 하려면 **PM2** 사용:
   ```cmd
   npm install -g pm2
   pm2 start server/index.js --name sbim-tc
   pm2 save
   pm2 startup
   ```

---

## 2. IIS로 배포 (Windows 서버 + IIS 있는 경우)

Node 앱을 IIS 사이트 하나로 서비스하려면 **iisnode**가 필요합니다.

### 1) 준비

- Windows 서버에 **IIS** 설치
- **Node.js** 설치 (예: `C:\Program Files\nodejs`)
- **iisnode** 설치:  
  https://github.com/Azure/iisnode/releases 에서 설치 파일 받아 설치

### 2) 배포 폴더 구성

1. 서버 PC에서 프로젝트 빌드:
   ```cmd
   npm install
   npm run build
   cd server
   npm install --omit=dev
   cd ..
   ```
2. 다음 폴더/파일만 IIS 사이트 폴더로 복사:
   - `server` 폴더 전체
   - `dist` 폴더 전체
   - `package.json` (루트)
   - `web.config` (이 프로젝트에 포함된 것 사용)

3. **web.config**에서 Node 경로 확인  
   - `nodeProcessCommandLine`이 실제 node.exe 경로와 맞는지 확인 (예: `C:\Program Files\nodejs\node.exe`)

### 3) IIS에서 사이트 만들기

1. IIS 관리자 → **사이트** → **웹 사이트 추가**
2. **실제 경로**: 위에서 복사한 폴더
3. **바인딩**: 원하는 포트(80 또는 443) 또는 호스트 이름
4. **응용 프로그램 풀**:  
   - .NET이 아니므로 **32비트 사용 안 함**,  
   - 필요 시 **고급 설정**에서 **ID**를 해당 폴더에 권한 있는 계정으로

5. 브라우저에서 `http://서버주소` 또는 `http://서버주소:포트` 로 접속

### 4) IIS 없이 같은 PC에서만 Node로 실행

- IIS를 쓰지 않아도 됩니다.  
- **1. 내부 서버 PC에 배포**처럼 `node server/index.js` 만 실행해 두고,  
  `http://그PC의IP:5001` 로 접속해도 됩니다.

---

## 3. 카페24로 배포

카페24는 **플랜에 따라** 가능한 게 다릅니다.

### 1) 일반 호스팅(스마트디자인, 쇼핑몰 등)

- **PHP + FTP + 웹디렉터리**만 있는 경우가 많습니다.
- **Node.js 실행이 불가**한 플랜이면, 이 프로젝트(Express API + DB)는 **그대로는 올릴 수 없습니다**.

### 2) 카페24에서 가능한 경우

- **VPS/서버형** 플랜을 쓰고 있고, **SSH 접속 + Node 설치**가 가능하면:
  - 내부 서버 PC 배포와 같은 방식으로:
    - 프로젝트 업로드(또는 Git clone)
    - `npm install` → `npm run build` → `server`에서 `npm install` → `node server/index.js` (또는 PM2)
- **Node 지원**이 없다고 안내된 플랜이면:
  - 프론트(React 빌드 결과)만 카페24에 올리고,
  - API는 **내부 서버 PC**나 **IIS 있는 서버**, **Render/Railway** 등 다른 곳에 두고,
  - 프론트에서 `VITE_API_URL`로 그 API 주소를 가리키게 해야 합니다.

### 3) 정리

- **카페24 = IIS/내부서버 아님**  
  → “카페24로 안 되나?”가 아니라 **“지금 쓰는 카페24 플랜이 Node 지원하는지”**가 중요합니다.  
  지원하면 위처럼 배포 가능하고, 지원 안 하면 Node 부분은 다른 서버(IIS, 내부 PC 등)로 가야 합니다.

---

## 요약

| 환경 | 가능 여부 | 방법 |
|------|------------|------|
| **내부 서버 PC** | ✅ 가능 | Node 설치 → 빌드 → `node server/index.js` (또는 PM2). 포트 5001 열고 `http://서버IP:5001` 로 접속 |
| **IIS 있는 서버** | ✅ 가능 | iisnode 설치 후 `web.config` 사용해서 Node 앱을 IIS 사이트로 서비스 (또는 같은 PC에서 Node만 켜도 됨) |
| **카페24** | ⚠️ 플랜에 따라 다름 | SSH + Node 가능 플랜이면 내부 서버와 동일 방식. 일반 호스팅만 있으면 Node는 다른 서버(IIS/내부 PC)에 두고, 카페24에는 프론트만 올리는 식으로 분리 |

원하시면 “내부 서버 PC만 쓸지”, “IIS로 도메인/80 포트 쓰고 싶은지”, “카페24 플랜 이름” 알려주시면 그에 맞춰 단계만 더 줄여서 적어 드리겠습니다.
