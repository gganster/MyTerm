<#
  The T01 protocol (measure.ps1) for the Rust build, with one change that is not about the numbers:
  nothing is stopped by *name*. The Electron script stopped every `MyTerm`; here `myterm.exe` and the
  installed `MyTerm.exe` are the same name on Windows, so a by-name stop would kill the user's own
  windows. Only the processes this script started (the root and its descendants, by PID) are stopped.

  Same protocol otherwise: 6-pane project without `command`, 3 runs, time = launch until 6 `pwsh`
  descend from the launched process (100 ms polling), memory = working set / private bytes of the
  application processes only (shells and their children excluded) 5 s after the 6th shell, second
  window = a first window open for 12 s, then a second process on the same folder.
#>
param([string]$Exe, [string]$Proj, [int]$Runs = 3, [string]$AppData = '')
if ($AppData) { $env:APPDATA = $AppData }
$env:MYTERM_DEV = '1'
$exeBase = [IO.Path]::GetFileNameWithoutExtension($Exe)

function Tree($rootPid) {
  $all = Get-CimInstance Win32_Process
  $ids = @($rootPid); $q = @($rootPid)
  while ($q.Count) { $c = $q[0]; $q = @($q | Select-Object -Skip 1); foreach ($p in $all | Where-Object { $_.ParentProcessId -eq $c }) { $ids += $p.ProcessId; $q += $p.ProcessId } }
  $ids
}
function ShellCount($rootPid) { @(Get-Process -Id (Tree $rootPid) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'pwsh' }).Count }
function StopTree($rootPid) { foreach ($i in (Tree $rootPid | Sort-Object -Descending)) { Stop-Process -Id $i -Force -ErrorAction SilentlyContinue } }
function TimeTo6($p) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 60) { if ((ShellCount $p.Id) -ge 6) { return $sw.Elapsed.TotalSeconds }; Start-Sleep -Milliseconds 100 }
  $null
}

1..$Runs | ForEach-Object {
  $p = Start-Process $Exe -ArgumentList "`"$Proj`"" -PassThru
  # Stopwatch starts at launch: TimeTo6 begins right after Start-Process returns (a few ms).
  $t = TimeTo6 $p
  Start-Sleep 5
  $app = @(Get-Process -Id (Tree $p.Id) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq $exeBase })
  $ws = ($app | Measure-Object WorkingSet64 -Sum).Sum / 1MB
  $pm = ($app | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB
  'run {0} : 6 shells after {1:N2}s ; app procs={2} ; WS={3:N0} MB ; private={4:N0} MB' -f $_, $t, $app.Count, $ws, $pm
  StopTree $p.Id
  Start-Sleep 2
}

# Second window: the first one has been open for 12 s.
$first = Start-Process $Exe -ArgumentList "`"$Proj`"" -PassThru
Start-Sleep 12
$second = Start-Process $Exe -ArgumentList "`"$Proj`"" -PassThru
$t2 = TimeTo6 $second
Start-Sleep 5
$both = @(Get-Process -Id ((Tree $first.Id) + (Tree $second.Id)) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq $exeBase })
'second window : 6 shells after {0:N2}s ; two windows, {1} app procs, WS={2:N0} MB' -f $t2, $both.Count, (($both | Measure-Object WorkingSet64 -Sum).Sum / 1MB)
StopTree $second.Id
StopTree $first.Id
