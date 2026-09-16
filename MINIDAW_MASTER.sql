-- Suíte Master da MiniDAW (EQ master, 16/09/2026).
-- Rodar UMA vez no SQL Editor do projeto ykswhzqdjoshjoaruhqs (o banco do Locutores IA).
-- Até rodar, o projeto salva normalmente e a tela avisa que o EQ master ficou de fora.
alter table public.minidaw_projects
    add column if not exists master jsonb not null default '{}'::jsonb;
