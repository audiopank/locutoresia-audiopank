-- Marcadores da MiniDAW (16/09/2026).
-- Rodar UMA vez no SQL Editor do projeto ykswhzqdjoshjoaruhqs (o banco do Locutores IA).
-- Até rodar, o projeto salva normalmente e a tela avisa que os marcadores ficaram de fora.
alter table public.minidaw_projects
    add column if not exists marcadores jsonb not null default '[]'::jsonb;
