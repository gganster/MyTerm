@echo off
setlocal
rem MyTerm CLI shim.
rem
rem Installed into %LOCALAPPDATA%\MyTerm\bin and added to the *user* PATH by the
rem NSIS installer, so no elevation is required.
rem
rem Resolves the caller's directory to an absolute path and hands it to the app.
rem `start ""` detaches, so the calling terminal gets its prompt back instead of
rem blocking until MyTerm exits.

set "MYTERM_EXE=%LOCALAPPDATA%\Programs\MyTerm\MyTerm.exe"
if not exist "%MYTERM_EXE%" set "MYTERM_EXE=%~dp0..\MyTerm.exe"

if "%~1"=="" (
  start "" "%MYTERM_EXE%"
  goto :eof
)

rem %~f1 expands to a full path, which also handles `.` and relative paths.
set "TARGET=%~f1"
start "" "%MYTERM_EXE%" "%TARGET%"
endlocal
