@echo off
chcp 65001 >nul
echo ========================================
echo   LOCUTORES IA - INICIANDO SERVIDOR
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA\backend"
echo Diretorio: %CD%
echo.
echo Iniciando servidor Flask...
echo Acesse: http://localhost:5000
echo.
echo ========================================
echo.
py app.py
pause
