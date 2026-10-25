@echo off
setlocal
title DEADWOOD - L'Hopital des Pins - Niveau 3
cd /d "%~dp0"
set "DEADWOOD_LEVEL=hospital"
set "PORT=3104"
if not "%~1"=="" set "PORT=%~1"
set "DEADWOOD_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined DEADWOOD_NODE set "DEADWOOD_NODE=%%N"
if not defined DEADWOOD_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "DEADWOOD_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined DEADWOOD_NODE (
    echo Node.js est introuvable. Installe Node.js 22 ou superieur puis relance ce fichier.
    pause
    exit /b 1
)
call "%DEADWOOD_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo Cette version de Node.js est trop ancienne. Installe Node.js 22 ou superieur.
    pause
    exit /b 1
)
if not exist "node_modules\three\package.json" goto install
if not exist "node_modules\ws\package.json" goto install

echo Demarrage du niveau 3. Garde cette fenetre ouverte pendant la partie.
echo Ouvre http://127.0.0.1:%PORT% dans Edge ou Chrome.
echo Pour arreter le serveur, appuie sur Ctrl+C.
call "%DEADWOOD_NODE%" start-hospital.mjs "%PORT%"
if errorlevel 1 goto failed
endlocal
exit /b 0

:install
where npm >nul 2>nul
if errorlevel 1 (
    echo Les dependances manquent et npm est introuvable.
    echo Installe Node.js 22 ou superieur avec npm, puis relance ce fichier.
    pause
    exit /b 1
)
for %%N in ("%DEADWOOD_NODE%") do set "PATH=%%~dpN;%PATH%"
call play.cmd
if errorlevel 1 goto failed
endlocal
exit /b 0

:failed
echo Le serveur s'est arrete avec une erreur. Consulte le message ci-dessus.
pause
endlocal
exit /b 1
