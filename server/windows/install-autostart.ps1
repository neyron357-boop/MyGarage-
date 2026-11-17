# MyGarage server straight on Windows (while Docker cannot run here): started hidden at every sign-in, and now.
# Undo: windows\uninstall-autostart.ps1. In Docker instead: uninstall this, then `docker compose up -d --build`.
param([string]$DataDir = 'C:\MyGarage')
$ErrorActionPreference = 'Stop'

$server = Split-Path -Parent $PSScriptRoot
$main = Join-Path $server 'src\main.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'MyGarage Server.vbs'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$lines = @(
  "' MyGarage server: started hidden at sign-in (made by server\windows\install-autostart.ps1).",
  'Set sh = CreateObject("WScript.Shell")',
  "sh.Environment(""PROCESS"")(""DATA_DIR"") = ""$DataDir""",
  "sh.CurrentDirectory = ""$server""",
  "sh.Run """"""$node"""" --disable-warning=ExperimentalWarning """"$main"""""", 0, False"
)
[IO.File]::WriteAllLines($vbs, $lines, [Text.Encoding]::Unicode)

# Already running (an earlier start): left as it is.
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$main*" }
if (-not $running) { Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`"" }

for ($i = 0; $i -lt 30; $i++) {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
    if ($r.ok) { Write-Output "MyGarage server is running (v$($r.version)). Data: $DataDir. Page: http://localhost:8788"; exit 0 }
  } catch { Start-Sleep -Milliseconds 500 }
}
Write-Error 'The server did not answer. See its log: Служебное\server.log in the data folder.'
