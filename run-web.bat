@echo off
cd /d "%~dp0"
set "NPM=D:\nodejs\npm.cmd"
if not exist "%NPM%" set "NPM=npm.cmd"
echo Installing dependencies...
call "%NPM%" install
if errorlevel 1 exit /b 1
echo.
echo Starting frontend and backend...
call "%NPM%" run dev:all
