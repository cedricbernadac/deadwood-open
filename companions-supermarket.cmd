@echo off
setlocal
title DEADWOOD - Compagnons du Dernier Panier
cd /d "%~dp0"
set "DEADWOOD_LEVEL=supermarket"
set "PORT=3013"
call companions.cmd %*
endlocal
