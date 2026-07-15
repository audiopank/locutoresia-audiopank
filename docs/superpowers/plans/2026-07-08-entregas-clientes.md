# Entregas de Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma tela interna onde a equipe do Locutores IA cadastra locuções finalizadas de clientes e gera um link público (sem login) pro cliente ouvir e aprovar/pedir ajuste — substituindo a entrega manual por WhatsApp/Drive.

**Architecture:** Tudo aditivo (tabela nova, bucket novo, rotas novas, 2 templates novos, 1 linha nova no menu). Bucket privado no Supabase Storage com signed URLs (upload e leitura) geradas pelo backend — o navegador do cliente nunca fala direto com o Supabase. Endpoint de resposta do cliente é de escopo estreito (só muda `status`).

**Tech Stack:** Flask + Jinja2, Supabase (Postgres + Storage, projeto `ykswhzqdjoshjoaruhqs`, client `supabase_manager.newpost_manager_client`), Bootstrap 5 + Font Awesome 6.4.0 (mesmo CDN já usado em `templates/library.html`), JS vanilla.

---

## Contexto para quem for implementar

- Este projeto é o "Locutores IA" — Flask (`backend/app.py`, arquivo grande) + templates Jinja em `templates/`.
- `core/supabase_manager.py` expõe `supabase_manager.newpost_manager_client` (um client `supabase-py` já autenticado com a service key do projeto Supabase correto) — é esse client que qualquer rota nova deve usar, nunca `supabase_manager.locutores_client` (aponta pro projeto errado).
- Existe um padrão já validado HOJE nesta mesma sessão pra upload de arquivo grande sem esbarrar no limite de ~4.5MB do Vercel: gerar uma **signed upload URL** no backend (`storage.from_(bucket).create_signed_upload_url(path)`, que retorna um dict com a chave `signed_url`), o navegador manda o arquivo direto pro Storage via `PUT` nessa URL (com `multipart/form-data`, campo `file`), e só depois um segundo request (JSON pequeno) salva os metadados no banco. Ver `backend/app.py` nas rotas `/api/tracks/upload-url` e `/api/tracks/upload-metadata` — o código novo deste plano segue exatamente esse padrão, adaptado pra um bucket **privado** (diferente do `music-tracks`, que é público).
- Pra **ler** um arquivo de um bucket privado, usa-se `storage.from_(bucket).create_signed_url(path, expires_in_segundos)`, que retorna um dict com a chave `signedURL` (e também `signedUrl`, mesma coisa duas vezes por causa de compatibilidade da lib) — uma URL temporária de leitura.
- Spec completa (com todas as decisões e justificativas): `docs/superpowers/specs/2026-07-08-entregas-clientes-design.md`.
- Como rodar localmente pra testar: `python start_simple.py` (Flask em `http://localhost:5000/`).
- **Restrição crítica do usuário:** nada neste plano pode modificar arquivos/rotas/tabelas já existentes, exceto a única linha nova adicionada no menu (`templates/index.html`). Toda tarefa abaixo só cria coisas novas.

---

## Task 1: Migração SQL (bucket privado + tabela)

**Files:**
- Create: `CREATE_CLIENT_DELIVERIES_TABLE.sql`

- [ ] **Step 1: Criar o arquivo de migração**

```sql
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
```

- [ ] **Step 2: Avisar o usuário pra rodar esse SQL no SQL Editor do projeto `ykswhzqdjoshjoaruhqs`** (o agente implementador não tem acesso ao dashboard do Supabase — esse passo é manual, feito pelo usuário. Peça confirmação de que rodou com sucesso antes de prosseguir pras próximas tasks, já que elas dependem da tabela/bucket existirem.)

- [ ] **Step 3: Commit**

```bash
git add CREATE_CLIENT_DELIVERIES_TABLE.sql
git commit -m "docs(entregas-clientes): adiciona migracao SQL (bucket privado + tabela)"
```

---

## Task 2: Backend — cadastro de entrega (signed upload URL + salvar metadados)

**Files:**
- Modify: `backend/app.py` (adicionar rotas novas — não altera nenhuma rota existente)

