$ErrorActionPreference = 'Stop'
$installer = (Get-ChildItem release/*.exe | Select-Object -First 1).FullName
if (!$installer) { throw 'Installer missing' }
$target = Join-Path $env:RUNNER_TEMP 'ArchiOfficeInstallerSmoke'
$clsid = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Classes\CLSID\{7CFD969B-AEF8-4D32-A338-9D472988DA21}'
$entry = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace\{7CFD969B-AEF8-4D32-A338-9D472988DA21}'
$data = Join-Path $env:APPDATA 'ArchiOffice'
New-Item $data -ItemType Directory -Force | Out-Null
$sentinel = Join-Path $data ('installer-smoke-' + [Guid]::NewGuid().ToString() + '.txt')
Set-Content $sentinel 'Keep local work through reinstall and uninstall'
try {
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $process = Start-Process $installer -ArgumentList '/S',('/D=' + $target) -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installation failed: $($process.ExitCode)" }
    $dll = (Get-ItemProperty ($clsid + '\InprocServer32')).'(default)'
    if (!$dll -or !(Test-Path $dll) -or !$dll.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) { throw 'Broken Explorer DLL registration' }
    if (!(Test-Path $entry)) { throw 'Explorer namespace missing' }
    foreach ($file in @('archioffice-shell-control.exe','archioffice-shell-preview.exe')) {
      if (!(Test-Path (Join-Path $target ('resources\drive-shell\' + $file)))) { throw "Missing $file" }
    }
    if (!(Test-Path $sentinel)) { throw 'Local work removed during reinstall' }
  }
  $uninstaller = (Get-ChildItem $target -Filter 'Uninstall*.exe' | Select-Object -First 1).FullName
  if (!$uninstaller) { throw 'Uninstaller missing' }
  $process = Start-Process $uninstaller -ArgumentList '/S',('_?=' + $target) -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
  if ((Test-Path $clsid) -or (Test-Path $entry)) { throw 'Explorer registration left behind' }
  if (!(Test-Path $sentinel)) { throw 'Local work removed during uninstall' }
  Write-Host 'Installer lifecycle passed: install, reinstall, native payload, registration, uninstall and local data retained.'
} finally { Remove-Item $sentinel -Force -ErrorAction SilentlyContinue }
