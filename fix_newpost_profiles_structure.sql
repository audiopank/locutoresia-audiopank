-- ===========================================
-- FIX ESTRUTURA DA TABELA newpost_profiles
-- Execute este SQL no Supabase Dashboard
-- ===========================================

-- 1. Primeiro, REMOVER a foreign key constraint que está causando o erro
ALTER TABLE newpost_profiles 
DROP CONSTRAINT IF EXISTS newpost_profiles_id_fkey;

-- 2. ALTERAR a tabela para ter id com valor padrão gen_random_uuid()
ALTER TABLE newpost_profiles 
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. Garantir que todas as permissões estão corretas
GRANT ALL ON newpost_profiles TO service_role;
GRANT ALL ON newpost_profiles TO authenticated;
GRANT ALL ON newpost_profiles TO anon;

-- ===========================================
-- FIM DO SCRIPT
-- ===========================================
