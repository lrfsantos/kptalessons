@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title CNA Corretor - Correcao completa

echo ============================================
echo  CNA Corretor - Instalacao e execucao
echo  Tudo acontece nesta pasta, nada sai dela.
echo ============================================
echo.

rem ---------- 1. Node.js (>= 18) — usa o embutido na pasta, se existir ----------
echo [1/5] Node.js...
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Nao encontrei o Node.js. Tentando instalar com winget...
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
for /f "tokens=1 delims=v." %%a in ('node --version 2^>nul') do set MAJOR=%%a
if not defined MAJOR (
  echo [ERRO] Node.js ausente e nao consegui instalar automaticamente.
  echo Instale em https://nodejs.org e rode este arquivo de novo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
if %MAJOR% LSS 18 (
  echo [ERRO] Node.js muito antigo (major %MAJOR%^). Instale 18 ou superior.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
echo Node.js OK (versao principal %MAJOR%^).

rem ---------- 2. Dependencias ----------
echo [2/5] Dependencias do programa...
if not exist "node_modules" (
  echo Instalando dependencias ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)
echo Dependencias OK.

rem ---------- 3. Navegador (Edge ou Chrome) ----------
echo [3/5] Navegador...
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" goto browser_ok
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" goto browser_ok
where msedge >nul 2>&1 && goto browser_ok
where chrome >nul 2>&1 && goto browser_ok
echo [ERRO] Nao encontrei o Microsoft Edge nem o Chrome.
echo Instale o Edge: https://www.microsoft.com/edge
start "" "https://www.microsoft.com/edge"
pause
exit /b 1
:browser_ok
echo Navegador OK.

rem ---------- 4. Login ----------
echo [4/5] Login no CNA...
if not exist "session.json" (
  echo Primeira vez neste computador. Vamos abrir o login do CNA:
  echo voce digita a SUA conta, e a sessao fica salva somente aqui.
  call npm run login
) else (
  echo Sessao ja existe.
)

rem ---------- 5. Rodar ----------
echo [5/5] Rodando o programa...
call npm run corrigir
echo.
echo [fim] Pressione qualquer tecla para fechar.
pause
