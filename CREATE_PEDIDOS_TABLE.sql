-- Fluxo Cliente → Produção → Aprovação (→ Pagamento futuro):
-- tabela de PEDIDOS que chegam pelo formulário público /solicitar.
-- O pedido vira uma entrega (client_deliveries) quando o estúdio produz;
-- a coluna valor fica pronta pro passo de pagamento/ROI (feature 05).
-- Rodar no SQL Editor do projeto Supabase "ykswhzqdjoshjoaruhqs".

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_nome text not null,
  whatsapp text,
  email text,
  tipo text,                   -- spot_30s, spot_60s, vinheta, institucional_ura, outro
  roteiro text,                -- texto/roteiro enviado pelo cliente
  estilo_voz text,             -- estilo de voz desejado
  referencia_trilha text,      -- trilha de referência (link ou descrição)
  prazo text,                  -- prazo desejado (texto livre)
  valor numeric,               -- preenchido pelo estúdio (prepara pagamento/ROI)
  status text not null default 'novo'
    check (status in ('novo', 'em_producao', 'aguardando_aprovacao', 'concluido', 'cancelado')),
  entrega_id uuid references public.client_deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pedidos enable row level security;

-- Nenhuma policy pra anon/authenticated: só o backend (service_role) lê/escreve.
-- O formulário público /solicitar passa pelo Flask, que valida e insere.
