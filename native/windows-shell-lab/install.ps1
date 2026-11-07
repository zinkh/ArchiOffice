# Opt-in, per-user prototype; run as the same account/session as Explorer.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitProcess) { throw 'Utilisez PowerShell Windows x64.' }
$clsid = '{67B0F7BE-5F65-4AEF-9D4B-B133A991D911}'
$namespace = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\$clsid"
$class = "HKCU:\Software\Classes\CLSID\$clsid"
$base = Join-Path $env:LOCALAPPDATA 'ArchiOffice\DriveShellPrototype'
if ($Uninstall) {
    # Remove only this prototype's keys; never touch A:, project data or caches.
    foreach ($key in @($namespace, $class)) {
        if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
    }
    Write-Host 'Entrée retirée. Fermez les fenêtres Explorateur ou déconnectez la session avant de supprimer les anciennes DLL.'
    Write-Host "Fichiers du prototype conservés : $base"
    exit 0
}
$source = Join-Path $PSScriptRoot 'archioffice-drive-shell.dll'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "DLL absente : $source" }
# Immutable version directory: an Explorer process may still hold the old DLL.
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$destination = Join-Path $base $hash
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$dll = Join-Path $destination 'archioffice-drive-shell.dll'
if (-not (Test-Path -LiteralPath $dll)) { Copy-Item -LiteralPath $source -Destination $dll }
if ((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash -ne $hash) { throw 'Empreinte de la DLL incorrecte.' }
$process = Start-Process -FilePath "$env:WINDIR\System32\regsvr32.exe" -ArgumentList @('/s', ('"' + $dll + '"')) -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Enregistrement Shell refusé ($($process.ExitCode))." }
Write-Host 'Prototype enregistré pour ce compte. Activez A: dans ArchiOffice, puis ouvrez une nouvelle fenêtre Explorateur.'
Write-Host 'Ouverture directe : explorer.exe shell:::{67B0F7BE-5F65-4AEF-9D4B-B133A991D911}'
Write-Host 'Mise à jour : fermer les fenêtres Explorateur, puis relancer ce script depuis le nouvel artefact.'
