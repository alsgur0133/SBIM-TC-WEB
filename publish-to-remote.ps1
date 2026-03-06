# 비주얼 스튜디오 / GitHub / Azure DevOps 원격 저장소에 게시
# 사용법: .\publish-to-remote.ps1
# 또는 URL 지정: .\publish-to-remote.ps1 -RepoUrl "https://github.com/계정/저장소.git"

param(
    [string]$RepoUrl = ""
)

Set-Location $PSScriptRoot

# 1. 변경사항 스테이징 및 커밋
Write-Host "[1/3] 변경사항 스테이징..." -ForegroundColor Cyan
git add -A
$status = git status --short
if (-not $status) {
    Write-Host "커밋할 변경사항이 없습니다." -ForegroundColor Yellow
} else {
    git commit -m "게시: 최신 변경사항 반영"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "커밋 완료." -ForegroundColor Green
}

# 2. 원격 저장소 확인/설정
$remote = git remote get-url origin 2>$null
if ($RepoUrl) {
    if ($remote) { git remote set-url origin $RepoUrl } else { git remote add origin $RepoUrl }
    $remote = $RepoUrl
    Write-Host "[2/3] 원격 저장소 설정: $remote" -ForegroundColor Green
} elseif ($remote) {
    Write-Host "[2/3] 원격 저장소: $remote" -ForegroundColor Green
} else {
    Write-Host "원격 저장소가 없습니다." -ForegroundColor Red
    Write-Host "사용법: .\publish-to-remote.ps1 -RepoUrl `"https://github.com/계정/저장소이름.git`"" -ForegroundColor Yellow
    Write-Host "또는 Azure: .\publish-to-remote.ps1 -RepoUrl `"https://dev.azure.com/조직/프로젝트/_git/리포이름`"" -ForegroundColor Yellow
    exit 1
}

# 3. 푸시
Write-Host "[3/3] 푸시 중..." -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "푸시 실패. 위 오류를 확인하세요." -ForegroundColor Red
    exit 1
}
Write-Host "게시 완료. 비주얼 스튜디오에서 위 원격 URL로 클론하면 됩니다." -ForegroundColor Green
