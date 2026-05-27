@echo off
echo ========================================
echo   PUSH INICIAL - NOVO REPOSITÓRIO
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo [1/5] Remote atual:
git remote -v
echo.
echo [2/5] Status...
git status
echo.
echo [3/5] Adicionando TUDO...
git add -A
echo ✓ Arquivos adicionados!
echo.
echo [4/5] Commit inicial completo...
git commit -m "🎉 LOCUTORES IA COMPLETO - Vozes, Autores, News Auto Post e Correções Vercel"
echo ✓ Commit feito!
echo.
echo [5/5] PUSH FORCE para o novo repositório...
echo.
git push -u origin main --force
echo.
echo ========================================
echo   PUSH CONCLUÍDO!
echo ========================================
echo.
echo Novo repositório: https://github.com/pankilhas2/locutoresia-master
echo.
echo Agora conecte no Vercel!
echo.
pause
