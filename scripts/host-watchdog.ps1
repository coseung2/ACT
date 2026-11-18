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

# 감시자는 한 번에 하나만 돈다. 두 개가 함께 돌면 같은 앱을 서로 종료·재시작할 수 있다.
# 뮤텍스는 프로세스가 끝날 때 풀리므로, 잠금을 잡은 채로 계속 둔다.
# Global\ 이름은 다른 세션(비대화형 작업 등)의 감시자까지 막는다. 권한이 없으면 세션 안에서만 막는다.
$lockHeld = $false
foreach ($name in @("Global\act-host-watchdog", "act-host-watchdog")) {
  try {
    $mutex = New-Object System.Threading.Mutex($false, $name)
  } catch {
    continue
  }
  try {
    $lockHeld = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $lockHeld = $true
  }
  break
}
if (-not $lockHeld) {
  Write-Log "another watchdog is already running - exit"
  exit 0
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

# 해당 PID가 3100 포트를 잡고 있는지. 시작 시각을 못 읽은 기록을 판별할 때 쓴다.
# 조회 자체가 실패하면 $null(알 수 없음)을 돌려준다 - "소유하지 않음"과 구분해야 한다.
function Test-AppOnPort($procId) {
  try {
    $conns = @(Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction Stop)
  } catch {
    return $null
  }
  foreach ($c in $conns) {
    if ([int]$c.OwningProcess -eq [int]$procId) { return $true }
  }
  return $false
}

# 포트를 계속 잡고 있는 우리 앱을 종료한다.
# 시작해도 되는 상태(종료했거나 애초에 우리 앱이 아님)면 $true, 아직 살아 있으면 $false를 돌려준다.
function Stop-App {
  $rec = Get-AppRecord
  if ($null -eq $rec) {
    Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
    return $true
  }
  $proc = Get-Process -Id $rec.Pid -ErrorAction SilentlyContinue
  if (-not $proc) {
    Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
    return $true
  }
  # 생성 시각을 확인할 수 없으면 시간 비교를 생략하지 않는다. 대신 포트 소유 여부로 우리 앱인지 확인한다.
  $isOurApp = $false
  $identityUnknown = $false
  try {
    if ($proc.ProcessName -ne "node") {
      $isOurApp = $false
    } elseif (($rec.Started -gt 0) -and ($proc.StartTime.Ticks -eq $rec.Started)) {
      $isOurApp = $true
    } elseif ($rec.Started -le 0) {
      $onPort = Test-AppOnPort $rec.Pid
      if ($null -eq $onPort) { $identityUnknown = $true } else { $isOurApp = [bool]$onPort }
    }
  } catch {
    $isOurApp = $false
  }
  if ($identityUnknown) {
    # 포트 조회가 실패하면 종료 여부를 판단할 수 없다. 기록을 남겨 두고 다음 주기에 다시 본다.
    Write-Log "could not check port 3100 for pid $($rec.Pid) - will retry"
    return $false
  }
  if (-not $isOurApp) {
    Write-Log "pid $($rec.Pid) is not our app - leaving it alone"
    Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
    return $true
  }
  Write-Log "app pid $($rec.Pid) is unresponsive - stopping it"
  Stop-Process -Id $rec.Pid -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $rec.Pid -ErrorAction SilentlyContinue)) { break }
  }
  if (Get-Process -Id $rec.Pid -ErrorAction SilentlyContinue) {
    # 권한 문제 등으로 종료하지 못했다. 기록을 남겨 두고 다음 주기에 다시 시도한다.
    Write-Log "could not stop pid $($rec.Pid) - will retry"
    return $false
  }
  Remove-Item $appPidFile -Force -ErrorAction SilentlyContinue
  return $true
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
    if (Stop-App) {
      Start-App
    } else {
      Write-Log "port 3100 is still held - skip restart"
    }
    Start-Sleep -Seconds 10
  }
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    Write-Log "tunnel down - restart"
    Start-Tunnel
    Start-Sleep -Seconds 5
  }
  Start-Sleep -Seconds 20
}
