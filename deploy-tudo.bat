@echo off
echo ========================================
echo   DEPLOY COMPLETO - LOCUTORES IA
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo [1/5] Status atual do Git...
git status
echo.
echo [2/5] Adicionando todas as alterações...
git add -A
echo ✓ Arquivos adicionados!
echo.
echo [3/5] Fazendo commit...
git commit -m "🎉 Atualização completa: Vozes funcionando + Correções NewPost-IA + Scripts de teste"
echo ✓ Commit feito!
echo.
echo [4/5] Enviando para o GitHub...
git push origin main
echo ✓ Push concluído!
echo.
echo [5/5] Pronto!
echo ========================================
echo   DEPLOY CONCLUÍDO!
echo ========================================
echo.
echo O Vercel agora fará o deploy automático!
echo Acesse: https://locutoresia-iej7-eudespankilhas-2.vercel.app/
echo.
pause
