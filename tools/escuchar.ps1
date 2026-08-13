$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$inbox = Join-Path $root 'inbox'
$pending = Join-Path $inbox 'PENDING.json'
$dispatch = Join-Path $PSScriptRoot 'dispatch-report.mjs'
New-Item -ItemType Directory -Force -Path $inbox | Out-Null
if (-not $env:CURSOR_API_KEY) {
  foreach ($kf in @(
    (Join-Path $PSScriptRoot '.cursor_api_key'),
    (Join-Path $root '.env.local')
  )) {
    if (-not (Test-Path $kf)) { continue }
    if ($kf -like '*.env.local') {
      $line = Select-String -Path $kf -Pattern '^\s*CURSOR_API_KEY\s*=\s*(.+)\s*$' | Select-Object -First 1
      if ($line) {
        $env:CURSOR_API_KEY = ($line.Matches[0].Groups[1].Value -replace '^["'']|["'']$', '').Trim()
      }
    } else {
      $env:CURSOR_API_KEY = (Get-Content -Raw $kf).Trim()
    }
    if ($env:CURSOR_API_KEY) { break }
  }
}

Write-Host "REPOSICION ESCUCHADOR → cola real + despacho"
if ($env:CURSOR_API_KEY) { Write-Host "CURSOR_API_KEY: OK" } else { Write-Host "CURSOR_API_KEY: FALTA" }

function Send-Beat([string]$status = '', [int]$count = -1) {
  try {
    $payload = @{}
    if ($status) { $payload.status = $status }
    if ($count -ge 0) { $payload.pendingCount = $count }
    $body = if ($payload.Count -gt 0) { ($payload | ConvertTo-Json -Compress) } else { '{}' }
    Invoke-RestMethod -Uri 'http://127.0.0.1:8788/api/watcher/beat' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 4 | Out-Null
  } catch {}
}

function Test-DispatchBusy {
  $busyFile = Test-Path (Join-Path $inbox 'BUSY.lock')
  if ($busyFile) { return $true }
  $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reposicion\\reposicion\\tools\\dispatch-report\.mjs|reposicion\\tools\\dispatch-report\.mjs' }
  return [bool]$proc
}

# Latido siempre: si no hay beat >20s el server pone luz apagada.
# (Antes Send-BeatStable omitía latidos iguales y la luz se apagaba sola.)
function Send-BeatStable([string]$status, [int]$count) {
  Send-Beat $status $count
}

