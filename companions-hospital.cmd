@echo off
setlocal
title DEADWOOD - Compagnons de l'Hopital des Pins
cd /d "%~dp0"
set "DEADWOOD_LEVEL=hospital"
set "PORT=3104"
call companions.cmd %*
endlocal
