-- ===========================================
-- CRIAR TABELA DE TRILHAS NA SUPABASE
-- ===========================================

-- Cria a tabela de trilhas
CREATE TABLE IF NOT EXISTS music_tracks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    artist TEXT DEFAULT 'Locutores IA',
    genre TEXT NOT NULL,
    mood TEXT NOT NULL,
    duration INTEGER NOT NULL, -- duração em segundos
    bpm INTEGER DEFAULT 120,
    description TEXT,
    file_url TEXT NOT NULL,
    file_size INTEGER, -- tamanho em bytes
    mime_type TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilita RLS (Row Level Security)
ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;

-- Cria políticas para permitir tudo (já que é para gerenciamento interno)
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON music_tracks;
CREATE POLICY "Allow all operations for authenticated users"
ON music_tracks
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Cria política para leitura pública
DROP POLICY IF EXISTS "Allow public read access" ON music_tracks;
CREATE POLICY "Allow public read access"
ON music_tracks
FOR SELECT
TO anon, authenticated
USING (true);

-- Cria trigger para atualizar o updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_music_tracks_updated_at ON music_tracks;
CREATE TRIGGER update_music_tracks_updated_at
BEFORE UPDATE ON music_tracks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Cria índices para performance
CREATE INDEX IF NOT EXISTS idx_music_tracks_genre ON music_tracks(genre);
CREATE INDEX IF NOT EXISTS idx_music_tracks_mood ON music_tracks(mood);
CREATE INDEX IF NOT EXISTS idx_music_tracks_is_active ON music_tracks(is_active);

-- ===========================================
-- FIM DO SCRIPT
-- ===========================================