function Show-Toast([string]$title, [string]$message) {
  try {
    $t = ($title -replace "'", "''")
    if ($t.Length -gt 80) { $t = $t.Substring(0, 80) }
    $m = ($message -replace "'", "''")
    if ($m.Length -gt 180) { $m = $m.Substring(0, 180) }
    $script = @"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
`$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
`$texts = `$xml.GetElementsByTagName('text')
`$texts.Item(0).AppendChild(`$xml.CreateTextNode('$t')) | Out-Null
`$texts.Item(1).AppendChild(`$xml.CreateTextNode('$m')) | Out-Null
`$toast = [Windows.UI.Notifications.ToastNotification]::new(`$xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('REPOSICION').Show(`$toast)
"@
    Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command', $script) -WindowStyle Hidden | Out-Null
  } catch {}
}

function Get-ReportBody([string]$raw) {
  if (-not $raw) { return '' }
  $lines = $raw -split "`r?`n"
  $body = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    $t = $line.Trim()
    if (-not $t) { continue }
    if ($t.StartsWith('#')) { continue }
    if ($t.StartsWith('- fecha:') -or $t.StartsWith('- pantalla:') -or $t.StartsWith('- orden:') -or $t.StartsWith('- version:')) { continue }
    [void]$body.Add($t)
  }
  return (($body -join ' ') -replace '\s+', ' ').Trim().ToLowerInvariant()
}

function Read-Pending {
  if (-not (Test-Path $pending)) { return @() }
  try {
    $raw = (Get-Content $pending -Raw -ErrorAction Stop).Trim()
    if (-not $raw -or $raw -eq 'null') { return @() }
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { return @() }
    if ($j -is [System.Array]) { return @($j) }
    return @($j)
  } catch { return @() }
}

function Write-Pending([object[]]$items) {
  if (-not $items -or $items.Count -eq 0) {
    Set-Content -Path $pending -Value '[]' -Encoding UTF8
    return
  }
  ($items | ConvertTo-Json -Depth 4 -Compress) | Set-Content -Path $pending -Encoding UTF8
}

function New-ItemFromFile([System.IO.FileInfo]$file) {
  $id = [IO.Path]::GetFileNameWithoutExtension($file.Name)
  $raw = ''
  try { $raw = Get-Content $file.FullName -Raw -ErrorAction Stop } catch {}
  $text = if ($raw) { $raw.Substring(0, [Math]::Min(500, $raw.Length)) } else { '' }
  $fp = Get-ReportBody $raw
  return [pscustomobject]@{
    id       = $id
    file     = $file.Name
    at       = (Get-Date).ToString('o')
    text     = $text
    fp       = $fp
    working  = $false
    launched = $false
  }
}

$seen = @{}
$seenFp = @{}
$items = @()
Get-ChildItem $inbox -Filter '*-*.md' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | ForEach-Object {
  $id = $_.BaseName
  $done = Join-Path $inbox ('DONE.' + $id)
  if ($_.Name -notmatch '-tomas\.md$') {
    if (-not (Test-Path $done)) { Set-Content -Path $done -Value 'log-only' -Encoding UTF8 }
    $seen[$_.Name] = $true
    Write-Host "=== LOG SOLO $($_.Name) (no Tomás) ==="
    return
  }
  if (Test-Path $done) {
    $seen[$_.Name] = $true
    return
  }
  $it = New-ItemFromFile $_
  $seen[$_.Name] = $true
  if ($it.fp -and $seenFp.ContainsKey($it.fp)) {
    # Duplicado del mismo pedido → marcar DONE y no encolar
    Set-Content -Path $done -Value 'dup' -Encoding UTF8
    Write-Host "=== DUP IGNORADO $($_.Name) ==="
    return
  }
  if ($it.fp) { $seenFp[$it.fp] = $true }
  $items += $it
  Write-Host "=== RECUPERADO $($_.Name) ==="
}
Write-Pending $items
$wait0 = @($items | Where-Object { -not $_.working }).Count
Send-Beat 'online' $wait0

while ($true) {
  $items = @(Read-Pending | Where-Object { $_ -and $_.id })

  Get-ChildItem $inbox -Filter '*-*.md' -ErrorAction SilentlyContinue | ForEach-Object {
    $name = $_.Name
    if ($seen.ContainsKey($name)) { return }
    $seen[$name] = $true
    $id = [IO.Path]::GetFileNameWithoutExtension($name)
    if ($name -notmatch '-tomas\.md$') {
      if (-not (Test-Path (Join-Path $inbox ('DONE.' + $id)))) {
        Set-Content -Path (Join-Path $inbox ('DONE.' + $id)) -Value 'log-only' -Encoding UTF8
      }
      Write-Host "=== LOG SOLO $name (no Tomás) ==="
      return
    }
    if (Test-Path (Join-Path $inbox ('DONE.' + $id))) { return }
    if ($items | Where-Object { $_.id -eq $id }) { return }
    $it = New-ItemFromFile $_
    if ($it.fp -and ($seenFp.ContainsKey($it.fp) -or ($items | Where-Object { $_.fp -eq $it.fp }))) {
      Set-Content -Path (Join-Path $inbox ('DONE.' + $id)) -Value 'dup' -Encoding UTF8
      Write-Host "=== DUP IGNORADO $name ==="
      return
    }
    if ($it.fp) { $seenFp[$it.fp] = $true }
    $items += $it
    Write-Host ""
    Write-Host "=== PENDIENTE $name $(Get-Date -Format HH:mm:ss) ==="
    Write-Host $it.text
    Show-Toast 'REPOSICION · pendiente' $it.text
  }

  $still = @()
  $now = Get-Date
  $anyWorking = $false
  $busy = Test-DispatchBusy

  foreach ($it in $items) {
    if (-not $it.fp -and $it.text) { $it | Add-Member -NotePropertyName fp -NotePropertyValue (Get-ReportBody $it.text) -Force }
    $done = Join-Path $inbox ('DONE.' + $it.id)
    $work = Join-Path $inbox ('WORKING.' + $it.id)
    $retry = Join-Path $inbox ('RETRY.' + $it.id)
    if (Test-Path $done) {
      Write-Host "=== HECHO $($it.id) ==="
      # Mantener DONE.* para siempre: si se borra, al reiniciar el .md vuelve a encolarse.
      Remove-Item $work -Force -ErrorAction SilentlyContinue
      Remove-Item $retry -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $inbox 'BUSY.lock') -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $inbox 'AGENT_WAKE.json') -Force -ErrorAction SilentlyContinue
      continue
    }
    # Fallo del despacho (cupo/red/timeout): no rebotar; reencolar con espera.
    if (Test-Path $retry) {
      $why = ''
      try { $why = (Get-Content $retry -Raw -ErrorAction SilentlyContinue) } catch {}
      Write-Host "=== REINTENTO $($it.id) ==="
      if ($why) { Write-Host ($why.Substring(0, [Math]::Min(180, $why.Length))) }
      Remove-Item $retry -Force -ErrorAction SilentlyContinue
      Remove-Item $work -Force -ErrorAction SilentlyContinue
      $busyLock = Join-Path $inbox 'BUSY.lock'
      if ((Test-Path $busyLock) -and ((Get-Content $busyLock -Raw -ErrorAction SilentlyContinue).Trim() -eq $it.id)) {
        Remove-Item $busyLock -Force -ErrorAction SilentlyContinue
      }
      Remove-Item (Join-Path $inbox 'AGENT_WAKE.json') -Force -ErrorAction SilentlyContinue
      $it.working = $false
      $it.launched = $false
      $it | Add-Member -NotePropertyName at -NotePropertyValue (Get-Date).ToString('o') -Force
      # Esperar 45s antes de volver a despachar (cupo/red).
      Set-Content -Path (Join-Path $inbox ('NEXT.' + $it.id)) -Value ((Get-Date).AddSeconds(45).ToString('o')) -Encoding UTF8
      $busy = Test-DispatchBusy
    }
    $nextFile = Join-Path $inbox ('NEXT.' + $it.id)
    if (Test-Path $nextFile) {
      $nextAt = $null
      try { $nextAt = [DateTime]::Parse((Get-Content $nextFile -Raw).Trim()) } catch {}
      if ($nextAt -and $now -lt $nextAt) {
        $still += $it
        continue
      }
      Remove-Item $nextFile -Force -ErrorAction SilentlyContinue
    }
    # Working huérfano: PENDING dice working pero no hay WORKING ni proceso.
    if (($it.working -or $it.launched) -and -not (Test-Path $work) -and -not $busy) {
      Write-Host "=== RECUPERA HUERFANO $($it.id) ==="
      $it.working = $false
      $it.launched = $false
      $it | Add-Member -NotePropertyName at -NotePropertyValue (Get-Date).ToString('o') -Force
    }
    if (Test-Path $work) {
      if (-not $it.working) { $it.working = $true }
      $anyWorking = $true
    }

    if (-not $it.working -and -not $anyWorking -and -not $busy -and -not $it.launched) {
      $it.launched = $true
      $it.working = $true
      $anyWorking = $true
      $busy = $true
      Set-Content -Path $work -Value '1' -Encoding UTF8
      Set-Content -Path (Join-Path $inbox 'BUSY.lock') -Value $it.id -Encoding UTF8
      $wake = @{ id = $it.id; file = $it.file; at = (Get-Date).ToString('o'); text = $it.text } | ConvertTo-Json -Compress
      Set-Content -Path (Join-Path $inbox 'AGENT_WAKE.json') -Value $wake -Encoding UTF8
      $waitNow = @($items | Where-Object { $_.id -ne $it.id -and -not $_.working }).Count
      Write-Host "=== TRABAJANDO $($it.id) (pendientes=$waitNow) ==="
      Show-Toast 'REPOSICION · trabajando' ($it.text.Substring(0, [Math]::Min(120, $it.text.Length)))
      Send-BeatStable 'working' $waitNow

      $hasKey = [bool]$env:CURSOR_API_KEY
      if ($hasKey -and (Test-Path $dispatch)) {
        Write-Host "=== DESPACHO SDK $($it.id) ==="
        Start-Process -FilePath 'node' -ArgumentList @($dispatch, $it.id) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
      } else {
        Write-Host "=== ESPERA AGENTE $($it.id) ==="
      }
    }

    $started = $null
    try { $started = [DateTime]::Parse($it.at) } catch {}
    if ($started -and ($now - $started).TotalMinutes -ge 30 -and -not $it.working) {
      Write-Host "=== TIMEOUT pendiente $($it.id) ==="
      continue
    }
    if ($it.working -and $started -and ($now - $started).TotalMinutes -ge 15) {
      Write-Host "=== TRABADO/TIMEOUT $($it.id) ==="
      $waitStuck = @($items | Where-Object { $_.id -ne $it.id -and -not $_.working }).Count
      Send-BeatStable 'stuck' $waitStuck
      Show-Toast 'REPOSICION · trabado' "Lleva demasiado: $($it.id)"
      Set-Content -Path $done -Value 'timeout 15m' -Encoding UTF8
      Remove-Item $work -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $inbox 'BUSY.lock') -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path $inbox 'AGENT_WAKE.json') -Force -ErrorAction SilentlyContinue
      continue
    }
    $still += $it
  }

  Write-Pending $still

  $waitCount = @($still | Where-Object { -not $_.working }).Count
  $stillBusy = Test-DispatchBusy
  if ($anyWorking -or $stillBusy) { Send-BeatStable 'working' $waitCount }
  else { Send-BeatStable 'online' $waitCount }

  Start-Sleep -Seconds 3
}
