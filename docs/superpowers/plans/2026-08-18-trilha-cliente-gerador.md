# Trilha do Cliente no Gerador de Anúncios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O produtor sobe o jingle/trilha do próprio cliente no Gerador de Anúncios; ela vira trilha de fundo do spot, fica guardada no Storage e reaparece no select em spots futuros — sem a IA jamais poder usá-la pra outro cliente.

**Architecture:** Reuso máximo: o upload usa os endpoints existentes `/api/tracks/upload-url` (signed URL do Supabase Storage, contorna o limite de ~4.5MB da Vercel) e `/api/tracks/upload-metadata` (linha na `music_tracks`), gravando com `genre='trilha_cliente'` — mesmo truque do `genre='demo_voz'` das demos da Vitrine. Única mudança de backend: o `/api/voxcraft/recommend-tracks` passa a excluir `trilha_cliente` E `demo_voz` (a segunda é correção de bug latente). O resto é frontend vanilla em `static/gerador.js` + `templates/gerador.html`.

**Tech Stack:** Flask (backend), vanilla JS + Web Audio (frontend, sem build), Supabase Storage/Postgres. Validação: `python -m py_compile` e `node --check` (não há test runner pra estes arquivos; a verificação funcional é o protocolo manual da Task 5).

**Spec:** `docs/superpowers/specs/2026-08-18-trilha-cliente-gerador-design.md`

**Contexto pro implementador que nunca viu este repo:**
- `static/gerador.js` é um IIFE vanilla (`(function () { 'use strict'; ... })()`). Tudo desta feature vive dentro dele. Estado global da página no objeto `estado` (linha ~14). Helpers já existentes que você VAI usar: `esc()` (escape de HTML — inclusive aspas, bug recorrente do repo), `avisar(texto, tipo)` com tipos `'info' | 'atencao' | 'ok'`, e `ctx` (AudioContext único da página).
- O pipeline de geração (`gerarSpot`) roda em passos numerados `[1]..[6]`; o passo `[3] TRILHA` é o que esta feature toca. Falha na trilha NUNCA interrompe o pipeline — locução seca é entregável (princípio do arquivo).
- Padrão de signed upload já usado 3x no repo (gerador.js `guardarRascunho`, minidaw.js `_uploadAudioProjeto` e pacote de stems): `POST` no endpoint de upload-url → `PUT` na `upload_url` com `FormData` e headers `apikey`/`Authorization: Bearer`. Copie esse padrão exato.
- **NUNCA** rode implementadores que commitam em paralelo neste repo (regra da casa). Edite só os trechos indicados — `gerador.js` tem ~550 linhas, não reescreva o arquivo.

---

### Task 1: Backend — recommend-tracks fica cego a `trilha_cliente` e `demo_voz`

A IA do "Deixar a IA escolher" jamais pode colocar o jingle do cliente A no anúncio do cliente B (regra de negócio) — e hoje ela já pode recomendar uma demo de VOZ como trilha de fundo (bug latente: `/api/tracks` filtra `demo_voz`, o recommend-tracks não).

**Files:**
- Modify: `backend/app.py` (~linha 1346, dentro de `voxcraft_recommend_tracks`)

- [ ] **Step 1: Aplicar o filtro na consulta ao acervo**

Localizar em `backend/app.py` (função `voxcraft_recommend_tracks`):

```python
        tracks_resp = supabase_manager.newpost_manager_client.table('music_tracks') \
            .select('id,name,artist,genre,mood,duration,bpm,description,file_url') \
            .eq('is_active', True).execute()
```

Substituir por:

```python
        # .neq demo_voz: demos de VOZ moram nesta tabela (ver /api/voice-demos);
        # /api/tracks já filtrava, mas aqui a IA podia recomendar uma demo como
        # trilha de fundo. .neq trilha_cliente: jingle subido pelo produtor pra
        # UM cliente — a IA jamais pode escolhê-lo pro anúncio de outro.
        tracks_resp = supabase_manager.newpost_manager_client.table('music_tracks') \
            .select('id,name,artist,genre,mood,duration,bpm,description,file_url') \
            .eq('is_active', True) \
            .neq('genre', 'demo_voz') \
            .neq('genre', 'trilha_cliente') \
            .execute()
```

- [ ] **Step 2: Validar sintaxe**

Run: `python -m py_compile backend/app.py`
Expected: sai sem imprimir nada (exit 0).

- [ ] **Step 3: Conferir que as 3 exclusões existem**

