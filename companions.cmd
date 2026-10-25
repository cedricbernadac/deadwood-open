@echo off
setlocal
title DEADWOOD - Compagnons IA
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
echo Demarrage des compagnons IA de DEADWOOD (cerveau OpenAI, ta cle OPENAI_API_KEY reste sur cet ordinateur).
echo Le jeu doit tourner sur cet ordinateur (play.cmd) : un seul cerveau sert les quatre decors du menu.
echo Le cerveau le cherche sur le port 3002 puis 3000, ou sur le port PORT s'il est defini. Essai sans API : companions.cmd --dry
echo Garde cette fenetre ouverte pendant la partie. Pour arreter les compagnons, appuie sur Ctrl+C.
call npm run companions -- %*
if errorlevel 1 (
    echo Les compagnons se sont arretes avec une erreur. Consulte le message ci-dessus.
) else (
    echo Les compagnons se sont arretes.
)
pause
endlocal
