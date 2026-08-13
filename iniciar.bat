@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Compilando REPOSICION...
  call npm run build
)
set PORT=8788
start "REPOSICION servidor" /min cmd /c "set PORT=8788&& node server\index.mjs"
timeout /t 2 /nobreak >nul
start "REPOSICION escuchador" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tools\escuchar.ps1
timeout /t 1 /nobreak >nul
REM keep-alive: health local+publico, reinicia Tunnelmole y pushea server.json
start "REPOSICION keep-alive" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tools\keep-alive.ps1
echo REPOSICION arriba. Keep-alive: activo 8-24h, reposo 0-8h. Puerto 8788 (aislado de ONCE).
exit /b 0
