@echo off
echo ========================================
echo   DEPLOY NOVO REPOSITÓRIO
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo [1/5] Verificando remote...
git remote -v
echo.
echo [2/5] Status atual do Git...
git status
echo.
echo [3/5] Adicionando todas as alterações...
git add -A
echo ✓ Arquivos adicionados!
echo.
echo [4/5] Fazendo commit...
git commit -m "🎉 Locutores IA Completo - Vozes, Autores, News Auto Post e Correções Vercel"
echo ✓ Commit feito!
echo.
echo [5/5] Enviando para o novo repositório...
echo URL: https://github.com/pankilhas2/locutoresia-master.git
echo.
git push -u origin main
echo.
echo ========================================
echo   DEPLOY CONCLUÍDO!
echo ========================================
echo.
echo Novo repositório: https://github.com/pankilhas2/locutoresia-master
echo.
echo Agora conecte este novo repositório no Vercel!
echo.
pause
