# aict.app 노트북 호스트 감시자 - 앱(3100)과 터널이 죽거나 멈추면 다시 띄운다.
# scripts/start-host.cmd 가 이 파일을 숨김 창으로 실행한다.
# 파일은 UTF-8 BOM으로 저장한다(Windows PowerShell 5.1이 코드 페이지와 무관하게 읽도록).
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root ".data\watchdog.log"
$appPidFile = Join-Path $root ".data\app.pid"

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

# 마지막으로 띄운 앱의 PID와 생성 시각. 응답은 멈췄는데 포트를 계속 잡고 있는 프로세스를 정리하기 위해 기록한다.
# PID는 Windows에서 재사용될 수 있으므로, 실행 시각까지 같을 때만 우리 앱으로 보고 종료한다.
function Get-AppRecord {
  if (-not (Test-Path $appPidFile)) { return $null }
  $lines = @(Get-Content $appPidFile | Where-Object { $_ -ne "" })
  if ($lines.Count -lt 2) { return $null }
  if ($lines[0] -notmatch '^\d+$' -or $lines[1] -notmatch '^-?\d+$') { return $null }
  return [pscustomobject]@{ Pid = [int]$lines[0]; Started = [long]$lines[1] }
}

function Stop-App {
  $rec = Get-AppRecord
  if ($null -eq $rec) {
    Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
    return
  }
  $proc = Get-Process -Id $rec.Pid -ErrorAction SilentlyContinue
  if ($proc) {
    $isOurApp = $false
    try {
      $isOurApp = ($proc.ProcessName -eq "node") -and (($rec.Started -le 0) -or ($proc.StartTime.Ticks -eq $rec.Started))
    } catch {
      $isOurApp = $false
    }
    if ($isOurApp) {
      Write-Log "app pid $($rec.Pid) is unresponsive - stopping it"
      Stop-Process -Id $rec.Pid -Force -ErrorAction SilentlyContinue
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (-not (Get-Process -Id $rec.Pid -ErrorAction SilentlyContinue)) { break }
      }
    } else {
      Write-Log "pid $($rec.Pid) is not our app - leaving it alone"
    }
  }
  Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
}

function Start-App {
  $proc = Start-Process -FilePath "node" `
    -ArgumentList "--import", "./node/install.mjs", "node_modules/next/dist/bin/next", "start", "-p", "3100" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root ".data\app.log") `
    -RedirectStandardError (Join-Path $root ".data\app.err") `
    -PassThru
  if ($proc) {
    $started = 0
    try { $started = $proc.StartTime.Ticks } catch { $started = 0 }
    Set-Content -Path $appPidFile -Value @($proc.Id, $started) -Encoding ascii
  }
}

function Start-Tunnel {
  $tokenPath = Join-Path $root ".data\tunnel-token"
  if (-not (Test-Path $tokenPath)) { return }
  $env:TUNNEL_TOKEN = (Get-Content $tokenPath -Raw).Trim()
  $cf = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
  if (-not $cf) {
    foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
      if (Test-Path $p) { $cf = $p; break }
    }
  }
  if (-not $cf) { Write-Log "cloudflared not found"; return }
  $tunnelLog = Join-Path $root ".data\tunnel.log"
  Start-Process -FilePath $cf `
    -ArgumentList @("tunnel", "--logfile", ('"' + $tunnelLog + '"'), "run") `
    -WorkingDirectory $root -WindowStyle Hidden
}

Write-Log "watchdog start"
while ($true) {
  if (-not (Test-App)) {
    Write-Log "app down - restart"
    Stop-App
    Start-App
    Start-Sleep -Seconds 10
  }
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    Write-Log "tunnel down - restart"
    Start-Tunnel
    Start-Sleep -Seconds 5
  }
  Start-Sleep -Seconds 20
}
