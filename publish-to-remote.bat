@echo off
cd /d "%~dp0"
echo [1/3] 변경사항 스테이징 및 커밋...
git add -A
git commit -m "게시: 최신 변경사항 반영"
if errorlevel 1 (
  echo 커밋할 변경 없음 또는 이미 커밋됨.
) else (
  echo 커밋 완료.
)

set REMOTE=
if not "%~1"=="" set REMOTE=%~1
if "%REMOTE%"=="" (
  git remote get-url origin 2>nul
  if errorlevel 1 (
    echo.
    echo 원격 저장소가 없습니다. 아래처럼 URL을 인자로 넣어 실행하세요.
    echo   publish-to-remote.bat "https://github.com/계정/저장소.git"
    echo   publish-to-remote.bat "https://dev.azure.com/조직/프로젝트/_git/리포이름"
    pause
    exit /b 1
  )
) else (
  git remote remove origin 2>nul
  git remote add origin "%REMOTE%"
  echo [2/3] 원격 설정: %REMOTE%
)

echo [3/3] 푸시 중...
git push -u origin main
if errorlevel 1 (
  echo 푸시 실패. GitHub/Azure에서 저장소를 먼저 만든 뒤 URL을 넣어 실행하세요.
  pause
  exit /b 1
)
echo 게시 완료.
pause
