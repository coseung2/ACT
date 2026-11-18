# aict.app 노트북 호스트 감시자 — 앱(3100)과 터널이 죽으면 다시 띄운다.
# scripts/start-host.cmd 가 이 파일을 숨김 창으로 실행한다.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root ".data\watchdog.log"

function Write-Log($message) {
  "$(Get-Date -Format s) $message" | Out-File -Append -Encoding utf8 $log
}

function Test-App {
  try {
    $res = Invoke-WebRequest "http://127.0.0.1:3100/robots.txt" -TimeoutSec 5 -UseBasicParsing
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-App {
  Start-Process -FilePath "node" `
    -ArgumentList "--import", "./node/install.mjs", "node_modules/next/dist/bin/next", "start", "-p", "3100" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root ".data\app.log") `
    -RedirectStandardError (Join-Path $root ".data\app.err")
}

function Start-Tunnel {
  $tokenPath = Join-Path $root ".data\tunnel-token"
  if (-not (Test-Path $tokenPath)) { return }
  $env:TUNNEL_TOKEN = (Get-Content $tokenPath -Raw).Trim()
  $cf = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
  if (-not $cf) {
    foreach ($p in @("$env:ProgramFiles(x86)\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
      if (Test-Path $p) { $cf = $p; break }
    }
  }
  if (-not $cf) { Write-Log "cloudflared 없음"; return }
  Start-Process -FilePath $cf -ArgumentList "tunnel", "run" -WindowStyle Hidden
}

Write-Log "watchdog start"
while ($true) {
  if (-not (Test-App)) {
    Write-Log "app down — restart"
    Start-App
    Start-Sleep -Seconds 10
  }
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    Write-Log "tunnel down — restart"
    Start-Tunnel
    Start-Sleep -Seconds 5
  }
  Start-Sleep -Seconds 20
}
