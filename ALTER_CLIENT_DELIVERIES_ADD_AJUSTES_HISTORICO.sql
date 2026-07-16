-- "Reenvio que lembra": preserva o histórico de ajustes mesmo depois que o
-- cliente reaprova. Sem isso, o reenvio de versão corrigida zera o feedback e
-- a informação mais rica (o que o cliente pediu pra mudar) se perde — deixando
-- CRM e IA de Performance cegos.
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".

alter table public.client_deliveries
  add column if not exists total_ajustes integer not null default 0,
  add column if not exists ajustes_historico jsonb not null default '[]'::jsonb;
