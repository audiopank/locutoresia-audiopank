@echo off
echo ========================================
echo   DEPLOY: AUTORES NEWPOST-IA
echo ========================================
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo [1/6] Status atual do Git...
git status
echo.
echo [2/6] Adicionando todas as alterações...
git add -A
echo ✓ Arquivos adicionados!
echo.
echo [3/6] Fazendo commit...
git commit -m "🎉 Autores NewPost-IA + Auto-criação de perfil + Integração completa"
echo ✓ Commit feito!
echo.
echo [4/6] Enviando para o GitHub...
git push origin main
echo ✓ Push concluído!
echo.
echo [5/6] Pronto!
echo ========================================
echo   DEPLOY CONCLUÍDO!
echo ========================================
echo.
echo O Vercel agora fará o deploy automático!
echo Acesse: https://locutoresia-iej7-eudespankilhas-2.vercel.app/
echo.
pause
