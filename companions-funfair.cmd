@echo off
setlocal
title DEADWOOD - Compagnons de la Fete Foraine
cd /d "%~dp0"
set "DEADWOOD_LEVEL=funfair"
set "PORT=3105"
call companions.cmd %*
endlocal
