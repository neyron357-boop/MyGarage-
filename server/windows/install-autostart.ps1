# MyGarage server straight on Windows (while Docker cannot run here): started hidden at every sign-in, and now.
# The launcher stays with it (v0.42.1): the server stopped for any reason — an error, a crash, ended by hand — is
# started again in two seconds, so the phones never stay without it.
# Undo: windows\uninstall-autostart.ps1. In Docker instead: uninstall this, then `docker compose up -d --build`.
param([string]$DataDir = 'C:\MyGarage')
$ErrorActionPreference = 'Stop'

$server = Split-Path -Parent $PSScriptRoot
$main = Join-Path $server 'src\main.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'MyGarage Server.vbs'

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$template = @'
' MyGarage server: started hidden at sign-in, and started again whenever it stops (made by server\windows\install-autostart.ps1).
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("DATA_DIR") = "{DATA}"
sh.CurrentDirectory = "{SERVER}"
cmd = """{NODE}"" --disable-warning=ExperimentalWarning ""{MAIN}"""
pause = 2
Do
  t = Timer
  sh.Run cmd, 0, True
  ran = Timer - t
  If ran < 0 Then ran = ran + 86400
  ' Ran a while: started again at once. Stopped right away again and again (the port taken, a broken update): less often, up to a minute.
  If ran > 60 Then
    pause = 2
  Else
    pause = pause * 2
  End If
  If pause > 60 Then pause = 60
  WScript.Sleep pause * 1000
Loop
'@
$text = $template.Replace('{DATA}', $DataDir).Replace('{SERVER}', $server).Replace('{NODE}', $node).Replace('{MAIN}', $main)
[IO.File]::WriteAllText($vbs, $text, [Text.Encoding]::Unicode)

# The launcher already running (an earlier start): left as it is — it starts the server again by itself.
$launcher = Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like '*MyGarage Server.vbs*' }
if (-not $launcher) {
  # A server started by the launcher before v0.42.1 (it did not stay): stopped, to run under the new one.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$main*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
  Start-Sleep -Milliseconds 500
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""
}

for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
    if ($r.ok) { Write-Output "MyGarage server is running (v$($r.version)). Data: $DataDir. Page: http://localhost:8788"; exit 0 }
  } catch { Start-Sleep -Milliseconds 500 }
}
Write-Error 'The server did not answer. See its log: Служебное\server.log in the data folder.'
