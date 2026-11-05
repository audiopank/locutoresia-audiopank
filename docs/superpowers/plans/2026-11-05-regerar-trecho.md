# 🔁 Regerar trecho — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na MiniDAW clássica, marcar com a Tesoura o trecho errado de uma faixa de VOZ e trocar só ele por uma fala nova gerada pela IA, com o resto da voz empurrado pela diferença — sem nada passar pelo Supabase.

**Architecture:** Matemática pura em `static/regerar-trecho.js` (UMD, testada no node), reaproveitando `ClipModel.silenciarTrecho` / `igualarDb` e `AlinharFalas.bordasDaFala`. A parte de tela fica no mesmo arquivo (guardada por `typeof document`), usa a API da `minidaw` (`_clipsDaFaixa`, `_snapshotClips`, `_guardarUndo`, `_sincronizarDerivados`, `cancelarSelecao`, `aposMudancaDeClips`). O backend ganha `entrega: 'inline'` no `/api/generate-audio`: devolve o áudio em base64 na resposta e PULA o upload em `locucoes/`.

**Tech Stack:** JS puro (UMD), Web Audio, Flask, node:test, pytest, puppeteer-core (verificação).

**Pedido extra dele (05/11):** "tudo precisa ser guardado no SALVAR NO PC pra não sufocar o Supabase" → (a) geração `inline` sem upload; (b) o Salvar no PC já grava cada buffer de clip como WAV na pasta (`_arquivosLocais`, minidaw.js ~6098) — conferir no teste do navegador que a fala nova vai junto e volta no Abrir do PC.

---

### Task 1: Matemática pura — `static/regerar-trecho.js`

**Files:** Create `static/regerar-trecho.js` · Test `tests/regerar-trecho.test.mjs`

Funções (exportadas em `RegerarTrecho`):
- `amostrasDaFaixa(clips, ini, fim, sr)` → Float32Array mono da faixa em [ini, fim), com `ganhoDb` de cada objeto.
- `pausasDoTrecho(clips, ini, fim, sr)` → `{antes, depois}` em s: silêncio que o produtor deixou em volta da fala marcada (mantém o ritmo). Sem fala → `{0, 0}`.
- `falaDoBuffer(buffer)` → `{ini, fim}` em s (bordas da fala com as folgas do Alinhar) ou `null`.
- `costurar(clips, ini, fim, novo, {pausas, crossfade=0.015})` com `novo = {buffer, falaIni, falaFim}` →
  `{clips, delta, clipNovo, ganhoDb}` ou `{erro: 'trecho-curto'|'fala-vazia'|'travado'|'travado-depois'}`.
  Passos: recusa cadeado no trecho; `delta = antes + durFala + depois − (fim − ini)`; recusa se há objeto
  travado depois do trecho e delta ≠ 0; `ClipModel.silenciarTrecho(clips, ini, fim, cf)`; tudo com
  `inicio ≥ fim` anda `delta`; clip novo em `ini + antes` (offset = falaIni, fades = cf); `ganhoDb` =
  `ClipModel.igualarDb(resultado, inicioNovo, fimNovo)` (limitado ±18 pelo próprio igualarDb).
- `frasesDoRoteiro(texto)` → frases (corta em `.`, `!`, `?`, `…` e quebra de linha; aceita "ofertas!Agora" sem espaço).
- `vozDoNome(nome, vozes)` → voz cujo id/nome começa com o 1º pedaço do nome do clip ("Callirrhoe_-_Gemini_…") ou `null`.

Testes (`node --test tests/regerar-trecho.test.mjs`), com buffers falsos `{duration, sampleRate, getChannelData}`:
1. fala nova MAIOR: o resto da mesma faixa anda +delta; o pedaço antes não mexe; o clip novo entra em `ini + antes`.
2. fala nova MENOR: delta negativo, nada se sobrepõe (`ClipModel.temSobreposicao` falso).
3. pausas preservadas: trecho com 0,3 s de silêncio antes e 0,2 s depois → clip novo entra em ini+~0,3−folga e o delta só conta a diferença de FALA.
4. cadeado no trecho → `{erro:'travado'}`; travado depois com delta ≠ 0 → `{erro:'travado-depois'}`; delta 0 com travado depois → ok.
5. ganho: fala nova 12 dB mais baixa que o resto → `ganhoDb ≈ +12`.
6. `frasesDoRoteiro('Atenção, caçador de ofertas!Agora os Achadinhos chegam.\nEntra agora, é grátis!')` → 3 frases.
7. `vozDoNome('Callirrhoe_-_Gemini_1793', [{id:'Callirrhoe'},{id:'Zephyr'}])` → Callirrhoe; nome sem voz → null.

