-- CAMPANHAS AGENDADAS (16/10/2026) — Locutores IA publica campanhas repetidas no feed.
-- Rodar no SQL Editor do projeto Supabase da NewPost-IA: esdglycwumxxksqpeima
-- (no painel aparece como "newpost-rede"). NÃO é o projeto do Locutores IA (ykswh).
-- Cada linha pertence ao perfil que publica (auth.uid()); o Locutores IA loga em
-- cada perfil e só enxerga/mexe nas linhas dele. Pode rodar de novo sem estragar nada.

create table if not exists public.campanhas_locutores (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null default auth.uid(),
    conta text not null,
    titulo text not null,
    legenda text not null,
    tags text[] not null default '{}',
    audio_url text,
    transcricao text,
    imagem_url text,
    regra text not null check (regra in ('intervalo', 'semana')),
    intervalo_dias int check (intervalo_dias between 1 and 30),
    dias_semana int[] not null default '{}',
    horario int not null check (horario in (9, 15, 21)),
    proxima_em date not null,
    ativa boolean not null default true,
    vezes int not null default 0,
    ultima_em timestamptz,
    ultimo_post_id uuid,
    ultimo_erro text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.campanhas_config (
    author_id uuid primary key default auth.uid(),
    teto_diario int not null default 1 check (teto_diario between 1 and 3),
    updated_at timestamptz not null default now()
);

alter table public.campanhas_locutores enable row level security;
alter table public.campanhas_config enable row level security;

drop policy if exists "campanhas do proprio perfil" on public.campanhas_locutores;
create policy "campanhas do proprio perfil" on public.campanhas_locutores
    for all to authenticated
    using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "config do proprio perfil" on public.campanhas_config;
create policy "config do proprio perfil" on public.campanhas_config
    for all to authenticated
    using (author_id = auth.uid()) with check (author_id = auth.uid());

grant select, insert, update, delete on public.campanhas_locutores to authenticated;
grant select, insert, update, delete on public.campanhas_config to authenticated;

-- Conferência: as duas tabelas aparecem com RLS ligada (rowsecurity = true).
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename in ('campanhas_locutores', 'campanhas_config');
