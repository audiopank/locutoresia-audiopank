# CLAUDE.md — Locutores IA

Guia para agentes trabalhando neste repositório. **Responda ao usuário em português.**

## O que é o sistema

**Locutores IA** (marca interna: *Studio Audio Pank*) é uma aplicação web de **locução/produção de áudio com IA** + um **agente automático de notícias** que gera e publica posts na plataforma **NewPost-IA**.

Dois grandes blocos funcionais:
1. **Studio de áudio (TTS / MiniDAW)** — gera locuções a partir de roteiros, com múltiplos provedores TTS, clonagem de voz, mixagem client-side e export MP3.
2. **News Agent** — coleta notícias via RSS, gera posts com IA e publica no feed da NewPost-IA (Supabase).

## Stack

- **Backend:** Flask 2.3 (Python 3.12), servido como WSGI. Entrada de produção: [api/index.py](api/index.py) → importa `app` de [backend/app.py](backend/app.py).
- **Deploy:** Vercel (`@vercel/python`), config em [vercel.json](vercel.json). Redeploy automático via push no Git.
- **Banco/Auth:** Supabase (REST). Cliente em [core/supabase_manager.py](core/supabase_manager.py) e [backend/supabase_client.py](backend/supabase_client.py).
- **Frontend:** Jinja templates em [templates/](templates/) + app React/Vite **MiniDAW** em [minidaw-react/](minidaw-react/) (build copiado para [static/minidaw-react/](static/minidaw-react/)).
- **TTS providers:** ElevenLabs, Google TTS, LMNT, edge-tts, gTTS, Gemini. Geradores em [core/tts_generator.py](core/tts_generator.py) e correlatos. Fallback típico: ElevenLabs → Google → OpenAI.

## Mapa do repositório

| Caminho | Papel |
|---|---|
| [api/index.py](api/index.py) | Handler WSGI do Vercel (expõe `app` **e** `application`) |
| [backend/app.py](backend/app.py) | App Flask principal — rotas web + APIs (arquivo grande) |
| [backend/](backend/) | Servidores, publishers, integrações Supabase/news |
| [core/](core/) | Geradores TTS, clonagem de voz, orquestração de agentes, RSS |
| [templates/](templates/) | Páginas Jinja (`/studio`, `/news-auto-post`, `/newpost-authors`, etc.) |
| [minidaw-react/](minidaw-react/) | Frontend React do MiniDAW (Vite + Tailwind + shadcn/ui) |
| [static/](static/) | Assets servidos, incluindo build do MiniDAW |
| `news_agent.py`, `news_scheduler.py` | Agente/scheduler de notícias (nível raiz, legado) |
| `*.sql`, `check_*.py`, `test_*.py` | Migrações Supabase e scripts de diagnóstico ad-hoc |

> ⚠️ A raiz do projeto tem MUITOS scripts `test_*`/`check_*`/`debug_*` e `.bat` de deploy históricos. São utilitários pontuais, não o app. Não confie neles como fonte de verdade — o app real é `backend/app.py` + `core/`.

## Rodar e fazer deploy

```bash
# Dev local (servidor simples)
python start_simple.py          # ou: python backend/start_server.py

# MiniDAW React (dentro de minidaw-react/)
npm install && npm run dev       # dev
npm run build                    # gera dist/ → copiar para static/minidaw-react/

# Deploy: commit + push na branch main → Vercel redeploya automaticamente
```

## Restrições e armadilhas conhecidas

Estas estão detalhadas na memória persistente (ver `MEMORY.md`). Resumo crítico:

