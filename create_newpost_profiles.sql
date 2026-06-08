-- ===========================================
-- CRIAR TABELA newpost_profiles
-- Execute este SQL no Supabase Dashboard: SQL Editor -> New Query
-- ===========================================

-- 1. Criar a tabela newpost_profiles
CREATE TABLE IF NOT EXISTS newpost_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    categoria TEXT DEFAULT 'Geral',
    criado_em TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_newpost_profiles_email ON newpost_profiles(email);
CREATE INDEX IF NOT EXISTS idx_newpost_profiles_categoria ON newpost_profiles(categoria);
CREATE INDEX IF NOT EXISTS idx_newpost_profiles_criado_em ON newpost_profiles(criado_em DESC);

-- 3. Garantir permissões
GRANT ALL ON newpost_profiles TO service_role;
GRANT ALL ON newpost_profiles TO authenticated;
GRANT ALL ON newpost_profiles TO anon;

-- 4. Habilitar RLS (Row Level Security)
ALTER TABLE IF EXISTS newpost_profiles ENABLE ROW LEVEL SECURITY;

-- 5. Criar políticas RLS permissivas para desenvolvimento
DROP POLICY IF EXISTS "Permitir todas as operações em newpost_profiles" ON newpost_profiles;
CREATE POLICY "Permitir todas as operações em newpost_profiles"
ON newpost_profiles
FOR ALL
USING (true)
WITH CHECK (true);

-- ===========================================
-- FIM DO SCRIPT
-- ===========================================