Run: `grep -n "neq('genre'" backend/app.py`
Expected: 3 ocorrências — a existente do `/api/tracks` (`demo_voz`) e as 2 novas no recommend-tracks.

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "fix(gerador): IA de trilhas nao enxerga mais demos de voz nem trilhas de clientes"
```

---

### Task 2: Template + select com optgroups e opção "Subir trilha do cliente..."

**Files:**
- Modify: `templates/gerador.html` (~linha 193-196, o bloco do select de trilha; e ~linha 258, cache-buster)
- Modify: `static/gerador.js` (~linha 121-133, função `carregarTrilhas`)

- [ ] **Step 1: Template — hint explicativo + input de arquivo oculto**

Em `templates/gerador.html`, localizar:

```html
                    <label class="form-label" for="selectTrilha">Trilha de fundo</label>
                    <select id="selectTrilha" class="form-select mb-3">
                        <option value="auto" selected>Deixar a IA escolher</option>
                    </select>
```

Substituir por:

```html
                    <label class="form-label" for="selectTrilha">Trilha de fundo</label>
                    <select id="selectTrilha" class="form-select mb-1">
                        <option value="auto" selected>Deixar a IA escolher</option>
                    </select>
                    <div class="hint mb-3">
                        "Deixar a IA escolher" segue sendo o padrão. "Subir trilha do
                        cliente" guarda o jingle dele pra este e pros próximos spots —
                        e a IA nunca usa trilha de um cliente no anúncio de outro.
                    </div>
                    <!-- Seletor de arquivo da trilha do cliente: disparado via JS
                         quando o select cai em "upload". Fica fora do fluxo visual. -->
                    <input type="file" id="inputTrilhaCliente" accept="audio/*" style="display:none">
```

- [ ] **Step 2: Cache-buster do gerador.js**

No mesmo arquivo, localizar:

```html
    <script src="/static/gerador.js?v=1"></script>
```

Substituir por:

```html
    <script src="/static/gerador.js?v=2"></script>
```

(Sem build system, o navegador segura o JS antigo no cache — o `?v=` é o mecanismo de invalidação deste repo.)

- [ ] **Step 3: `carregarTrilhas` com optgroups e re-seleção**

Em `static/gerador.js`, localizar a função inteira:

```javascript
    async function carregarTrilhas() {
        const sel = document.getElementById('selectTrilha');
        let lista = [];
        try {
            const r = await fetch('/api/tracks');
            const d = await r.json();
            lista = d.tracks || [];
        } catch (e) { /* segue sem catálogo: dá pra usar 'auto' ou 'nenhuma' */ }
        sel.innerHTML =
            '<option value="auto" selected>Deixar a IA escolher</option>' +
            '<option value="nenhuma">Sem trilha (locução seca)</option>' +
            lista.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    }
```

Substituir por:

```javascript
    async function carregarTrilhas(selecionarId) {
        const sel = document.getElementById('selectTrilha');
        let lista = [];
        try {
            const r = await fetch('/api/tracks');
            const d = await r.json();
            lista = d.tracks || [];
        } catch (e) { /* segue sem catálogo: dá pra usar 'auto' ou 'nenhuma' */ }

        // Trilhas de clientes ficam num grupo próprio: o produtor acha o jingle
        // do cliente na hora, e ninguém confunde acervo com material de cliente.
        const doCliente = lista.filter(t => t.genre === 'trilha_cliente');
        const doAcervo = lista.filter(t => t.genre !== 'trilha_cliente');
        const opt = t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;

        sel.innerHTML =
            '<option value="auto" selected>Deixar a IA escolher</option>' +
            '<option value="nenhuma">Sem trilha (locução seca)</option>' +
            '<option value="upload">📤 Subir trilha do cliente...</option>' +
            (doAcervo.length
                ? `<optgroup label="Acervo">${doAcervo.map(opt).join('')}</optgroup>` : '') +
            (doCliente.length
                ? `<optgroup label="Trilhas de clientes">${doCliente.map(opt).join('')}</optgroup>` : '');

        // Depois de um upload, o catálogo recarrega e a trilha nova já fica ativa.
        if (selecionarId != null) sel.value = String(selecionarId);
    }
