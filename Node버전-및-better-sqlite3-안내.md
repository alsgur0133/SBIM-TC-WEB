# Node 버전 및 better-sqlite3 오류 해결 (레거시)

> **참고:** 본 프로젝트 API DB는 **PostgreSQL 전용**입니다. 아래는 과거 SQLite 네이티브 모듈 관련 안내입니다.

## 원인

- **better-sqlite3**는 네이티브 모듈이라 사용 중인 Node.js 버전에 맞게 **빌드**되어야 합니다.
- **Node 24**에는 아직 사전 빌드된 바이너리가 없어, 소스에서 빌드하려면 **Python + node-gyp**가 필요합니다.
- Python이 없으면 `gyp ERR! find Python Could not find any Python installation` 오류가 납니다.

---

## 해결 방법 (둘 중 하나 선택)

### 방법 1: Node.js LTS 사용 (권장, 가장 간단)

**Node 24 대신 Node.js LTS(20 또는 22)**를 쓰면 better-sqlite3 사전 빌드가 있어 Python 없이 동작합니다.

1. [https://nodejs.org](https://nodejs.org) 접속
2. **LTS 버전**(20 또는 22) 다운로드 후 설치
3. 기존 Node 24는 설치 프로그램에서 제거하거나, LTS 설치 시 "Replace" 선택
4. 새 터미널에서 프로젝트 폴더로 이동 후:

   ```bash
   cd "D:\AI WEB\SBIM TC WEB"
   cd server
   npm install
   npm rebuild
   cd ..
   npm run dev:all
   ```

이렇게 하면 Python 설치 없이 서버가 실행됩니다.

---

### 방법 2: Python 설치 후 현재 Node 24로 빌드

Node 24를 계속 쓰려면, **Python 3**과 **Visual Studio Build Tools**가 필요합니다.

1. **Python 3** 설치  
   - [https://www.python.org/downloads/](https://www.python.org/downloads/)  
   - 설치 시 **"Add Python to PATH"** 반드시 체크
2. **Visual Studio Build Tools** (C++ 빌드 도구)  
   - [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/)  
   - "C++를 사용한 데스크톱 개발" 워크로드 설치
3. 터미널 **새로 연 뒤** 프로젝트 폴더에서:

   ```bash
   cd "D:\AI WEB\SBIM TC WEB"
   npm run rebuild:server
   npm run dev:all
   ```

---

## 요약

| 상황 | 권장 |
|------|------|
| Python 없고, 빨리 해결하고 싶음 | **Node.js LTS 20 또는 22** 설치 후 `server`에서 `npm install` + `npm rebuild` |
| Node 24를 꼭 써야 함 | **Python 3** + **VS Build Tools** 설치 후 `npm run rebuild:server` |

둘 다 완료 후 `npm run dev:all`로 프론트엔드와 API 서버를 실행하면 됩니다.
