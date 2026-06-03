@echo off
chcp 65001 >nul
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo ========================================
echo   TESTANDO SUPABASE COM TODAS AS COMBINAÇÕES
echo ========================================
echo.
py test_all_keys.py
echo.
echo ========================================
echo   FIM DO TESTE
echo ========================================
pause