- **Vercel é read-only filesystem:** nada de `FileHandler` em logging nem gravar arquivos no disco em produção. Código já usa `os.environ.get('VERCEL')` para detectar o ambiente e desabilitar essas partes (agentes com SQLite/log ficam off em prod).
- **WSGI:** o runtime do Vercel procura a variável `app`. Sempre exponha `app` em `api/index.py` (não só `application`).
- **Dependências removidas** por incompatibilidade com Python 3.12: `lxml`, `newspaper3k`, `numpy`. Não reintroduzir.
- **Supabase — dois projetos:** o banco de trabalho do Locutores IA é `ykswhzqdjoshjoaruhqs` (`NEWPOST_SUPABASE_*`); o **feed público da NewPost-IA** (https://www.newpostia.app) roda em `esdglycwumxxksqpeima` desde 31/08/2026 (`NEWPOST_FEED_*`, publicação **com login** via [core/newpost_feed.py](core/newpost_feed.py) — a RLS barra anônimo). O projeto antigo `hzmtdfojctctvgqjdbex` (Lovable) foi desligado. Confirme o projeto antes de rodar SQL/triggers.
- **Tabela `posts`:** usa `media_urls`/`media_types`/`tags` (arrays), **não** `image_url`/`caption`/`hashtags`. `author_id` é FK para `profiles.id` (usar o ID válido da NewPost-IA verificada).
- **Git push:** o remote correto é `audiopank/locutoresia-audiopank`; a URL precisa embutir `audiopank@` para evitar 403.
- **Vercel project correto:** `locutoresia-audiopank` (conta `novaaudiopank@gmail.com`).

## Squads de desenvolvimento (metodologia)

O repositório inclui três pastas com agentes e skills para guiar o desenvolvimento:

- **`c-level-squad/`** e **`claude-squads/.claude/agents/`** — 6 subagentes executivos "C-Level": `vision-chief` (CEO/orquestrador, tier 0), `coo-orchestrator`, `cto-architect`, `cio-engineer`, `cmo-architect`, `caio-architect`. Use para decisões de estratégia/arquitetura/produto.
- **`SquadDev/SquadDev/`** e **`claude-squads/.claude/skills/`** — suíte "Superpowers" de skills de workflow de engenharia: `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `using-git-worktrees`, `finishing-a-development-branch`, `writing-skills`, `using-superpowers`.

**Filosofia de trabalho destas skills (adotar):**
- Antes de qualquer trabalho criativo, use **brainstorming** para alinhar intenção/requisitos.
- Para tarefas multi-step, escreva um plano (**writing-plans**) antes de tocar no código.
- **TDD** e **systematic-debugging** são rígidas: siga exatamente; não pule a disciplina.
- **Nunca** afirme que algo está "pronto/funcionando" sem evidência — rode a verificação primeiro (**verification-before-completion**).

> **Ativação:** ✅ feito — os 6 agentes e as 14 skills foram copiados para a raiz `.claude/agents/` e `.claude/skills/`, então já são carregados pelo Claude Code. As pastas `c-level-squad/`, `SquadDev/SquadDev/` e `claude-squads/` permanecem como fonte/backup. Para invocar um agente use o Agent tool (ex.: `vision-chief`, `cto-architect`); as skills aparecem via Skill tool.

## Skills de marketing

O repositório inclui `marketingskills-main/` — pacote open-source de +50 skills de marketing pro Claude Code ([coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)): copywriting, CRO, anúncios pagos, SEO, e-mail, precificação, lançamento, psicologia de marketing, etc.

> **Ativação (13/08/2026):** ✅ parcial — 9 skills relevantes pra uma produtora de áudio/locução foram copiadas pra `.claude/skills/`, já carregadas pelo Claude Code: `copywriting`, `cro`, `ads`, `social`, `marketing-ideas`, `pricing`, `launch`, `marketing-psychology`, `emails`. As outras ~41 (ASO de app, paywalls, SMS, revops B2B, etc.) ficaram de fora por não se aplicarem ao negócio — estão disponíveis em `marketingskills-main/skills/` caso alguma faça sentido depois; copiar a pasta pra `.claude/skills/<nome>/` ativa. `marketingskills-main/` permanece como fonte/backup completo.

## Convenções

- Idioma: código e comentários em português (segue o existente). Respostas ao usuário em português.
- Plataforma: Windows + PowerShell. Há `.bat` para deploy, mas prefira git direto.
- Não commitar segredos: há vários `.env*` no repo — credenciais reais ficam fora do controle de versão.
