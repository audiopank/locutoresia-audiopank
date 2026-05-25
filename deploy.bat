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
git add fix_posts_rls_policies.sql
git add disable_posts_rls.sql
git add FIX_RLS_NOW.sql
git add remove_all_posts_policies.sql
git add commit_schema.bat
git add deploy.bat

echo.
echo 💾 Fazendo commit...
git commit -m "feat: atualiza dashboard e Posts Sociais, corrige RLS e formata notícias"

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
