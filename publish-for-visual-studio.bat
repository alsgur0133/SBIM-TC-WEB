@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PUBLISH_DIR=%~dp0bin\publish
echo Building frontend...
call npm run build
if errorlevel 1 exit /b 1
echo Copying server and dist to %PUBLISH_DIR%...
if not exist "%PUBLISH_DIR%" mkdir "%PUBLISH_DIR%"
xcopy /E /I /Y dist "%PUBLISH_DIR%\dist" >nul
xcopy /E /I /Y server "%PUBLISH_DIR%\server" >nul
copy /Y package.json "%PUBLISH_DIR%\" >nul
echo Publish complete: %PUBLISH_DIR%
pause
