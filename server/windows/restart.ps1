# MyGarage server on Windows: stopped and started again (after an update). The tunnel goes on running — the server
# keeps it, so the address the phones have stays the same (v0.41.1).
$ErrorActionPreference = 'Stop'
$server = Split-Path -Parent $PSScriptRoot
$main = Join-Path $server 'src\main.mjs'
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'MyGarage Server.vbs'
if (-not (Test-Path $vbs)) { Write-Error 'Autostart is not installed: run windows\install-autostart.ps1' }

Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$main*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Start-Sleep -Milliseconds 500
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""

for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
    if ($r.ok) { Write-Output "MyGarage server is running again (v$($r.version)). Page: http://localhost:8788"; exit 0 }
  } catch { Start-Sleep -Milliseconds 500 }
}
Write-Error 'The server did not answer. See server.log in the service folder of the data folder.'
