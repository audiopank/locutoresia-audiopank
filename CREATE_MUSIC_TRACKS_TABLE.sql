-- Tabela da Biblioteca de Trilhas Sonoras (Mixer do MiniDAW).
-- Rodar no SQL Editor do projeto Supabase "NewPost-IA" (ykswhzqdjoshjoaruhqs),
-- que é onde o schema do Locutores IA está de fato hospedado hoje.

CREATE TABLE IF NOT EXISTS public.music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  artist TEXT,
  genre TEXT,
  mood TEXT,
  duration INTEGER,
  bpm INTEGER,
  description TEXT,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_active ON public.music_tracks(is_active);

ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;

-- Leitura pública: é uma biblioteca de trilhas, sem dado sensível de usuário.
DROP POLICY IF EXISTS "music_tracks_public_read" ON public.music_tracks;
CREATE POLICY "music_tracks_public_read" ON public.music_tracks
  FOR SELECT USING (is_active = true);

-- Nenhuma policy de INSERT/UPDATE/DELETE pra anon/authenticated:
-- só a service_role (usada pelo backend Flask no upload/exclusão) grava.
