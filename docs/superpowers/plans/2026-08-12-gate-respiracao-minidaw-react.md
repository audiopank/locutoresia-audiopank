# Gate de respiração no Audio Pank Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda track de Locução na MiniDAW React nasce com um Gate ativo que fecha a faixa nas pausas sem fala (removendo a respiração alta característica de voz gerada por IA), com sensibilidade ajustável — audível tanto no "Mix Rápido" quanto no Export final.

**Architecture:** Porta o algoritmo já calibrado e aprovado da MiniDAW clássica (`static/mix-engine.js`) para um módulo puro `gate.js` (RMS por janela + envelope de ganho), no mesmo padrão de `loudness.js`/`mastering.js`: matemática testável por `node --test`, sem depender de `AudioContext`/`AudioParam`. Aplicado direto no buffer decodificado, dentro de `mixer.ts`, **antes** da cadeia de efeitos existente (`buildEffectChain`) e **independente** do interruptor geral "Ativar" do painel de efeitos — é conserto, não estilo.

**Tech Stack:** JavaScript ESM puro (algoritmo), Web Audio API / `OfflineAudioContext` (integração no mixdown existente), React + TypeScript + Tailwind (UI), `node --test` (testes).

**Spec:** `docs/superpowers/specs/2026-08-12-gate-respiracao-minidaw-react-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `minidaw-react/src/lib/gate.js` (novo) | Só o algoritmo: detecção de trechos de fala + envelope de ganho. Puro, sem DOM/Web Audio. |
| `tests/gate.test.mjs` (novo) | Testes do algoritmo, rodando na raiz do repo. |
| `minidaw-react/src/lib/audioEffects.ts` (modificar) | `TrackEffects` ganha campo `gate`; `defaultEffects` passa a receber o tipo da track. |
| `minidaw-react/src/components/MiniDAWIntegrated.tsx` (modificar) | Os 3 pontos que criam track passam o tipo pra `defaultEffects`; snapshots antigos (sem `gate`) são normalizados ao carregar. |
| `minidaw-react/src/lib/mixer.ts` (modificar) | Aplica o gate no buffer decodificado antes da cadeia de efeitos, para tracks de voz com `gate.ativo`. |
| `minidaw-react/src/components/TrackEffectsPanel.tsx` (modificar) | UI do Gate: toggle + slider de sensibilidade (1-30), visível só em tracks de Locução, fora da área esmaecida pelo "Ativar" geral. |

**Por que independente do "Ativar" geral:** o painel de efeitos (`TrackEffectsPanel.tsx`) tem um interruptor mestre `enabled` que começa **desligado** por padrão e esmaece/desativa os outros 4 efeitos (EQ/Compressor/Reverb/Nivelar voz) até o usuário ligar. Se o Gate ficasse atrás desse mesmo interruptor, "ativo por padrão em tracks de Locução" — decisão do usuário na spec — não teria efeito nenhum até alguém ligar manualmente o painel inteiro. Por isso o Gate tem seu próprio flag (`gate.ativo`) e é checado separadamente em `mixer.ts`, nunca dentro de `hasActiveEffects`.

**Por que `.js` e não `.ts`:** mesmo motivo de `loudness.js`/`mastering.js` — `node --test` roda `.js` ESM direto, sem compilador, e o build (`vite build`) não roda `tsc`, então importar `.js` de um `.tsx`/`.ts` funciona normalmente.

---

### Task 1: Algoritmo do Gate (detecção + envelope)

**Files:**
- Create: `minidaw-react/src/lib/gate.js`
- Test: `tests/gate.test.mjs`

- [ ] **Step 1: Escrever os testes que falham**

```javascript
// tests/gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../minidaw-react/src/lib/gate.js';

function tomEm(amplitude, segundos, sr) {
    const n = Math.floor(segundos * sr);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / sr);
    return a;
}
function silencio(segundos, sr) {
    return new Float32Array(Math.floor(segundos * sr));
}
function concat(...arrs) {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
}

