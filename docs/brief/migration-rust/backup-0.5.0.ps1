<#
  Saves everything the Rust installer touches on a machine that has MyTerm 0.5.0 (Electron), and can put
  it back. Run it BEFORE the first real install of the Rust version.

    backup-0.5.0.ps1            save into ..\..\..\..\backup-0.5.0-install (next to the project folders)
    backup-0.5.0.ps1 -Restore   put it back (closes nothing: close MyTerm first)

  Saved: the registry keys of the install, of the uninstall entry and of the context menu, the user PATH
  (raw, with its kind), the Start menu shortcut, the whole install folder, and preferences.json.
#>
param([switch] $Restore, [string] $Dir = (Join-Path (Split-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot)))) 'backup-0.5.0-install'))
$ErrorActionPreference = 'Stop'

$keys = @(
  'HKCU\Software\MyTerm',
  'HKCU\Software\bb20937c-569f-5a89-9956-bcc0a0242b0b',
  'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\bb20937c-569f-5a89-9956-bcc0a0242b0b',
  'HKCU\Software\Classes\Directory\shell\MyTerm',
  'HKCU\Software\Classes\Directory\Background\shell\MyTerm'
)
$install = Join-Path $env:LOCALAPPDATA 'Programs\MyTerm'
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MyTerm.lnk'
$prefs = Join-Path $env:APPDATA 'MyTerm\preferences.json'

if (-not $Restore) {
  if (Get-Process | Where-Object { $_.ProcessName -ieq 'MyTerm' }) { throw 'MyTerm tourne : fermez-le avant la sauvegarde.' }
  New-Item -ItemType Directory -Force $Dir | Out-Null
  $i = 0
  foreach ($k in $keys) {
    $i++
    reg query $k *> $null
    if ($LASTEXITCODE -eq 0) { reg export $k (Join-Path $Dir ("key$i.reg")) /y | Out-Null; Set-Content (Join-Path $Dir "key$i.name") $k } else { Set-Content (Join-Path $Dir "key$i.absent") $k }
  }
  $env_ = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  $raw = $env_.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $kind = $env_.GetValueKind('Path').ToString()
  $env_.Close()
  Set-Content (Join-Path $Dir 'path.txt') $raw -NoNewline -Encoding UTF8
  Set-Content (Join-Path $Dir 'path.kind') $kind
  if (Test-Path $shortcut) { Copy-Item $shortcut (Join-Path $Dir 'MyTerm.lnk') }
  if (Test-Path $prefs) { Copy-Item $prefs (Join-Path $Dir 'preferences.json') }
  robocopy $install (Join-Path $Dir 'install') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $files = (Get-ChildItem (Join-Path $Dir 'install') -Recurse -File | Measure-Object).Count
  $orig = (Get-ChildItem $install -Recurse -File | Measure-Object).Count
  "sauvegarde dans $Dir : $files fichiers copiés sur $orig ; clés : " + ((Get-ChildItem $Dir -Filter 'key*.reg').Count) + ' exportées'
  if ($files -ne $orig) { throw 'copie incomplète' }
  return
}

# Restore: the install folder first (the Rust files are overwritten, the extra ones removed), then the keys.
if (Get-Process | Where-Object { $_.ProcessName -ieq 'MyTerm' }) { throw 'MyTerm tourne : fermez-le avant la restauration.' }
robocopy (Join-Path $Dir 'install') $install /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
# `reg delete` of a key that is not there is an error for PowerShell, and not one to stop on.
$ErrorActionPreference = 'Continue'
foreach ($f in Get-ChildItem $Dir -Filter 'key*.name') { $k = Get-Content $f.FullName; reg delete $k /f 2>$null | Out-Null }
foreach ($f in Get-ChildItem $Dir -Filter 'key*.absent') { $k = Get-Content $f.FullName; reg delete $k /f 2>$null | Out-Null }
$ErrorActionPreference = 'Stop'
foreach ($f in Get-ChildItem $Dir -Filter 'key*.reg') { reg import $f.FullName | Out-Null }
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$key.SetValue('Path', (Get-Content (Join-Path $Dir 'path.txt') -Raw), [Microsoft.Win32.RegistryValueKind]::Parse([Microsoft.Win32.RegistryValueKind], (Get-Content (Join-Path $Dir 'path.kind'))))
$key.Close()
if (Test-Path (Join-Path $Dir 'MyTerm.lnk')) { Copy-Item (Join-Path $Dir 'MyTerm.lnk') $shortcut -Force }
'restauré depuis ' + $Dir
