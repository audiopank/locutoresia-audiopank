-- Bucket de Storage PRIVADO para Entregas de Clientes (locuções com
-- aprovação pública). Rodar no SQL Editor do projeto Supabase
-- "ykswhzqdjoshjoaruhqs" (mesmo projeto onde vive music_tracks/usage_events).
--
-- Diferente do bucket 'music-tracks' (público): aqui guardamos dado de
-- cliente (nome, contato), então o bucket é privado e toda leitura passa
-- por uma signed URL gerada pelo backend.

insert into storage.buckets (id, name, public)
values ('client-deliveries', 'client-deliveries', false)
on conflict (id) do nothing;

create table if not exists public.client_deliveries (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_contact text,
  request_description text,
  storage_path text not null,
  file_size integer,
  mime_type text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'ajuste_solicitado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_deliveries enable row level security;

-- Nenhuma policy pra anon/authenticated: só o backend (service_role) lê/escreve.
-- A página pública de aprovação (/aprovacao/<id>) passa pelo Flask, que usa a
-- service key — o navegador do cliente nunca fala direto com o Supabase.
