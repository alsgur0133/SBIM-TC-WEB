# 비주얼 스튜디오에서 SBIM TC WEB 열기 및 게시

## 1. 비주얼 스튜디오에서 열기 (권장: 폴더로 열기)

**`.sln`을 열면 "호환되지 않음"이 뜨는 환경에서는 아래 방법을 사용하세요.**

### ✅ 권장: 폴더로 열기 (호환되지 않음 없음)

1. **Visual Studio 2022** 실행
2. **파일 > 열기 > 폴더**
3. 이 프로젝트 폴더 선택 (예: `D:\AI WEB\SBIM TC WEB`)
4. **폴더 선택** 클릭

→ `package.json`을 인식해 Node.js 프로젝트로 열립니다.  
→ 솔루션 탐색기에 파일 트리가 보이고, 터미널에서 `npm run dev:all` 실행 가능.

### .sln으로 열기

- **파일 > 열기 > 프로젝트/솔루션** → `SBIM-TC-WEB.sln` 선택
- 솔루션에는 "SBIM-TC-WEB" 폴더만 보일 수 있습니다. 실제 편집·실행은 **폴더로 열기**를 사용하세요.

---

## 2. 실행 및 디버깅

- **F5** 또는 **디버그 > 디버깅 시작**: `npm run dev:all` 실행 (프론트 + API 서버)
- 브라우저에서 **http://localhost:5173** 자동 열림
- 중단점은 **server/index.js** 또는 **src/** 파일에 걸 수 있음

---

## 3. 게시(배포) 방법

### 방법 A: 배치 파일로 폴더에 게시

1. **`publish-for-visual-studio.bat`** 더블클릭
2. `npm run build` 후 **bin\publish** 폴더에 결과물 생성
3. **bin\publish** 폴더 전체를 서버(IIS, Azure 등)에 복사해 배포

### 방법 B: Azure에 게시

1. Visual Studio에서 **프로젝트 우클릭 > 게시**
2. **대상: Azure** 선택 후 **Azure App Service** 또는 **Azure VM** 선택
3. 마법사 따라 로그인 후 앱 서비스 선택/생성
4. 게시 프로필 저장 후 **게시** 클릭

### 방법 C: GitHub / Azure DevOps에 코드 게시

1. **보기 > Git 변경 내용** (또는 팀 탐색기)
2. 원격에 **GitHub** 또는 **Azure DevOps** 저장소 연결
3. 커밋 후 **푸시**로 코드 게시

---

## 파일 설명

| 파일 | 설명 |
|------|------|
| **SBIM-TC-WEB.sln** | 비주얼 스튜디오 솔루션 (이걸로 열기) |
| **SBIM-TC-WEB.esproj** | VS 2022 JavaScript 프로젝트 설정 (권장) |
| **SBIM-TC-WEB.njsproj** | 구형 Node.js 프로젝트 (호환되지 않으면 .esproj 사용) |
| **publish-for-visual-studio.bat** | 빌드 후 bin\publish에 배포용 파일 복사 |
| **Properties/PublishProfiles/FolderProfile.pubxml** | 폴더 게시 프로필 (필요 시 사용) |
