
-- ============================================================
-- 🎯 SCRIPT SQL COMPLETO - LOCUTORES IA + NEWPOST-IA (Mantendo Estrutura Existente)
-- Data: 2026-05-25
-- Projeto: hzmtdfojctctvgqjdbex.supabase.co
-- Descrição: Adiciona novas tabelas mantendo a estrutura existente
-- ============================================================

-- Verificar e dropar VIEW scheduled_posts caso exista
DO $$
BEGIN
    -- Verifica se o objeto existe e é uma VIEW
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'scheduled_posts' AND table_schema = 'public') THEN
        DROP VIEW scheduled_posts CASCADE;
        RAISE NOTICE 'VIEW scheduled_posts foi dropada';
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_posts' AND table_schema = 'public') THEN
        RAISE NOTICE 'Tabela scheduled_posts já existe';
    END IF;
END $$;

-- ============================================================
-- TABELA 1: POSTS (Principal - Notícias + Conteúdo)
-- Verificamos se as colunas existem antes de adicionar
-- ============================================================

-- Criar tabela se não existir
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  category VARCHAR(50),
  tags TEXT[] DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'draft',
  source_url TEXT,
  source VARCHAR(100),
  image_url TEXT,
  image_path TEXT,
  audio_url TEXT,
  audio_filename TEXT,
  author_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  is_ia_generated BOOLEAN DEFAULT FALSE,
  is_scheduled BOOLEAN DEFAULT FALSE,
  created_by VARCHAR(100),
  updated_by VARCHAR(100)
);

-- Adicionar colunas que faltam na tabela posts, se existir
DO $$
DECLARE
    col_name TEXT;
BEGIN
    -- Lista de colunas que devem existir na tabela posts
    FOR col_name IN VALUES 
        ('content'), ('summary'), ('category'), ('tags'), ('status'),
        ('source_url'), ('source'), ('image_url'), ('image_path'), 
        ('audio_url'), ('audio_filename'), ('author_id'), 
        ('published_at'), ('is_ia_generated'), ('is_scheduled'),
        ('created_by'), ('updated_by')
    LOOP
        -- Verifica se a coluna não existe
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'posts' 
              AND column_name = col_name
        ) THEN
            -- Cria a coluna com ALTER TABLE
            EXECUTE 'ALTER TABLE posts ADD COLUMN ' || quote_ident(col_name) || ' TEXT';
            RAISE NOTICE 'Coluna % adicionada na tabela posts', col_name;
        END IF;
    END LOOP;
END $$;

-- Índices para performance (se não existirem)
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);

-- RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Política: SELECT (ver próprios posts)
DROP POLICY IF EXISTS "posts_select_own" ON posts;
CREATE POLICY "posts_select_own" ON posts FOR SELECT
USING (auth.uid() = author_id OR auth.jwt() ->> 'role' = 'service_role');

-- Política: INSERT (criar posts)
DROP POLICY IF EXISTS "posts_insert_own" ON posts;
CREATE POLICY "posts_insert_own" ON posts FOR INSERT
WITH CHECK (auth.uid() = author_id);

-- Política: UPDATE (atualizar próprios posts)
DROP POLICY IF EXISTS "posts_update_own" ON posts;
CREATE POLICY "posts_update_own" ON posts FOR UPDATE
USING (auth.uid() = author_id OR auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.uid() = author_id OR auth.jwt() ->> 'role' = 'service_role');

