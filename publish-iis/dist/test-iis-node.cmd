@echo off
REM ASCII only: UTF-8 Korean breaks under cmd.exe on some Windows locales.
setlocal
echo ========================================
echo  SBIM TC WEB - Node test (no IIS)
echo ========================================
echo.
where node 2>nul
if errorlevel 1 (
  echo ERROR: node.exe not found. Install Node.js LTS.
  pause
  exit /b 1
)
node -v
echo.
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
if exist "%HERE%\server\index.js" (
  cd /d "%HERE%\server"
) else if exist "%HERE%\..\server\index.js" (
  cd /d "%HERE%\..\server"
) else if exist "%HERE%\dist\server\index.js" (
  cd /d "%HERE%\dist\server"
) else (
  echo ERROR: server\index.js not found.
  echo Put this .cmd next to web.config under publish-iis, or inside publish-iis\dist, then run again.
  pause
  exit /b 1
)
echo Current dir: %CD%
echo If server stays running, Node and DATABASE_URL are OK. If 500 in IIS only, check iisnode.
echo If it exits at once, set DATABASE_URL in publish-iis\.env or publish-iis\dist\.env (uncommented line).
echo Also see: server\startup.log or %%TEMP%%\sbim-tc-web-boot.log
echo.
set NODE_ENV=production
node index.js
echo.
echo Process ended.
pause
