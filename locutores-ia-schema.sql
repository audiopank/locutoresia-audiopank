-- =====================================================================
-- 🎙️ LOCUTORES IA — Studio Audio Pank
-- Schema completo para importar no Supabase
-- Execute no SQL Editor do seu novo projeto Supabase
-- =====================================================================

-- 0) Extensões
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- 1) ENUM de roles + tabela user_roles + has_role (SECURITY DEFINER)
-- =====================================================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- =====================================================================
-- 2) Helper: trigger genérico updated_at
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- =====================================================================
-- 3) profiles (vinculado a auth.users)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  full_name text,
  avatar_url text,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles select all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Profiles update own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Profiles insert own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cria profile automaticamente ao registrar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username, avatar_url)
  VALUES (NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 4) audio_projects (núcleo do Studio)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  script text NOT NULL,
  voice_provider text NOT NULL DEFAULT 'openai',
  voice_model text,
  voice_name text,
  voice_audio_url text,
  soundtrack_url text,
  soundtrack_filename text,
  mixed_audio_url text,
  voice_volume numeric DEFAULT 0.8,
  music_volume numeric DEFAULT 0.3,
  storyboard_images jsonb DEFAULT '[]'::jsonb,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_projects TO authenticated;
GRANT ALL ON public.audio_projects TO service_role;
ALTER TABLE public.audio_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select" ON public.audio_projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners insert" ON public.audio_projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update" ON public.audio_projects FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete" ON public.audio_projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER audio_projects_updated_at BEFORE UPDATE ON public.audio_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_audio_projects_user ON public.audio_projects(user_id, created_at DESC);

-- =====================================================================
-- 5) project_versions (histórico/rollback)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.audio_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  name text,
  description text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.project_versions TO authenticated;
GRANT ALL ON public.project_versions TO service_role;
ALTER TABLE public.project_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Versions select own" ON public.project_versions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Versions insert own" ON public.project_versions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Versions delete own" ON public.project_versions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Auto-incrementa version_number por project_id
CREATE OR REPLACE FUNCTION public.get_next_version_number(p_project_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  SELECT COALESCE(MAX(version_number),0)+1 INTO n FROM public.project_versions WHERE project_id = p_project_id;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.set_version_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version_number := public.get_next_version_number(NEW.project_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS project_versions_set_number ON public.project_versions;
CREATE TRIGGER project_versions_set_number BEFORE INSERT ON public.project_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_version_number();

CREATE INDEX IF NOT EXISTS idx_project_versions_project ON public.project_versions(project_id, version_number DESC);

-- =====================================================================
-- 6) notifications
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',  -- info | success | error | warning
  read boolean NOT NULL DEFAULT false,
  related_id uuid,
  related_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notif select own" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Notif insert own" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Notif update own" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Notif delete own" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

-- =====================================================================
-- 7) ai_music (cache de trilhas geradas via MusicGen)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ai_music (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style_id text,
  music_url text NOT NULL,
  public_url text,
  duration integer,
  bpm integer,
  prompt text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.ai_music TO anon, authenticated;
GRANT ALL ON public.ai_music TO service_role;
ALTER TABLE public.ai_music ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Music public read" ON public.ai_music FOR SELECT USING (true);

-- =====================================================================
-- 8) audio_tags
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audio_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8B5CF6',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audio_tags TO anon, authenticated;
GRANT ALL ON public.audio_tags TO service_role;
ALTER TABLE public.audio_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tags public read" ON public.audio_tags FOR SELECT USING (true);

-- =====================================================================
-- 9) chat_history (Assistente VoxCraft)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  is_bot boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.chat_history TO authenticated;
GRANT ALL ON public.chat_history TO service_role;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chat select own" ON public.chat_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Chat insert own" ON public.chat_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Chat delete own" ON public.chat_history FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================================================================
-- 10) Storage bucket: audio-projects
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-projects','audio-projects', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas do bucket
CREATE POLICY "audio-projects public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio-projects');

CREATE POLICY "audio-projects auth upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "audio-projects owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'audio-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "audio-projects owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'audio-projects' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =====================================================================
-- FIM. Verifique RLS, regenere types e configure os secrets das edge functions.
-- =====================================================================