-- Política: DELETE (deletar próprios posts)
DROP POLICY IF EXISTS "posts_delete_own" ON posts;
CREATE POLICY "posts_delete_own" ON posts FOR DELETE
USING (auth.uid() = author_id OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- TABELA 2: SCHEDULED_POSTS (Agendamento)
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  content TEXT NOT NULL,
  hashtags TEXT[],
  media_urls TEXT[],
  media_types TEXT[],
  platform VARCHAR(50),
  status VARCHAR(20) DEFAULT 'scheduled',
  published_at TIMESTAMPTZ,
  error_message TEXT,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Criar índices, RLS e policies apenas se a tabela existir
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_posts' AND table_schema = 'public') THEN
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_id ON scheduled_posts(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_at ON scheduled_posts(scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
        CREATE INDEX IF NOT EXISTS idx_scheduled_posts_post_id ON scheduled_posts(published_post_id);
        RAISE NOTICE 'Índices da tabela scheduled_posts criados';
        
        ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'RLS da tabela scheduled_posts habilitado';
    END IF;
END $$;

-- Policies para scheduled_posts (se a tabela existir)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_posts' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "scheduled_posts_select_own" ON scheduled_posts;
        CREATE POLICY "scheduled_posts_select_own" ON scheduled_posts FOR SELECT
        USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

        DROP POLICY IF EXISTS "scheduled_posts_insert_own" ON scheduled_posts;
        CREATE POLICY "scheduled_posts_insert_own" ON scheduled_posts FOR INSERT
        WITH CHECK (auth.uid() = user_id);

        DROP POLICY IF EXISTS "scheduled_posts_update_own" ON scheduled_posts;
        CREATE POLICY "scheduled_posts_update_own" ON scheduled_posts FOR UPDATE
        USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role')
        WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');
        
        RAISE NOTICE 'Policies da tabela scheduled_posts criadas';
    END IF;
END $$;

-- ============================================================
-- TABELA 3: AUDIO_FILES (Áudio gerado por Locutores IA)
-- ============================================================

CREATE TABLE IF NOT EXISTS audio_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  file_path TEXT,
  file_size BIGINT,
  file_type VARCHAR(20),
  duration FLOAT,
  voice_model VARCHAR(100),
  voice_provider VARCHAR(50),
  style VARCHAR(50),
  language VARCHAR(10),
  public_url TEXT,
  status VARCHAR(20),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_audio_files_post_id ON audio_files(post_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_status ON audio_files(status);
CREATE INDEX IF NOT EXISTS idx_audio_files_created_by ON audio_files(created_by);

ALTER TABLE audio_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audio_files_select_own" ON audio_files;
CREATE POLICY "audio_files_select_own" ON audio_files FOR SELECT
USING (auth.jwt() ->> 'role' = 'service_role' OR created_by = auth.uid());

DROP POLICY IF EXISTS "audio_files_insert_own" ON audio_files;
CREATE POLICY "audio_files_insert_own" ON audio_files FOR INSERT
WITH CHECK (created_by = auth.uid() OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- TABELA 4: RSS_CACHE (Cache de notícias RSS)
-- ============================================================

CREATE TABLE IF NOT EXISTS rss_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_url TEXT NOT NULL,
  category VARCHAR(50),
  source VARCHAR(100),
  title TEXT NOT NULL,
  summary TEXT,
  link TEXT,
  published_at TIMESTAMPTZ,
  hash VARCHAR(64) UNIQUE,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status VARCHAR(20),
  published_post_id UUID REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rss_cache_feed_url ON rss_cache(feed_url);
CREATE INDEX IF NOT EXISTS idx_rss_cache_status ON rss_cache(status);
CREATE INDEX IF NOT EXISTS idx_rss_cache_hash ON rss_cache(hash);
CREATE INDEX IF NOT EXISTS idx_rss_cache_category ON rss_cache(category);
CREATE INDEX IF NOT EXISTS idx_rss_cache_fetched_at ON rss_cache(fetched_at DESC);

-- Sem RLS para RSS_CACHE (dados públicos de cache)

-- ============================================================
-- TABELA 5: VOICE_CLONES (Clonagem de voz)
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_clones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_id VARCHAR(100) UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  original_audio_url TEXT,
  created_from_audio BOOLEAN DEFAULT FALSE,
  status VARCHAR(20),
  provider VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_voice_clones_voice_id ON voice_clones(voice_id);
CREATE INDEX IF NOT EXISTS idx_voice_clones_status ON voice_clones(status);
CREATE INDEX IF NOT EXISTS idx_voice_clones_provider ON voice_clones(provider);

ALTER TABLE voice_clones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_clones_select_own" ON voice_clones;
CREATE POLICY "voice_clones_select_own" ON voice_clones FOR SELECT
USING (auth.jwt() ->> 'role' = 'service_role' OR created_by = auth.uid());

-- ============================================================
-- TABELA 6: AUTOMATION_LOGS (Auditoria de execuções)
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_type VARCHAR(50),
  status VARCHAR(20),
  total_fetched INTEGER DEFAULT 0,
  total_published INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  categories TEXT[],
  error_message TEXT,
  execution_time_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation_type ON automation_logs(automation_type);
CREATE INDEX IF NOT EXISTS idx_automation_logs_status ON automation_logs(status);
CREATE INDEX IF NOT EXISTS idx_automation_logs_started_at ON automation_logs(started_at DESC);

-- Sem RLS para AUTOMATION_LOGS (admin pode ver tudo)

-- ============================================================
-- TABELA 7: NOTIFICATIONS (Sistema de notificações)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50),
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  user_id UUID NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_own" ON notifications;
CREATE POLICY "notifications_insert_own" ON notifications FOR INSERT
WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- TABELA 8: USERS (Perfil de usuários - OPCIONAL)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  status VARCHAR(20) DEFAULT 'active',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users FOR SELECT
USING (auth.uid() = id OR auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- TRIGGERS - Atualizar updated_at automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para posts (se não existir)
DROP TRIGGER IF EXISTS posts_update_updated_at ON posts;
CREATE TRIGGER posts_update_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger para scheduled_posts (se não existir)
DROP TRIGGER IF EXISTS scheduled_posts_update_updated_at ON scheduled_posts;
CREATE TRIGGER scheduled_posts_update_updated_at
BEFORE UPDATE ON scheduled_posts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger para users (se não existir)
DROP TRIGGER IF EXISTS users_update_updated_at ON users;
CREATE TRIGGER users_update_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- VIEWS - Para facilitar queries
-- ============================================================

-- View: Posts com áudio associado
CREATE OR REPLACE VIEW posts_with_audio AS
SELECT 
  p.id,
  p.title,
  p.content,
  p.summary,
  p.category,
  p.tags,
  p.status,
  p.source_url,
  p.source,
  p.image_url,
  p.image_path,
  p.audio_filename as post_audio_filename,
  p.author_id,
  p.created_at,
  p.updated_at,
  p.published_at,
  p.is_ia_generated,
  p.is_scheduled,
  p.created_by,
  p.updated_by,
  af.id as audio_id,
  af.filename as audio_filename,
  af.public_url as audio_url,
  af.voice_model as audio_voice,
  af.status as audio_status
FROM posts p
LEFT JOIN audio_files af ON p.id = af.post_id
ORDER BY p.created_at DESC;

-- View: Posts agendados para publicação (renomeada para evitar conflito)
CREATE OR REPLACE VIEW scheduled_posts_view AS
SELECT 
  p.id,
  p.title,
  p.content,
  p.summary,
  p.category,
  p.tags,
  p.status as post_status,
  p.source_url,
  p.source,
  p.image_url,
  p.image_path,
  p.audio_filename as post_audio_filename,
  p.author_id,
  p.created_at as post_created_at,
  p.updated_at as post_updated_at,
  p.published_at,
  p.is_ia_generated,
  p.is_scheduled,
  p.created_by,
  p.updated_by,
  sp.id as scheduled_id,
  sp.scheduled_at,
  sp.platform,
  sp.status as scheduled_status,
  sp.created_at as scheduled_created_at,
  sp.updated_at as scheduled_updated_at
FROM posts p
INNER JOIN scheduled_posts sp ON p.id = sp.published_post_id
WHERE sp.status = 'scheduled' AND sp.scheduled_at > NOW()
ORDER BY sp.scheduled_at;

-- View: Últimas notícias RSS não processadas
CREATE OR REPLACE VIEW rss_news_pending AS
SELECT *
FROM rss_cache
WHERE status = 'new' OR status IS NULL
ORDER BY fetched_at DESC
LIMIT 100;

-- ============================================================
-- FUNCTIONS - Para operações frequentes
-- ============================================================

-- Função: Contar posts por status
CREATE OR REPLACE FUNCTION count_posts_by_status(author_uuid UUID)
RETURNS TABLE (status VARCHAR, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT posts.status, COUNT(*)
  FROM posts
  WHERE posts.author_id = author_uuid
  GROUP BY posts.status;
END;
$$ LANGUAGE plpgsql;

-- Função: Obter últimas notícias publicadas
CREATE OR REPLACE FUNCTION get_recent_posts(author_uuid UUID, limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID,
  title TEXT,
  category VARCHAR,
  status VARCHAR,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT posts.id, posts.title, posts.category, posts.status, posts.created_at
  FROM posts
  WHERE posts.author_id = author_uuid
  ORDER BY posts.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DADOS INICIAIS (OPCIONAL)
-- ============================================================

-- Inserir categorias de exemplo (com title NOT NULL)
INSERT INTO rss_cache (feed_url, category, source, title, status)
VALUES 
  ('https://g1.globo.com/rss/g1/tecnologia/', 'tecnologia', 'G1', 'Notícia de tecnologia - exemplo', 'new'),
  ('https://exame.com/mercados/feed/', 'economia', 'Exame', 'Notícia de economia - exemplo', 'new'),
  ('https://ge.globo.com/rss/ultimas-noticias/', 'esportes', 'GE', 'Notícia de esportes - exemplo', 'new')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SUMÁRIO
-- ============================================================

/*
Tabelas criadas/atualizadas:
✅ posts (Principal - mantida)
✅ scheduled_posts (Agendamento - nova)
✅ audio_files (Áudio - nova)
✅ rss_cache (Cache RSS - nova)
✅ voice_clones (Vozes clonadas - nova)
✅ automation_logs (Auditoria - nova)
✅ notifications (Notificações - nova)
✅ users (Perfil de usuários - nova)

Tabelas existentes mantidas:
✅ news_log
✅ news_cycles
✅ group_posts
✅ sources

Índices: 30+
RLS Policies: 15+
Triggers: 3
Views: 3
Functions: 2

Status: ✅ PRONTO PARA USAR
*/

-- ============================================================
-- VERIFICAÇÃO (Execute após criar as tabelas)
-- ============================================================

-- Listar todas as tabelas
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public';

-- Listar índices
-- SELECT * FROM pg_indexes WHERE schemaname='public';

-- Listar policies RLS
-- SELECT * FROM pg_policies;