test('detectarTrechos: silencio total nao gera trecho de fala nenhum', () => {
    const canal = new Float32Array(8000); // 1s de zeros a 8kHz
    const trechos = G.detectarTrechos(canal, 8000, 12);
    assert.deepEqual(trechos, []);
});

test('detectarTrechos: fala cercada de silencio acha um unico trecho na posicao certa', () => {
    const sr = 8000;
    const canal = concat(silencio(0.5, sr), tomEm(0.5, 1.0, sr), silencio(0.5, sr));
    const trechos = G.detectarTrechos(canal, sr, 12);
    assert.equal(trechos.length, 1);
    const [ini, fim] = trechos[0];
    assert.ok(Math.abs(ini - 0.5) < 0.06, `inicio detectado ${ini}, esperado ~0.5`);
    assert.ok(Math.abs(fim - 1.5) < 0.06, `fim detectado ${fim}, esperado ~1.5`);
});

test('detectarTrechos: pausa curta (dentro do hold de 0.25s) funde dois trechos num so', () => {
    const sr = 8000;
    const canal = concat(tomEm(0.5, 0.5, sr), silencio(0.1, sr), tomEm(0.5, 0.5, sr));
    const trechos = G.detectarTrechos(canal, sr, 12);
    assert.equal(trechos.length, 1, 'pausa de 0.1s e menor que o hold, nao deveria abrir um segundo trecho');
});

test('detectarTrechos: pausa longa (alem do hold de 0.25s) mantem dois trechos separados', () => {
    const sr = 8000;
    const canal = concat(tomEm(0.5, 0.5, sr), silencio(0.5, sr), tomEm(0.5, 0.5, sr));
    const trechos = G.detectarTrechos(canal, sr, 12);
    assert.equal(trechos.length, 2, 'pausa de 0.5s e maior que o hold, tem que abrir dois trechos');
});

test('detectarTrechos: sensibilidade mais alta fecha o gate tambem em trechos baixinhos de respiracao', () => {
    const sr = 8000;
    // fala alta (amp 0.5) + respiracao baixinha (amp 0.0707, rms ~0.05) + fala alta de novo
    const canal = concat(tomEm(0.5, 0.5, sr), tomEm(0.0707, 0.5, sr), tomEm(0.5, 0.5, sr));
    const baixa = G.detectarTrechos(canal, sr, 10);
    const alta = G.detectarTrechos(canal, sr, 20);
    assert.equal(baixa.length, 1, 'sensibilidade baixa: respiracao ainda passa como fala, vira um trecho so');
    assert.equal(alta.length, 2, 'sensibilidade alta: respiracao cai abaixo do limiar, vira uma pausa real');
});

test('aplicarGate: sem trechos nao mexe no canal', () => {
    const canal = new Float32Array(100).fill(1);
    G.aplicarGate(canal, 1000, [], {});
    assert.ok(canal.every((v) => v === 1));
});

test('aplicarGate: fora do trecho de fala vai pro piso, nunca pra zero absoluto', () => {
    const sr = 1000;
    const canal = new Float32Array(2000).fill(1); // 2s de amplitude constante 1
    G.aplicarGate(canal, sr, [[0.5, 1.5]], { piso: 0.06, attack: 0, release: 0 });
    assert.ok(Math.abs(canal[0] - 0.06) < 1e-6, `borda inicial ${canal[0]}, esperado piso 0.06`);
    assert.ok(Math.abs(canal[1999] - 0.06) < 1e-6, `borda final ${canal[1999]}, esperado piso 0.06`);
    assert.ok(Math.abs(canal[1000] - 1) < 1e-6, `dentro do trecho de fala ${canal[1000]}, esperado ganho pleno`);
});

