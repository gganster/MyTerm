; MyTerm (native) installer: per-user, no elevation. Installs MyTerm.exe, the `myterm` CLI shim on the
; user PATH, the two Explorer context-menu verbs and the shortcuts; the uninstaller removes all of it.
;
; Built by installer/build.ps1:  makensis -DVERSION=x.y.z -DEXE=... -DOUTFILE=... -DPLUGINS=... myterm.nsi
;
; It replaces the electron-builder installer of 0.5.0 and has to be a drop-in for it: same install
; folder, same executable name, same "Installed apps" key, same shortcut names, same arguments
; (`/S --updated --force-run`, which is what the 0.5.0 updater passes), so an installed 0.5.0 updates
; to this one without leaving a second entry, a second shortcut or a dead pinned button behind.
;
; PATH editing is delegated to path-entry.ps1 rather than done with NSIS string operations. NSIS
; strings are capped (1024 chars in a default build) and a long PATH would be silently truncated:
; destroying the user's PATH is the worst thing an installer of this size could do. It is a script
; file and not an inline -Command because an inline one shipped broken from 0.1.0 through 0.2.0: NSIS
; escapes a quote as $\' and not by doubling it, so the command died on a parse error before touching
; anything. `-File` takes a path and carries no quoting, so that bug class is gone, not patched.
;
; Everything is per-user (HKCU, %LOCALAPPDATA%): no elevation, and an uninstall that leaves no
; working trace. The empty `Directory\shell` parents the shell keys create on a profile that had
; none are not chased: deleting a branch other applications also write to is a far worse failure
; than an inert empty key.

Unicode true
RequestExecutionLevel user

!ifndef VERSION
  !error "-DVERSION=X.Y.Z is required"
!endif
!ifndef EXE
  !error "-DEXE=<path to myterm.exe> is required"
!endif
!ifndef OUTFILE
  !define OUTFILE "MyTerm-${VERSION}-setup.exe"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "paths.nsh"

!ifdef PLUGINS
  !addplugindir /x86-unicode "${PLUGINS}"
!endif

; The key 0.5.0 wrote ("Installed apps" lists one entry per key): reusing it is what keeps a single
; entry after the Rust version updates over the Electron one.
!define UNINSTKEY "bb20937c-569f-5a89-9956-bcc0a0242b0b"
; Also the AppUserModelID the app claims (src/identity.rs): the shortcuts carry it, and a mismatch
; would split a pinned MyTerm from the running one.
!define AUMID "dev.gganster.myterm"

Name "MyTerm"
OutFile "${OUTFILE}"
!ifdef SANDBOX
  ; Never the real folder: this build must be unable to overwrite an installed MyTerm.
  InstallDir "$TEMP\myterm-sandbox-install"
!else
  InstallDir "$LOCALAPPDATA\Programs\MyTerm"
!endif
InstallDirRegKey HKCU "${APPKEY}" "InstallDir"
BrandingText "MyTerm ${VERSION}"
SetCompressor /SOLID lzma

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "MyTerm"
VIAddVersionKey "FileDescription" "Installeur MyTerm"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\MyTerm.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer MyTerm"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

!macro CloseRunning un
  Function ${un}CloseRunning
!ifndef SANDBOX
    ; An install over a running MyTerm would fail on the locked executable, and the update contract is
    ; that the installer closes every window (the app asked first). WM_CLOSE first, so each window
    ; writes its preferences and unregisters; whatever is still there after a pause is forced.
    nsExec::Exec 'taskkill /IM MyTerm.exe'
    Pop $0
    Sleep 2500
    nsExec::Exec 'taskkill /F /IM MyTerm.exe'
    Pop $0
!endif
  FunctionEnd
!macroend
!insertmacro CloseRunning ""
!insertmacro CloseRunning "un."

