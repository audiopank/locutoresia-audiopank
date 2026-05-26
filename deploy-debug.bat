@echo off
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo === Status atual do Git ===
git status
echo.
echo === Adicionando api/index.py ===
git add api/index.py
echo.
echo === Fazendo commit ===
git commit -m "Debug: Adicionar logs detalhados para diagnosticar erro Vercel"
echo.
echo === Enviando para o GitHub ===
git push origin main
echo.
echo === Pronto! ===
pause