```

- [ ] **Step 4: Validar sintaxe**

Run: `node --check static/gerador.js`
Expected: sem saída (exit 0).

- [ ] **Step 5: Commit**

```bash
git add templates/gerador.html static/gerador.js
git commit -m "feat(gerador): select de trilha ganha grupos Acervo/Trilhas de clientes e opcao de upload"
```

---

### Task 3: Fluxo de upload da trilha do cliente

**Files:**
- Modify: `static/gerador.js` — novo campo no `estado`, nova constante, nova função `subirTrilhaCliente`, e a fiação do select/input dentro do `DOMContentLoaded`

- [ ] **Step 1: Estado + constante**

Localizar o objeto `estado` no topo do IIFE:

```javascript
    const estado = {
        pedido: null,       // pedido escolhido
        pedidos: [],        // lista carregada
        vozes: [],          // catálogo de vozes (tem provider)
        roteiro: '',        // roteiro em uso
        vozBuffer: null,    // AudioBuffer da locução
        trilha: null,       // {name, file_url, ...}
        trilhaBuffer: null,
        receita: null,      // resposta do mix-recipe
        mixBlob: null       // resultado final
    };
```

Substituir por:

```javascript
    const estado = {
        pedido: null,       // pedido escolhido
        pedidos: [],        // lista carregada
        vozes: [],          // catálogo de vozes (tem provider)
        roteiro: '',        // roteiro em uso
        vozBuffer: null,    // AudioBuffer da locução
        trilha: null,       // {name, file_url, ...}
        trilhaBuffer: null,
        receita: null,      // resposta do mix-recipe
        mixBlob: null,      // resultado final
        trilhaCliente: null // trilha subida NESTA aba: {id, name, file_url, buffer}
    };

    // Valor do select quando a trilha do cliente decodificou mas NÃO ficou
    // guardada (Storage/catálogo falhou): vive só nesta aba, sem file_url.
    const TRILHA_LOCAL = 'local';
```

- [ ] **Step 2: Função `subirTrilhaCliente`**

Inserir logo DEPOIS da função `carregarTrilhas` (e antes do comentário `// ── Helpers de áudio ──`):

```javascript
    // ── Trilha do cliente (upload) ───────────────────────────────────────

    // Sobe o arquivo pro Storage (signed URL — o corpo NÃO passa pela função
    // da Vercel, que rejeita >4.5MB) e cataloga na music_tracks com
    // genre='trilha_cliente'. Esse marcador é o que esconde a trilha da IA do
    // "Deixar a IA escolher" (recommend-tracks filtra): jingle do cliente A
    // jamais no anúncio do cliente B. O buffer já vem decodificado de fora.
    async function subirTrilhaCliente(file, nome, buffer) {
        const ru = await fetch('/api/tracks/upload-url', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name || (nome + '.mp3') })
        });
        const u = await ru.json();
        if (!u.success) throw new Error(u.error || 'sem URL de upload');

        const fd = new FormData();
        fd.append('file', file, file.name || nome);
        const up = await fetch(u.upload_url, {
            method: 'PUT',
            headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
            body: fd
        });
        if (!up.ok) throw new Error('falha no envio pro Storage');

        const rm = await fetch('/api/tracks/upload-metadata', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nome,
                genre: 'trilha_cliente',
                mood: 'cliente',
                description: 'Trilha enviada pelo cliente',
                duration: Math.round(buffer.duration),
                file_url: u.public_url,
                file_size: file.size,
                mime_type: file.type || 'audio/mpeg'
            })
        });
        const m = await rm.json();
        if (!m.success || !m.track) throw new Error(m.error || 'falha ao catalogar a trilha');

        return { id: m.track.id, name: nome, file_url: u.public_url, buffer: buffer };
    }
```

- [ ] **Step 3: Fiação do select + input de arquivo**

Dentro do handler de `DOMContentLoaded` (no fim do arquivo, onde os outros botões são fiados — logo antes de `document.getElementById('textoComercial').addEventListener('input', atualizarContador);`), inserir:

