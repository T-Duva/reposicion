# Arranque diario 09:00 (Task Scheduler). Idempotente.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root 'tools\_wake-at-7.log'

function Log([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch {}
}

function Test-UrlOk([string]$url) {
  if (-not $url) { return $false }
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
  } catch { return $false }
}

Log '=== wake-at-7 ==='

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Log 'build ausente -> npm run build'
  & npm run build 2>&1 | Out-Null
}

$serverAlive = Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server[/\\]index\.mjs' -and $_.CommandLine -match 'node' }
if (-not (Test-UrlOk 'http://127.0.0.1:8788/api/health')) {
  if ($serverAlive) {
    $serverAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Start-Sleep -Seconds 1
  }
  Log 'arranque servidor'
  Start-Process -FilePath 'node' -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
}

$esc = Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -match 'reposicion\\tools\\escuchar\.ps1|tools\\escuchar\.ps1' }
if (-not $esc) {
  Log 'arranque escuchador'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $root 'tools\escuchar.ps1')
  ) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

$ka = Get-CimInstance Win32_Process -EA SilentlyContinue |
  Where-Object { $_.CommandLine -match 'keep-alive\.ps1' }
if (-not $ka) {
  Log 'arranque keep-alive'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $root 'tools\keep-alive.ps1')
  ) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

Log 'listo'
