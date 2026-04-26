@echo off

cd /d "%~dp0"

echo IIS publish: deploy:iis (Trimble dev 앱 값 자동 적용 + publish-iis 준비)

call npm run deploy:iis

if errorlevel 1 ( echo deploy:iis failed. & pause & exit /b 1 )

echo.

echo Publish output: %~dp0publish-iis  ^(IIS site physical path = this folder, NOT dist only^)

echo Copy publish-iis folder to your server, point IIS to ...\publish-iis — see IIS-SETUP.txt

echo.

pause

