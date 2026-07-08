# Reorganização do fluxo de Roteiro — Locutores IA

Data: 2026-07-08

## Problema

Na home do Locutores IA (`templates/index.html`), o fluxo de "Roteiro com IA" tem dois problemas reportados pelo usuário:

1. **Editor de Roteiro não funciona corretamente.** Os botões "Melhorar com Gemini" e "Mudar Tom de Voz" chamam `/api/gemini/improve` e `/api/gemini/tone`, cujos prompts pedem ao Gemini pra reescrever o texto mas não instruem a devolver *só* o texto reescrito. O modelo responde de forma conversacional (ex: "Certamente! Aqui está uma versão reescrita com um tom profissional e formal:\n\n---\n\n[texto]"), e essa resposta inteira aparece na caixa de "Sugestão do Gemini". Se o usuário clica em "Aplicar", o preâmbulo conversacional vai para o Editor e pode ser salvo na Biblioteca de Roteiros como está — poluindo os roteiros salvos com texto de conversa em vez de conteúdo limpo pronto pra locução.

2. **Biblioteca de Roteiros bagunçada no corpo da página.** Hoje ela é um painel empilhado entre o "Editor de Roteiro" e o "Gerar Locução" no conteúdo principal, misturando roteiros de origens diferentes (edição manual, gerados por IA com o bug acima, importados do NewPost-IA) numa lista longa que cresce sem controle, empurrando o resto da página pra baixo.

## Escopo confirmado com o usuário

- O painel **"Gerar Locução"** (texto → voz direto na home, separado do MiniDAW) **fica exatamente como está** — fora de escopo desta mudança.
- Nenhuma mudança de schema/banco é necessária: tudo usa o endpoint `/api/scripts` que já existe (`backend/app.py`, `GET/POST/PUT/DELETE`).

## Design

### 1. Correção do prompt do Gemini (raiz do bug)

Em `backend/app.py`, ajustar os prompts de:
- `gemini_improve_script` (`/api/gemini/improve`)
- `gemini_change_tone` (`/api/gemini/tone`)

Ambos os prompts devem instruir explicitamente o Gemini a responder **apenas com o texto reescrito**, sem saudação, sem introdução, sem marcações como "---". Mesmo padrão de instrução já usado com sucesso em `/api/gemini/script` e `/api/gemini/variations` (que já pedem "Responda APENAS com..." e funcionam limpos).

### 2. Fluxo do Editor: aplicar direto, sem caixa de sugestão

Em `templates/index.html`, as funções `improveScript()` e `changeTone()` deixam de popular `#geminiSuggestions`/`#suggestionText` e passam a **substituir diretamente** o valor de `#scriptEditor` com o texto retornado, mostrando uma notificação (`showNotification`) de sucesso (ex: "Roteiro melhorado!" / "Tom alterado!").

Remover do HTML: o bloco `#geminiSuggestions` (caixa de sugestão) e as funções `acceptSuggestion()`/`dismissSuggestion()` associadas, já que deixam de ser necessárias. Undo fica a cargo do Ctrl+Z nativo do textarea.

### 3. Biblioteca de Roteiros sai do corpo da página

- Remover de `templates/index.html` o bloco `<!-- Script Library Section -->` (painel "Biblioteca de Roteiros" completo, incluindo `#scriptsContainer`/`#scriptsList`/`#noScriptsMsg`) e as funções JS que só existem pra popular esse bloco específico na home (mantendo as que são reaproveitadas, como `loadScripts`/`renderScripts`, que migram para a nova página).
- Nova rota `/roteiros` (nome de arquivo sugerido: `templates/scripts_library.html`), servida por uma nova view Flask em `backend/app.py`, seguindo o mesmo padrão visual/estrutural de `templates/library.html` (Biblioteca de Trilhas): cabeçalho com "Voltar ao Início", campo de busca por título/conteúdo, filtros (Todos / Este mês / NewPost-IA), lista de cards com título, preview do conteúdo, timestamp, e ações (editar título/conteúdo inline, gerar locução, excluir) — reaproveitando `loadScripts`/`renderScripts` adaptadas dessa página.
- Filtro "NewPost-IA": roteiros cujo título comece com `"Roteiro NewPost-IA"` (convenção já usada nos dados existentes, ver `Roteiro NewPost-IA - Jogo do Brasil_24/06/2026` na biblioteca atual).

### 4. Menu lateral: novo item + widget de recentes

Em `templates/index.html`, seção de menu (`menu-section`):
- Novo item em **Ferramentas**, logo após "Biblioteca de Trilhas":
  ```html
  <a href="/roteiros" class="menu-item badge-new">
      <i class="fas fa-book"></i>
      <span>Biblioteca de Roteiros</span>
  </a>
  ```
- Nova seção **"Roteiros Recentes"**, entre a seção atual sem título (Início/Busca/Notícias) e "Automação": lista os 3 roteiros mais recentes (busca via `GET /api/scripts`, já ordenado do mais novo pro mais antigo — `scripts.insert(0, ...)` no backend), truncando o título a ~24 caracteres, com um link final "Ver todos »" apontando para `/roteiros`. Populado via JS no `DOMContentLoaded` da home, e **atualizado novamente logo após um "Salvar Roteiro" bem-sucedido** (mesma função de recarregar, chamada de novo — sem precisar de reload da página).

### 5. Handoff `/roteiros` → `/` (reaproveitando o padrão já validado)

Os botões de ação de cada roteiro na página `/roteiros`:
- **"Usar no Editor"**: grava o conteúdo do roteiro em `localStorage` (`pendingScriptContent`) e redireciona para `/`. A home, no `DOMContentLoaded`, verifica essa chave, preenche `#scriptEditor` se presente, e remove a chave do `localStorage` (mesmo padrão de "consumir uma vez" usado em `selectedTrackUrl` para o handoff Biblioteca de Trilhas → MiniDAW).
- **"Gerar Locução"**: mesmo mecanismo, mas grava em `pendingVoiceText` e preenche `#textInput` do painel "Gerar Locução" (que continua existindo e inalterado).

## Fora de escopo

- Qualquer mudança no painel "Gerar Locução".
- Qualquer mudança de schema Supabase (a Biblioteca de Roteiros usa armazenamento local em arquivo via `/api/scripts`, não Supabase — isso já é uma limitação conhecida e pré-existente, não faz parte desta tarefa).
- Migrar o armazenamento de roteiros para Supabase (o arquivo local `SCRIPTS_FILE` não persiste de forma confiável na Vercel — ver `core/supabase_manager.py`/discussão anterior sobre filesystem read-only; fica registrado aqui como problema conhecido, não resolvido nesta spec).
