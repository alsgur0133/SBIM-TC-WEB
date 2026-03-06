@echo off
chcp 65001 >nul
cd /d "%~dp0"

git checkout main 2>nul
git branch -D temp 2>nul
git checkout --orphan temp main
git reset
git add -A
git commit -m "SBIM TC WEB (large file removed from history)"
git branch -D main
git branch -m main

echo Done. Run: git push -u origin main --force
