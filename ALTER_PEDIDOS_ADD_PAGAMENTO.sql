-- Pagamento (fase 1): plano escolhido pelo cliente + controle de pago.
-- O VALOR nunca vem do navegador — o backend define pela tabela de preços
-- (senão daria pra fraudar o preço no cliente). A coluna valor já existe.
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".

alter table public.pedidos
  add column if not exists plano text,
  add column if not exists pago boolean not null default false,
  add column if not exists pago_em timestamptz;
