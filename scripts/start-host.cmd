@echo off
REM 노트북에서 aict.app을 띄운다. 감시자(host-watchdog.ps1)가 앱과 터널을 계속 살려 둔다.
REM 시작 프로그램 폴더의 런처가 이 파일을 부른다.
setlocal
cd /d "%~dp0.."

if not exist ".data\act.db" (
  echo [host] .data\act.db 가 없습니다. 먼저 npm run db:import 를 실행하세요.
  exit /b 1
)

REM cmd의 start는 인용이 깨지기 쉬워 PowerShell로 숨김 실행한다(감시자는 이 세션과 분리된다).
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0host-watchdog.ps1' -WindowStyle Hidden"

exit /b 0
