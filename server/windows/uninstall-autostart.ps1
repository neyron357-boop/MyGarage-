# MyGarage server on Windows: no longer started at sign-in, and stopped now. The data folder is left as it is.
$ErrorActionPreference = 'Stop'
$server = Split-Path -Parent $PSScriptRoot
$main = Join-Path $server 'src\main.mjs'
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'MyGarage Server.vbs'
if (Test-Path $vbs) { Remove-Item $vbs -Force -Confirm:$false }
# The launcher first (v0.42.1: it starts a stopped server again), then the server.
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like '*MyGarage Server.vbs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$main*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
# The tunnel runs on its own (it outlives a restart of the server): stopped with it here.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*127.0.0.1:8787*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Write-Output 'MyGarage server: autostart removed, server stopped.'
