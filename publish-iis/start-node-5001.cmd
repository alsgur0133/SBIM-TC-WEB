@echo off
REM IIS ARR mode: run this on the server, next to web.config under publish-iis\dist.
REM Keep this window open, or run the same app with pm2/nssm as a service.
setlocal
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"

if exist "%HERE%\server\index.js" (
  cd /d "%HERE%\server"
) else if exist "%HERE%\dist\server\index.js" (
  cd /d "%HERE%\dist\server"
) else (
  echo ERROR: server\index.js not found.
  echo Put this file in publish-iis\dist, next to web.config.
  pause
  exit /b 1
)

echo ========================================
echo  SBIM TC WEB - Node 5001 for IIS ARR
echo ========================================
echo Current dir: %CD%
echo URL: http://127.0.0.1:5001/bracetc/
echo.

set NODE_ENV=production
set PORT=5001
set TRUST_PROXY=1

node index.js
echo.
echo Process ended with exit code %ERRORLEVEL%
pause