Estas duas rotas devem ser adicionadas logo depois da rota `delete_track` existente (que termina com `return jsonify({"success": False, "error": str(e)}), 500` antes do comentário `@app.route('/busca-noticias')`). Localize esse ponto exato no arquivo antes de inserir.

- [ ] **Step 1: Adicionar as rotas de cadastro**

```python
CLIENT_DELIVERIES_BUCKET = 'client-deliveries'

@app.route('/api/client-deliveries/upload-url', methods=['POST', 'OPTIONS'])
def get_client_delivery_upload_url():
    """Gera uma signed upload URL do Supabase Storage (bucket privado) pro
    navegador enviar o arquivo de locução direto pro Storage, sem passar
    pela função serverless do Vercel (limite de ~4.5MB no corpo da requisição)."""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({"success": False, "error": "Supabase Storage não configurado"}), 500

        data = request.get_json() or {}
        filename = data.get('filename', '')
        if not filename:
            return jsonify({"success": False, "error": "Nome do arquivo é obrigatório"}), 400

        import uuid
        file_extension = os.path.splitext(filename)[1]
        storage_path = f"entregas/{uuid.uuid4()}{file_extension}"

        signed = supabase_manager.newpost_manager_client.storage.from_(CLIENT_DELIVERIES_BUCKET) \
            .create_signed_upload_url(storage_path)

        anon_key = os.getenv("NEWPOST_SUPABASE_ANON_KEY", "")

        return jsonify({
            "success": True,
            "upload_url": signed["signed_url"],
            "path": storage_path,
            "apikey": anon_key
        })
    except Exception as e:
        print(f"Erro ao gerar signed upload URL de entrega: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/client-deliveries', methods=['POST', 'OPTIONS'])
def create_client_delivery():
    """Salva o registro da entrega depois que o arquivo já foi enviado direto
    pro Supabase Storage via signed upload URL. Nunca recebe o arquivo em si."""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({"success": False, "error": "Supabase não configurado"}), 500

        data = request.get_json() or {}
        client_name = data.get('client_name', '').strip()
        storage_path = data.get('storage_path', '')
        if not client_name:
            return jsonify({"success": False, "error": "Nome do cliente é obrigatório"}), 400
        if not storage_path:
            return jsonify({"success": False, "error": "storage_path é obrigatório"}), 400

        delivery_data = {
            "client_name": client_name,
            "client_contact": data.get('client_contact', ''),
            "request_description": data.get('request_description', ''),
            "storage_path": storage_path,
            "file_size": int(data.get('file_size', 0) or 0),
            "mime_type": data.get('mime_type', 'audio/mpeg'),
            "status": "pendente"
        }

        response = supabase_manager.newpost_manager_client.table('client_deliveries').insert(delivery_data).execute()
        delivery_data['id'] = response.data[0]['id']

        return jsonify({"success": True, "delivery": delivery_data}), 201

    except Exception as e:
        print(f"Erro ao salvar entrega de cliente: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
```

- [ ] **Step 2: Verificar manualmente (Task 1 já deve ter sido rodada no Supabase antes deste passo)**

```bash
python start_simple.py
```

Em outro terminal:

```bash
curl -s -X POST http://localhost:5000/api/client-deliveries/upload-url -H "Content-Type: application/json" -d "{\"filename\":\"teste.mp3\"}"
```

Esperado: JSON com `"success": true`, `upload_url` começando com `https://ykswhzqdjoshjoaruhqs.supabase.co/storage/v1/object/upload/sign/client-deliveries/entregas/...`, e `path` no formato `entregas/<uuid>.mp3`.

```bash
curl -s -X POST http://localhost:5000/api/client-deliveries -H "Content-Type: application/json" -d "{\"client_name\":\"Cliente Teste\",\"client_contact\":\"11999999999\",\"request_description\":\"teste do plano\",\"storage_path\":\"entregas/teste-fake.mp3\",\"file_size\":100,\"mime_type\":\"audio/mpeg\"}"
```

