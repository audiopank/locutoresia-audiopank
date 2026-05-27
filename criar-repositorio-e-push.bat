@echo off
echo ========================================
echo   CRIAR REPOSITÓRIO VAZIO E PUSH
echo ========================================
echo.
echo PASSO 1: Crie um repositório COMPLETAMENTE VAZIO no GitHub!
echo.
echo Acesse: https://github.com/new
echo.
echo NÃO marque NENHUMA das opções:
echo   - Não marque "Add a README file"
echo   - Não marque "Add .gitignore"
echo   - Não marque "Choose a license"
echo.
echo Crie o repositório e depois volte aqui!
echo.
pause
echo.
cd /d "d:\DOWLOADS PROGRAMAS 2025\Locutores IA"
echo.
set /p REPO_NAME="Digite o nome do repositório que você criou: "
echo.
echo PASSO 2: Atualizando remote...
git remote set-url origin https://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@github.com/pankilhas2/%REPO_NAME%.git
echo ✓ Remote atualizado!
git remote -v
echo.
echo PASSO 3: Fazendo push...
git push -u origin main --force
echo.
echo ========================================
echo   CONCLUÍDO!
echo ========================================
echo.
echo Acesse seu repositório: https://github.com/pankilhas2/%REPO_NAME%
echo.
echo Agora conecte no Vercel!
echo.
pause
