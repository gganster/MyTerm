#Requires -Version 5.1
<#
.SYNOPSIS
  Adds or removes %LOCALAPPDATA%\MyTerm\bin in the *user* PATH.

.DESCRIPTION
  A real script, not a one-liner embedded in installer.nsh, for two reasons.

  The first is the bug this replaces. NSIS escapes a quote as $\' and not by
  doubling it, so the ''Path'' in the old inline command reached PowerShell
  verbatim, PowerShell read '' as the empty string, and the whole command died
  on a parse error before touching anything. It shipped that way from 0.1.0
  through 0.2.0: the shim was installed, the registry key was written, and the
  PATH entry silently never appeared. A file has no NSIS quoting layer to get
  wrong, and it can be read and reviewed like any other source.

  The second is [Environment]::SetEnvironmentVariable itself, which cannot be
  used here at all. It always writes REG_SZ. A user PATH is very often
  REG_EXPAND_SZ — the machine one on this very box is — and rewriting it as
  REG_SZ turns every %VAR% entry in it into a dead literal. Adding one entry
  must never be able to break the others; destroying someone's PATH is the
  single worst thing an installer of this size could do. So the value is
  written through the registry API with the kind it already had.

  Doing it that way costs the broadcast that SetEnvironmentVariable performs for
  free, and the broadcast is not optional: without it Explorer keeps handing its
  stale environment block to every terminal it starts, so the user would install
  MyTerm and still get "myterm is not recognized" until the next sign-out. It is
  therefore sent explicitly at the end.

.PARAMETER Mode
  Add (install) or Remove (uninstall).

.OUTPUTS
  Exit code 0 on success, 2 if the PATH does not read back as expected,
  3 on an unhandled failure. installer.nsh reports a non-zero code instead of
  claiming success, which is what made the original failure invisible.
#>
[CmdletBinding()]
param(
  [Parameter()]
  [ValidateSet('Add', 'Remove')]
  [string] $Mode = 'Add'
)

$ErrorActionPreference = 'Stop'

# Trailing separators and case are not meaningful in a PATH entry, so the same
# folder written three ways must still count as one.
function Get-Canonical([string] $entry) {
  return $entry.Trim().TrimEnd('\', '/').ToLowerInvariant()
}

function Send-EnvironmentChange {
  if (-not ('MyTerm.Native' -as [type])) {
    Add-Type -Namespace 'MyTerm' -Name 'Native' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
  }

  $HWND_BROADCAST = [System.IntPtr] 0xFFFF
  $WM_SETTINGCHANGE = 0x1A
  $SMTO_ABORTIFHUNG = 0x0002
  $result = [System.UIntPtr]::Zero
  # A hung top-level window elsewhere on the desktop must not hang the
  # installer, so this is the timeout-bounded form and its result is ignored:
  # a broadcast that did not land costs a sign-out, not a failed install.
  [void] [MyTerm.Native]::SendMessageTimeout(
    $HWND_BROADCAST, $WM_SETTINGCHANGE, [System.IntPtr]::Zero, 'Environment',
    $SMTO_ABORTIFHUNG, 5000, [ref] $result)
}

try {
  $bin = Join-Path $env:LOCALAPPDATA 'MyTerm\bin'
  $target = Get-Canonical $bin

  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  if ($null -eq $key) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  }

  try {
    $raw = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)

    # Preserve what is there. A PATH that does not exist yet is created
    # expandable, which is what Windows itself uses.
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($key.GetValueNames() -contains 'Path') { $kind = $key.GetValueKind('Path') }

    $parts = @([string] $raw -split ';' | Where-Object { $_.Trim() -ne '' })
    $without = @($parts | Where-Object { (Get-Canonical $_) -ne $target })

    if ($Mode -eq 'Add') {
      # Appended, never prepended: MyTerm has no business shadowing a command
      # the user already resolves to something else.
      $updated = @($without + $bin)
    }
    else {
      $updated = $without
    }

    $joined = $updated -join ';'
    if ($joined -ne ([string] $raw)) { $key.SetValue('Path', $joined, $kind) }

    # Read back through the registry, not through the process environment: this
    # process inherited its own PATH at start and would never show the change.
    $after = @([string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -split ';' |
      ForEach-Object { Get-Canonical $_ })
    $present = $after -contains $target
    if (($Mode -eq 'Add') -ne $present) { exit 2 }
  }
  finally {
    $key.Close()
  }

  Send-EnvironmentChange
  exit 0
}
catch {
  Write-Output "myterm PATH ${Mode}: $($_.Exception.Message)"
  exit 3
}
