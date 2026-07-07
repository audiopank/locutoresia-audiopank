-- Tabela de eventos reais de uso, pra alimentar as estatísticas da home
-- (Vozes IA / Áudios Gerados / Projetos), hoje mockadas no template.
-- Rodar no SQL Editor do projeto Supabase "Principal (Locutores IA)".

CREATE TABLE IF NOT EXISTS public.usage_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('audio_generated', 'project_saved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_type ON public.usage_events(event_type);

-- RLS ativado sem nenhuma policy: só a service_role (usada pelo backend Flask)
-- consegue ler/escrever. Nenhum acesso público direto, nem leitura nem escrita.
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
