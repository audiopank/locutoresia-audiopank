# Gate de respiração no Audio Pank Studio (MiniDAW React) — design

**Data:** 2026-08-12
**Status:** aprovado pelo usuário (brainstorming completo)

## Problema

Vozes geradas por IA respiram alto entre as frases — um chiado de ar que some
no fone mas aparece feio no rádio/PDV. A MiniDAW **clássica** já resolve isso
com um Gate real (`static/mix-engine.js`, `detectarTrechosDeClips` +
`aplicarGate`), mas a **React** (Audio Pank Studio) não tem nada equivalente.

## Fatiamento acordado

O usuário trouxe 3 pedidos novos na mesma conversa (VU meters, revisão da
masterização, efeitos de track na React). São 3 subsistemas independentes;
esta spec cobre só o Gate, escolhido como primeiro por ser o mais concreto e
por já existir uma implementação comprovada pra portar (não é design do zero).

## Estado atual investigado (antes do design)

- MiniDAW React já tem 4 efeitos por track (`minidaw-react/src/lib/audioEffects.ts`):
  EQ 3 bandas, Compressor, Reverb, "Nivelar voz". Nenhum é Gate.
- Esses efeitos só tocam no **mixdown offline** (`mixer.ts` → `mixTracks`,
  chamado por Export e por "Mix Rápido"), nunca no playback cru do timeline —
  não existe playback ao vivo via grafo Web Audio na React hoje (só em
  `MasterizarPanel.tsx`, pra tocar versões já renderizadas). Isso não muda
  nesta spec: o Gate segue a mesma regra dos outros 4 efeitos.
- A React já distingue `track.type: "voiceover" | "music"` — dá pra ligar o
  Gate por padrão só nas tracks de Locução, sem heurística nova.
- O algoritmo da clássica é buffer-based (RMS em janelas de 30ms + hold +
  attack/release), não depende de nó de áudio ao vivo — porta limpo pro
  padrão já usado por `loudness.js`/`mastering.js`/`correcaoTom.js` nesta
  mesma pasta: matemática pura, sem DOM/Web Audio, testável via `node --test`.

## Decisões do usuário

| Pergunta | Resposta |
|---|---|
| Ordem dos 3 pedidos de hoje | Gate primeiro |
| Ativo por padrão? | **Sim**, em tracks de Locução (nunca em Música) |
| Sensibilidade | **Ajustável**, slider 1-30 igual à clássica |

## Arquitetura

**Novo módulo puro `minidaw-react/src/lib/gate.js`** — porta o algoritmo já
calibrado da clássica:
- `detectarTrechos(dadosCanal, sr, sensibilidade)`: RMS em janelas de 30ms;
  limiar = pico do canal × `sensibilidade%` (1-30, clampado); funde trechos
  de fala próximos com hold de 0.25s.
- `aplicarGate(canal, sr, trechos)`: escreve o envelope de ganho direto no
  buffer — attack 20ms (abre antes da palavra), release 120ms (fecha suave),
  piso -24dB (nunca muda total — silêncio absoluto soa "com buracos").

Sem dependência de `AudioContext`/`AudioParam`: opera em `Float32Array`,
igual `loudness.js`. Isso permite testar a matemática isolada via
`node --test`, sem precisar de `OfflineAudioContext` pra validar.

**Integração:**
- `TrackEffects` (`audioEffects.ts`) ganha o campo:
  ```js
  gate: { ativo: boolean, sensibilidade: number } // sensibilidade 1-30
  ```
- `MiniDAWIntegrated.tsx`, em `addTrack("voiceover", ...)`: o estado inicial
  de efeitos da track já nasce com `gate.ativo = true` e a sensibilidade
  calibrada padrão da clássica. Tracks `"music"` nunca ganham esse campo
  ativo (o controle nem aparece na UI pra elas).
- `mixer.ts` (`mixTracks`): antes de alimentar o buffer decodificado no
  `buildEffectChain` (que monta EQ/Compressor/Reverb/Nivelar voz como nós),
  se a track é `voiceover` e `effects.gate.ativo`, roda `aplicarGate` direto
  no(s) canal(is) do buffer decodificado. Isso mantém a mesma ordem de
  chamada — Gate processa a voz crua antes do resto da cadeia colorir o
  sinal — e garante que Export e "Mix Rápido" ouçam o mesmo resultado, sem
  caminho de código separado.

**UI:** `TrackEffectsPanel.tsx` ganha um bloco "Gate (respiração)": toggle +
slider de sensibilidade (1-30), visível **só** em tracks com
`type === "voiceover"`.

## Testes

- `tests/gate.test.mjs` (mesmo padrão de `tests/loudness.test.mjs`):
  - Trecho de fala cercado de silêncio: as bordas silenciosas ficam no piso
    de -24dB, não em -∞ (nunca zero absoluto).
  - Dois trechos de fala próximos (dentro do hold de 0.25s) se fundem num só,
    sem fechar o gate no meio de uma pausa curta entre palavras.
  - Áudio 100% falado, sem pausa nenhuma: o gate não altera nada (não há
    trecho de silêncio pra fechar).
  - Sensibilidade mais alta detecta mais silêncio (limiar mais generoso) que
    sensibilidade mais baixa, no mesmo áudio.
- Depois dos testes automatizados passando: teste de ouvido real numa
  locução de IA com respiração audível, comparando Mix Rápido/Export com
  Gate ligado vs. desligado — mesmo processo de calibração usado na
  masterização (Mauro Filho).

## Fora de escopo agora

- Preview ao vivo durante o timeline cru — nenhum dos 4 efeitos existentes
  tem isso hoje, não é regressão introduzida por esta spec.
- Detecção por IA/VAD — fica no heurístico de RMS+limiar já comprovado na
  clássica, mais barato e sem dependência nova.
- VU meters e revisão da masterização (presets de destino com tom próprio) —
  pedidos separados da mesma conversa, cada um com spec própria depois desta.
