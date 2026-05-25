@echo off
echo ==========================================
echo 🚀 DEPLOY LOCUTORES IA - VERCEL
echo ==========================================
echo.

echo 📦 Adicionando arquivos ao Git...
git add backend/app.py
git add templates/socialpost.html
git add templates/news-auto-post.html
git add locutores_ia_supabase_schema.sql
git add deploy.bat

echo.
echo 💾 Fazendo commit...
git commit -m "feat: corrige bug na atualização de status dos posts na seção PENDENTES"

echo.
echo 📤 Enviando para GitHub...
git push

echo.
echo 🚀 Fazendo deploy no Vercel...
vercel --prod --yes

echo.
echo ==========================================
echo ✅ Deploy concluido!
echo ==========================================
pause
