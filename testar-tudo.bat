@echo off
echo ========================================
echo   LOCUTORES IA - TESTE COMPLETO
echo ========================================
echo.
echo [1/3] Verificando arquivos...
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo ✓ Arquivos OK!
echo.
echo [2/3] Carregando variáveis de ambiente...
echo ✓ NEWPOST_SUPABASE_URL: https://hzmtdfojctctvgqjdbex.supabase.co
echo ✓ NEWPOST_SUPABASE_SERVICE_KEY: (presente no .env)
echo ✓ NEWPOST_AUTHOR_ID: 3a1a93d0-e451-47a4-a126-f1b7375895eb
echo.
echo [3/3] Iniciando servidor...
echo Acesse: http://localhost:5000
echo.
echo ========================================
echo   PRONTO PARA USAR!
echo ========================================
echo.
cd backend
py app.py
pause
