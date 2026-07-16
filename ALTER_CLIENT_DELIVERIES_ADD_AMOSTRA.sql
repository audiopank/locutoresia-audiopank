-- Amostra de voz no pedido de ajuste: o cliente anexa uma referência de estilo
-- ("quero assim") na página pública, e o estúdio ouve direto no painel.
-- Este SQL é idempotente e TAMBÉM inclui as colunas do "reenvio que lembra"
-- (caso a migração anterior ainda não tenha sido rodada, este cobre tudo).
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".

alter table public.client_deliveries
  add column if not exists total_ajustes integer not null default 0,
  add column if not exists ajustes_historico jsonb not null default '[]'::jsonb,
  add column if not exists amostra_path text;
