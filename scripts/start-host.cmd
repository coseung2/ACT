@echo off
REM 노트북에서 aict.app을 띄운다(앱 + Cloudflare Tunnel). 작업 스케줄러 "로그온할 때"에 등록해 쓴다.
setlocal
cd /d "%~dp0.."

if not exist ".data\act.db" (
  echo [host] .data\act.db 가 없습니다. 먼저 npm run db:import 를 실행하세요.
  exit /b 1
)

start "act-app" /min cmd /c "node --import ./node/install.mjs node_modules\next\dist\bin\next start -p 3100 >> .data\app.log 2>&1"

if not exist ".data\tunnel-token" (
  echo [host] .data\tunnel-token 이 없습니다. 터널은 건너뜁니다.
  exit /b 0
)

REM 경로에 공백이 있어 cmd의 start로는 인용이 깨진다 — PowerShell로 띄운다(토큰은 환경변수로).
powershell -NoProfile -WindowStyle Hidden -Command "$env:TUNNEL_TOKEN = (Get-Content '.data\tunnel-token' -Raw).Trim(); Start-Process -FilePath 'C:\Program Files (x86)\cloudflared\cloudflared.exe' -ArgumentList 'tunnel','run' -WindowStyle Hidden"

exit /b 0
