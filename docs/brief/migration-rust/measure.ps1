param([string]$Exe,[string]$Proj,[int]$Runs=3)
function Tree($rootPid){ $all=Get-CimInstance Win32_Process; $ids=@($rootPid); $q=@($rootPid)
 while($q.Count){ $c=$q[0];$q=$q[1..($q.Count)]; foreach($p in $all|?{$_.ParentProcessId -eq $c}){ $ids+=$p.ProcessId;$q+=$p.ProcessId}}; $ids }
$exeName=[IO.Path]::GetFileName($Exe)
1..$Runs | % {
 Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Exe)) -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
 $sw=[Diagnostics.Stopwatch]::StartNew(); $p=Start-Process $Exe -ArgumentList "`"$Proj`"" -PassThru
 $t=$null
 while($sw.Elapsed.TotalSeconds -lt 60){ $ids=Tree $p.Id; $sh=Get-Process -Id $ids -ErrorAction SilentlyContinue | ?{$_.ProcessName -in 'pwsh','conhost','OpenConsole'} | ?{$_.ProcessName -eq 'pwsh'}; if(($sh|measure).Count -ge 6){$t=$sw.Elapsed.TotalSeconds;break}; Start-Sleep -Milliseconds 100 }
 Start-Sleep 5
 $ids=Tree $p.Id
 $app=Get-Process -Id $ids -ErrorAction SilentlyContinue | ?{$_.ProcessName -eq ([IO.Path]::GetFileNameWithoutExtension($Exe))}
 $ws=($app|Measure WorkingSet64 -Sum).Sum/1MB; $pm=($app|Measure PrivateMemorySize64 -Sum).Sum/1MB
 "run $_ : 6 shells after {0:N2}s ; app procs={1} ; WS={2:N0} MB ; private={3:N0} MB" -f $t,($app|measure).Count,$ws,$pm
}
Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($Exe)) -ErrorAction SilentlyContinue | Stop-Process -Force
