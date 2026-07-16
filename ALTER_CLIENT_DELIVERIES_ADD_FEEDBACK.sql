-- Fecha o ciclo de Entregas de Clientes: guarda o comentário que o cliente
-- escreve ao clicar em "Pedir Ajuste" na página pública de aprovação.
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs"
-- (mesmo projeto de client_deliveries/music_tracks/usage_events).

alter table public.client_deliveries
  add column if not exists feedback text;
