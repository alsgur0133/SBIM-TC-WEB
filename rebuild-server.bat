@echo off
cd /d "%~dp0"
echo Rebuilding server (better-sqlite3 for current Node.js)...
call npm run rebuild:server
if errorlevel 1 (
  echo Failed. Trying direct commands...
  cd server
  call npm install
  call npm rebuild
  cd ..
)
echo Done. You can now run: npm run dev:all
pause
