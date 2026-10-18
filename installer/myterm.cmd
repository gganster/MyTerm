@echo off
setlocal enabledelayedexpansion
rem MyTerm CLI shim.
rem
rem Installed into %LOCALAPPDATA%\MyTerm\bin and added to the *user* PATH by the
rem NSIS installer, so no elevation is ever required.
rem
rem The install directory is read from the registry key the installer writes,
rem which keeps the shim correct even when the user chooses a custom location.

set "MYTERM_EXE="

for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\MyTerm" /v InstallDir 2^>nul ^| findstr /i "InstallDir"') do (
  set "MYTERM_DIR=%%B"
)
if defined MYTERM_DIR if exist "!MYTERM_DIR!\MyTerm.exe" set "MYTERM_EXE=!MYTERM_DIR!\MyTerm.exe"

rem Fallbacks: the default per-user location, then a sibling of this shim.
if not defined MYTERM_EXE if exist "%LOCALAPPDATA%\Programs\MyTerm\MyTerm.exe" set "MYTERM_EXE=%LOCALAPPDATA%\Programs\MyTerm\MyTerm.exe"
if not defined MYTERM_EXE if exist "%~dp0..\MyTerm.exe" set "MYTERM_EXE=%~dp0..\MyTerm.exe"

if not defined MYTERM_EXE (
  echo MyTerm est introuvable. Reinstallez l'application.
  exit /b 1
)

rem `start ""` detaches so the calling terminal gets its prompt back instead of
rem blocking until MyTerm exits. %~f1 expands `.` and relative paths to a full
rem path, resolved against the caller's directory.
if "%~1"=="" (
  start "" "%MYTERM_EXE%"
) else (
  start "" "%MYTERM_EXE%" "%~f1"
)
endlocal