Esperado: JSON com `"success": true` e um `delivery.id` (UUID). Guarde esse ID pra usar como referência ao testar a Task 3 (dá pra excluir depois).

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat(entregas-clientes): endpoints de cadastro (signed upload url + salvar metadados)"
```

---

## Task 3: Backend — listagem e exclusão

**Files:**
- Modify: `backend/app.py` (adicionar logo depois das rotas da Task 2)

- [ ] **Step 1: Adicionar as rotas de listagem e exclusão**

```python
@app.route('/api/client-deliveries', methods=['GET'])
def list_client_deliveries():
    """Lista as entregas cadastradas, cada uma com uma signed URL de leitura
    gerada na hora (o bucket é privado, não existe URL pública fixa pra guardar)."""
    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({"success": True, "deliveries": []})

        response = supabase_manager.newpost_manager_client.table('client_deliveries') \
            .select('*') \
            .order('created_at', desc=True) \
            .execute()

        deliveries = response.data
        for delivery in deliveries:
            try:
                signed = supabase_manager.newpost_manager_client.storage.from_(CLIENT_DELIVERIES_BUCKET) \
                    .create_signed_url(delivery['storage_path'], 3600)
                delivery['playback_url'] = signed.get('signedURL') or signed.get('signedUrl')
            except Exception as e:
                print(f"Erro ao gerar signed URL de leitura: {e}")
                delivery['playback_url'] = None

        return jsonify({"success": True, "deliveries": deliveries})

    except Exception as e:
        print(f"Erro ao listar entregas de clientes: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/client-deliveries/<delivery_id>', methods=['DELETE', 'OPTIONS'])
def delete_client_delivery(delivery_id):
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        return response

    try:
        if supabase_manager and supabase_manager.newpost_manager_client:
            supabase_manager.newpost_manager_client.table('client_deliveries') \
                .delete().eq('id', delivery_id).execute()

        return jsonify({"success": True, "message": "Entrega excluída com sucesso"}), 200

    except Exception as e:
        print(f"Erro ao excluir entrega de cliente: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500
```

- [ ] **Step 2: Verificar manualmente**

Com o servidor local rodando (`python start_simple.py`, se não estiver mais de pé):

```bash
curl -s http://localhost:5000/api/client-deliveries
```

Esperado: JSON com `"success": true` e uma lista `deliveries` contendo pelo menos o registro de teste criado na Task 2 — cada item deve ter um campo `playback_url` (pode ser `null` já que `entregas/teste-fake.mp3` não existe de verdade no Storage, o que é esperado nesse teste com dado fake).

```bash
curl -s -X DELETE http://localhost:5000/api/client-deliveries/<ID_DO_TESTE_DA_TASK_2>
```

Esperado: `{"success": true, "message": "Entrega excluída com sucesso"}`. Rode o `GET` de novo e confirme que a lista não tem mais esse registro.

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat(entregas-clientes): endpoints de listagem e exclusao"
```

---

## Task 4: Backend — resposta do cliente + página pública de aprovação

**Files:**
- Modify: `backend/app.py` (adicionar logo depois das rotas da Task 3)
- Create: `templates/aprovacao.html` (referenciado aqui, conteúdo completo na Task 6 — se a Task 6 ainda não rodou, criar um arquivo placeholder mínimo só pra Task 4 não quebrar; a Task 6 substitui esse conteúdo)

Para esta task não travar em uma dependência circular com a Task 6 (o template), crie primeiro um `templates/aprovacao.html` **mínimo e funcional** aqui mesmo (será o mesmo arquivo que a Task 6 completa com estilo/copy melhor — a Task 6 pode reescrever o arquivo inteiro sem problema).

- [ ] **Step 1: Criar um `templates/aprovacao.html` mínimo (funcional, sem estilo — Task 6 substitui)**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Aprovação de Locução</title>
</head>
<body>
    {% if not found %}
        <p>Entrega não encontrada.</p>
    {% else %}
        <h3>{{ delivery.client_name }}</h3>
        <p>{{ delivery.request_description }}</p>
        <audio controls src="{{ playback_url }}"></audio>
        <div id="responseArea">
            {% if delivery.status == 'pendente' %}
            <button onclick="respond('aprovado')">Aprovar</button>
            <button onclick="respond('ajuste_solicitado')">Pedir Ajuste</button>
            {% else %}
            <p>Status atual: {{ delivery.status }}</p>
            {% endif %}
        </div>
    {% endif %}
    <script>
        const deliveryId = "{{ delivery.id if found else '' }}";
        async function respond(status) {
            const response = await fetch(`/api/client-deliveries/${deliveryId}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status })
            });
            const result = await response.json();
            if (result.success) {
                document.getElementById('responseArea').innerHTML = `<p>Obrigado! Status: ${status}</p>`;
            } else {
                alert('Erro: ' + result.error);
            }
        }
    </script>
</body>
</html>
```

- [ ] **Step 2: Adicionar as rotas de resposta e a página pública em `backend/app.py`**

```python
@app.route('/api/client-deliveries/<delivery_id>/respond', methods=['POST', 'OPTIONS'])
def respond_client_delivery(delivery_id):
    """Endpoint público e de escopo estreito: só aceita mudar o status de UM
    registro específico pra 'aprovado' ou 'ajuste_solicitado'. Não expõe
    nenhum outro campo pra escrita, nem lista/lê outros registros."""
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response

    try:
        data = request.get_json() or {}
        status = data.get('status', '')
        if status not in ('aprovado', 'ajuste_solicitado'):
            return jsonify({"success": False, "error": "Status inválido"}), 400

        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return jsonify({"success": False, "error": "Supabase não configurado"}), 500

        supabase_manager.newpost_manager_client.table('client_deliveries') \
            .update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}) \
            .eq('id', delivery_id).execute()

        return jsonify({"success": True, "status": status})

    except Exception as e:
        print(f"Erro ao responder entrega de cliente: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/aprovacao/<delivery_id>')
def client_delivery_approval_page(delivery_id):
    """Página pública, sem login — cliente ouve a locução e aprova/pede ajuste.
    Busca via service_role (server-side); o navegador do cliente nunca fala
    direto com o Supabase."""
    try:
        if not supabase_manager or not supabase_manager.newpost_manager_client:
            return render_template('aprovacao.html', found=False), 404

        response = supabase_manager.newpost_manager_client.table('client_deliveries') \
            .select('*').eq('id', delivery_id).limit(1).execute()

        if not response.data:
            return render_template('aprovacao.html', found=False), 404

        delivery = response.data[0]
        signed = supabase_manager.newpost_manager_client.storage.from_(CLIENT_DELIVERIES_BUCKET) \
            .create_signed_url(delivery['storage_path'], 3600)
        playback_url = signed.get('signedURL') or signed.get('signedUrl')

        return render_template('aprovacao.html', found=True, delivery=delivery, playback_url=playback_url)

    except Exception as e:
        print(f"Erro ao carregar página de aprovação: {e}")
        import traceback
        traceback.print_exc()
        return render_template('aprovacao.html', found=False), 500
```

- [ ] **Step 3: Verificar manualmente**

Crie um registro de teste de verdade (repita o `POST /api/client-deliveries` da Task 2, ou reaproveite se ainda existir), pegue o `id` retornado, e abra no navegador:

```
http://localhost:5000/aprovacao/<ID_DO_REGISTRO>
```

Esperado: a página carrega mostrando o nome do cliente e a descrição (o áudio pode não tocar se `storage_path` for fake, mas a página não deve dar erro 500). Clique em "Aprovar" e confirme que a página mostra a mensagem de agradecimento. Rode `curl http://localhost:5000/api/client-deliveries` de novo e confirme que o `status` desse registro mudou pra `aprovado`.

Teste também um ID que não existe:

```
http://localhost:5000/aprovacao/00000000-0000-0000-0000-000000000000
```

Esperado: página mostra "Entrega não encontrada", sem erro 500.

- [ ] **Step 4: Commit**

```bash
git add backend/app.py templates/aprovacao.html
git commit -m "feat(entregas-clientes): endpoint de resposta e pagina publica de aprovacao"
```

---

## Task 5: Tela interna (`/entregas-clientes`) + item de menu

**Files:**
- Modify: `backend/app.py` (adicionar rota, logo depois das rotas da Task 4)
- Create: `templates/entregas-clientes.html`
- Modify: `templates/index.html:768-771` (adicionar item de menu, sem remover nada)

- [ ] **Step 1: Adicionar a rota em `backend/app.py`**

```python
@app.route('/entregas-clientes')
def client_deliveries_page():
    """Entregas de Clientes — cadastro e acompanhamento de locuções entregues."""
    return render_template('entregas-clientes.html')
```

- [ ] **Step 2: Criar `templates/entregas-clientes.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Entregas de Clientes - Locutores IA</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: #6366f1;
            --dark-bg: #0f172a;
            --card-bg: #1e293b;
            --border-color: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
        }
        body {
            background: linear-gradient(135deg, var(--dark-bg) 0%, #1a1f3a 100%);
            color: var(--text-primary);
            min-height: 100vh;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .page-container {
            padding: 2rem;
            max-width: 1100px;
            margin: 0 auto;
        }
        .section-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .form-label { color: var(--text-secondary); }
        .form-control, .form-select {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }
        .form-control:focus, .form-select:focus {
            background: rgba(15, 23, 42, 0.8);
            border-color: var(--primary-color);
            color: var(--text-primary);
            box-shadow: none;
        }
        .delivery-card {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 1.25rem;
            margin-bottom: 1rem;
        }
        .status-badge-pendente { background: #f59e0b; }
        .status-badge-aprovado { background: #22c55e; }
        .status-badge-ajuste_solicitado { background: #ef4444; }
        .back-link { color: var(--text-secondary); text-decoration: none; }
        .back-link:hover { color: var(--text-primary); }
    </style>
</head>
<body>
    <div class="page-container">
        <a href="/" class="back-link"><i class="fas fa-arrow-left me-2"></i>Voltar para Início</a>
        <h2 class="mt-3 mb-4"><i class="fas fa-user-check me-2"></i>Entregas de Clientes</h2>

        <div class="section-card">
            <h5 class="mb-3">Cadastrar nova entrega</h5>
            <div class="mb-3">
                <label class="form-label">Nome do cliente</label>
                <input type="text" class="form-control" id="clientName" placeholder="Ex: Loja Fashion Center">
            </div>
            <div class="mb-3">
                <label class="form-label">Contato (WhatsApp ou e-mail)</label>
                <input type="text" class="form-control" id="clientContact" placeholder="Ex: (85) 99999-9999">
            </div>
            <div class="mb-3">
                <label class="form-label">Descrição do pedido</label>
                <textarea class="form-control" id="requestDescription" rows="2" placeholder="Ex: Spot 30s pra loja de roupas, tom energético"></textarea>
            </div>
            <div class="mb-3">
                <label class="form-label">Arquivo de áudio</label>
                <input type="file" class="form-control" id="audioFile" accept="audio/*">
            </div>
            <button class="btn btn-primary" id="uploadBtn" onclick="uploadDelivery()">
                <i class="fas fa-upload me-2"></i>Cadastrar Entrega
            </button>
        </div>

        <div class="section-card">
            <h5 class="mb-3">Entregas cadastradas</h5>
            <div id="deliveriesList">
                <p class="text-secondary">Carregando...</p>
            </div>
        </div>
    </div>

    <script>
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        function statusLabel(status) {
            if (status === 'aprovado') return 'Aprovado';
            if (status === 'ajuste_solicitado') return 'Ajuste Solicitado';
            return 'Pendente';
        }

        async function uploadDelivery() {
            const clientName = document.getElementById('clientName').value.trim();
            const clientContact = document.getElementById('clientContact').value.trim();
            const requestDescription = document.getElementById('requestDescription').value.trim();
            const fileInput = document.getElementById('audioFile');
            const file = fileInput.files[0];
            const uploadBtn = document.getElementById('uploadBtn');

            if (!clientName) {
                alert('Informe o nome do cliente.');
                return;
            }
            if (!file) {
                alert('Selecione um arquivo de áudio.');
                return;
            }

            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Enviando...';

            try {
                const urlResponse = await fetch('/api/client-deliveries/upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name })
                });
                const urlResult = await urlResponse.json();
                if (!urlResult.success) {
                    throw new Error(urlResult.error);
                }

                const uploadFormData = new FormData();
                uploadFormData.append('file', file);
                const storageResponse = await fetch(urlResult.upload_url, {
                    method: 'PUT',
                    headers: {
                        'apikey': urlResult.apikey,
                        'Authorization': `Bearer ${urlResult.apikey}`
                    },
                    body: uploadFormData
                });
                if (!storageResponse.ok) {
                    throw new Error('Falha ao enviar o arquivo para o armazenamento');
                }

                const createResponse = await fetch('/api/client-deliveries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_name: clientName,
                        client_contact: clientContact,
                        request_description: requestDescription,
                        storage_path: urlResult.path,
                        file_size: file.size,
                        mime_type: file.type
                    })
                });
                const createResult = await createResponse.json();
                if (!createResult.success) {
                    throw new Error(createResult.error);
                }

                alert('Entrega cadastrada com sucesso!');
                document.getElementById('clientName').value = '';
                document.getElementById('clientContact').value = '';
                document.getElementById('requestDescription').value = '';
                fileInput.value = '';
                loadDeliveries();

            } catch (error) {
                console.error('Erro no cadastro:', error);
                alert(`Erro ao cadastrar entrega: ${error.message}`);
            } finally {
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '<i class="fas fa-upload me-2"></i>Cadastrar Entrega';
            }
        }

        async function loadDeliveries() {
            const container = document.getElementById('deliveriesList');
            try {
                const response = await fetch('/api/client-deliveries');
                const result = await response.json();

                if (!result.success || !result.deliveries || result.deliveries.length === 0) {
                    container.innerHTML = '<p class="text-secondary">Nenhuma entrega cadastrada ainda.</p>';
                    return;
                }

                container.innerHTML = result.deliveries.map(d => {
                    const approvalUrl = `${window.location.origin}/aprovacao/${d.id}`;
                    return `
                        <div class="delivery-card">
                            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                                <div>
                                    <strong>${escapeHtml(d.client_name)}</strong>
                                    <span class="badge status-badge-${d.status} ms-2">${statusLabel(d.status)}</span>
                                    <p class="text-secondary mb-0 mt-1">${escapeHtml(d.request_description)}</p>
                                    <p class="text-secondary mb-0"><small>${escapeHtml(d.client_contact)}</small></p>
                                </div>
                                <div>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteDelivery('${d.id}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                            <audio controls class="w-100 mt-2" src="${d.playback_url || ''}"></audio>
                            <button class="btn btn-sm btn-outline-light mt-2" onclick="copyApprovalLink('${approvalUrl}')">
                                <i class="fas fa-link me-1"></i>Copiar link de aprovação
                            </button>
                        </div>
                    `;
                }).join('');

            } catch (error) {
                console.error('Erro ao carregar entregas:', error);
                container.innerHTML = '<p class="text-danger">Erro ao carregar entregas.</p>';
            }
        }

        function copyApprovalLink(url) {
            navigator.clipboard.writeText(url);
            alert('Link copiado para a área de transferência!');
        }

        async function deleteDelivery(id) {
            if (!confirm('Tem certeza que deseja excluir esta entrega?')) return;
            try {
                const response = await fetch(`/api/client-deliveries/${id}`, { method: 'DELETE' });
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error);
                }
                loadDeliveries();
            } catch (error) {
                alert(`Erro ao excluir: ${error.message}`);
            }
        }

        loadDeliveries();
    </script>
</body>
</html>
```

**Nota de segurança (por que este template é seguro):** `d.client_name`, `d.request_description` e `d.client_contact` só são interpolados dentro de nós de texto (`<strong>`, `<p>`) usando `escapeHtml()` — nunca dentro de um atributo HTML entre aspas. `d.id` e `approvalUrl` são interpolados dentro de atributos (`onclick="...('${d.id}')"`), mas `d.id` é sempre um UUID gerado pelo Postgres (`gen_random_uuid()`) e `approvalUrl` é montado a partir desse mesmo UUID — nenhum dos dois pode conter aspas, então não há risco de quebra de atributo nesse caso específico.

- [ ] **Step 3: Adicionar o item de menu em `templates/index.html`**

Localize este trecho (dentro da seção "Ferramentas"):

```html
                <a href="/roteiros" class="menu-item badge-new">
                    <i class="fas fa-book"></i>
                    <span>Biblioteca de Roteiros</span>
                </a>
                <a href="#" class="menu-item badge-new" id="voxcraftBtn">
```

Substitua por (adiciona o novo item entre os dois, sem remover nada):

```html
                <a href="/roteiros" class="menu-item badge-new">
                    <i class="fas fa-book"></i>
                    <span>Biblioteca de Roteiros</span>
                </a>
                <a href="/entregas-clientes" class="menu-item badge-new">
                    <i class="fas fa-user-check"></i>
                    <span>Entregas de Clientes</span>
                </a>
                <a href="#" class="menu-item badge-new" id="voxcraftBtn">
```

- [ ] **Step 4: Verificar manualmente**

Com `python start_simple.py` rodando, abra `http://localhost:5000/` e confirme que o item "Entregas de Clientes" aparece no menu, dentro de "Ferramentas", logo depois de "Biblioteca de Roteiros". Clique nele e confirme que abre `/entregas-clientes` com o formulário e a lista (mesmo que vazia). Cadastre uma entrega de teste com um arquivo de áudio pequeno de verdade e confirme que ela aparece na lista com player funcionando.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py templates/entregas-clientes.html templates/index.html
git commit -m "feat(entregas-clientes): tela interna de cadastro/listagem + item de menu"
```

---

## Task 6: Página pública de aprovação (versão final, com estilo)

**Files:**
- Modify: `templates/aprovacao.html` (substituir o conteúdo mínimo da Task 4 pela versão completa)

- [ ] **Step 1: Substituir todo o conteúdo de `templates/aprovacao.html` por:**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aprovação de Locução - Locutores IA</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: #6366f1;
            --dark-bg: #0f172a;
            --card-bg: #1e293b;
            --border-color: #334155;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
        }
        body {
            background: linear-gradient(135deg, var(--dark-bg) 0%, #1a1f3a 100%);
            color: var(--text-primary);
            min-height: 100vh;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .approval-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 2.5rem;
            max-width: 500px;
            width: 100%;
            margin: 2rem;
        }
        .status-message {
            text-align: center;
            padding: 1rem;
            border-radius: 10px;
            margin-top: 1.5rem;
        }
        .status-aprovado { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
        .status-ajuste_solicitado { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    </style>
</head>
<body>
    <div class="approval-card">
        {% if not found %}
            <h4 class="text-center"><i class="fas fa-exclamation-circle me-2"></i>Entrega não encontrada</h4>
            <p class="text-secondary text-center">Esse link pode ter expirado ou não existe mais.</p>
        {% else %}
            <h4 class="mb-1">{{ delivery.client_name }}</h4>
            <p class="text-secondary">{{ delivery.request_description }}</p>
            <audio controls class="w-100 mt-3" src="{{ playback_url }}"></audio>

            <div id="responseArea">
                {% if delivery.status == 'pendente' %}
                <div class="d-flex gap-2 mt-4">
                    <button class="btn btn-success w-100" onclick="respond('aprovado')">
                        <i class="fas fa-check me-2"></i>Aprovar
                    </button>
                    <button class="btn btn-outline-danger w-100" onclick="respond('ajuste_solicitado')">
                        <i class="fas fa-edit me-2"></i>Pedir Ajuste
                    </button>
                </div>
                {% elif delivery.status == 'aprovado' %}
                <div class="status-message status-aprovado">
                    <i class="fas fa-check-circle me-2"></i>Você já aprovou esta locução.
                </div>
                {% else %}
                <div class="status-message status-ajuste_solicitado">
                    <i class="fas fa-info-circle me-2"></i>Você já pediu ajuste nesta locução.
                </div>
                {% endif %}
            </div>
        {% endif %}
    </div>

    <script>
        const deliveryId = "{{ delivery.id if found else '' }}";

        async function respond(status) {
            try {
                const response = await fetch(`/api/client-deliveries/${deliveryId}/respond`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: status })
                });
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error);
                }

                const area = document.getElementById('responseArea');
                if (status === 'aprovado') {
                    area.innerHTML = '<div class="status-message status-aprovado"><i class="fas fa-check-circle me-2"></i>Obrigado! Locução aprovada.</div>';
                } else {
                    area.innerHTML = '<div class="status-message status-ajuste_solicitado"><i class="fas fa-info-circle me-2"></i>Obrigado! Vamos ajustar e te enviar um novo link em breve.</div>';
                }
            } catch (error) {
                alert(`Erro ao registrar resposta: ${error.message}`);
            }
        }
    </script>
</body>
</html>
```

**Nota de segurança:** `{{ delivery.client_name }}` e `{{ delivery.request_description }}` são renderizados via Jinja2, que faz auto-escape de HTML por padrão nesta app (arquivo `.html`) — não precisa de escaping manual aqui, diferente da interpolação em JavaScript usada em `entregas-clientes.html`.

- [ ] **Step 2: Verificar manualmente**

Repita o teste da Task 4 (`http://localhost:5000/aprovacao/<ID>`) e confirme visualmente que agora tem o estilo escuro consistente com o resto do app, os botões Aprovar/Pedir Ajuste aparecem quando o status é `pendente`, e a mensagem de agradecimento aparece corretamente depois de clicar.

- [ ] **Step 3: Commit**

```bash
git add templates/aprovacao.html
git commit -m "style(entregas-clientes): estiliza a pagina publica de aprovacao"
```

---

## Task 7: Verificação final ponta a ponta

**Files:** nenhum (apenas verificação)

- [ ] **Step 1: Fluxo completo com servidor local rodando**

1. Abra `/entregas-clientes`, cadastre uma entrega de teste com um arquivo de áudio real (qualquer MP3 pequeno).
2. Confirme que ela aparece na lista com o player tocando o áudio de verdade (não fake).
3. Clique em "Copiar link de aprovação" e cole a URL numa aba anônima do navegador (sem nenhuma sessão logada).
4. Na aba anônima, confirme que o áudio toca e clique em "Aprovar".
5. Volte pra aba de `/entregas-clientes`, recarregue a lista, e confirme que o status mudou pra "Aprovado".
6. Exclua o registro de teste pelo botão de lixeira.

- [ ] **Step 2: Confirmar isolamento (nada quebrou)**

Abra `/library` (Biblioteca de Trilhas) e `/roteiros` (Biblioteca de Roteiros) e confirme visualmente que continuam funcionando exatamente como antes — nenhuma mudança visual ou de comportamento nelas.

- [ ] **Step 3: Confirmar que o bucket é realmente privado**

Pegue o `storage_path` de um registro de teste (via `GET /api/client-deliveries`) e tente montar manualmente uma URL pública tipo `https://ykswhzqdjoshjoaruhqs.supabase.co/storage/v1/object/public/client-deliveries/<storage_path>` — o acesso deve **falhar** (403 ou 400), confirmando que o bucket não está público. Só a signed URL retornada pela API deve funcionar.

- [ ] **Step 4: Encerrar o servidor local**

Nenhum commit nesta task — é só verificação. Se algum item falhar, corrigir na task correspondente e repetir a verificação.

---

## Self-review (cobertura da spec)

- Bucket privado + tabela isolada, RLS travada → Task 1. ✅
- Cadastro (signed upload URL + salvar metadados) → Task 2. ✅
- Listagem com signed read URL + exclusão → Task 3. ✅
- Resposta do cliente (escopo estreito) + página pública sem login → Task 4 e 6. ✅
- Tela interna + item de menu → Task 5. ✅
- Isolamento total (nada existente é modificado, exceto a linha do menu) → confirmado em todas as tasks (só `templates/index.html` tem uma modificação, e é aditiva) + verificado explicitamente na Task 7. ✅
- Verificação end-to-end incluindo confirmação de que o bucket é privado de fato → Task 7. ✅
