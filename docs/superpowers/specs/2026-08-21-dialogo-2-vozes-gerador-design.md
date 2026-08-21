# Modo Diálogo (2 vozes) no Gerador de Anúncios — design

**Data:** 2026-08-21
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

Spot em diálogo ("marido e mulher no supermercado", "cliente e atendente na
farmácia") é formato clássico e premium de rádio — e o Locutores IA hoje só
gera locução de UMA voz. A sugestão veio de uma lista da Lovable (analisada
item a item em 21/08/2026: dos 6 itens, este foi o único aprovado — 2 já
existiam, 1 já tinha sido rejeitado, 2 eram armadilha).

**Atalho técnico que define o design:** o TTS do Gemini
(`gemini-2.5-flash-preview-tts`, o modelo que o app JÁ usa) tem modo
**multi-speaker nativo** — numa única chamada, recebe o roteiro marcado com
personagens e 2 vozes, e devolve a conversa inteira com trocas naturais.
Verificado no SDK local (google-genai 2.8.0, o mesmo pinado em produção):
`types.MultiSpeakerVoiceConfig`/`SpeakerVoiceConfig` existem e a config de 2
falantes monta sem erro. Custo: **1 chamada de cota**, mesma latência de uma
locução comum.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Onde vive | **Só no Gerador** (`/gerador`) — não mexe no Studio |
| Personagens | **Nomes livres com detecção automática** ("Ana:", "Seu Zé:") — vale igual pro texto pronto do cliente |
| Modo Expressivo (ElevenLabs) | **Fora da v1** — diálogo só no Modo Padrão (Google); Expressivo mostra aviso claro e não gera |
| Abordagem | **A: multi-speaker nativo em 1 chamada** (rejeitada a B: N chamadas + costura — N× cota, N× latência com o timeout da Vercel, pausas artificiais) |

## Interface (`templates/gerador.html` + `static/gerador.js`)

- Novo select **"Formato"** no painel de controles, acima do Modo:
  **"Locutor único"** (padrão — tudo exatamente como hoje) /
  **"Diálogo (2 vozes)"**.
- Com Diálogo escolhido, aparece um segundo select **"Voz 2"** logo abaixo do
  select de Voz existente — populado da MESMA fonte do select de Voz
  (`estado.vozes` filtrado por `provider === 'gemini'`, o catálogo que
  `/api/voices` já entrega), sem lista nova nem endpoint novo. Escondido no
  formato Locutor único.
- Dica de UI: "1ª voz = primeiro personagem que fala no roteiro; 2ª voz = o
  segundo. As falas vêm marcadas como `Nome: fala`."
- **Diálogo + Modo Expressivo**: aviso claro via `avisar(...)` no clique de
  Gerar — "Diálogo por enquanto é só no Modo Padrão (Google)" — e a geração
  não começa (não gasta roteiro nem TTS).

## Roteiro IA (`/api/gerador/roteiro`, `backend/app.py`)

- O payload ganha `formato: 'dialogo' | 'unico'` (default `unico`).
- Com `formato='dialogo'`, o prompt ganha a variante: escrever a conversa com
  **exatamente 2 personagens** (nomes coerentes com o briefing), cada fala
  numa linha no formato `Nome: fala`, sem rubricas além disso. A grade de
  duração do plano vendido continua valendo (mesma mecânica de palavras).
- Com `formato='dialogo'` (e SÓ nesse caso, pra não mexer na estimativa dos
  spots de voz única — "Atenção: chegou..." não é personagem), a estimativa
  de duração **desconta os rótulos** `Nome:` do início das linhas: rótulo não
  é falado e hoje inflaria a contagem de palavras.
- Com o checkbox **"Texto pronto do cliente"** marcado, nada muda: o texto
  dele é usado como está — se já vem com `Nome:`, o diálogo funciona direto.

## Detecção de personagens (uma fonte da verdade, no backend)

Função pura em `backend/app.py` (testável isolada): varre o texto linha a
linha por `^\s*(Nome de até ~30 chars sem dois-pontos):\s+fala` e devolve os
personagens **na ordem de primeira aparição**.

- **< 2 personagens** com `formato='dialogo'` → erro amigável ANTES de gastar
  TTS: "Marque as falas como `Nome: fala` — preciso de 2 personagens."
- **> 2 personagens** → erro claro: "O diálogo suporta 2 vozes; achei N
  personagens (X, Y, Z...). Junte ou corte pra 2."
- Mapeamento: 1º personagem detectado → Voz, 2º → Voz 2.

## TTS (`/api/generate-audio` + `core/tts_generator.py`)

- Payload do `/api/generate-audio` ganha `dialogo: true` + `voice2` (o
  `run_audio_generation` repassa). Sem esses campos, caminho atual intocado.
- Em `core/tts_generator.py`, caminho irmão do atual:
  `_synthesize_google_dialogo(text, voz1, voz2, speakers, temperature)` monta
  `types.SpeechConfig(multi_speaker_voice_config=...)` com os 2 nomes
  detectados apontando pras 2 vozes (via `GOOGLE_VOICE_MAP`, como hoje), no
  MESMO modelo `gemini-2.5-flash-preview-tts` e mesma conversão pra WAV
  (`_convert_to_wav`). O texto vai com os rótulos `Nome:` — é assim que o
  modelo roteia as vozes.
- Estilo de fala: **um só pro diálogo inteiro**, aplicado como hoje
  (`aplicar_instrucao_de_tom` + temperature). Estilo por personagem: fora da v1.
- `dialogo=true` com `api != 'google'` → erro explícito (o frontend já
  bloqueia antes; o backend não deixa passar por outra porta).

## Do buffer pra frente: ZERO mudança

A voz do diálogo vira um AudioBuffer como qualquer locução. Trilha (inclusive
a do cliente), receita de mix, checagem de duração contra o plano, Spots
guardados, "Abrir na MiniDAW" (voz vai como MP3 único) e Enviar funcionam sem
saber que há duas vozes.

## Erros e casos de borda

- IA de roteiro fora do ar com `formato='dialogo'` → fallback atual (briefing
  cru + aviso); se o briefing não tiver `Nome:`, a detecção barra com o erro
  amigável — nada é gasto em TTS.
- "Regerar só a voz" continua funcionando: regera o diálogo com as mesmas 2
  vozes selecionadas na tela.
- Personagem com nome contendo acento/espaço ("Seu Zé:") é válido — a regex
  cobre; dois-pontos DENTRO da fala (ex. horário "10:30") não vira
  personagem porque o padrão exige o rótulo no INÍCIO da linha.
- Formato Diálogo + voz clonada LMNT selecionada → mesmo aviso do Expressivo
  (fora da v1).

## Fora de escopo desta v1 (decidido no brainstorming)

- 3+ vozes (limite do multi-speaker do Gemini é 2 — e 2 cobre o formato real).
- Diálogo no Modo Expressivo/ElevenLabs (caminho futuro: N chamadas +
  costura, só se houver demanda).
- Estilo de fala por personagem.
- Qualquer mudança no Studio (`/`).
- Preço/item novo na Vitrine pra "spot em diálogo" — decisão comercial do
  produtor, fora do código por enquanto.
