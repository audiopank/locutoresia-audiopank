# Reorganização do Fluxo de Roteiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o Editor de Roteiro da home do Locutores IA (prompts do Gemini que poluíam o texto com conversa) e mover a Biblioteca de Roteiros do corpo da página pra uma página própria (`/roteiros`), com um atalho de recentes no menu lateral.

**Architecture:** Flask + Jinja templates (sem framework JS, vanilla JS + Bootstrap 5, mesmo padrão de `templates/library.html`). Nenhuma mudança de banco/schema — tudo usa o endpoint `/api/scripts` (armazenamento em arquivo local via `SCRIPTS_FILE`) que já existe em `backend/app.py`. Handoff entre páginas via `localStorage`, mesmo padrão já implementado e validado nesta mesma sessão para "Biblioteca de Trilhas → MiniDAW".

**Tech Stack:** Python 3.12 / Flask 2.3, Jinja2, Bootstrap 5.3, Font Awesome 6, `google-genai` (Gemini).

---

## Contexto para quem for implementar (zero conhecimento prévio do projeto)

- `templates/index.html` é a página servida em `/` (rota Flask em `backend/app.py`, procure por `def index()` ou `@app.route('/')`). Ela tem um menu lateral fixo (`<aside class="sidebar">`) com seções (`menu-section`), e no conteúdo principal (coluna direita) tem 3 painéis empilhados: "Editor de Roteiro", "Biblioteca de Roteiros" e "Gerar Locução". O painel "Gerar Locução" **não deve ser tocado** nesta tarefa.
- `templates/library.html` é a "Biblioteca de Trilhas Sonoras" (rota `/library`, veja `backend/app.py:567-570`) — é o padrão visual/estrutural que a nova página de roteiros deve seguir: cabeçalho com "Voltar ao Início", filtros, grid/lista de cards com ações.
- O endpoint `/api/scripts` (GET lista, POST cria, PUT `/api/scripts/<id>` atualiza, DELETE `/api/scripts/<id>` remove) já existe em `backend/app.py` (por volta da linha 6081-6191) e não precisa de nenhuma mudança. Cada script tem: `id`, `title`, `content`, `created_at`, `updated_at`. A lista vem sempre ordenada do mais novo pro mais antigo (o backend insere com `scripts.insert(0, ...)`).
- Rode o servidor local pra testar manualmente com: `python start_simple.py` (a partir da raiz do repo) ou veja `CLAUDE.md` na raiz pra outras opções. Teste os endpoints via `python -c "..."` usando `app.test_client()` como já é convenção neste projeto (veja exemplos nos próprios commits recentes).

---

### Task 1: Corrigir os prompts do Gemini (raiz do bug do Editor)

**Files:**
- Modify: `backend/app.py:5286` (dentro de `gemini_improve_script`, rota `/api/gemini/improve`)
- Modify: `backend/app.py:5440` (dentro de `gemini_change_tone`, rota `/api/gemini/tone`)

O prompt de `/api/gemini/improve` hoje é:

```python
        prompt = f"Melhore o seguinte roteiro para uma locução profissional, mantendo o significado original, mas tornando-o mais fluido e envolvente:\n\n{text}"
```

- [ ] **Step 1: Corrigir o prompt de `/api/gemini/improve`**

Substituir a linha acima por:

```python
        prompt = (
            "Melhore o seguinte roteiro para uma locução profissional, mantendo o significado original, "
            "mas tornando-o mais fluido e envolvente. "
            "Responda APENAS com o texto do roteiro melhorado, sem saudação, sem introdução, sem comentários "
            "e sem marcações como \"---\" — pronto para ser narrado exatamente como está.\n\n"
            f"Roteiro original:\n{text}"
        )
```

O prompt de `/api/gemini/tone` hoje é:

```python
        prompt = f"Reescreva o seguinte roteiro com um tom {tone_descriptions.get(tone, tone)}, mantendo todo o conteúdo e informação original:\n\n{text}"
```

- [ ] **Step 2: Corrigir o prompt de `/api/gemini/tone`**

Substituir a linha acima por:

```python
        prompt = (
            f"Reescreva o seguinte roteiro com um tom {tone_descriptions.get(tone, tone)}, "
            "mantendo todo o conteúdo e informação original. "
            "Responda APENAS com o texto do roteiro reescrito, sem saudação, sem introdução, sem comentários "
            "e sem marcações como \"---\" — pronto para ser narrado exatamente como está.\n\n"
            f"Roteiro original:\n{text}"
        )
```

