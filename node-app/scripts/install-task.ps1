$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'Wholesome Discord MCP'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'The task already exists. Review it before updating; this installer will not overwrite it.'
}
# Preserve the installing user's access; exclude other ordinary local users.
& icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict application directory permissions.' }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $root 'scripts\supervisor.js') + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local authenticated Discord AI and MCP service' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Task installed for this user at logon. RDP disconnect is OK; logging off stops the service. Open http://localhost:8090.'
