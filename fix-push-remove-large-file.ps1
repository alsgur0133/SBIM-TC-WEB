# GitHub 100MB 제한 때문에 실패한 푸시 수정
# 히스토리에서 대용량 zip 제거 후 한 번에 커밋해서 푸시 가능하게 함
Set-Location $PSScriptRoot

# 1. 현재 main의 파일들로 새 브랜치(히스토리 없음)
git checkout --orphan temp main
git reset

# 2. zip 제외하고 모두 스테이징 (.gitignore에 *.zip 있음)
git add -A
git status --short

# 3. 한 번에 커밋
git commit -m "SBIM TC WEB (large file removed from history)"

# 4. main 삭제 후 temp를 main으로
git branch -D main
git branch -m main

Write-Host "완료. 이제 아래 명령으로 푸시하세요:" -ForegroundColor Green
Write-Host "  git push -u origin main --force" -ForegroundColor Yellow
