@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title CORRETOR CNA

echo CORRETOR CNA
echo ============
echo.

rem Caminhos locais: nada e instalado, nada e baixado.
set "PATH=%~dp0runtime\node;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0runtime\ms-playwright"
set "BROWSER=chromium"

if not exist "%~dp0runtime\node\node.exe" goto falha_node
if not exist "%~dp0node_modules\playwright-core" goto falha_deps

rem Carrega .env quando existir (sem dependencias externas).
if not exist "%~dp0.env" goto sem_env
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0.env") do (
  if not "%%A"=="" set "%%A=%%B"
)
:sem_env

echo Verificando componentes locais...
"%~dp0runtime\node\node.exe" preflight.js
if errorlevel 1 (
  echo.
  echo ERRO: pre-flight falhou. Veja as mensagens acima.
  echo A janela permanece aberta para voce ler.
  pause
  exit /b 1
)
echo.

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
