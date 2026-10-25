@echo off
setlocal
title DEADWOOD - Last Light
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js est introuvable. Installe Node.js 22 ou superieur depuis https://nodejs.org puis relance ce fichier.
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo Cette version de Node.js est trop ancienne. Installe Node.js 22 ou superieur puis relance ce fichier.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm est introuvable. Reinstalle Node.js avec npm puis relance ce fichier.
    pause
    exit /b 1
)

if not exist "node_modules\three\package.json" goto install
if not exist "node_modules\ws\package.json" goto install
goto launch

:install
echo Premiere installation des dependances. Une connexion Internet est necessaire.
call npm install
if errorlevel 1 (
    echo L'installation a echoue. Verifie ta connexion Internet puis relance ce fichier.
    pause
    exit /b 1
)

:launch
if not defined PORT set "PORT=3000"
if defined DEADWOOD_LEVEL goto level_launch
echo Demarrage de DEADWOOD : choisis le decor (cabane, supermarche, hopital, fete foraine) dans le menu du jeu.
echo Garde cette fenetre ouverte pendant la partie.
echo Ouvre http://localhost:%PORT% sur cet ordinateur.
echo Les autres joueurs utilisent l'adresse reseau affichee par le serveur.
echo Pour arreter le serveur, appuie sur Ctrl+C.
call npm run start:lan
goto server_stopped

:level_launch
echo Demarrage de DEADWOOD. Garde cette fenetre ouverte pendant la partie.
echo Ouvre http://localhost:%PORT% sur cet ordinateur.
echo Les autres joueurs utilisent l'adresse reseau affichee par le serveur.
echo Pour arreter le serveur, appuie sur Ctrl+C.
call npm start

:server_stopped
if errorlevel 1 (
    echo Le serveur s'est arrete avec une erreur. Consulte le message ci-dessus.
    pause
)
endlocal
