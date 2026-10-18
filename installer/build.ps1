#Requires -Version 5.1
<#
.SYNOPSIS
  Builds myterm.exe, packs it into dist\MyTerm-<version>-setup.exe and writes dist\latest.yml.

.DESCRIPTION
  latest.yml is the electron-updater format on purpose, whatever reads it: an installed 0.5.0 (Electron)
  updates by fetching `latest.yml` from the latest GitHub release, checking `sha512` and running the
  `path` installer with `/S --updated --force-run`. The Rust updater (src/updater.rs) reads the same
  file, so one release serves both.

.PARAMETER Sandbox
  Builds the SANDBOX installer (see paths.nsh): same script, every key and folder redirected to a
  throwaway place. Output: dist\MyTerm-<version>-sandbox-setup.exe, without latest.yml.
#>
[CmdletBinding()]
param([switch] $Sandbox)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$cargo = Get-Content (Join-Path $root 'Cargo.toml') -Raw
if ($cargo -notmatch '(?m)^version\s*=\s*"(\d+\.\d+\.\d+)"') { throw 'Cargo.toml: version X.Y.Z introuvable' }
$version = $Matches[1]

cargo build --release
if ($LASTEXITCODE -ne 0) { throw 'cargo build a échoué' }

# makensis: the PATH, then NSIS' own folder, then the copy electron-builder caches on a dev machine.
$makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (-not $makensis) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    "$env:ProgramFiles\NSIS\makensis.exe"
  ) + @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis') -Filter makensis.exe -Recurse -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $makensis = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $makensis) { throw 'makensis introuvable (choco install nsis)' }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$name = if ($Sandbox) { "MyTerm-$version-sandbox-setup.exe" } else { "MyTerm-$version-setup.exe" }
$out = Join-Path $dist $name
$args = @(
  '/V2',
  "/DVERSION=$version",
  "/DEXE=$(Join-Path $root 'target\release\myterm.exe')",
  "/DOUTFILE=$out",
  "/DPLUGINS=$(Join-Path $PSScriptRoot 'plugins\x86-unicode')"
)
if ($Sandbox) { $args += '/DSANDBOX' }
$args += (Join-Path $PSScriptRoot 'myterm.nsi')
& $makensis @args
if ($LASTEXITCODE -ne 0) { throw 'makensis a échoué' }

if ($Sandbox) { Write-Output $out; return }

$bytes = [System.IO.File]::ReadAllBytes($out)
$sha512 = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash($bytes))
$date = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
# Hand-written, no YAML library: the shape is fixed and electron-updater is strict about it.
$yml = @"
version: $version
files:
  - url: $name
    sha512: $sha512
    size: $($bytes.Length)
path: $name
sha512: $sha512
releaseDate: '$date'
"@
[System.IO.File]::WriteAllText((Join-Path $dist 'latest.yml'), $yml.Replace("`r`n", "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Output $out