; What the 0.5.0 (Electron) install leaves in the folder this one installs over, and next to it. Only
; named files and named sub-folders: never a recursive delete of $INSTDIR itself, which the user may
; have pointed at a folder holding other things. The marker is app.asar: a folder that is not an
; Electron install of ours is left alone. The user's data (%APPDATA%\MyTerm: preferences, approvals,
; recent projects, .updaterId) is not touched: it is what the update must preserve.
!macro removeElectronTraces
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    DetailPrint "Retrait des fichiers de la version Electron…"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
    Delete "$INSTDIR\chrome_100_percent.pak"
    Delete "$INSTDIR\chrome_200_percent.pak"
    Delete "$INSTDIR\d3dcompiler_47.dll"
    Delete "$INSTDIR\dxcompiler.dll"
    Delete "$INSTDIR\dxil.dll"
    Delete "$INSTDIR\ffmpeg.dll"
    Delete "$INSTDIR\icudtl.dat"
    Delete "$INSTDIR\libEGL.dll"
    Delete "$INSTDIR\libGLESv2.dll"
    Delete "$INSTDIR\resources.pak"
    Delete "$INSTDIR\snapshot_blob.bin"
    Delete "$INSTDIR\v8_context_snapshot.bin"
    Delete "$INSTDIR\vk_swiftshader.dll"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\vulkan-1.dll"
    RMDir /r "$INSTDIR\locales"
    Delete "$INSTDIR\resources\app.asar"
    Delete "$INSTDIR\resources\app-update.yml"
    Delete "$INSTDIR\resources\elevate.exe"
    RMDir /r "$INSTDIR\resources\app.asar.unpacked"
  ${EndIf}
  ; electron-builder's own bookkeeping, and the updater's download cache (installer.exe, pending\).
  DeleteRegKey HKCU "${ELECTRONKEY}"
  RMDir /r "${UPDATERCACHE}"
!macroend

!macro customInstall
  DetailPrint "Installation du CLI myterm…"

  ; Recorded so the shim can find the executable even after a custom install path.
  WriteRegStr HKCU "${APPKEY}" "InstallDir" "$INSTDIR"

  CreateDirectory "${BIN}"
  CopyFiles /SILENT "$INSTDIR\resources\myterm.cmd" "${BIN}\myterm.cmd"

  ; The script is run from the copy next to the shim, not from $INSTDIR: the uninstaller needs it
  ; too, and $INSTDIR is the thing being removed.
  CopyFiles /SILENT "$INSTDIR\resources\path-entry.ps1" "${BIN}\path-entry.ps1"

  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${BIN}\path-entry.ps1" -Mode Add -Bin "${BIN}" -EnvironmentKey "${ENVKEY}"'
  Pop $0
  ; Checked, not just printed: an old line printed "PATH mis a jour" whatever the code was, which is
  ; exactly why nobody noticed it never worked.
  ${If} $0 == 0
    DetailPrint "PATH utilisateur mis a jour : ${BIN}"
  ${Else}
    DetailPrint "ECHEC de l'ajout au PATH (code $0). La commande myterm ne sera pas disponible dans un terminal ; le raccourci et le menu contextuel fonctionnent."
  ${EndIf}

  DetailPrint "Ajout de MyTerm au menu contextuel de l'explorateur…"

  ; Two verbs, because Explorer builds two different menus and the one the user reaches for is the
  ; second:
  ;
  ;   Directory\shell             right-click *on* a folder icon
  ;   Directory\Background\shell  right-click in the empty space *inside* an open folder: the
  ;                               « ouvrir ici » of this feature
  ;
  ; %V, not %1. Background has no clicked item, so %1 there expands to nothing and MyTerm would open
  ; on the home screen: the failure is silent, the entry still appears and still launches the app.
  ;
  ; The command points at the executable, not at myterm.cmd: a .cmd flashes a console window on every
  ; launch, and the shim only exists to *find* the install directory from a terminal.
  ;
  ; MultiSelectModel=Single hides the entry when several folders are selected: the default for a
  ; command-line verb is one invocation *per item*, six selected folders would start six MyTerm.
  WriteRegStr HKCU "${CLASSES}\Directory\shell\MyTerm" "" "Ouvrir dans MyTerm"
  WriteRegStr HKCU "${CLASSES}\Directory\shell\MyTerm" "Icon" '"$INSTDIR\MyTerm.exe",0'
  WriteRegStr HKCU "${CLASSES}\Directory\shell\MyTerm" "MultiSelectModel" "Single"
  WriteRegStr HKCU "${CLASSES}\Directory\shell\MyTerm\command" "" '"$INSTDIR\MyTerm.exe" "%V"'

  WriteRegStr HKCU "${CLASSES}\Directory\Background\shell\MyTerm" "" "Ouvrir MyTerm ici"
  WriteRegStr HKCU "${CLASSES}\Directory\Background\shell\MyTerm" "Icon" '"$INSTDIR\MyTerm.exe",0'
  WriteRegStr HKCU "${CLASSES}\Directory\Background\shell\MyTerm\command" "" '"$INSTDIR\MyTerm.exe" "%V"'