- [ ] Escrever os testes → rodar (FAIL: módulo não existe) → implementar → rodar (PASS) → commit.

### Task 2: Backend `entrega: 'inline'` (sem Supabase)

**Files:** Modify `backend/app.py` (`run_audio_generation`) · Test `tests/test_regerar_trecho_inline.py`

- Ler `entrega_inline = str(data.get('entrega') or '') == 'inline'`.
- Logo após `audio_data` gerado: se inline → limite 3,5 MB (413 com mensagem "marque só a frase"),
  `complete_job`, `log_usage_event('audio_generated')`, devolve
  `{'success': True, 'audio_base64': ..., 'mime': 'audio/wav'|'audio/mpeg', 'message': ...}` SEM gravar em `locucoes/`.
- Teste: `sys.modules['tts_generator']` falso devolvendo bytes RIFF; `supabase_manager` falso cujo storage
  explode se tocado; `operation_tracker` falso. Assert: 200, base64 decodifica nos mesmos bytes, storage nunca chamado.
  Segundo teste: sem `entrega`, caminho antigo intocado (sobe pro storage falso).

- [ ] Teste → FAIL → implementar → PASS → commit.

### Task 3: Studio guarda voz/estilo da geração

**Files:** Modify `static/script.js` (generateAudio), `templates/index.html` (`script.js?v=11`), testes que fixam `script.js?v=`.

- `const providerEnviado = …` (a expressão que já existe) usado no payload e em
  `localStorage.setItem('minidaw_ultima_geracao', JSON.stringify({voice, style, language, provider, nome}))`,
  no mesmo `try` onde grava `minidaw_pending_roteiro`.
- Teste .py de leitura de fonte: a chave existe e é gravada junto do roteiro.

- [ ] Teste → FAIL → implementar → PASS → commit.

### Task 4: Tela — painel, botão na Tesoura, tecla G

**Files:** Modify `static/regerar-trecho.js` (parte navegador), `static/minidaw.js` (botão + tecla G, bump v86),
`templates/minidaw.html` (script `regerar-trecho.js?v=1` depois do minidaw.js; `minidaw.js?v=86`), 23 testes .py `v=85→86`.

- Botão "🔁 Regerar trecho" na barra da Tesoura só em faixa de voz, `onclick="RegerarTrecho.abrir('<id>')"`.
- Tecla **G** com Tesoura armada e trecho marcado (`_digitando` já protege os campos).
- `abrir(trackId)`: exige 1 trecho (extras → aviso), ≥ 0,05 s; painel fixo (padrão Vídeo do cliente) com
  frase, botõezinhos de `frasesDoRoteiro(minidaw_pending_roteiro)`, voz (lista `/api/voices`, pré-seleção:
  `minidaw_ultima_geracao` → `vozDoNome(track.name)`), estilo (8 do Studio), Gerar / Ouvir antes / Ouvir
  depois / Aplicar / Tentar de novo / Cancelar.
- Gerar: `POST /api/generate-audio` com `entrega:'inline'` → base64 → `decodeAudioData` → `falaDoBuffer`
  → `costurar` em memória (prévia). 429/erro → aviso honesto, sem laço.
- Ouvir antes/depois: toca a janela [ini−2, fim+2] dos clips (originais / costurados), seca, no `audioContext` da MiniDAW.
- Aplicar: `_snapshotClips` → `_guardarUndo` → `track.clips = r.clips` → `_sincronizarDerivados` →
  `cancelarSelecao` → `aposMudancaDeClips([track])` → aviso "o resto da voz andou ±X s · Ctrl+Z desfaz".

- [ ] Implementar → `node --check` → pytest das versões → commit.

### Task 5: Verificação no navegador (sem gastar cota)

**Files:** scratchpad `navegador/regerar-trecho.mjs` (não commitado)

- Servidor local + puppeteer; voz de teste (seno modulado com pausas); `page.setRequestInterception` responde
  `/api/generate-audio` com um WAV inline falso (fala de 1,5 s).
- Conferir: botão aparece só em voz; G abre; Gerar → Aplicar → clips da faixa: novo no lugar, resto andou
  exatamente `delta`; trilha intocada; Ctrl+Z volta idêntico; nenhuma requisição a `supabase.co`.
- Salvar no PC (diretório falso via `showDirectoryPicker` substituído) grava um WAV a mais pra fala nova.

- [ ] Rodar → corrigir o que falhar → suíte completa (`node --test tests/*.mjs`, `pytest tests -q`) → commit → push → deploy.
