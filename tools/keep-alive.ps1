# REPOSICION keep-alive: servidor + escuchador + Tunnelmole.
# Horario: activo 08:00-23:59, reposo 00:00-07:59 (puede apagarse).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$serverJson = Join-Path $root 'server.json'
$tunnelLog = Join-Path $root 'tools\_tunnelmole.log'
$keepLog = Join-Path $root 'tools\_keep-alive.log'
$pollSecActive = 90
$pollSecSleep = 300
$wakeHour = 8    # inclusive
$sleepHour = 24  # desde esta hora reposo (00:00-07:59)
$localHealth = 'http://127.0.0.1:8788/api/health'
$script:ModeActive = $null

function Write-Keep([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  try { Add-Content -Path $keepLog -Value $line -Encoding UTF8 } catch {}
}

function Test-ActiveHours {
  $h = (Get-Date).Hour
  return ($h -ge $wakeHour -and $h -lt $sleepHour)
}

function Test-UrlOk([string]$url, [int]$timeoutSec = 8) {
  if (-not $url) { return $false }
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Get-PublishedUrl {
  try {
    $j = Get-Content $serverJson -Raw -ErrorAction Stop | ConvertFrom-Json
    return ([string]$j.url).Trim().TrimEnd('/')
  } catch {
    return ''
  }
}

function Set-PublishedUrl([string]$url) {
  $url = $url.Trim().TrimEnd('/')
  '{"url":"' + $url + '"}' | Set-Content -Path $serverJson -Encoding UTF8 -NoNewline
  $serverTs = Join-Path $root 'src\lib\server.ts'
  if (Test-Path $serverTs) {
    try {
      $txt = Get-Content $serverTs -Raw
      $txt2 = [regex]::Replace(
        $txt,
        "const FALLBACKS = \[[\s\S]*?\]",
        "const FALLBACKS = [`r`n  '$url',`r`n  'http://192.168.1.27:8788',`r`n]"
      )
      if ($txt2 -ne $txt) { Set-Content -Path $serverTs -Value $txt2 -Encoding UTF8 }
    } catch {}
  }
}

function Push-ServerJson([string]$url) {
  try {
    & git -C $root add -- server.json 2>$null | Out-Null
    $st = & git -C $root status --porcelain -- server.json 2>$null
    if (-not $st) {
      Write-Keep "git: server.json sin cambios ($url)"
      return
    }
    & git -C $root commit -m "Update public Tunnelmole URL (keep-alive)." 2>&1 | Out-Null
    & git -C $root push origin master 2>&1 | Out-Null
    Write-Keep "git: push OK -> $url"
  } catch {
    Write-Keep "git push FAIL: $($_.Exception.Message)"
  }
}

function Ensure-Server {
  if (Test-UrlOk $localHealth 5) { return $true }
  Write-Keep 'local health FAIL -> reinicio servidor'
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reposicion[/\\].*server[/\\]index\.mjs' -and $_.CommandLine -match 'node' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-Process -FilePath 'node' -ArgumentList @(Join-Path $root 'server/index.mjs') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  return (Test-UrlOk $localHealth 5)
}

function Ensure-Escuchador {
  $alive = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reposicion\\tools\\escuchar\.ps1' }
  if ($alive) { return }
  Write-Keep 'escuchador ausente -> arranque'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $root 'tools\escuchar.ps1')
  ) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

function Stop-Tunnelmole {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'tunnelmole' -and $_.CommandLine -match '8788' } |
    ForEach-Object {
      Write-Keep "kill tunnelmole pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-TunnelmoleAndWaitUrl {
  $outLog = Join-Path $root 'tools\_tunnelmole.out.log'
  $errLog = Join-Path $root 'tools\_tunnelmole.err.log'
  foreach ($f in @($tunnelLog, $outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep 'arrancando tunnelmole...'
  # npx.cmd + Redirect* (cmd > file a veces no escribe nada en este entorno)
  $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'tunnelmole', '8788') `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog, $tunnelLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.tunnelmole\.net)') {
      $url = 'https://' + $Matches[1]
      try { Set-Content -Path $tunnelLog -Value $raw -Encoding UTF8 } catch {}
      Write-Keep "tunnelmole URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'tunnelmole: no aparecio URL a tiempo'
  return $null
}

function Ensure-PublicTunnel {
  $url = Get-PublishedUrl
  if ($url -and (Test-UrlOk "$url/api/health" 12)) {
    return $true
  }
  Write-Keep "publico FAIL ($url) -> reinicio tunel"
  Stop-Tunnelmole
  Start-Sleep -Seconds 2
  $newUrl = Start-TunnelmoleAndWaitUrl
  if (-not $newUrl) { return $false }
  $ok = $false
  for ($i = 0; $i -lt 10; $i++) {
    if (Test-UrlOk "$newUrl/api/health" 10) { $ok = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) {
    Write-Keep "tunel nuevo no responde health: $newUrl"
    return $false
  }
  $prev = Get-PublishedUrl
  Set-PublishedUrl $newUrl
  if ($prev -ne $newUrl) {
    Push-ServerJson $newUrl
  }
  return $true
}

function Stop-Escuchador {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reposicion\\tools\\escuchar\.ps1' } |
    ForEach-Object {
      Write-Keep "kill escuchador pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-Server {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reposicion[/\\].*server[/\\]index\.mjs' -and $_.CommandLine -match 'node' } |
    ForEach-Object {
      Write-Keep "kill servidor pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Send-WatcherOff {
  try {
    $body = '{"status":"off","pendingCount":0}'
    Invoke-RestMethod -Uri 'http://127.0.0.1:8788/api/watcher/beat' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 4 | Out-Null
  } catch {}
}

function Enter-SleepMode {
  Write-Keep "horario reposo ($sleepHour`:00-$($wakeHour - 1):59) -> apagando"
  Stop-Tunnelmole
  Stop-Escuchador
  Send-WatcherOff
  Stop-Server
}

function Enter-ActiveMode {
  Write-Keep "horario activo ($wakeHour`:00-$($sleepHour - 1):59) -> arranque"
  $null = Ensure-Server
  Ensure-Escuchador
  $null = Ensure-PublicTunnel
}

Write-Keep "=== REPOSICION keep-alive iniciado (activo $wakeHour`:00-$($sleepHour - 1):59) ==="
while ($true) {
  try {
    $active = Test-ActiveHours
    if ($active -and $script:ModeActive -ne $true) {
      Enter-ActiveMode
      $script:ModeActive = $true
    } elseif (-not $active -and $script:ModeActive -ne $false) {
      Enter-SleepMode
      $script:ModeActive = $false
    } elseif ($active) {
      $null = Ensure-Server
      Ensure-Escuchador
      $null = Ensure-PublicTunnel
    }
  } catch {
    Write-Keep "loop error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds ($(if (Test-ActiveHours) { $pollSecActive } else { $pollSecSleep }))
}
