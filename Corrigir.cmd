@echo off
rem Botão único do professor: duplo clique e o programa roda.
chcp 65001 >nul
cd /d "%~dp0"
call npm run corrigir
echo.
pause
