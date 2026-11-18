@echo off
REM 노트북에서 aict.app을 띄운다(앱 + Cloudflare Tunnel). 시작 프로그램 폴더의 런처가 이 파일을 부른다.
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

REM cloudflared 위치: PATH → Program Files(x86) → Program Files
set "CF="
for %%p in (cloudflared.exe) do if not defined CF set "CF=%%~$PATH:p"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF (
  echo [host] cloudflared를 찾지 못했습니다. winget install Cloudflare.cloudflared 로 설치하세요.
  exit /b 0
)

REM 경로에 공백이 있어 cmd의 start로는 인용이 깨진다 — PowerShell로 띄운다(토큰·경로는 환경변수로).
powershell -NoProfile -WindowStyle Hidden -Command "$env:TUNNEL_TOKEN = (Get-Content '.data\tunnel-token' -Raw).Trim(); Start-Process -FilePath $env:CF -ArgumentList 'tunnel','run' -WindowStyle Hidden"

exit /b 0
