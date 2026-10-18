; Where the installer writes. Two worlds, one script.
;
; The real one (default) is what ships. `-DSANDBOX` points every registry key and folder at a
; throwaway place under HKCU\Software\MyTermSandbox and $INSTDIR, so the whole install and uninstall
; can be run on a machine that already has MyTerm without touching its PATH, its context menu, its
; shortcuts or its "Installed apps" entry. tests/installer.rs reads the real branch.

!ifdef SANDBOX
  !define CLASSES "Software\MyTermSandbox\Classes"
  !define APPKEY "Software\MyTermSandbox\MyTerm"
  !define UNINSTROOT "Software\MyTermSandbox\Uninstall"
  !define ENVKEY "Software\MyTermSandbox\Environment"
  !define BIN "$INSTDIR\sandbox-bin"
  !define SHORTCUTS "$INSTDIR\sandbox-shortcuts"
  !define ELECTRONKEY "Software\MyTermSandbox\bb20937c-569f-5a89-9956-bcc0a0242b0b"
  !define UPDATERCACHE "$INSTDIR\sandbox-updater-cache"
!else
  !define CLASSES "Software\Classes"
  !define APPKEY "Software\MyTerm"
  !define UNINSTROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"
  !define ENVKEY "Environment"
  !define BIN "$LOCALAPPDATA\MyTerm\bin"
  !define SHORTCUTS "$SMPROGRAMS"
  !define ELECTRONKEY "Software\bb20937c-569f-5a89-9956-bcc0a0242b0b"
  !define UPDATERCACHE "$LOCALAPPDATA\myterm-updater"
!endif
