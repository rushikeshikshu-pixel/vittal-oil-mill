# ============================================================
#  Vitthal Oil Mill OS - Auto-Start Installer
#  Run ONCE on the permanent server PC to make the dashboard
#  server start automatically and keep running.
#
#  HOW TO RUN:
#    1. Right-click this file  ->  "Run with PowerShell"
#       (or open PowerShell as Administrator and run it)
#    2. Approve the prompt.
#  To remove later:  run this with the -Uninstall switch.
# ============================================================

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$taskName = "VitthalOilMillServer"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $scriptDir "run-server.bat"

# Remove any existing task first (idempotent / uninstall).
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing '$taskName' task." -ForegroundColor Yellow
}

if ($Uninstall) {
    Write-Host "Auto-start uninstalled. The server will no longer start automatically." -ForegroundColor Green
    return
}

if (-not (Test-Path $runner)) {
    Write-Host "ERROR: run-server.bat not found next to this script." -ForegroundColor Red
    return
}

# Confirm Python is available (the server needs it).
try {
    $pyVersion = (& python --version) 2>&1
    Write-Host "Found $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "WARNING: 'python' was not found on PATH. Install Python 3 (python.org) and tick 'Add to PATH' before the server will run." -ForegroundColor Red
}

# Start at boot AND at any user logon, so the server is up whenever the PC is on.
$action   = New-ScheduledTaskAction -Execute $runner
$trigger1 = New-ScheduledTaskTrigger -AtStartup
$trigger2 = New-ScheduledTaskTrigger -AtLogOn
# Run in the background, keep trying, never auto-stop.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
# Run as SYSTEM so it works even before anyone logs in (needed for remote access at night).
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger1, $trigger2 `
    -Settings $settings -Principal $principal `
    -Description "Runs the Vitthal Oil Mill dashboard server automatically and restarts it if it stops." | Out-Null

# Start it right now too, so you don't have to reboot.
Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "SUCCESS - the Vitthal Oil Mill server is now installed and running." -ForegroundColor Green
Write-Host "It will start automatically every time this PC boots, and restart itself if it stops." -ForegroundColor Green
Write-Host "Open http://localhost:4567 to confirm." -ForegroundColor Cyan
