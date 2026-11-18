@echo off
rem ARZ Terminal server launcher: restarts the server if it crashes, logs to local\server.log
rem Exit code 98 = port already in use (another instance is running) -> do NOT loop.
setlocal
cd /d "%~dp0.."
if not exist local mkdir local
rem rotate the log when it grows past ~5 MB
if exist local\server.log for %%A in (local\server.log) do if %%~zA GTR 5242880 move /y local\server.log local\server.log.old >nul 2>&1
:loop
echo [%date% %time%] start >> local\server.log
node server.js >> local\server.log 2>&1
set RC=%errorlevel%
echo [%date% %time%] exit code %RC% >> local\server.log
if "%RC%"=="98" goto end
rem ping is used as a delay because "timeout" fails without a console
ping -n 6 127.0.0.1 >nul
goto loop
:end
