# MyGarage server on Windows: no longer started at sign-in, and stopped now. The data folder is left as it is.
$ErrorActionPreference = 'Stop'
$server = Split-Path -Parent $PSScriptRoot
$main = Join-Path $server 'src\main.mjs'
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'MyGarage Server.vbs'
if (Test-Path $vbs) { Remove-Item $vbs -Force -Confirm:$false }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$main*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Write-Output 'MyGarage server: autostart removed, server stopped.'
