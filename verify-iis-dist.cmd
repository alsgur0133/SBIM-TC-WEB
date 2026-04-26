@echo off
REM Run ON THE IIS SERVER after deploy. No IIS — only Node + same env as iisnode cwd.
REM If this exits immediately, fix DATABASE_URL / PostgreSQL before retesting IIS.
setlocal
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
if exist "%HERE%\server\index.js" (
  cd /d "%HERE%\server"
) else if exist "%HERE%\..\server\index.js" (
  cd /d "%HERE%\..\server"
) else if exist "%HERE%\dist\server\index.js" (
  cd /d "%HERE%\dist\server"
) else (
  echo ERROR: server\index.js not found. Put this .cmd next to web.config under publish-iis\dist (IIS physical path).
  pause
  exit /b 1
)
if not exist "index.js" (
  echo ERROR: Missing index.js in %CD%
  pause
  exit /b 1
)
echo Current directory: %CD%
REM Do not put nested quotes in the echo line above: cmd.exe can misparse and run a stray one-letter command.
echo Starting node index.js ... Expect DB init OK and Server running in the output below.
echo.
set NODE_ENV=production
node index.js
echo.
echo Process ended with exit code %ERRORLEVEL%
pause
