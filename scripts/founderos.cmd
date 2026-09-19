@echo off
rem  Entry point for the Windows helper scripts.
rem
rem  Windows ships with PowerShell's execution policy at Restricted, so running
rem  .\scripts\backup.ps1 directly fails on a fresh PC until you change a
rem  machine setting. Going through this .cmd sets Bypass for that one process
rem  instead, so the move to a new PC never depends on host configuration.
rem
rem    scripts\founderos bootstrap [-Restore]
rem    scripts\founderos backup    [-BackupDir <path>] [-KeepDays 90] [-SkipSecrets]
rem    scripts\founderos restore   [-BackupDir <path>] [-Force]

setlocal enabledelayedexpansion
set "CMD=%~1"

if "%CMD%"=="" goto usage
if /i "%CMD%"=="bootstrap" goto ok
if /i "%CMD%"=="backup"    goto ok
if /i "%CMD%"=="restore"   goto ok
echo Unknown command: %CMD%
goto usage

:ok
set "SCRIPT=%~dp0%CMD%.ps1"
if not exist "%SCRIPT%" (
  echo Missing script: %SCRIPT%
  exit /b 1
)

rem Collect everything after the command name, preserving quoting.
set "ARGS="
:collect
shift
if "%~1"=="" goto run
set "ARGS=!ARGS! %1"
goto collect

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" !ARGS!
exit /b %ERRORLEVEL%

:usage
echo.
echo   scripts\founderos bootstrap   Set up this PC ^(fnm, Node 22, npm ci, .env.local^)
echo   scripts\founderos backup      Snapshot the databases + encrypt .env.local to the backup folder
echo   scripts\founderos restore     Restore the databases + decrypt .env.local from the backup folder
echo.
exit /b 1
