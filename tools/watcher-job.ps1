param(
  [Parameter(Mandatory = $true)][string]$Id,
  [ValidateSet('start', 'done')][string]$Action = 'start'
)
$inbox = Join-Path (Split-Path -Parent $PSScriptRoot) 'inbox'
New-Item -ItemType Directory -Force -Path $inbox | Out-Null
if ($Action -eq 'start') {
  Set-Content -Path (Join-Path $inbox ("WORKING." + $Id)) -Value '1' -Encoding UTF8
  Invoke-RestMethod -Uri 'http://127.0.0.1:8788/api/watcher/beat' -Method POST -ContentType 'application/json' -Body '{"status":"working"}' -TimeoutSec 4 | Out-Null
  Write-Output "working $Id"
} else {
  Set-Content -Path (Join-Path $inbox ("DONE." + $Id)) -Value '1' -Encoding UTF8
  Remove-Item (Join-Path $inbox ("WORKING." + $Id)) -Force -ErrorAction SilentlyContinue
  Invoke-RestMethod -Uri 'http://127.0.0.1:8788/api/watcher/beat' -Method POST -ContentType 'application/json' -Body '{"status":"done"}' -TimeoutSec 4 | Out-Null
  Write-Output "done $Id"
}
