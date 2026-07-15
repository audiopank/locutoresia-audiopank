# Entregas de Clientes — Design

## Contexto e problema

O VoxCraft AI (`VOXCRAFT_SYSTEM_PROMPT` em `backend/app.py`) já vende ativamente o serviço de "Atendimento Completo" (encomenda): o cliente manda o pedido por e-mail/WhatsApp, a equipe cria o roteiro, escolhe a voz e produz o áudio final. Hoje, depois que a locução fica pronta, **a entrega acontece inteiramente fora do Locutores IA** (WhatsApp, e-mail) — não existe nenhum registro de quem pediu o quê, nem um jeito profissional do cliente ouvir e aprovar o resultado.

## Objetivo

Uma tela interna onde a equipe cadastra a locução finalizada de um cliente e gera um link público (sem login) para esse cliente ouvir e aprovar — substituindo o envio manual por WhatsApp/Drive por um fluxo rastreável dentro do próprio app.

## Escopo e isolamento

Tudo é **aditivo** — tabela nova, bucket novo, rotas novas, template novo, uma linha nova no menu. Nenhum arquivo/rota/tabela existente é modificado. Isso é uma restrição explícita do usuário: a Biblioteca de Trilhas, a Biblioteca de Roteiros e qualquer outra feature em produção não podem ser tocadas.

Fora de escopo (explicitamente adiado, não faz parte desta spec): login/conta de cliente, notificação automática por e-mail/WhatsApp quando o cliente responde, comentário de texto no "Pedir Ajuste", e qualquer integração com o futuro Painel de ROI.

## Modelo de dados

```sql
-- Bucket PRIVADO — diferente do 'music-tracks' (que é público). Dado de
-- cliente é sensível, então o acesso de leitura sempre passa por uma signed
-- URL gerada pelo backend, nunca por uma URL pública fixa.
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
-- Nenhuma policy pra anon/authenticated: só o backend (service_role) acessa.
-- A página pública de aprovação passa pelo Flask (que usa a service key),
-- nunca fala direto com o Supabase a partir do navegador do cliente.
```

`storage_path` substitui o `file_url` que a Biblioteca de Trilhas usa — como o bucket é privado, não existe uma URL pública fixa pra guardar. O caminho no Storage é guardado, e uma signed URL de leitura é gerada **sob demanda**, com expiração curta, toda vez que alguém precisa ouvir o áudio (tela interna ou página de aprovação).

## Fluxo interno (equipe) — tela em `/entregas-clientes`

Formulário: nome do cliente, contato (WhatsApp ou e-mail), descrição do pedido (texto livre), e o arquivo de áudio. O upload segue o mesmo padrão de duas etapas já validado hoje na Biblioteca de Trilhas (signed **upload** URL do Supabase Storage, sem passar o arquivo pela função serverless do Vercel — importante pra trilhas/locuções grandes não esbarrarem no limite de ~4.5MB):

1. `POST /api/client-deliveries/upload-url` → gera uma signed upload URL pro bucket `client-deliveries` (mesmo mecanismo de `create_signed_upload_url` usado em `/api/tracks/upload-url`, adaptado pro bucket novo).
2. Navegador envia o arquivo direto pro Storage usando essa URL.
3. `POST /api/client-deliveries` → salva o registro (`client_name`, `client_contact`, `request_description`, `storage_path`, `file_size`, `mime_type`, `status='pendente'`).

Abaixo do formulário, uma lista das entregas já cadastradas: nome do cliente, descrição, status (badge colorido — Pendente/Aprovado/Ajuste Solicitado), player de áudio (tocando via uma signed URL de leitura gerada na hora pelo `GET /api/client-deliveries`), botão "Copiar link de aprovação" (monta a URL `/aprovacao/<id>`), e botão de excluir.

## Fluxo público (cliente) — página em `/aprovacao/<id>`

Rota Flask server-side (não é uma SPA nem chama Supabase direto do navegador): busca o registro por `id` usando o client Supabase do backend (service_role), gera uma signed URL de leitura válida por 1 hora (`create_signed_url(storage_path, expires_in=3600)`), e renderiza uma página simples: nome do cliente, descrição do pedido, player de áudio, e dois botões — **Aprovar** e **Pedir Ajuste**.

Clicar em qualquer um dos dois botões chama `POST /api/client-deliveries/<id>/respond` com `{"status": "aprovado"}` ou `{"status": "ajuste_solicitado"}` — atualiza só a coluna `status` daquele registro específico. Sem notificação automática (a equipe vê a mudança de status a próxima vez que abrir `/entregas-clientes`). O link é o próprio UUID do registro — não-listável, não há como um cliente adivinhar o link de outro.

Esse endpoint público (`/respond`) é intencionalmente estreito: só aceita um dos dois valores de status pra aquele `id` específico, nada mais — não é um PATCH genérico exposto sem autenticação.

## Menu

Novo item dentro da seção "Ferramentas" do menu lateral (`templates/index.html`), mesmo padrão visual dos outros itens (`badge-new`):

```html
<a href="/entregas-clientes" class="menu-item badge-new">
    <i class="fas fa-user-check"></i> Entregas de Clientes
</a>
```

## Segurança (resumo da decisão)

- Bucket privado + signed URLs (upload e leitura) em vez de bucket público — nenhuma URL de áudio de cliente fica acessível permanentemente sem passar pelo backend.
- RLS da tabela `client_deliveries` sem nenhuma policy pra anon/authenticated — só o backend com service_role lê/escreve.
- A página pública de aprovação é renderizada pelo Flask (server-side), nunca expõe a service key nem faz o navegador do cliente falar direto com o Supabase.
- O endpoint de resposta do cliente (`/respond`) é de escopo estreito (só muda status, só daquele id) — evita expor uma superfície de escrita genérica sem autenticação.

## Verificação

- Teste manual local: cadastrar uma entrega, copiar o link de aprovação, abrir em aba anônima (sem sessão), ouvir o áudio, clicar Aprovar, e confirmar que o status mudou na tela interna.
- Confirmar que a signed URL de leitura expira (não é reutilizável indefinidamente) e que o bucket realmente está marcado como privado no Supabase.
- Confirmar que nenhum arquivo/rota da Biblioteca de Trilhas ou de Roteiros foi alterado.
