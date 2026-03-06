@echo off
cd /d "%~dp0"
echo [1/5] main으로 이동 후 temp 브랜치 정리...
git checkout main 2>nul
git branch -D temp 2>nul
echo [2/5] zip 없이 새 히스토리 만드는 중...
git checkout --orphan temp main
git reset

echo [3/5] 파일 스테이징 (.gitignore에 *.zip 있음)
git add -A

echo [4/5] 커밋
git commit -m "SBIM TC WEB (large file removed from history)"

echo [5/5] main 브랜치 교체
git branch -D main
git branch -m main

echo.
echo 완료. 아래 명령으로 푸시하세요:
echo   git push -u origin main --force
pause
