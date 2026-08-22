; MyTerm NSIS customisation: install the CLI shim, put it on the user PATH, and
; register the two Explorer context-menu verbs.
;
; PATH editing is delegated to PowerShell rather than done with NSIS string
; operations. NSIS strings are capped (1024 chars in a default build) and a
; long PATH would be silently truncated — destroying the user's PATH is the
; single worst thing an installer of this size could do. PowerShell's
; [Environment]::SetEnvironmentVariable also broadcasts WM_SETTINGCHANGE, so
; newly opened terminals see the change without a sign-out.
;
; Everything here is per-user (HKCU, %LOCALAPPDATA%): no elevation, and an
; uninstall that leaves no working trace — the empty `Directory\shell` parents
; the shell keys create on a profile that had none are not chased, because
; deleting a branch other applications also write to is a far worse failure than
; an inert empty key.
;
; "No elevation" holds because electron-builder.yml sets `allowElevation: false`;
; without it the assisted installer offers a live "all users" option, and an
; install elevated that way would write these HKCU keys into the *admin's* hive.

!macro customInstall
  DetailPrint "Installation du CLI myterm…"

  ; Recorded so the shim can find the executable even after a custom install path.
  WriteRegStr HKCU "Software\MyTerm" "InstallDir" "$INSTDIR"

  CreateDirectory "$LOCALAPPDATA\MyTerm\bin"
  CopyFiles /SILENT "$INSTDIR\resources\myterm.cmd" "$LOCALAPPDATA\MyTerm\bin\myterm.cmd"

  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = Join-Path $$env:LOCALAPPDATA ''MyTerm\bin''; $$current = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ($$null -eq $$current) { $$current = '''' }; $$parts = $$current -split '';'' | Where-Object { $$_ -ne '''' }; if ($$parts -notcontains $$bin) { $$updated = (@($$parts) + $$bin) -join '';''; [Environment]::SetEnvironmentVariable(''Path'', $$updated, ''User'') }"'
  Pop $0
  DetailPrint "PATH utilisateur mis a jour (code $0)"

  DetailPrint "Ajout de MyTerm au menu contextuel de l'explorateur…"

  ; Two verbs, because Explorer builds two different menus and the one the user
  ; actually reaches for is the second:
  ;
  ;   Directory\shell             right-click *on* a folder icon
  ;   Directory\Background\shell  right-click in the empty space *inside* an open
  ;                               folder — the « ouvrir ici » of this feature
  ;
  ; Only Background says « ici » : on a folder icon the target is the thing under
  ; the cursor, not the window you are standing in.
  ;
  ; %V, not %1. Background has no clicked item, so %1 there expands to nothing
  ; and MyTerm would open on the home screen — the failure is silent, the menu
  ; entry still appears and still launches the app. On Directory the two are
  ; equivalent, so %V everywhere keeps a single command string.
  ;
  ; The command points at the executable, not at myterm.cmd: a .cmd flashes a
  ; console window on every launch, and the shim only exists to *find* the
  ; install directory from a terminal — here $INSTDIR is already known.
  ;
  ; HKCU\Software\Classes, never HKCR or HKLM: same per-user contract as the PATH
  ; edit above. No elevation, and nothing left behind for other accounts.
  ; MultiSelectModel=Single hides the entry when several folders are selected.
  ; The default for a command-line verb is one invocation *per item*: six
  ; selected folders would start six MyTerm.exe, five of them losing the
  ; single-instance lock and shoving their project at the one window in turn.
  ; The background verb needs no such attribute — there is nothing selected.
  WriteRegStr HKCU "Software\Classes\Directory\shell\MyTerm" "" "Ouvrir dans MyTerm"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MyTerm" "Icon" '"$INSTDIR\MyTerm.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\MyTerm" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MyTerm\command" "" '"$INSTDIR\MyTerm.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MyTerm" "" "Ouvrir MyTerm ici"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MyTerm" "Icon" '"$INSTDIR\MyTerm.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MyTerm\command" "" '"$INSTDIR\MyTerm.exe" "%V"'
!macroend

!macro customUnInstall
  ; An update runs the *old* uninstaller before installing the new files, so
  ; without this guard every auto-update tears the integration down and rebuilds
  ; it. Harmless when the update succeeds — and unrecoverable when it does not:
  ; if the file removal cannot rename $INSTDIR (a busy pty, antivirus), the
  ; template restores the files and aborts, `customInstall` never runs, and the
  ; user is left with a working application that has silently lost its PATH
  ; entry, its shim and both context-menu verbs, with nothing said about it.
  ;
  ; Skipping is also simply correct: `customInstall` rewrites the same values.
  ${ifNot} ${isUpdated}

  DetailPrint "Retrait du CLI myterm…"

  ; Removes only our own entry; every other PATH element is preserved verbatim.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$bin = Join-Path $$env:LOCALAPPDATA ''MyTerm\bin''; $$current = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ($$current) { $$parts = $$current -split '';'' | Where-Object { $$_ -ne '''' -and $$_ -ne $$bin }; [Environment]::SetEnvironmentVariable(''Path'', ($$parts -join '';''), ''User'') }"'
  Pop $0

  ; DeleteRegKey, not DeleteRegValue: the whole `MyTerm` subtree is ours and an
  ; emptied-out `MyTerm\command` would still be an entry in the user's shell.
  ; Nothing above it is touched — `Directory\shell` is shared with every other
  ; application that registers a verb, and deleting it would take theirs too.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\MyTerm"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\MyTerm"

  Delete "$LOCALAPPDATA\MyTerm\bin\myterm.cmd"
  RMDir "$LOCALAPPDATA\MyTerm\bin"
  RMDir "$LOCALAPPDATA\MyTerm"
  DeleteRegKey HKCU "Software\MyTerm"

  ${endif}
!macroend
