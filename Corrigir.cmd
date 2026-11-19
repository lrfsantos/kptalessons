@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title CORRETOR CNA

echo CORRETOR CNA
echo ============
echo.
echo Inicializando...
echo Verificando componentes locais...
echo.

rem Caminhos locais: nada e instalado, nada e baixado.
set "PATH=%~dp0runtime\node;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0runtime\ms-playwright"
set "BROWSER=chromium"

if not exist "%~dp0runtime\node\node.exe" goto falha_node
if not exist "%~dp0node_modules\playwright-core" goto falha_deps
if not exist "%~dp0runtime\ms-playwright\chromium-1255" goto falha_chromium

echo Node.js portatil: OK
echo Playwright: OK
echo Chromium portatil: OK
echo.
"%~dp0runtime\node\node.exe" --version >nul 2>&1 || goto falha_node

call "%~dp0runtime\node\node.exe" corrigir.js
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo O programa encontrou um problema. Anote a mensagem acima.
echo A janela permanece aberta para voce ler.
pause
exit /b %EXITCODE%

:falha_node
echo ERRO: Node.js portatil ausente em runtime\node\node.exe.
echo A pasta de distribuicao esta incompleta. Nao tente instalar nada.
pause
exit /b 1

:falha_deps
echo ERRO: dependencias ausentes em node_modules\.
echo A pasta de distribuicao esta incompleta. Nao tente instalar nada.
pause
exit /b 1

:falha_chromium
echo ERRO: Chromium portatil ausente em runtime\ms-playwright\.
echo A pasta de distribuicao esta incompleta. Nao tente instalar nada.
pause
exit /b 1