!macroend

!macro customUnInstall
  DetailPrint "Retrait du CLI myterm…"

  ; Removes only our own entry; every other PATH element is preserved verbatim.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${BIN}\path-entry.ps1" -Mode Remove -Bin "${BIN}" -EnvironmentKey "${ENVKEY}"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "ECHEC du retrait du PATH (code $0) : l'entree ${BIN} peut subsister."
  ${EndIf}

  ; DeleteRegKey, not DeleteRegValue: the whole `MyTerm` subtree is ours and an emptied-out
  ; `MyTerm\command` would still be an entry in the user's shell. Nothing above it is touched:
  ; `Directory\shell` is shared with every other application that registers a verb.
  DeleteRegKey HKCU "${CLASSES}\Directory\shell\MyTerm"
  DeleteRegKey HKCU "${CLASSES}\Directory\Background\shell\MyTerm"

  Delete "${BIN}\myterm.cmd"
  Delete "${BIN}\path-entry.ps1"
  RMDir "${BIN}"
!ifndef SANDBOX
  RMDir "$LOCALAPPDATA\MyTerm"
!endif
  DeleteRegKey HKCU "${APPKEY}"
!macroend

Var Fresh

Section "MyTerm"
  ; An install over an existing one keeps the user's choices: the Desktop shortcut is created only the
  ; first time (a 0.5.0 that never had one, or whose owner deleted it, must not get one back).
  StrCpy $Fresh 1
  ${If} ${FileExists} "$INSTDIR\MyTerm.exe"
    StrCpy $Fresh 0
  ${EndIf}
  Call CloseRunning
  !insertmacro removeElectronTraces

  SetOutPath "$INSTDIR"
  ; MyTerm.exe whatever the build called it: the context-menu entries, the shortcuts and a pinned
  ; taskbar button written by 0.5.0 all point at that name.
  File "/oname=MyTerm.exe" "${EXE}"
  SetOutPath "$INSTDIR\resources"
  File "myterm.cmd"
  File "path-entry.ps1"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall MyTerm.exe"

  !insertmacro customInstall

  CreateDirectory "${SHORTCUTS}"
  CreateShortCut "${SHORTCUTS}\MyTerm.lnk" "$INSTDIR\MyTerm.exe" "" "$INSTDIR\MyTerm.exe" 0
  WinShell::SetLnkAUMI "${SHORTCUTS}\MyTerm.lnk" "${AUMID}"
!ifndef SANDBOX
  ${If} $Fresh == 1
    CreateShortCut "$DESKTOP\MyTerm.lnk" "$INSTDIR\MyTerm.exe" "" "$INSTDIR\MyTerm.exe" 0
    WinShell::SetLnkAUMI "$DESKTOP\MyTerm.lnk" "${AUMID}"
  ${EndIf}
!endif

  ; "Installed apps".
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "DisplayName" "MyTerm ${VERSION}"
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "Publisher" "gganster"
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "DisplayIcon" "$INSTDIR\MyTerm.exe,0"
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall MyTerm.exe" /currentuser'
  WriteRegStr HKCU "${UNINSTROOT}\${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall MyTerm.exe" /currentuser /S'
  WriteRegDWORD HKCU "${UNINSTROOT}\${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTROOT}\${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Call un.CloseRunning

  !insertmacro customUnInstall

  Delete "${SHORTCUTS}\MyTerm.lnk"
!ifndef SANDBOX
  Delete "$DESKTOP\MyTerm.lnk"
!endif
!ifdef SANDBOX
  RMDir "${SHORTCUTS}"
!endif

  Delete "$INSTDIR\MyTerm.exe"
  Delete "$INSTDIR\resources\myterm.cmd"
  Delete "$INSTDIR\resources\path-entry.ps1"
  RMDir "$INSTDIR\resources"
  Delete "$INSTDIR\Uninstall MyTerm.exe"
  ; Not recursive: a folder the user put other files in keeps them.
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTROOT}\${UNINSTKEY}"
SectionEnd

; `--force-run` is what the updater passes after a silent update; an interactive run offers it on the
; finish page instead.
Function .onInstSuccess
  ${GetParameters} $R0
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\MyTerm.exe"'
  ${EndIf}
FunctionEnd