```javascript
        // ── Upload de trilha do cliente ──────────────────────────────────
        const selTrilha = document.getElementById('selectTrilha');
        const inputTrilha = document.getElementById('inputTrilhaCliente');
        let trilhaAnterior = selTrilha.value;   // pra voltar se cancelar o seletor

        selTrilha.addEventListener('change', () => {
            if (selTrilha.value !== 'upload') { trilhaAnterior = selTrilha.value; return; }
            inputTrilha.value = '';   // permite escolher o MESMO arquivo de novo
            inputTrilha.click();
        });

        // Chrome dispara 'cancel' (não 'change') quando o produtor fecha o
        // seletor sem escolher arquivo. Sem isto, o select ficava travado em
        // "upload" e re-selecionar a opção não reabria o diálogo.
        inputTrilha.addEventListener('cancel', () => {
            selTrilha.value = trilhaAnterior;
        });

        inputTrilha.addEventListener('change', async () => {
            const file = inputTrilha.files && inputTrilha.files[0];
            // Cinto de segurança pra navegador que dispare 'change' vazio.
            if (!file) { selTrilha.value = trilhaAnterior; return; }

            // Decodifica ANTES de subir: áudio que não toca não vai pro Storage.
            let buffer;
            try {
                buffer = await ctx.decodeAudioData(await file.arrayBuffer());
            } catch (e) {
                avisar('Não consegui ler esse áudio — confira se o arquivo toca no seu computador. Prefira MP3 ou WAV.', 'atencao');
                selTrilha.value = trilhaAnterior;
                return;
            }

            if (file.size > 25 * 1024 * 1024) {
                avisar('Arquivo grande (' + Math.round(file.size / 1024 / 1024)
                       + 'MB) — funciona, mas em MP3 pesaria bem menos e soaria igual no spot.', 'atencao');
            }

            const sugestao = (file.name || 'trilha-do-cliente').replace(/\.[^.]+$/, '');
            const nome = ((window.prompt(
                'Nome da trilha (inclua o cliente, ex.: "Jingle Padaria do Zé"):',
                sugestao) || sugestao).trim()) || sugestao;

            avisar('⬆️ Subindo "' + nome + '" pro Storage...', 'info');
            try {
                estado.trilhaCliente = await subirTrilhaCliente(file, nome, buffer);
                await carregarTrilhas(estado.trilhaCliente.id);
                if (selTrilha.selectedIndex === -1) {
                    // O recarregamento do catálogo falhou (rede): sem isto o
                    // select ficaria em branco e a trilha recém-subida seria
                    // ignorada em silêncio. O buffer está em mãos de qualquer
                    // jeito — garante uma opção visível apontando pra ela.
                    const o = document.createElement('option');
                    o.value = String(estado.trilhaCliente.id);
                    o.textContent = estado.trilhaCliente.name;
                    selTrilha.appendChild(o);
                    selTrilha.value = String(estado.trilhaCliente.id);
                }
                trilhaAnterior = String(estado.trilhaCliente.id);
                avisar('✅ Trilha "' + nome + '" guardada e selecionada. Pode gerar o anúncio.', 'ok');
            } catch (e) {
                // O áudio decodificou mas não ficou guardado: o spot da VEZ ainda
                // sai com ele — só não existe amanhã nem no "Abrir na MiniDAW".
                estado.trilhaCliente = { id: TRILHA_LOCAL, name: nome, file_url: null, buffer: buffer };
                let o = selTrilha.querySelector('option[value="' + TRILHA_LOCAL + '"]');
                if (!o) {
                    o = document.createElement('option');
                    o.value = TRILHA_LOCAL;
                    selTrilha.appendChild(o);
                }
                o.textContent = '⚠️ ' + nome + ' (só nesta aba)';
                selTrilha.value = TRILHA_LOCAL;
                trilhaAnterior = TRILHA_LOCAL;
                avisar('⚠️ A trilha NÃO ficou guardada (' + e.message + '). Dá pra gerar o spot '
                       + 'agora mesmo assim, mas ela some ao fechar a aba e não vai junto '
                       + 'no "Abrir na MiniDAW".', 'atencao');
            }
        });
```

- [ ] **Step 4: Validar sintaxe**

Run: `node --check static/gerador.js`
Expected: sem saída (exit 0).

- [ ] **Step 5: Commit**

```bash
git add static/gerador.js
git commit -m "feat(gerador): upload da trilha do cliente com decode previo e fallback so-nesta-aba"
```

---

### Task 4: Passo [3] do pipeline usa a trilha do cliente + handoff pra MiniDAW sem URL

**Files:**
- Modify: `static/gerador.js` — passo `[3] TRILHA` dentro de `gerarSpot` (~linha 320-358) e o handler de `btnAbrirMiniDAW` (~linha 523-527)

- [ ] **Step 1: Ramo da trilha do cliente no passo [3]**

Localizar (dentro do try do passo 3):

```javascript
            const escolha = document.getElementById('selectTrilha').value;
            try {
                if (escolha === 'nenhuma') {
                    avisar('Sem trilha, por escolha sua.', 'info');
                } else if (escolha === 'auto') {
```

