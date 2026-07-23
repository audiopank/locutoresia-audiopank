-- CREATE_MINIDAW_PROJECTS_TABLE.sql
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".
--
-- CONTEXTO
-- Salvar um projeto da MiniDAW e reabrir DEPOIS trazendo a voz + trilha + efeitos
-- de volta -- pra quando o cliente pede "troca só a trilha" semanas depois, sem
-- refazer a mixagem do zero.
--
-- Hoje havia 3 mecanismos, todos furados: localStorage (salva só ajustes, sem
-- áudio), arquivo .vip (base64 num arquivo de disco, frágil) e /api/projects
-- (gravava em /tmp da Vercel, efêmero -> sumia). Esta tabela substitui o /tmp.
--
-- O ÁUDIO em si NÃO fica aqui: cada faixa sobe pro Storage (bucket
-- 'client-deliveries', pasta 'projetos/') e o caminho é guardado dentro de
-- `tracks`. Assim a linha fica leve e o download é por signed URL.

CREATE TABLE IF NOT EXISTS public.minidaw_projects (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    roteiro    text DEFAULT '',
    -- Array de faixas. Cada item:
    --   { id, name, type ('voice'|'music'), volume, pan, fadeIn, fadeOut,
    --     effects {...}, eqSettings {...}, audio_path 'projetos/<uuid>.wav' }
    tracks     jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minidaw_projects_updated
    ON public.minidaw_projects (updated_at DESC);

-- RLS ligada e SEM policy de anon: o app fala com esta tabela via service_role
-- (que ignora RLS). Mesma postura das outras tabelas de dado interno.
ALTER TABLE public.minidaw_projects ENABLE ROW LEVEL SECURITY;

-- Conferir:
-- SELECT id, name, jsonb_array_length(tracks) AS faixas, updated_at
--   FROM public.minidaw_projects ORDER BY updated_at DESC;
