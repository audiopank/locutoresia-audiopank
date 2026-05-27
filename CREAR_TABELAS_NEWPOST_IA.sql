-- ========================================================= 
-- INTEGRAÇÃO ÁUDIO PANK IA ↔ NEWPOST-IA 
-- Cole este SQL no SQL Editor do Supabase do NewPost-IA 
-- ========================================================= 
 
-- --------------------------------------------------------- 
-- TABELA 1: posts 
-- --------------------------------------------------------- 
CREATE TABLE IF NOT EXISTS public.posts ( 
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(), 
  title         TEXT        NOT NULL, 
  content       TEXT, 
  audio_url     TEXT, 
  status        TEXT        NOT NULL DEFAULT 'draft',  -- draft | ready | published | scheduled | error 
  source        TEXT,                                   -- ex: 'audio-pank-ia', 'rss', 'manual' 
  source_url    TEXT, 
  author_id     UUID        NOT NULL, 
  is_ia_generated BOOLEAN   NOT NULL DEFAULT false, 
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(), 
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now() 
); 
 
CREATE INDEX IF NOT EXISTS idx_posts_author_id  ON public.posts(author_id); 
CREATE INDEX IF NOT EXISTS idx_posts_status     ON public.posts(status); 
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts(created_at DESC); 
 
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated; 
GRANT ALL ON public.posts TO service_role; 
 
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY; 
 
CREATE POLICY "Users can view their own posts" 
  ON public.posts FOR SELECT TO authenticated 
  USING (auth.uid() = author_id); 
 
CREATE POLICY "Users can insert their own posts" 
  ON public.posts FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = author_id); 
 
CREATE POLICY "Users can update their own posts" 
  ON public.posts FOR UPDATE TO authenticated 
  USING (auth.uid() = author_id) 
  WITH CHECK (auth.uid() = author_id); 
 
CREATE POLICY "Users can delete their own posts" 
  ON public.posts FOR DELETE TO authenticated 
  USING (auth.uid() = author_id); 
 
 
-- --------------------------------------------------------- 
-- TABELA 2: audio_files 
-- --------------------------------------------------------- 
CREATE TABLE IF NOT EXISTS public.audio_files ( 
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(), 
  post_id        UUID        REFERENCES public.posts(id) ON DELETE CASCADE, 
  filename       TEXT        NOT NULL, 
  public_url     TEXT, 
  file_type      TEXT,                                  -- mp3 | wav | flac | ogg 
  voice_provider TEXT,                                  -- elevenlabs | openai | google | lmnt 
  voice_model    TEXT, 
  status         TEXT        NOT NULL DEFAULT 'ready', -- generating | ready | failed 
  created_by     UUID        NOT NULL, 
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now() 
); 
 
CREATE INDEX IF NOT EXISTS idx_audio_files_post_id ON public.audio_files(post_id); 
CREATE INDEX IF NOT EXISTS idx_audio_files_status  ON public.audio_files(status); 
 
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_files TO authenticated; 
GRANT ALL ON public.audio_files TO service_role; 
 
ALTER TABLE public.audio_files ENABLE ROW LEVEL SECURITY; 
 
CREATE POLICY "Users can view their own audio files" 
  ON public.audio_files FOR SELECT TO authenticated 
  USING (auth.uid() = created_by); 
 
CREATE POLICY "Users can insert their own audio files" 
  ON public.audio_files FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = created_by); 
 
CREATE POLICY "Users can update their own audio files" 
  ON public.audio_files FOR UPDATE TO authenticated 
  USING (auth.uid() = created_by); 
 
CREATE POLICY "Users can delete their own audio files" 
  ON public.audio_files FOR DELETE TO authenticated 
  USING (auth.uid() = created_by);
