; MyTerm NSIS customisation: install the CLI shim and put it on the user PATH.
;
; PATH editing is delegated to PowerShell rather than done with NSIS string
; operations. NSIS strings are capped (1024 chars in a default build) and a
; long PATH would be silently truncated — destroying the user's PATH is the
; single worst thing an installer of this size could do. PowerShell's
; [Environment]::SetEnvironmentVariable also broadcasts WM_SETTINGCHANGE, so
; newly opened terminals see the change without a sign-out.
;
; Everything here is per-user (HKCU, %LOCALAPPDATA%): no elevation, and an
; uninstall that leaves nothing behind.

!macro customInstall
  DetailPrint "Installation du CLI myterm…"

  ; Recorded so the shim can find the executable even after a custom install path.
  WriteRegStr HKCU "Software\MyTerm" "InstallDir" "$INSTDIR"

  CreateDirectory "$LOCALAPPDATA\MyTerm\bin"
  CopyFiles /SILENT "$INSTDIR\resources\myterm.cmd" "$LOCALAPPDATA\MyTerm\bin\myterm.cmd"

  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = Join-Path $$env:LOCALAPPDATA ''MyTerm\bin''; $$current = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ($$null -eq $$current) { $$current = '''' }; $$parts = $$current -split '';'' | Where-Object { $$_ -ne '''' }; if ($$parts -notcontains $$bin) { $$updated = (@($$parts) + $$bin) -join '';''; [Environment]::SetEnvironmentVariable(''Path'', $$updated, ''User'') }"'
  Pop $0
  DetailPrint "PATH utilisateur mis a jour (code $0)"
!macroend

!macro customUnInstall
  DetailPrint "Retrait du CLI myterm…"

  ; Removes only our own entry; every other PATH element is preserved verbatim.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = Join-Path $$env:LOCALAPPDATA ''MyTerm\bin''; $$current = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ($$current) { $$parts = $$current -split '';'' | Where-Object { $$_ -ne '''' -and $$_ -ne $$bin }; [Environment]::SetEnvironmentVariable(''Path'', ($$parts -join '';''), ''User'') }"'
  Pop $0

  Delete "$LOCALAPPDATA\MyTerm\bin\myterm.cmd"
  RMDir "$LOCALAPPDATA\MyTerm\bin"
  RMDir "$LOCALAPPDATA\MyTerm"
  DeleteRegKey HKCU "Software\MyTerm"
!macroend