Substituir por:

```javascript
            const escolha = document.getElementById('selectTrilha').value;
            try {
                if (escolha === 'nenhuma') {
                    avisar('Sem trilha, por escolha sua.', 'info');
                } else if (escolha === 'upload') {
                    // Abriu o seletor de arquivo mas nenhum upload se concluiu.
                    avisar('Nenhuma trilha foi subida — seguindo com locução seca. Suba o arquivo antes de gerar.', 'atencao');
                } else if (estado.trilhaCliente && String(estado.trilhaCliente.id) === escolha) {
                    // Trilha do cliente subida NESTA aba: o buffer já está em
                    // mãos — não baixa de volta do Storage. Cobre também a
                    // TRILHA_LOCAL (upload falhou, buffer só na memória).
                    estado.trilha = {
                        id: estado.trilhaCliente.id,
                        name: estado.trilhaCliente.name,
                        file_url: estado.trilhaCliente.file_url
                    };
                    estado.trilhaBuffer = estado.trilhaCliente.buffer;
                } else if (escolha === 'auto') {
```

(O ramo final `else` existente — busca por id no `/api/tracks` — fica como está: é ele que cobre trilhas de clientes subidas em sessões ANTERIORES, que chegam pelo catálogo com `file_url` normal.)

- [ ] **Step 2: Não re-baixar o que já está decodificado**

Logo abaixo, no mesmo try, localizar:

```javascript
                if (estado.trilha) estado.trilhaBuffer = await baixarEDecodificar(estado.trilha.file_url);
```

Substituir por:

```javascript
                if (estado.trilha && !estado.trilhaBuffer) {
                    estado.trilhaBuffer = await baixarEDecodificar(estado.trilha.file_url);
                }
```

- [ ] **Step 3: Handoff pra MiniDAW só passa trilha que TEM URL**

Localizar (no handler de `btnAbrirMiniDAW`):

```javascript
                        trilha: estado.trilha
                            ? { url: estado.trilha.file_url, nome: estado.trilha.name }
                            : null,
```

Substituir por:

```javascript
                        // Trilha local (upload que falhou) não tem URL — mandar
                        // url:null faria a MiniDAW tentar baixar 'null'.
                        trilha: (estado.trilha && estado.trilha.file_url)
                            ? { url: estado.trilha.file_url, nome: estado.trilha.name }
                            : null,
```

- [ ] **Step 4: Validar sintaxe**

Run: `node --check static/gerador.js`
Expected: sem saída (exit 0).

- [ ] **Step 5: Commit**

```bash
git add static/gerador.js
git commit -m "feat(gerador): pipeline usa a trilha do cliente sem re-download e protege o handoff pra MiniDAW"
```

---

### Task 5: Verificação manual no navegador (protocolo — sem código)

Não delegar a subagente: é o produtor (ou o controlador com o produtor) no `/gerador` real.

- [ ] **1. Regressão do caminho padrão:** com "Deixar a IA escolher", gerar um spot com briefing manual. A trilha deve vir do acervo como sempre (e NUNCA uma demo de voz).
- [ ] **2. Upload feliz:** selecionar "📤 Subir trilha do cliente...", escolher um MP3, dar nome com cliente. Esperar o ✅; conferir que o select mostra a trilha selecionada no grupo "Trilhas de clientes". Gerar o spot e OUVIR a trilha do cliente no resultado.
- [ ] **3. Cancelar o seletor:** escolher "Subir trilha...", fechar o seletor de arquivo sem escolher nada. O select deve voltar pra opção anterior.
- [ ] **4. Reuso em sessão nova:** F5 na página → a trilha subida deve aparecer no grupo "Trilhas de clientes"; selecionar e gerar → deve baixar do Storage e mixar normal.
- [ ] **5. IA cega:** com a trilha do cliente EXISTINDO no catálogo, gerar um spot em "Deixar a IA escolher" → a IA nunca deve escolher a trilha do cliente.
- [ ] **6. Handoff:** depois de gerar com trilha do cliente (catalogada), "Abrir na MiniDAW" → a trilha deve chegar lá como URL e tocar.
- [ ] **7. Arquivo inválido:** tentar subir um .txt renomeado pra .mp3 (ou arquivo corrompido) → aviso amigável, nada sobe pro Storage, select volta ao anterior.
- [ ] **8. Deploy:** push pra `main` e repetir o teste 2 em produção (o `?v=2` garante o JS novo).
