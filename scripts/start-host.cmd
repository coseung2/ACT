@echo off
REM 노트북에서 aict.app을 띄운다. 감시자(host-watchdog.ps1)가 앱과 터널을 계속 살려 둔다.
REM 시작 프로그램 폴더의 런처가 이 파일을 부른다. 이 파일은 UTF-8(한글 메시지용).
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

if not exist ".data\act.db" (
  echo [host] .data\act.db 가 없습니다. 먼저 npm run db:import 를 실행하세요.
  exit /b 1
)

REM 감시자 경로는 환경 변수로 넘긴다. 작은따옴표나 공백이 있는 경로도 PowerShell 문자열이 깨지지 않는다.
REM -File 인수는 자식 명령줄에서 큰따옴표로 감싼다(공백 경로 대비). 감시자는 이 셸과 분리된다.
set "ACT_WATCHDOG=%~dp0host-watchdog.ps1"
powershell -NoProfile -WindowStyle Hidden -Command "$p = $env:ACT_WATCHDOG; Start-Process powershell -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File \"' + $p + '\"') -WindowStyle Hidden"

exit /b 0
