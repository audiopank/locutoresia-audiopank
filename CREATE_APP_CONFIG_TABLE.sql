-- Configuração editável pelo Admin (preços dos planos + links de checkout Kiwify).
-- Guarda como key-value jsonb pra o dono mudar preço/link sem tocar no código.
-- RLS travado: só o backend (service_role) lê/escreve; o Admin passa pelo Flask
-- com senha de administrador. Rodar no SQL Editor do projeto "ykswhzqdjoshjoaruhqs".

create table if not exists public.app_config (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
-- Sem policy pra anon/authenticated: só service_role.
