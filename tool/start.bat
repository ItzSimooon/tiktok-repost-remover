@echo off
rem Startet Repost Cleaner (Windows)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte Node.js 18 oder neuer installieren: https://nodejs.org/de
  pause
  exit /b 1
)
if not exist node_modules (
  echo Erster Start - installiere Abhaengigkeiten ...
  call npm install --omit=dev --no-audit --no-fund
)
call npm start
pause