- [ ] **Step 3: Testar manualmente as duas rotas**

Rode (a partir da raiz do repo, com o `.env` carregado — já existe `GEMINI_API_KEY` configurada):

```bash
python -c "
import sys; sys.path.insert(0, '.')
from dotenv import load_dotenv; load_dotenv()
from backend.app import app

client = app.test_client()

r1 = client.post('/api/gemini/improve', json={'text': 'anuncio de pizzaria com promocao de terca'})
print('IMPROVE:', r1.get_json())

r2 = client.post('/api/gemini/tone', json={'text': 'anuncio de pizzaria com promocao de terca', 'tone': 'friendly'})
print('TONE:', r2.get_json())
"
```

Expected: os dois `print` mostram `{'success': True, 'text': '...'}` onde o campo `text` **começa direto com o conteúdo do roteiro**, sem nenhuma frase tipo "Aqui está", "Certamente", "Claro!" no início. Se ainda aparecer preâmbulo, ajuste o prompt reforçando a instrução (ex: adicionar "NÃO escreva nada antes ou depois do roteiro.") e rode de novo.

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "fix(gemini): remove preambulo conversacional de improve/tone

Os prompts de /api/gemini/improve e /api/gemini/tone nao instruiam
o Gemini a responder so com o texto reescrito. O modelo respondia
de forma conversacional (\"Certamente! Aqui esta uma versao...\"),
e esse texto ia parar no Editor e podia ser salvo na Biblioteca de
Roteiros como esta, poluindo os roteiros salvos."
```

---

### Task 2: Nova página `/roteiros` (Biblioteca de Roteiros completa)

**Files:**
- Create: `templates/scripts_library.html`
- Modify: `backend/app.py` (nova rota, logo após a rota `/library` — por volta da linha 570)

- [ ] **Step 1: Criar a rota Flask `/roteiros`**

Em `backend/app.py`, logo depois da rota `/library` (procure por `@app.route('/library')` / `def library():` / `return render_template('library.html')`), adicione:

```python
@app.route('/roteiros')
def scripts_library_page():
    """Biblioteca de Roteiros"""
    return render_template('scripts_library.html')
```

- [ ] **Step 2: Testar que a rota responde**

```bash
python -c "
import sys; sys.path.insert(0, '.')
from dotenv import load_dotenv; load_dotenv()
from backend.app import app
client = app.test_client()
r = client.get('/roteiros')
print(r.status_code)
"
```

Expected: `500` (o template ainda não existe — é esperado nesse ponto). Depois do Step 3 abaixo, deve virar `200`.

- [ ] **Step 3: Criar o template `templates/scripts_library.html`**

Criar o arquivo com o conteúdo completo abaixo (segue o mesmo padrão visual/estrutural de `templates/library.html`, adaptado pra roteiros de texto em vez de trilhas de áudio):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Biblioteca de Roteiros - Locutores IA</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: #6366f1;
            --secondary-color: #8b5cf6;
            --accent-color: #ec4899;
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
        .main-header {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--border-color);
            padding: 1rem 0;
            position: sticky;
            top: 0;
            z-index: 1000;
        }
        .library-container {
            padding: 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .filter-section {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .script-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            margin-bottom: 1rem;
        }
        .search-box, .form-control, .form-select {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }
        .search-box:focus, .form-control:focus, .form-select:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
            background: rgba(15, 23, 42, 0.6);
            color: var(--text-primary);
        }
        .btn-primary-custom {
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            border: none;
            color: white;
            font-weight: 500;
        }
        .btn-primary-custom:hover {
            background: linear-gradient(135deg, var(--secondary-color), var(--accent-color));
        }
        .delete-btn {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #ef4444;
            padding: 0.375rem 0.75rem;
            border-radius: 8px;
        }
        .delete-btn:hover {
            background: rgba(239, 68, 68, 0.2);
        }
    </style>
</head>
<body>
    <header class="main-header">
        <div class="container-fluid">
            <div class="row align-items-center">
                <div class="col-md-6">
                    <h1 class="h3 mb-0">
                        <i class="fas fa-book me-2"></i>
                        Biblioteca de Roteiros
                    </h1>
                    <p class="mb-0 text-muted">Todos os roteiros salvos</p>
                </div>
                <div class="col-md-6 text-md-end">
                    <a href="/" class="btn btn-secondary">
                        <i class="fas fa-arrow-left me-1"></i>
                        Voltar ao Início
                    </a>
                </div>
            </div>
        </div>
    </header>

    <main class="library-container">
        <div class="filter-section">
            <input type="text" class="form-control search-box" id="searchInput" placeholder="Pesquise por título ou conteúdo...">
            <div class="d-flex flex-wrap gap-2 mt-3">
                <select class="form-select" id="originSelect" style="max-width: 220px;">
                    <option value="">Todos</option>
                    <option value="mes">Este mês</option>
                    <option value="newpost">NewPost-IA</option>
                </select>
                <button class="btn btn-primary-custom" onclick="loadScripts()">
                    <i class="fas fa-sync-alt me-1"></i>
                    Atualizar
                </button>
            </div>
        </div>

        <div id="scriptsList"></div>

        <div class="text-center mt-5" id="emptyState" style="display: none;">
            <i class="fas fa-file-alt fa-4x mb-3" style="color: var(--text-secondary); opacity: 0.5;"></i>
            <h4>Nenhum roteiro encontrado</h4>
            <p class="text-muted">Salve roteiros no Editor da página inicial pra vê-los aqui.</p>
        </div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        let SCRIPTS = [];

        document.addEventListener('DOMContentLoaded', function() {
            loadScripts();
            document.getElementById('searchInput').addEventListener('input', filterScripts);
            document.getElementById('originSelect').addEventListener('change', filterScripts);
        });

        async function loadScripts() {
            try {
                const response = await fetch('/api/scripts');
                const data = await response.json();
                if (data.success) {
                    SCRIPTS = data.scripts;
                    filterScripts();
                }
            } catch (error) {
                console.error('Erro ao carregar roteiros:', error);
            }
        }

        function filterScripts() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const origin = document.getElementById('originSelect').value;
            const now = new Date();

            const filtered = SCRIPTS.filter(function(script) {
                const matchesSearch = !search ||
                    script.title.toLowerCase().includes(search) ||
                    script.content.toLowerCase().includes(search);

                let matchesOrigin = true;
                if (origin === 'newpost') {
                    matchesOrigin = script.title.startsWith('Roteiro NewPost-IA');
                } else if (origin === 'mes') {
                    const created = new Date(script.created_at);
                    matchesOrigin = created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
                }

                return matchesSearch && matchesOrigin;
            });

            renderScripts(filtered);
        }

        function renderScripts(scripts) {
            const container = document.getElementById('scriptsList');
            const emptyState = document.getElementById('emptyState');

            if (scripts.length === 0) {
                container.innerHTML = '';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';
            container.innerHTML = scripts.map(function(script) {
                const safeId = script.id.replace(/'/g, "\\'");
                const escapedTitle = escapeHtml(script.title);
                return `
                <div class="script-card" id="script-${safeId}">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="flex-grow-1">
                            <input type="text" class="form-control form-control-sm bg-transparent text-light border-0 fw-bold"
                                   id="title-${safeId}" value="${escapedTitle}"
                                   onchange="updateScriptTitle('${safeId}')">
                            <small class="text-secondary">${new Date(script.created_at).toLocaleString('pt-BR')}</small>
                        </div>
                        <div class="d-flex gap-2 ms-2">
                            <button class="btn btn-sm btn-outline-light" title="Usar no Editor" onclick="useInEditor('${safeId}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-primary" title="Gerar Locução" onclick="useForVoice('${safeId}')">
                                <i class="fas fa-microphone"></i>
                            </button>
                            <button class="delete-btn" title="Excluir" onclick="deleteScript('${safeId}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <textarea class="form-control form-control-sm bg-dark text-light border-secondary"
                              id="content-${safeId}" rows="3"
                              onchange="updateScriptContent('${safeId}')">${escapeHtml(script.content)}</textarea>
                </div>
            `;
            }).join('');
        }

        async function updateScriptTitle(scriptId) {
            const title = document.getElementById(`title-${scriptId}`).value;
            try {
                await fetch(`/api/scripts/${scriptId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });
                loadScripts();
            } catch (error) {
                console.error('Erro ao atualizar título:', error);
            }
        }

        async function updateScriptContent(scriptId) {
            const content = document.getElementById(`content-${scriptId}`).value;
            try {
                await fetch(`/api/scripts/${scriptId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
            } catch (error) {
                console.error('Erro ao atualizar conteúdo:', error);
            }
        }

        async function deleteScript(scriptId) {
            if (!confirm('Tem certeza que deseja excluir este roteiro?')) return;
            try {
                const response = await fetch(`/api/scripts/${scriptId}`, { method: 'DELETE' });
                const data = await response.json();
                if (data.success) {
                    loadScripts();
                } else {
                    throw new Error(data.error);
                }
            } catch (error) {
                console.error('Erro ao excluir:', error);
                alert(`Erro ao excluir: ${error.message}`);
            }
        }

        function useInEditor(scriptId) {
            const script = SCRIPTS.find(function(s) { return s.id === scriptId; });
            if (!script) return;
            localStorage.setItem('pendingScriptContent', script.content);
            window.location.href = '/';
        }

        function useForVoice(scriptId) {
            const script = SCRIPTS.find(function(s) { return s.id === scriptId; });
            if (!script) return;
            localStorage.setItem('pendingVoiceText', script.content);
            window.location.href = '/';
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
```

- [ ] **Step 4: Testar que a rota responde 200**

```bash
python -c "
import sys; sys.path.insert(0, '.')
from dotenv import load_dotenv; load_dotenv()
from backend.app import app
client = app.test_client()
r = client.get('/roteiros')
print(r.status_code)
assert r.status_code == 200
assert b'Biblioteca de Roteiros' in r.data
print('OK')
"
```

Expected: imprime `200` e depois `OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py templates/scripts_library.html
git commit -m "feat(roteiros): cria pagina /roteiros (Biblioteca de Roteiros completa)

Nova pagina seguindo o mesmo padrao visual de templates/library.html
(Biblioteca de Trilhas): busca, filtro por origem/mes, cards com
edicao inline de titulo/conteudo, gerar locucao e exclusao. Usa o
endpoint /api/scripts que ja existe, sem mudanca de schema."
```

---

### Task 3: Editor de Roteiro aplica direto (remove caixa de sugestão)

**Files:**
- Modify: `templates/index.html:858-872` (HTML da caixa de sugestão)
- Modify: `templates/index.html` (funções `improveScript`, `changeTone`, remoção de `acceptSuggestion`/`dismissSuggestion`/`currentSuggestion` e seus listeners)

- [ ] **Step 1: Remover o HTML da caixa de sugestão**

Em `templates/index.html`, dentro do painel "Editor de Roteiro", remover este bloco inteiro (é o filho `<!-- Gemini Suggestions Area -->`):

```html
                                <!-- Gemini Suggestions Area -->
                                <div class="col-12" id="geminiSuggestions" style="display: none;">
                                    <div class="p-3 bg-dark rounded-3">
                                        <h6 class="text-light mb-3"><i class="fas fa-lightbulb me-2"></i>Sugestões do Gemini</h6>
                                        <p id="suggestionText" class="text-secondary"></p>
                                        <div class="d-flex gap-2 mt-2">
                                            <button class="btn btn-sm btn-success" id="acceptSuggestionBtn">
                                                <i class="fas fa-check me-1"></i>Aplicar
                                            </button>
                                            <button class="btn btn-sm btn-outline-light" id="dismissSuggestionBtn">
                                                <i class="fas fa-times me-1"></i>Descartar
                                            </button>
                                        </div>
                                    </div>
                                </div>
```

- [ ] **Step 2: Reescrever `improveScript()` e `changeTone()` pra aplicar direto**

Encontrar (no `<script>` da página, função `improveScript`):

```javascript
        // Script Editor and Gemini Functions
        let currentSuggestion = '';

        async function improveScript() {
            const scriptEditor = document.getElementById('scriptEditor');
            const script = scriptEditor.value.trim();
            if (!script) {
                alert('Por favor, escreva um roteiro primeiro');
                return;
            }
            showNotification('Gerando sugestões...', 'info');
            try {
                const response = await fetch('/api/gemini/improve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: script })
                });

                if (!response.ok) {
                    throw new Error('Erro ao comunicar com a API do Gemini');
                }

                const data = await response.json();
                if (data.success) {
                    currentSuggestion = data.text;
                    document.getElementById('suggestionText').textContent = currentSuggestion;
                    document.getElementById('geminiSuggestions').style.display = 'block';
                    showNotification('Sugestão gerada com sucesso!', 'success');
                }
            } catch (error) {
                console.error('Error improving script:', error);
                // Fallback: simple improvement
                currentSuggestion = `Aqui está uma versão melhorada do seu roteiro:\n\n${script}`;
                document.getElementById('suggestionText').textContent = currentSuggestion;
                document.getElementById('geminiSuggestions').style.display = 'block';
                showNotification('Usando melhorador local (API não disponível)', 'info');
            }
        }

        async function changeTone() {
            const scriptEditor = document.getElementById('scriptEditor');
            const script = scriptEditor.value.trim();
            const tone = document.getElementById('toneSelect').value;
            if (!script) {
                alert('Por favor, escreva um roteiro primeiro');
                return;
            }
            showNotification('Alterando tom...', 'info');
            try {
                const response = await fetch('/api/gemini/tone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: script, tone: tone })
                });

                if (!response.ok) {
                    throw new Error('Erro ao comunicar com a API do Gemini');
                }

                const data = await response.json();
                if (data.success) {
                    currentSuggestion = data.text;
                    document.getElementById('suggestionText').textContent = currentSuggestion;
                    document.getElementById('geminiSuggestions').style.display = 'block';
                    showNotification('Tom alterado com sucesso!', 'success');
                }
            } catch (error) {
                console.error('Error changing tone:', error);
                // Fallback: just indicate the tone change
                currentSuggestion = `Aqui está o seu roteiro com o tom "${tone}":\n\n${script}`;
                document.getElementById('suggestionText').textContent = currentSuggestion;
                document.getElementById('geminiSuggestions').style.display = 'block';
                showNotification('Usando alterador local (API não disponível)', 'info');
            }
        }

        function acceptSuggestion() {
            document.getElementById('scriptEditor').value = currentSuggestion;
            document.getElementById('textInput').value = currentSuggestion;
            document.getElementById('geminiSuggestions').style.display = 'none';
        }

        function dismissSuggestion() {
            document.getElementById('geminiSuggestions').style.display = 'none';
        }
```

Substituir por:

```javascript
        // Script Editor and Gemini Functions
        async function improveScript() {
            const scriptEditor = document.getElementById('scriptEditor');
            const textInput = document.getElementById('textInput');
            const script = scriptEditor.value.trim();
            if (!script) {
                alert('Por favor, escreva um roteiro primeiro');
                return;
            }
            showNotification('Melhorando roteiro...', 'info');
            try {
                const response = await fetch('/api/gemini/improve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: script })
                });

                if (!response.ok) {
                    throw new Error('Erro ao comunicar com a API do Gemini');
                }

                const data = await response.json();
                if (data.success) {
                    scriptEditor.value = data.text;
                    if (textInput) textInput.value = data.text;
                    showNotification('Roteiro melhorado!', 'success');
                } else {
                    throw new Error(data.error || 'Erro desconhecido');
                }
            } catch (error) {
                console.error('Error improving script:', error);
                showNotification('Não foi possível melhorar o roteiro. Tente novamente.', 'error');
            }
        }

        async function changeTone() {
            const scriptEditor = document.getElementById('scriptEditor');
            const textInput = document.getElementById('textInput');
            const script = scriptEditor.value.trim();
            const tone = document.getElementById('toneSelect').value;
            if (!script) {
                alert('Por favor, escreva um roteiro primeiro');
                return;
            }
            showNotification('Alterando tom...', 'info');
            try {
                const response = await fetch('/api/gemini/tone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: script, tone: tone })
                });

                if (!response.ok) {
                    throw new Error('Erro ao comunicar com a API do Gemini');
                }

                const data = await response.json();
                if (data.success) {
                    scriptEditor.value = data.text;
                    if (textInput) textInput.value = data.text;
                    showNotification('Tom alterado!', 'success');
                } else {
                    throw new Error(data.error || 'Erro desconhecido');
                }
            } catch (error) {
                console.error('Error changing tone:', error);
                showNotification('Não foi possível alterar o tom. Tente novamente.', 'error');
            }
        }
```

- [ ] **Step 3: Remover os listeners de `acceptSuggestionBtn`/`dismissSuggestionBtn`**

Dentro do `document.addEventListener('DOMContentLoaded', function() { ... })`, remover:

```javascript
            const acceptBtn = document.getElementById('acceptSuggestionBtn');
            if (acceptBtn) acceptBtn.addEventListener('click', acceptSuggestion);

            const dismissBtn = document.getElementById('dismissSuggestionBtn');
            if (dismissBtn) dismissBtn.addEventListener('click', dismissSuggestion);

```

(mantendo as linhas de `improveBtn`, `toneBtn`, `saveBtn` que ficam antes/depois).

- [ ] **Step 4: Verificar que não sobrou nenhuma referência aos IDs removidos**

```bash
grep -n "geminiSuggestions\|suggestionText\|acceptSuggestion\|dismissSuggestion\|currentSuggestion" templates/index.html
```

Expected: nenhum resultado (comando não imprime nada).

- [ ] **Step 5: Teste manual no navegador**

1. Rode o servidor local (`python start_simple.py` ou equivalente).
2. Abra `/` no navegador, escreva um texto qualquer no Editor de Roteiro.
3. Clique "Melhorar com Gemini" — o texto do Editor deve ser **substituído diretamente** pela versão melhorada (sem caixa de sugestão aparecendo), com uma notificação verde "Roteiro melhorado!".
4. Repita com "Mudar Tom de Voz" (escolha um tom no select antes) — mesmo comportamento, notificação "Tom alterado!".
5. Confirme visualmente que o texto que aparece no Editor **não começa** com frases como "Certamente", "Aqui está", "Claro!".

- [ ] **Step 6: Commit**

```bash
git add templates/index.html
git commit -m "feat(editor): aplica melhorias do Gemini direto no Editor

Remove a caixa de 'Sugestao do Gemini' com Aplicar/Descartar.
Melhorar com Gemini e Mudar Tom de Voz agora substituem o
conteudo do Editor diretamente, com notificacao de sucesso.
Undo fica a cargo do Ctrl+Z nativo do textarea."
```

---

### Task 4: Remover Biblioteca de Roteiros do corpo + menu lateral

**Files:**
- Modify: `templates/index.html:876-887` (remover bloco "Script Library Section")
- Modify: `templates/index.html` (sidebar: novo item de menu + nova seção "Roteiros Recentes")
- Modify: `templates/index.html` (JS: repurpose `renderScripts`, remover funções órfãs, adicionar consumo de handoff via localStorage)

- [ ] **Step 1: Remover o painel "Biblioteca de Roteiros" do corpo da página**

Remover este bloco inteiro de `templates/index.html`:

```html
                        <!-- Script Library Section -->
                        <div class="generation-panel mb-4">
                            <h5><i class="fas fa-book"></i>Biblioteca de Roteiros</h5>
                            
                            <div id="scriptsContainer" class="mt-3">
                                <div class="text-center py-4 text-secondary" id="noScriptsMsg">
                                    <i class="fas fa-file-alt fa-3x mb-2"></i>
                                    <p>Nenhum roteiro salvo ainda. Salve seu primeiro roteiro acima!</p>
                                </div>
                                <div id="scriptsList" class="row g-3"></div>
                            </div>
                        </div>

```

- [ ] **Step 2: Adicionar o item de menu "Biblioteca de Roteiros" em Ferramentas**

Encontrar, dentro da seção `<div class="menu-section">` cujo título é "Ferramentas":

```html
                <a href="/library" class="menu-item badge-new">
                    <i class="fas fa-book-open"></i>
                    <span>Biblioteca de Trilhas</span>
                </a>
```

Adicionar logo depois (mantendo a linha acima intacta):

```html
                <a href="/library" class="menu-item badge-new">
                    <i class="fas fa-book-open"></i>
                    <span>Biblioteca de Trilhas</span>
                </a>
                <a href="/roteiros" class="menu-item badge-new">
                    <i class="fas fa-book"></i>
                    <span>Biblioteca de Roteiros</span>
                </a>
```

- [ ] **Step 3: Adicionar a seção "Roteiros Recentes" no menu lateral**

Encontrar o fim da seção "Principal" e o início da seção "Automação":

```html
                <a href="/noticias" class="menu-item">
                    <i class="fas fa-newspaper"></i>
                    <span>Notícias</span>
                </a>
            </div>

            <div class="menu-section">
                <div class="menu-section-title">Automação</div>
```

Substituir por (inserindo a nova seção entre as duas):

```html
                <a href="/noticias" class="menu-item">
                    <i class="fas fa-newspaper"></i>
                    <span>Notícias</span>
                </a>
            </div>

            <div class="menu-section">
                <div class="menu-section-title">Roteiros Recentes</div>
                <div id="recentScriptsList">
                    <span class="menu-item" style="opacity:.6;">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>Carregando...</span>
                    </span>
                </div>
                <a href="/roteiros" class="menu-item">
                    <i class="fas fa-arrow-right"></i>
                    <span>Ver todos »</span>
                </a>
            </div>

            <div class="menu-section">
                <div class="menu-section-title">Automação</div>
```

- [ ] **Step 4: Repurpose `renderScripts()` pra popular o widget de recentes**

Encontrar (função completa `renderScripts`):

```javascript
        function renderScripts() {
            const container = document.getElementById('scriptsList');
            const noScriptsMsg = document.getElementById('noScriptsMsg');

            if (!container) return;

            if (currentScripts.length === 0) {
                noScriptsMsg.style.display = 'block';
                container.innerHTML = '';
                return;
            }

            noScriptsMsg.style.display = 'none';
            container.innerHTML = currentScripts.map(function(script) {
                const escapedTitle = script.title.replace(/"/g, '\\"');
                const safeId = script.id.replace(/'/g, "\\'");
                return `
                <div class="col-12" id="script-${safeId}">
                    <div class="p-3 bg-dark rounded-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div class="flex-grow-1">
                                <input type="text" class="form-control form-control-sm bg-transparent text-light border-0 fw-bold" 
                                       id="title-${safeId}" value="${escapedTitle}" 
                                       onchange="updateScriptTitle('${safeId}')">
                                <small class="text-secondary">${new Date(script.created_at).toLocaleString('pt-BR')}</small>
                            </div>
                            <div class="d-flex gap-2 ms-2">
                                <button class="btn btn-sm btn-outline-light" title="Usar no Editor" onclick="useScript('${safeId}')">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-primary" title="Gerar Locução" onclick="generateVoiceFromScript('${safeId}')">
                                    <i class="fas fa-microphone"></i>
                                </button>
                                <button class="btn btn-sm btn-danger" title="Excluir" onclick="deleteScript('${safeId}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <textarea class="form-control form-control-sm bg-dark text-light border-secondary" 
                                  id="content-${safeId}" rows="3" 
                                  onchange="updateScriptContent('${safeId}')">${script.content}</textarea>
                    </div>
                </div>
            `}).join('');
        }
```

Substituir por:

```javascript
        function renderScripts() {
            const container = document.getElementById('recentScriptsList');
            if (!container) return;

            const recent = currentScripts.slice(0, 3);

            if (recent.length === 0) {
                container.innerHTML = '<span class="menu-item" style="opacity:.6;"><i class="fas fa-info-circle"></i><span>Nenhum roteiro ainda</span></span>';
                return;
            }

            container.innerHTML = recent.map(function(script) {
                const safeId = script.id.replace(/'/g, "\\'");
                let title = script.title || 'Sem título';
                if (title.length > 24) title = title.slice(0, 24) + '…';
                return `
                <a href="#" class="menu-item" onclick="useScript('${safeId}'); return false;" title="${escapeHtml(script.title)}">
                    <i class="fas fa-file-alt"></i>
                    <span>${escapeHtml(title)}</span>
                </a>`;
            }).join('');
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
```

- [ ] **Step 5: Remover as funções órfãs (`updateScriptTitle`, `updateScriptContent`, `deleteScript`)**

Essas três funções não são mais chamadas por nada em `index.html` (a edição inline e exclusão agora vivem só em `/roteiros`, ver Task 2). Remover:

```javascript
        async function updateScriptTitle(scriptId) {
            const title = document.getElementById(`title-${scriptId}`).value;
            try {
                await fetch(`/api/scripts/${scriptId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title })
                });
                showNotification('Título atualizado!', 'success');
                loadScripts();
            } catch (error) {
                console.error('Erro:', error);
            }
        }

        async function updateScriptContent(scriptId) {
            const content = document.getElementById(`content-${scriptId}`).value;
            try {
                await fetch(`/api/scripts/${scriptId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                showNotification('Conteúdo atualizado!', 'success');
            } catch (error) {
                console.error('Erro:', error);
            }
        }
```

e:

```javascript
        async function deleteScript(scriptId) {
            if (!confirm('Tem certeza que deseja excluir este roteiro?')) return;

            try {
                const response = await fetch(`/api/scripts/${scriptId}`, { method: 'DELETE' });
                const data = await response.json();
                if (data.success) {
                    showNotification('Roteiro excluído com sucesso!', 'success');
                    loadScripts();
                }
            } catch (error) {
                console.error('Erro ao excluir roteiro:', error);
                showNotification('Erro ao excluir roteiro!', 'error');
            }
        }
```

(Deixar `useScript` e `generateVoiceFromScript` intactas — continuam em uso pelo widget de recentes e continuam válidas.)

- [ ] **Step 6: Verificar que não sobrou referência a `scriptsList`/`noScriptsMsg`/`scriptsContainer`**

```bash
grep -n "scriptsContainer\|scriptsList\|noScriptsMsg" templates/index.html
```

Expected: nenhum resultado.

- [ ] **Step 7: Commit**

```bash
git add templates/index.html
git commit -m "refactor(roteiros): remove Biblioteca de Roteiros do corpo da home

O painel grande de roteiros salvos sai do conteudo principal.
Vira um widget compacto 'Roteiros Recentes' (3 ultimos) no menu
lateral, com link 'Ver todos' pra pagina /roteiros nova. Remove
funcoes de edicao/exclusao inline que so faziam sentido na lista
grande (agora vivem em scripts_library.html)."
```

---

### Task 5: Consumir o handoff (`localStorage`) vindo de `/roteiros`

**Files:**
- Modify: `templates/index.html` (dentro do `document.addEventListener('DOMContentLoaded', ...)` já existente)

- [ ] **Step 1: Adicionar a leitura do `localStorage` no `DOMContentLoaded`**

Encontrar:

```javascript
            // Load scripts from library
            loadScripts();
        });
```

Substituir por:

```javascript
            // Load scripts from library
            loadScripts();

            // Handoff vindo de /roteiros (Usar no Editor / Gerar Locução)
            const pendingScriptContent = localStorage.getItem('pendingScriptContent');
            if (pendingScriptContent !== null) {
                document.getElementById('scriptEditor').value = pendingScriptContent;
                if (textInput) textInput.value = pendingScriptContent;
                localStorage.removeItem('pendingScriptContent');
                showNotification('Roteiro carregado no editor!', 'info');
            }

            const pendingVoiceText = localStorage.getItem('pendingVoiceText');
            if (pendingVoiceText !== null) {
                const voiceTextInput = document.getElementById('textInput');
                if (voiceTextInput) voiceTextInput.value = pendingVoiceText;
                localStorage.removeItem('pendingVoiceText');
                showNotification('Roteiro carregado para gerar locução!', 'info');
            }
        });
```

(A variável `textInput` já existe nesse mesmo bloco, declarada logo acima como `const textInput = document.getElementById('textInput');` — reaproveitar, não redeclarar.)

- [ ] **Step 2: Teste manual do handoff completo**

1. Rode o servidor local, abra `/`, escreva um roteiro qualquer no Editor e clique "Salvar Roteiro" (dê um título quando pedido).
2. No menu lateral, confirme que o roteiro aparece em "Roteiros Recentes" (título truncado, no topo da lista).
3. Clique em "Ver todos »" — deve abrir `/roteiros` e mostrar o roteiro salvo no card.
4. Na página `/roteiros`, clique no ícone de lápis ("Usar no Editor") do roteiro — deve voltar pra `/` com o texto já preenchido no Editor de Roteiro, e uma notificação "Roteiro carregado no editor!".
5. Volte pra `/roteiros`, clique no ícone de microfone ("Gerar Locução") — deve voltar pra `/` com o texto preenchido no campo "Texto para Locução" do painel Gerar Locução (mais abaixo na página), com notificação "Roteiro carregado para gerar locução!".
6. Na página `/roteiros`, teste excluir um roteiro de teste — deve sumir da lista.

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat(roteiros): consome handoff de /roteiros via localStorage

'Usar no Editor' e 'Gerar Locucao' na pagina /roteiros gravam o
conteudo em localStorage e redirecionam pra /. A home le e limpa
essas chaves no carregamento, preenchendo o Editor ou o campo de
Gerar Locucao — mesmo padrao ja validado nesta sessao pro handoff
Biblioteca de Trilhas -> MiniDAW."
```

---

## Verificação final (checklist manual, depois de todas as tasks)

- [ ] `/` carrega sem erros no console do navegador (F12 → Console).
- [ ] "Melhorar com Gemini" e "Mudar Tom de Voz" aplicam direto no Editor, texto limpo (sem preâmbulo).
- [ ] Não existe mais painel "Biblioteca de Roteiros" grande no corpo de `/`.
- [ ] Menu lateral mostra "Roteiros Recentes" (até 3 itens) + "Ver todos »", e "Biblioteca de Roteiros" em Ferramentas.
- [ ] `/roteiros` carrega, lista todos os roteiros, busca e filtro funcionam.
- [ ] Handoff "Usar no Editor" e "Gerar Locução" funcionam nos dois sentidos.
- [ ] Painel "Gerar Locução" da home continua exatamente como antes (nenhuma mudança).
