$ErrorActionPreference = 'Continue'
Write-Host 'Reposicion-wake watcher started'
while ($true) {
  $wake = 'E:\reposicion\inbox\AGENT_WAKE.json'
  if (Test-Path $wake) {
    Write-Output 'AGENT_LOOP_WAKE_Reposicion {"prompt":"Procesar pedido REPOSICIÓN pendiente: leer inbox/AGENT_WAKE.json, aplicar el cambio en E:\\reposicion, npm run build, crear DONE, limpiar WORKING/BUSY/WAKE"}'
    Start-Sleep -Seconds 90
  }
  Start-Sleep -Seconds 5
}
