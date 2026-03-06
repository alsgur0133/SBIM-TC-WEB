# PATH 새로고침 (Node.js가 설치 후 터미널을 열었을 때 인식되도록)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$env:Path = "$machinePath;$userPath"

Set-Location $PSScriptRoot

# npm.cmd 사용 (PowerShell 실행 정책 오류 방지)
$npm = $null
if (Test-Path "D:\nodejs\npm.cmd") { $npm = "D:\nodejs\npm.cmd" }
elseif (Test-Path "C:\Program Files\nodejs\npm.cmd") { $npm = "C:\Program Files\nodejs\npm.cmd" }
elseif (Test-Path "${env:ProgramFiles(x86)}\nodejs\npm.cmd") { $npm = "${env:ProgramFiles(x86)}\nodejs\npm.cmd" }
elseif (Test-Path "$env:APPDATA\nvm\*\npm.cmd") { $npm = (Get-Item "$env:APPDATA\nvm\*\npm.cmd").FullName }
elseif (Test-Path "$env:LOCALAPPDATA\Programs\node\npm.cmd") { $npm = "$env:LOCALAPPDATA\Programs\node\npm.cmd" }
else { $npm = "npm.cmd" }

if (-not $npm) {
    Write-Host "Node.js/npm을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "1) Node.js 설치: https://nodejs.org 에서 LTS 버전 설치" -ForegroundColor Yellow
    Write-Host "2) 설치 후 Cursor를 완전히 종료했다가 다시 열고 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
    exit 1
}

Write-Host "npm 사용: $npm" -ForegroundColor Green
Write-Host "의존성 설치 중..." -ForegroundColor Cyan
& $npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "프론트엔드 + 백엔드 실행 중..." -ForegroundColor Cyan
& $npm run dev:all
