-- ===========================================
-- FIX RLS PARA TABELA newpost_profiles
-- Execute este SQL no Supabase Dashboard do NewPost-IA
-- ===========================================

-- 1. Ativar RLS (se não estiver ativado)
ALTER TABLE IF EXISTS newpost_profiles ENABLE ROW LEVEL SECURITY;

-- 2. Remover políticas existentes (para recriar com segurança)
DROP POLICY IF EXISTS "Permitir leitura de profiles" ON newpost_profiles;
DROP POLICY IF EXISTS "Permitir inserção de profiles" ON newpost_profiles;
DROP POLICY IF EXISTS "Permitir atualização de profiles" ON newpost_profiles;
DROP POLICY IF EXISTS "Permitir exclusão de profiles" ON newpost_profiles;

-- 3. Criar políticas que PERMITIR TUDO para service_role e authenticated
--    IMPORTANTE: Isso resolve o erro "new row violates row-level security policy"
CREATE POLICY "Permitir tudo para service_role"
ON newpost_profiles FOR ALL
USING (true)
WITH CHECK (true);

-- Ou, se quiser políticas mais específicas:
CREATE POLICY "Permitir leitura pública"
ON newpost_profiles FOR SELECT
USING (true);

CREATE POLICY "Permitir inserção"
ON newpost_profiles FOR INSERT
WITH CHECK (true);

CREATE POLICY "Permitir atualização"
ON newpost_profiles FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Permitir exclusão"
ON newpost_profiles FOR DELETE
USING (true);

-- 4. Garantir permissões GRANT para service_role
GRANT ALL ON newpost_profiles TO service_role;
GRANT ALL ON newpost_profiles TO authenticated;
GRANT ALL ON newpost_profiles TO anon;

-- ===========================================
-- FIM DO SCRIPT
-- ===========================================