test('aplicarGate: trecho cobrindo o buffer inteiro nao atenua nada', () => {
    const sr = 1000;
    const canal = new Float32Array(2000).fill(1);
    G.aplicarGate(canal, sr, [[0, 2]]);
    assert.ok(canal.every((v) => Math.abs(v - 1) < 1e-6), 'buffer 100% falado nao deveria ter nenhuma amostra atenuada');
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test tests/gate.test.mjs`
Expected: falha com "Cannot find module '../minidaw-react/src/lib/gate.js'" (o arquivo ainda não existe).

- [ ] **Step 3: Implementar `gate.js`**

```javascript
// minidaw-react/src/lib/gate.js
// Gate de respiração: fecha a faixa nos trechos SEM fala e devolve o volume
// quando ela volta. Voz gerada por IA respira alto entre frases — um chiado
// de ar que some no fone mas aparece feio no rádio/PDV, ainda mais depois do
// limiter puxar tudo pra cima. Porta o algoritmo já calibrado e aprovado da
// MiniDAW clássica (static/mix-engine.js), reescrito como matemática pura
// sobre buffer — sem AudioParam/AudioContext — pra dar pra testar por
// `node --test`, no mesmo padrão de loudness.js.

const JANELA = 0.03;   // 30ms por bloco de análise RMS
const HOLD = 0.25;     // funde trechos de fala separados por pausas curtas

export const GATE_PADRAO = {
    sensibilidade: 12,  // 1-30, mesmo range/default da clássica
    piso: 0.06,          // -24dB nas pausas — nunca muda total (soaria "com buracos")
    attack: 0.02,        // abre 20ms ANTES da palavra
    release: 0.12,       // fecha suave, sem cortar a cauda da fala
};

// Acha os trechos [inicio, fim] (em segundos) com fala num canal mono.
// `sensibilidade` 1-30: quanto maior, mais alto o limiar em relação ao pico
// — logo mais generoso em classificar trechos baixinhos (respiração) como
// pausa, e não como fala.
export function detectarTrechos(dadosCanal, sr, sensibilidade) {
    const passo = Math.max(1, Math.floor(JANELA * sr));
    const sens = sensibilidade != null ? sensibilidade : GATE_PADRAO.sensibilidade;
    const pct = Math.min(0.30, Math.max(0.01, sens / 100));

    const rms = [];
    let pico = 0;
    for (let i = 0; i < dadosCanal.length; i += passo) {
        let soma = 0;
        const fim = Math.min(i + passo, dadosCanal.length);
        for (let j = i; j < fim; j++) soma += dadosCanal[j] * dadosCanal[j];
        const v = Math.sqrt(soma / Math.max(1, fim - i));
        rms.push(v);
        if (v > pico) pico = v;
    }
    // Piso absoluto: buffer só com ruído de fundo não vira um "gate" sem sentido.
    if (pico < 0.003) return [];

    const limiar = pico * pct;
    const segmentos = [];
    let inicio = null;
    for (let k = 0; k < rms.length; k++) {
        const temFala = rms[k] >= limiar;
        if (temFala && inicio === null) inicio = k * JANELA;
        if (!temFala && inicio !== null) {
            segmentos.push([inicio, k * JANELA]);
            inicio = null;
        }
    }
    if (inicio !== null) segmentos.push([inicio, rms.length * JANELA]);
    if (!segmentos.length) return [];

    const unidos = [segmentos[0].slice()];
    for (let i = 1; i < segmentos.length; i++) {
        const ult = unidos[unidos.length - 1];
        if (segmentos[i][0] - ult[1] <= HOLD) {
            ult[1] = Math.max(ult[1], segmentos[i][1]);
        } else {
            unidos.push(segmentos[i].slice());
        }
    }
    return unidos;
}

// Aplica o envelope de ganho direto no canal (in-place). `trechos` vem de
// detectarTrechos. Como HOLD (0.25s) é sempre maior que attack+release
// (0.14s por padrão), trechos não fundidos nunca se sobrepõem ao abrir a
// rampa de attack/release — cada abertura/fechamento fica isolado no tempo.
export function aplicarGate(canal, sr, trechos, opcoes) {
    if (!trechos || !trechos.length) return;
    const o = opcoes || {};
    const piso = o.piso != null ? o.piso : GATE_PADRAO.piso;
    const attack = o.attack != null ? o.attack : GATE_PADRAO.attack;
    const release = o.release != null ? o.release : GATE_PADRAO.release;
    const duracao = canal.length / sr;

    const pontos = [[0, piso]];
    for (const [ini, fim] of trechos) {
        const abre = Math.max(0, ini - attack);
        const fecha = Math.min(duracao, fim + release);
        pontos.push([abre, piso], [ini, 1], [fim, 1], [fecha, piso]);
    }
    pontos.push([duracao, piso]);

    let idx = 0;
    for (let i = 0; i < canal.length; i++) {
        const t = i / sr;
        while (idx < pontos.length - 2 && pontos[idx + 1][0] <= t) idx++;
        const [t0, g0] = pontos[idx];
        const [t1, g1] = pontos[idx + 1];
        const ganho = t1 > t0 ? g0 + (g1 - g0) * ((t - t0) / (t1 - t0)) : g1;
        canal[i] *= ganho;
    }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test tests/gate.test.mjs`
Expected: 8 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/lib/gate.js tests/gate.test.mjs
git commit -m "feat(master): algoritmo do Gate de respiracao (porta da classica)"
```

---

### Task 2: Campo `gate` em `TrackEffects`

**Files:**
- Modify: `minidaw-react/src/lib/audioEffects.ts:1-23`

- [ ] **Step 1: Adicionar o campo e parametrizar `defaultEffects` pelo tipo da track**

Em `minidaw-react/src/lib/audioEffects.ts`, substituir as linhas 1 a 23 (comentário do topo até o fim de `defaultEffects`) por:

```typescript
/**
 * Cadeia de efeitos por faixa (mastering): Equalizador + Compressor + Reverb + Nivelar voz.
 * Baseado no AudioEffectsService do Studio original, adaptado para:
 *  - ser aplicado por faixa,
 *  - incluir Reverb (ConvolverNode com IR sintética),
 *  - poder ser "bakeado" no mix offline (OfflineAudioContext).
 */

export interface TrackEffects {
  enabled: boolean;
  eq: { low: number; mid: number; high: number }; // dB, -12..+12
  compressor: boolean;     // dá consistência/peso à voz
  reverb: number;          // 0..1 (quantidade de wet)
  normalize: boolean;      // "nivelar voz" — limiter + makeup
  // Gate de respiração — independente do `enabled` geral acima (ver mixer.ts).
  // Ativo por padrão em tracks de Locução, nunca em Música.
  gate: { ativo: boolean; sensibilidade: number }; // sensibilidade 1-30
}

export const defaultEffects = (trackType: "voiceover" | "music" = "music"): TrackEffects => ({
  enabled: false,
  eq: { low: 0, mid: 0, high: 0 },
  compressor: false,
  reverb: 0,
  normalize: false,
  gate: { ativo: trackType === "voiceover", sensibilidade: 12 },
});
```

O resto do arquivo (`hasActiveEffects`, `generateReverbIR`, `buildEffectChain`) não muda — o Gate de propósito não entra em `hasActiveEffects` nem em `buildEffectChain`: ele é aplicado direto no buffer, num passo separado em `mixer.ts` (Task 4), antes da cadeia de nós.

- [ ] **Step 2: Checar que o TypeScript não tem mais nenhuma referência quebrada**

O projeto já roda com `strict: false` e tem uma pilha de erros de TS pré-existentes em arquivos não relacionados (ex.: `NewsAutoPost.tsx`, `VoiceLibrary.tsx`) — não é escopo desta task arrumar isso, e o build (`vite build`) não roda `tsc`. Filtre só os arquivos tocados por este plano:

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "audioEffects|MiniDAWIntegrated|TrackEffectsPanel|mixer\.ts"`
Expected: erro em `MiniDAWIntegrated.tsx` reclamando que `defaultEffects()` espera um argumento nos 3 pontos que ainda não foram atualizados (Task 3), e nada em `audioEffects.ts`. Nenhum erro novo em `TrackEffectsPanel.tsx`/`mixer.ts` ainda (eles só passam a referenciar `gate` nas Tasks 4 e 5).

- [ ] **Step 3: Commit**

```bash
git add minidaw-react/src/lib/audioEffects.ts
git commit -m "feat(master): TrackEffects ganha campo gate, defaultEffects recebe o tipo da track"
```

---

### Task 3: Ligar o Gate por padrão nas tracks de Locução

**Files:**
- Modify: `minidaw-react/src/components/MiniDAWIntegrated.tsx:76-91` (`addTrack`)
- Modify: `minidaw-react/src/components/MiniDAWIntegrated.tsx:122-141` (`handleAudioGenerated`)
- Modify: `minidaw-react/src/components/MiniDAWIntegrated.tsx:145-164` (`handleMusicTrackFromLibrary`)
- Modify: `minidaw-react/src/components/MiniDAWIntegrated.tsx:63-69` (`loadSnapshot`)

- [ ] **Step 1: Passar o tipo da track para `defaultEffects` nos 3 pontos de criação**

Em `addTrack` (linha 87), trocar:
```typescript
      effects: defaultEffects(),
```
por:
```typescript
      effects: defaultEffects(type),
```

Em `handleAudioGenerated` (linha 131, sempre `type: "voiceover"`), trocar:
```typescript
      effects: defaultEffects(),
```
por:
```typescript
      effects: defaultEffects("voiceover"),
```

Em `handleMusicTrackFromLibrary` (linha 154, sempre `type: "music"`), trocar:
```typescript
      effects: defaultEffects(),
```
por:
```typescript
      effects: defaultEffects("music"),
```

- [ ] **Step 2: Normalizar projetos salvos ANTES desta feature (sem o campo `gate`)**

Projetos salvos na Vitrine de Projetos VIP antes desta mudança têm `effects` sem o campo `gate` — carregar um deles direto quebraria qualquer leitura de `effects.gate.ativo`. Em `loadSnapshot` (linha 63-69), trocar:

```typescript
  const loadSnapshot = useCallback((snap: { projectId: string; roteiro: string; tracks: Track[] }) => {
    audioRefs.current = {};
    if (snap.projectId) setProjectId(snap.projectId);
    setRoteiro(snap.roteiro || "");
    setTracks(snap.tracks || []);
    setActiveTab("multitrack");
  }, []);
```

por:

```typescript
  // Projetos salvos antes do Gate existir não têm `effects.gate` — preenche
  // com o default do tipo da track (ativo=true só em locução) sem perder o
  // resto dos efeitos que o usuário já tinha configurado.
  const normalizeTrackEffects = (t: Track): Track => ({
    ...t,
    effects: {
      ...defaultEffects(t.type),
      ...t.effects,
      gate: { ...defaultEffects(t.type).gate, ...(t.effects?.gate || {}) },
    },
  });

  const loadSnapshot = useCallback((snap: { projectId: string; roteiro: string; tracks: Track[] }) => {
    audioRefs.current = {};
    if (snap.projectId) setProjectId(snap.projectId);
    setRoteiro(snap.roteiro || "");
    setTracks((snap.tracks || []).map(normalizeTrackEffects));
    setActiveTab("multitrack");
  }, []);
```

- [ ] **Step 3: Checar TypeScript**

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "audioEffects|MiniDAWIntegrated|TrackEffectsPanel|mixer\.ts"`
Expected: nenhum erro em `MiniDAWIntegrated.tsx`/`audioEffects.ts` (os 3 pontos de criação já passam o tipo certo). `TrackEffectsPanel.tsx` ainda não é tocado por esta task — se aparecer erro nele é da falta da prop `trackType`, corrigida na Task 5.

- [ ] **Step 4: Commit**

```bash
git add minidaw-react/src/components/MiniDAWIntegrated.tsx
git commit -m "feat(master): gate ativo por padrao em tracks de locucao, normaliza projetos salvos antigos"
```

---

### Task 4: Aplicar o Gate no mixdown (Export + Mix Rápido)

**Files:**
- Modify: `minidaw-react/src/lib/mixer.ts:1-2` (imports)
- Modify: `minidaw-react/src/lib/mixer.ts:146-168` (loop de `mixTracks`)

- [ ] **Step 1: Importar o gate**

No topo de `minidaw-react/src/lib/mixer.ts`, trocar:
```typescript
import { Mp3Encoder } from "@breezystack/lamejs";
import { buildEffectChain, hasActiveEffects, type TrackEffects } from "./audioEffects";
```
por:
```typescript
import { Mp3Encoder } from "@breezystack/lamejs";
import { buildEffectChain, hasActiveEffects, type TrackEffects } from "./audioEffects";
import { detectarTrechos, aplicarGate } from "./gate.js";
```

- [ ] **Step 2: Aplicar o gate no buffer antes da cadeia de efeitos**

Dentro de `mixTracks`, o loop `for (const d of decoded) { ... }` (linhas 146-168) começa assim:

```typescript
  for (const d of decoded) {
    const src = offline.createBufferSource();
    src.buffer = d.buffer;
```

Trocar por:

```typescript
  for (const d of decoded) {
    // Gate de respiração: roda ANTES da cadeia de efeitos (EQ/Compressor/etc),
    // direto no buffer decodificado — é conserto na voz crua, não estilo.
    // Independente de `hasActiveEffects`/`effects.enabled`: por isso é
    // checado aqui, fora do bloco que decide se builda a cadeia de nós.
    if (d.type === "voiceover" && d.effects?.gate?.ativo) {
      const trechos = detectarTrechos(d.buffer.getChannelData(0), d.buffer.sampleRate, d.effects.gate.sensibilidade);
      for (let ch = 0; ch < d.buffer.numberOfChannels; ch++) {
        aplicarGate(d.buffer.getChannelData(ch), d.buffer.sampleRate, trechos);
      }
    }

    const src = offline.createBufferSource();
    src.buffer = d.buffer;
```

O resto do loop (gain, ducking da trilha, `hasActiveEffects`/`buildEffectChain`, `src.start(0)`) fica exatamente como está — o gate só pré-processa o buffer que já ia ser usado.

- [ ] **Step 3: Checar TypeScript**

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "audioEffects|MiniDAWIntegrated|TrackEffectsPanel|mixer\.ts"`
Expected: nenhum erro em `mixer.ts`. `TrackEffectsPanel.tsx` só é corrigido na Task 5.

- [ ] **Step 4: Commit**

```bash
git add minidaw-react/src/lib/mixer.ts
git commit -m "feat(master): gate de respiracao entra no mixdown antes da cadeia de efeitos"
```

---

### Task 5: UI do Gate no painel de efeitos

**Files:**
- Modify: `minidaw-react/src/components/TrackEffectsPanel.tsx` (arquivo inteiro)
- Modify: `minidaw-react/src/components/MiniDAWIntegrated.tsx:571-574`

- [ ] **Step 1: Reescrever `TrackEffectsPanel.tsx`**

Substituir o arquivo inteiro por:

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sliders, Waves, Gauge, Activity, Wind, ChevronDown, ChevronUp } from "lucide-react";
import type { TrackEffects } from "@/lib/audioEffects";

interface TrackEffectsPanelProps {
  effects: TrackEffects;
  onChange: (fx: TrackEffects) => void;
  trackType: "voiceover" | "music";
}

const EqBand = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-white/60 w-12">{label}</span>
    <Slider value={[value]} min={-12} max={12} step={1} onValueChange={([v]) => onChange(v)} className="flex-1" />
    <span className="text-xs text-white/70 w-12 text-right">{value > 0 ? `+${value}` : value} dB</span>
  </div>
);

export const TrackEffectsPanel = ({ effects, onChange, trackType }: TrackEffectsPanelProps) => {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TrackEffects>) => onChange({ ...effects, ...patch });
  const setEq = (patch: Partial<TrackEffects["eq"]>) => onChange({ ...effects, eq: { ...effects.eq, ...patch } });
  const setGate = (patch: Partial<TrackEffects["gate"]>) => onChange({ ...effects, gate: { ...effects.gate, ...patch } });

  const activeCount =
    (effects.compressor ? 1 : 0) + (effects.normalize ? 1 : 0) + (effects.reverb > 0 ? 1 : 0) +
    (effects.eq.low || effects.eq.mid || effects.eq.high ? 1 : 0);

  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="flex items-center justify-between p-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm text-white/80 hover:text-white">
          <Sliders className="w-4 h-4 text-purple-400" />
          Efeitos
          {effects.enabled && activeCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200">{activeCount} ativo(s)</span>
          )}
          {trackType === "voiceover" && effects.gate.ativo && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/30 text-teal-200">Gate</span>
          )}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">Ativar</span>
          <Switch checked={effects.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </div>
      </div>

      {open && (
        <div className="p-4 pt-0 space-y-4">
          {trackType === "voiceover" && (
            <div className="p-2 rounded-md bg-white/5 space-y-2">
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-white/80"><Wind className="w-4 h-4 text-teal-400" /> Gate (respiração)</span>
                <Switch checked={effects.gate.ativo} onCheckedChange={(v) => setGate({ ativo: v })} />
              </label>
              {effects.gate.ativo && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/60 w-20">Sensibilidade</span>
                  <Slider value={[effects.gate.sensibilidade]} min={1} max={30} step={1} onValueChange={([v]) => setGate({ sensibilidade: v })} className="flex-1" />
                  <span className="text-xs text-white/70 w-8 text-right">{effects.gate.sensibilidade}</span>
                </div>
              )}
              <p className="text-xs text-white/40">Corta a respiração entre as falas. Independe do "Ativar" ao lado — funciona sempre que ligado.</p>
            </div>
          )}

          <div className={`space-y-4 ${effects.enabled ? "" : "opacity-50 pointer-events-none"}`}>
            {/* Toggles rápidos */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-2 p-2 rounded-md bg-white/5">
                <span className="flex items-center gap-2 text-sm text-white/80"><Gauge className="w-4 h-4 text-blue-400" /> Compressor</span>
                <Switch checked={effects.compressor} onCheckedChange={(v) => set({ compressor: v })} />
              </label>
              <label className="flex items-center justify-between gap-2 p-2 rounded-md bg-white/5">
                <span className="flex items-center gap-2 text-sm text-white/80"><Activity className="w-4 h-4 text-green-400" /> Nivelar voz</span>
                <Switch checked={effects.normalize} onCheckedChange={(v) => set({ normalize: v })} />
              </label>
            </div>

            {/* Reverb */}
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-white/80 w-28"><Waves className="w-4 h-4 text-cyan-400" /> Reverb</span>
              <Slider value={[Math.round(effects.reverb * 100)]} min={0} max={100} step={1} onValueChange={([v]) => set({ reverb: v / 100 })} className="flex-1" />
              <span className="text-xs text-white/70 w-10 text-right">{Math.round(effects.reverb * 100)}%</span>
            </div>

            {/* Equalizador */}
            <div className="space-y-2">
              <span className="text-sm text-white/80">Equalizador</span>
              <EqBand label="Graves" value={effects.eq.low} onChange={(v) => setEq({ low: v })} />
              <EqBand label="Médios" value={effects.eq.mid} onChange={(v) => setEq({ mid: v })} />
              <EqBand label="Agudos" value={effects.eq.high} onChange={(v) => setEq({ high: v })} />
            </div>
          </div>

          <p className="text-xs text-white/40">Os efeitos são aplicados no mix final (Exportar/Mix Rápido).</p>
        </div>
      )}
    </div>
  );
};

export default TrackEffectsPanel;
```

- [ ] **Step 2: Passar o tipo da track pro painel**

Em `minidaw-react/src/components/MiniDAWIntegrated.tsx`, linhas 571-574, trocar:

```typescript
                        <TrackEffectsPanel
                          effects={track.effects}
                          onChange={(fx) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, effects: fx } : t))}
```

por:

```typescript
                        <TrackEffectsPanel
                          effects={track.effects}
                          trackType={track.type}
                          onChange={(fx) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, effects: fx } : t))}
```

(a linha seguinte, com o fechamento `/>`, continua igual — só está sendo inserida uma prop nova entre as duas existentes).

- [ ] **Step 3: Checar TypeScript limpo**

Run: `cd minidaw-react && npx tsc --noEmit -p . 2>&1 | grep -E "audioEffects|MiniDAWIntegrated|TrackEffectsPanel|mixer\.ts"`
Expected: nenhum erro em nenhum dos 4 arquivos — este era o último ponto pendente (prop `trackType`).

- [ ] **Step 4: Commit**

```bash
git add minidaw-react/src/components/TrackEffectsPanel.tsx minidaw-react/src/components/MiniDAWIntegrated.tsx
git commit -m "feat(master): UI do Gate de respiracao no painel de efeitos"
```

---

### Task 6: Build e publicação

**Files:**
- Modify: `templates/minidaw-react.html`
- Modify: `static/minidaw-react/index.html`

⚠️ **A armadilha desta etapa:** o build da React é manual e os hashes vivem em DOIS arquivos. Atualizar só um entrega página velha em produção.

- [ ] **Step 1: Rodar a suíte completa antes de publicar**

Run: `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs tests/loudness.test.mjs tests/gate.test.mjs`
Expected: 0 falhas.

- [ ] **Step 2: Build**

```bash
cd minidaw-react && npm run build
```

- [ ] **Step 3: Copiar para static**

```bash
cp -r minidaw-react/dist/assets/* static/minidaw-react/assets/
```

Os arquivos antigos ficam para trás (o nome tem hash). Não apague no mesmo commit: uma aba já aberta ainda pode estar pedindo o arquivo velho.

- [ ] **Step 4: Descobrir os nomes novos**

Run: `ls static/minidaw-react/assets/`
Anote o `index-XXXX.js` e o `index-XXXX.css` recém-criados.

- [ ] **Step 5: Atualizar os DOIS arquivos de hash**

Em `templates/minidaw-react.html` e em `static/minidaw-react/index.html`, substitua os nomes antigos de `index-*.js` e `index-*.css` pelos novos.

- [ ] **Step 6: Conferir que os dois batem**

Run: `grep -o "index-[A-Za-z0-9_-]*\.\(js\|css\)" templates/minidaw-react.html static/minidaw-react/index.html | sort -u`
Expected: exatamente dois nomes distintos (um .js e um .css), e ambos existem em `static/minidaw-react/assets/`.

- [ ] **Step 7: Commit e publicar**

```bash
git add static/minidaw-react templates/minidaw-react.html
git commit -m "build(master): publica o Gate de respiracao no Audio Pank Studio"
git push origin testes-local:main
```

- [ ] **Step 8: Confirmar que subiu**

Run: `git show origin/main:templates/minidaw-react.html | grep -o "index-[A-Za-z0-9_-]*\.js"`
Expected: o hash novo.

---

### Task 7: Verificação de ouvido (gate do produtor)

Sem código. É o critério de sucesso da spec: gerar (ou usar) uma locução de IA com respiração audível entre frases, adicionar como track de Locução (Gate já nasce ligado), rodar "Mix Rápido" com e sem o Gate (toggle no painel) e comparar de ouvido — a respiração deve sumir por baixo sem soar "com buracos" nem cortar o começo/fim das palavras. Testar também com sensibilidade baixa (~5) e alta (~25) pra sentir a diferença. Só reportar como concluído depois desse teste real, não só pelos testes automatizados passarem.
