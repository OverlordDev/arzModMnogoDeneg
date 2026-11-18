# ARZ Terminal: autostart of the server with Windows (current user, no admin rights).
#
# Usage (from the project folder):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_autostart.ps1             # install + start now
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_autostart.ps1 -Status
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_autostart.ps1 -Stop       # stop the running server
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_autostart.ps1 -Uninstall  # remove autostart + stop
#
# What it does: puts a shortcut "ARZ Terminal Server.lnk" into your Startup folder. The shortcut
# runs scripts\start_server_hidden.vbs -> scripts\run_server.bat (hidden window, restarts the
# server after a crash, log: local\server.log). To remove it by hand: delete that shortcut.

param([switch]$Uninstall, [switch]$Stop, [switch]$Status)
$ErrorActionPreference = 'Stop'

$scripts = $PSScriptRoot
$root    = Split-Path $scripts -Parent
$vbs     = Join-Path $scripts 'start_server_hidden.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'ARZ Terminal Server.lnk'
$port    = if ($env:PORT) { $env:PORT } else { '3000' }
$health  = "http://localhost:$port/api/health"

function Test-Health {
    try { return ((Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 3).StatusCode -eq 200) } catch { return $false }
}

# Our own process tree only: cmd.exe running run_server.bat and the node.exe children of it.
function Get-ArzLauncher {
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'run_server\.bat' }
}

function Stop-ArzServer {
    $cmds = @(Get-ArzLauncher)
    if ($cmds.Count -eq 0) { Write-Host 'No launcher process found (server started another way is left alone).'; return }
    $ids = $cmds | ForEach-Object { $_.ProcessId }
    # kill the launcher first so it cannot restart the server, then its node children
    foreach ($c in $cmds) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($ids -contains $_.ParentProcessId) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host 'Stopped.'
}

if ($Status) {
    Write-Host ('Startup shortcut : ' + $(if (Test-Path $lnk) { 'installed (' + $lnk + ')' } else { 'NOT installed' }))
    Write-Host ('Launcher running : ' + $(if (@(Get-ArzLauncher).Count -gt 0) { 'yes' } else { 'no' }))
    Write-Host ('Server responds  : ' + $(if (Test-Health) { "yes ($health)" } else { 'no' }))
    return
}

if ($Stop) { Stop-ArzServer; return }

if ($Uninstall) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Removed: $lnk" } else { Write-Host 'Autostart shortcut was not installed.' }
    Stop-ArzServer
    return
}

# ---- install ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH. Install Node.js 18+ first.' }
if (-not (Test-Path $vbs)) { throw "Missing $vbs" }

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $wscript
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'ARZ Terminal server (hidden, restarts on crash)'
$s.Save()
Write-Host "Autostart installed: $lnk"

if (Test-Health) {
    Write-Host "Server already responds on $health - not starting a second copy."
} else {
    Start-Process -FilePath $wscript -ArgumentList ('"' + $vbs + '"')
    $ok = $false
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; if (Test-Health) { $ok = $true; break } }
    if ($ok) { Write-Host "Server started: $health" } else { Write-Host "Server did not answer in 20 s - see local\server.log" }
}
