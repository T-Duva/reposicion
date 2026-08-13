# Instala tarea diaria 08:00 para despertar REPOSICION.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$wake = Join-Path $root 'tools\wake-at-7.ps1'
$taskName = 'REPOSICION Wake 8am'
$oldTask = 'REPOSICION Wake 7am'

if (-not (Test-Path $wake)) { throw "Falta $wake" }

Unregister-ScheduledTask -TaskName $oldTask -Confirm:$false -ErrorAction SilentlyContinue

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wake`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Arranca REPOSICION (servidor + tunel) todos los dias a las 08:00' -Force | Out-Null

Write-Host "Tarea registrada: $taskName (diaria 08:00)"
Write-Host "Horario activo keep-alive: 08:00-18:59 | reposo permitido: 19:00-08:59"
