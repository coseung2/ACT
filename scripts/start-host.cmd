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

REM 토큰은 명령줄이 아니라 환경변수로 넘긴다(cloudflared가 TUNNEL_TOKEN을 읽는다).
for /f "usebackq delims=" %%t in (".data\tunnel-token") do set "TUNNEL_TOKEN=%%t"
start "act-tunnel" /min cmd /c "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" tunnel run >> .data\tunnel.log 2>&1"
exit /b 0
