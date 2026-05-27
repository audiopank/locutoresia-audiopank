@echo off
echo ========================================
echo   PUSH FINAL - COM TOKEN
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo [1/4] Configurando remote com token...
git remote set-url origin https://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@github.com/pankilhas2/locutoresia-master.git
git remote -v
echo.
echo [2/4] Status...
git status
echo.
echo [3/4] Adicionando e commitando (se necessário)...
git add -A
git commit -m "🎉 LOCUTORES IA COMPLETO - Vozes, Autores, News Auto Post e Correções Vercel" 2>nul || echo Nada novo para commit
echo.
echo [4/4] PUSH FORCE para o novo repositório...
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
