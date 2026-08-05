# Timeline de Clips na MiniDAW Clássica — Plano de Implementação (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faixas da MiniDAW clássica passam a carregar vários clips posicionados livremente no tempo (arrastar, mover entre faixas, dividir, trim), com playback/export/persistência respeitando as posições.

**Architecture:** Novo módulo puro `static/clip-model.js` (matemática de clips, testável em node) + extensão do `static/mix-engine.js` (detecção de voz por posição, render por clips) + evolução do `static/minidaw.js` (migração preguiçosa `_clipsDaFaixa`, agendamento por clip, UI de timeline). Três entregas independentes: **A** motor por baixo (som idêntico ao atual), **B** timeline visual com os 4 gestos, **C** persistência. O usuário testa em produção ao fim de cada entrega.

**Tech Stack:** Vanilla JS (browser), Web Audio API, `node --test` (node 22) para os módulos puros, Flask/Supabase já existentes.

**Spec:** `docs/superpowers/specs/2026-08-05-timeline-clips-minidaw-design.md`

---

## Fatos do código atual que o plano assume (verificados 05/08/2026)

- `static/minidaw.js` (3405 linhas, `MINIDAW_VERSAO = 25`): faixa = `{id, name, type, audioUrl, audioBuffer, duration, volume, pan, fadeIn, fadeOut, muted, solo, effects, gateSettings, color}` (linhas 137-176). Playback: 1 `BufferSource` por faixa (`playTrack`, 1134), agenda central `agendarVolumeDaFaixa` (1078) com `base = ctxTime - currentTime`, `stop()` (1187) cancela agendas. Duração: `calculateDuration` (1019) = maior voz + 1.05s. Tesoura: `iniciarSelecao`/`aplicarCorte` (2439/2513, modos remover/manter/dividir) — hoje DESTRUTIVA (copia buffers). Waveform: 1 canvas por faixa, envelope min/max (735). Projeto: `salvarProjetoSupabase` (2867) sobe 1 WAV por faixa (`audio_path`/`audio_url_direct`), `carregarProjetoSupabase` (2979) restaura.
- `static/mix-engine.js` (574 linhas, IIFE `(function(global){...})(window)`, exporta `global.MixEngine`): `detectarTrechosDeVoz(voiceTracks, hold, limiarPct)` (45) analisa `track.audioBuffer` DO ZERO — não sabe de posições. `renderizarMix(o)` (233) cria 1 source por faixa com `source.start(0)`, fades por faixa (383-427), ducking com `offset=0`.
- Backend `GET /api/projects/<id>` (`backend/app.py:8983`) assina `tr['audio_path']` de cada faixa (1 áudio por faixa).
- Regras da casa: automação de ganho SEMPRE cancel-first pela agenda central; `mix-engine.js` e playback mudam JUNTOS; `MINIDAW_VERSAO` e `?v=` do template sobem juntos; usuário testa em produção.

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| Create: `static/clip-model.js` | Matemática pura de clips (sem DOM, sem Web Audio) — UMD: `window.ClipModel` no browser, `module.exports` no node |
| Create: `tests/clip-model.test.mjs` | Testes node do clip-model |
| Create: `tests/mix-engine-clips.test.mjs` | Testes node da detecção de voz por posição |
| Modify: `static/mix-engine.js` | `detectarTrechosDeClips` + `renderizarMix` por clips |
| Modify: `static/minidaw.js` | Modelo, playback, gestos, UI |
| Modify: `templates/minidaw.html` | `<script clip-model.js>`, CSS da timeline, `?v=` |
| Modify: `backend/app.py:9000-9014` | Assinar também `tr['buffers'][i]['audio_path']` |

**Modelo do clip** (dicionário usado em TODOS os arquivos — nomes exatos):

```js
// clip = {
//   id: 'clip_...',       // string única
//   buffer: AudioBuffer,  // arquivo de origem (clips de um corte compartilham)
//   inicio: 12.5,         // posição na timeline do PROJETO (s)
//   offset: 3.0,          // a partir de que ponto do ARQUIVO toca (s) — trim não-destrutivo
//   duracao: 8.2,         // quanto toca (s)
//   fadeIn: 0, fadeOut: 0 // fades POR CLIP (s)
// }
// track.clips = [...ordenados por inicio, sem sobreposição...]
// track.audioBuffer/duration continuam existindo como campos DERIVADOS
// (compatibilidade): audioBuffer = clips[0]?.buffer; duration = fim do último clip.
```

---

# ENTREGA A — Motor por clips (som idêntico ao atual)

Ao final: cada faixa tem `clips[]` por baixo (1 clip cobrindo o arquivo), playback e
export agendam POR CLIP, ducking/gate enxergam posições. Nada muda no ouvido — é o
critério de aceite.

### Task 1: `static/clip-model.js` + testes node

**Files:**
- Create: `static/clip-model.js`
- Create: `tests/clip-model.test.mjs`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `tests/clip-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CM = require('../static/clip-model.js');

const buf = { duration: 10 };   // AudioBuffer é opaco pro modelo

test('clipInteiro cobre o arquivo a partir de 0', () => {
    const c = CM.clipInteiro(buf);
    assert.equal(c.inicio, 0);
    assert.equal(c.offset, 0);
    assert.equal(c.duracao, 10);
    assert.equal(c.buffer, buf);
    assert.ok(c.id.startsWith('clip_'));
});

test('fimDoClip e fimDaFaixa', () => {
    const a = { inicio: 2, duracao: 3 };
    const b = { inicio: 8, duracao: 4 };
    assert.equal(CM.fimDoClip(a), 5);
    assert.equal(CM.fimDaFaixa([a, b]), 12);
    assert.equal(CM.fimDaFaixa([]), 0);
});

test('duracaoDoProjeto: fim do último clip de VOZ + 1.05', () => {
    const faixas = [
        { type: 'voice', clips: [{ inicio: 1, duracao: 4 }] },      // fim 5
        { type: 'music', clips: [{ inicio: 0, duracao: 60 }] },
    ];
    assert.ok(Math.abs(CM.duracaoDoProjeto(faixas) - 6.05) < 1e-9);
});

test('duracaoDoProjeto sem voz: maior fim de clip', () => {
    const faixas = [{ type: 'music', clips: [{ inicio: 2, duracao: 30 }] }];
    assert.equal(CM.duracaoDoProjeto(faixas), 32);
});

test('clipNoPonto acha o clip que cobre o tempo t', () => {
    const a = { inicio: 0, duracao: 5 }, b = { inicio: 8, duracao: 2 };
    assert.equal(CM.clipNoPonto([a, b], 3), a);
    assert.equal(CM.clipNoPonto([a, b], 9), b);
    assert.equal(CM.clipNoPonto([a, b], 6), null);   // buraco
});

test('dividirClip parte no tempo do projeto, offsets certos', () => {
    const c = { id: 'clip_x', buffer: buf, inicio: 2, offset: 1, duracao: 6, fadeIn: 0.5, fadeOut: 0.5 };
    const [a, b] = CM.dividirClip(c, 5);            // 3s dentro do clip
    assert.equal(a.inicio, 2); assert.equal(a.offset, 1); assert.equal(a.duracao, 3);
    assert.equal(b.inicio, 5); assert.equal(b.offset, 4); assert.equal(b.duracao, 3);
    assert.equal(a.buffer, buf); assert.equal(b.buffer, buf);
    assert.equal(a.fadeIn, 0.5); assert.equal(a.fadeOut, 0);   // fade só na borda original
    assert.equal(b.fadeIn, 0);   assert.equal(b.fadeOut, 0.5);
    assert.notEqual(a.id, b.id);
});

test('dividirClip fora do miolo devolve null', () => {
    const c = { inicio: 2, offset: 0, duracao: 6, buffer: buf };
    assert.equal(CM.dividirClip(c, 2.001), null);    // < 50ms da borda
    assert.equal(CM.dividirClip(c, 9), null);
});

test('removerTrecho: some o meio e a direita PUXA pra esquerda', () => {
    const c = { id: 'c', buffer: buf, inicio: 0, offset: 0, duracao: 10, fadeIn: 0, fadeOut: 0 };
    const novos = CM.removerTrecho([c], c, 3, 5);    // tira 2s
    assert.equal(novos.length, 2);
    assert.equal(novos[0].duracao, 3);               // 0..3
    assert.equal(novos[1].inicio, 3);                // colou
    assert.equal(novos[1].offset, 5);                // pula o trecho no arquivo
    assert.equal(novos[1].duracao, 5);
});

test('manterTrecho vira um clip só com o recorte', () => {
    const c = { id: 'c', buffer: buf, inicio: 2, offset: 1, duracao: 8, fadeIn: 0, fadeOut: 0 };
    const m = CM.manterTrecho(c, 4, 7);              // projeto 4..7
    assert.equal(m.inicio, 4);
    assert.equal(m.offset, 3);                       // 1 + (4-2)
    assert.equal(m.duracao, 3);
});

test('aplicarTrim nas duas bordas, não-destrutivo e com limites', () => {
    const c = { inicio: 5, offset: 2, duracao: 6, buffer: { duration: 20 } };
    const ini = CM.aplicarTrim(c, 'ini', 7);         // encolhe 2s pela esquerda
    assert.equal(ini.inicio, 7); assert.equal(ini.offset, 4); assert.equal(ini.duracao, 4);
    const fim = CM.aplicarTrim(c, 'fim', 8);         // encolhe 3s pela direita
    assert.equal(fim.inicio, 5); assert.equal(fim.offset, 2); assert.equal(fim.duracao, 3);
    // esticar a borda final além do arquivo: para no fim do arquivo (offset 2 + 18 = 20)
    const max = CM.aplicarTrim(c, 'fim', 60);
    assert.equal(max.duracao, 18);
    // esticar a borda inicial recupera áudio escondido, até offset 0
    const volta = CM.aplicarTrim(ini, 'ini', 0);
    assert.equal(volta.offset, 0); assert.equal(volta.inicio, 3);   // 7 - 4
    // duração mínima
    const mini = CM.aplicarTrim(c, 'fim', 5.001);
    assert.ok(mini.duracao >= 0.05);
});

test('calcularSnap gruda no alvo mais perto dentro da tolerância', () => {
    assert.equal(CM.calcularSnap(4.9, [0, 5, 10], 0.2), 5);
    assert.equal(CM.calcularSnap(4.5, [0, 5, 10], 0.2), 4.5);   // longe: não gruda
    assert.equal(CM.calcularSnap(0.1, [0, 5], 0.2), 0);
});

test('moverClip clampa entre os vizinhos e no zero', () => {
    const a = { id: 'a', inicio: 0, duracao: 3 };
    const b = { id: 'b', inicio: 5, duracao: 2 };
    const c = { id: 'c', inicio: 10, duracao: 4 };
    // b quer ir pra 1 → bateria em a (fim 3): clampa em 3
    assert.equal(CM.moverClip([a, b, c], b, 1), 3);
    // b quer ir pra 9 → fim 11 invadiria c (início 10): clampa em 8
    assert.equal(CM.moverClip([a, b, c], b, 9), 8);
    // a quer ir pra -2: clampa em 0
    assert.equal(CM.moverClip([a, b, c], a, -2), 0);
    // espaço livre: vale o pedido
    assert.equal(CM.moverClip([a, b, c], b, 3.5), 3.5);
});

test('ordenarClips ordena por inicio sem mutar o array original', () => {
    const arr = [{ inicio: 5 }, { inicio: 1 }];
    const ord = CM.ordenarClips(arr);
    assert.equal(ord[0].inicio, 1);
    assert.equal(arr[0].inicio, 5);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/clip-model.test.mjs`
Expected: FAIL (`Cannot find module '../static/clip-model.js'`)

- [ ] **Step 3: Implementar `static/clip-model.js`**

```js
/**
 * Modelo de clips da timeline — MATEMÁTICA PURA, sem DOM e sem Web Audio.
 *
 * Um clip é um RECORTE POSICIONADO de um arquivo: {buffer, inicio, offset,
 * duracao, fadeIn, fadeOut}. `inicio` é onde ele entra na timeline do PROJETO;
 * `offset` é a partir de onde o ARQUIVO toca (trim não-destrutivo: encurtar só
 * mexe em offset/duracao, o áudio continua inteiro no buffer).
 *
 * Vive num arquivo separado pra ser testável com `node --test` — o buffer aqui
 * é opaco (só se lê .duration), então os testes rodam sem navegador.
 */
(function (global) {
    'use strict';

    // Menor clip que faz sentido segurar com o mouse. Também é a distância
    // mínima da borda pra "Dividir" (dividir a 1ms da ponta cria um farelo
    // inaudível que só atrapalha).
    const DURACAO_MIN = 0.05;

    let _seq = 0;
    function novoId() {
        // Date.now sozinho colide quando dois clips nascem no mesmo ms
        // (dividir cria dois de uma vez) — o contador desempata.
        return 'clip_' + Date.now() + '_' + (_seq++);
    }

    function clipInteiro(buffer) {
        return {
            id: novoId(), buffer: buffer,
            inicio: 0, offset: 0, duracao: buffer.duration,
            fadeIn: 0, fadeOut: 0
        };
    }

    function fimDoClip(c) { return c.inicio + c.duracao; }

    function fimDaFaixa(clips) {
        let fim = 0;
        for (const c of (clips || [])) fim = Math.max(fim, fimDoClip(c));
        return fim;
    }

    // Duração do projeto = fim do último clip de VOZ + 1.05s (regra da casa:
    // a trilha "respira" 1.05s depois da última palavra e o mix acaba).
    // Sem voz nenhuma, vale o clip que termina mais tarde.
    function duracaoDoProjeto(faixas) {
        let fimVoz = 0, fimTudo = 0;
        for (const f of (faixas || [])) {
            const fim = fimDaFaixa(f.clips);
            fimTudo = Math.max(fimTudo, fim);
            if (f.type === 'voice') fimVoz = Math.max(fimVoz, fim);
        }
        return fimVoz > 0 ? fimVoz + 1.05 : fimTudo;
    }

    function ordenarClips(clips) {
        return (clips || []).slice().sort((a, b) => a.inicio - b.inicio);
    }

    function clipNoPonto(clips, t) {
        for (const c of (clips || [])) {
            if (t >= c.inicio && t <= fimDoClip(c)) return c;
        }
        return null;
    }

    // Divide no tempo `t` DO PROJETO. Fades ficam nas bordas originais: a
    // emenda nasce seca de propósito — os dois pedaços colados têm que soar
    // como o áudio contínuo que eram.
    function dividirClip(c, t) {
        if (t < c.inicio + DURACAO_MIN || t > fimDoClip(c) - DURACAO_MIN) return null;
        const antes = t - c.inicio;
        const a = {
            id: novoId(), buffer: c.buffer,
            inicio: c.inicio, offset: c.offset, duracao: antes,
            fadeIn: c.fadeIn || 0, fadeOut: 0
        };
        const b = {
            id: novoId(), buffer: c.buffer,
            inicio: t, offset: c.offset + antes, duracao: c.duracao - antes,
            fadeIn: 0, fadeOut: c.fadeOut || 0
        };
        return [a, b];
    }

    // Remove o trecho [ini, fim] (tempo do projeto) de DENTRO do clip e puxa a
    // parte direita pra esquerda — mesmo resultado audível do corte destrutivo
    // antigo, mas o arquivo continua inteiro (offset pula o trecho).
    function removerTrecho(clips, clip, ini, fim) {
        ini = Math.max(clip.inicio, ini);
        fim = Math.min(fimDoClip(clip), fim);
        if (fim - ini < 0.001) return clips;
        const resto = [];
        const antes = ini - clip.inicio;
        if (antes >= DURACAO_MIN) {
            resto.push({
                id: novoId(), buffer: clip.buffer,
                inicio: clip.inicio, offset: clip.offset, duracao: antes,
                fadeIn: clip.fadeIn || 0, fadeOut: 0
            });
        }
        const depois = fimDoClip(clip) - fim;
        if (depois >= DURACAO_MIN) {
            resto.push({
                id: novoId(), buffer: clip.buffer,
                inicio: ini,                                   // puxa pra esquerda
                offset: clip.offset + (fim - clip.inicio),     // pula o trecho no arquivo
                duracao: depois,
                fadeIn: 0, fadeOut: clip.fadeOut || 0
            });
        }
        return ordenarClips(clips.filter(c => c.id !== clip.id).concat(resto));
    }

    // Fica só o trecho [ini, fim] do clip (tempo do projeto), no lugar onde está.
    function manterTrecho(clip, ini, fim) {
        ini = Math.max(clip.inicio, ini);
        fim = Math.min(fimDoClip(clip), fim);
        return {
            id: novoId(), buffer: clip.buffer,
            inicio: ini, offset: clip.offset + (ini - clip.inicio),
            duracao: Math.max(DURACAO_MIN, fim - ini),
            fadeIn: 0, fadeOut: 0
        };
    }

    // Trim NÃO-DESTRUTIVO pela borda. `novoTempo` é onde a borda deve ficar
    // (tempo do projeto). Borda 'ini' também recupera áudio escondido (offset
    // desce até 0); borda 'fim' estica até o fim do arquivo. Devolve um clip
    // NOVO (não muta) — o chamador substitui no array.
    function aplicarTrim(c, borda, novoTempo) {
        const arquivo = c.buffer && c.buffer.duration != null ? c.buffer.duration : Infinity;
        if (borda === 'ini') {
            // O quanto a borda anda (negativo = recuperando áudio pela esquerda)
            let delta = novoTempo - c.inicio;
            delta = Math.max(-c.offset, Math.min(delta, c.duracao - DURACAO_MIN));
            return Object.assign({}, c, {
                inicio: c.inicio + delta,
                offset: c.offset + delta,
                duracao: c.duracao - delta
            });
        }
        // borda 'fim'
        let novaDur = novoTempo - c.inicio;
        novaDur = Math.max(DURACAO_MIN, Math.min(novaDur, arquivo - c.offset));
        return Object.assign({}, c, { duracao: novaDur });
    }

    function calcularSnap(t, alvos, tolerancia) {
        let melhor = t, dist = tolerancia;
        for (const alvo of (alvos || [])) {
            const d = Math.abs(alvo - t);
            if (d <= dist) { melhor = alvo; dist = d; }
        }
        return melhor;
    }

    // Devolve o `inicio` VÁLIDO mais próximo do pedido: clampa no 0 e nos
    // vizinhos da MESMA faixa (clips não se sobrepõem na v1 — sobreposição
    // criaria dois áudios somados sem crossfade, que soa a erro, não a recurso).
    function moverClip(clips, clip, inicioPedido) {
        let minIni = 0, maxIni = Infinity;
        for (const c of (clips || [])) {
            if (c.id === clip.id) continue;
            if (fimDoClip(c) <= clip.inicio + 1e-9) minIni = Math.max(minIni, fimDoClip(c));
            else if (c.inicio >= fimDoClip(clip) - 1e-9) maxIni = Math.min(maxIni, c.inicio - clip.duracao);
        }
        return Math.max(minIni, Math.min(inicioPedido, maxIni));
    }

    const ClipModel = {
        DURACAO_MIN, novoId, clipInteiro, fimDoClip, fimDaFaixa,
        duracaoDoProjeto, ordenarClips, clipNoPonto, dividirClip,
        removerTrecho, manterTrecho, aplicarTrim, calcularSnap, moverClip
    };

    global.ClipModel = ClipModel;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClipModel;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/clip-model.test.mjs`
Expected: PASS (13 testes)

- [ ] **Step 5: Commit**

```bash
git add static/clip-model.js tests/clip-model.test.mjs
git commit -m "feat(minidaw): clip-model puro -- matematica de clips com testes node"
```

### Task 2: `mix-engine.js` — detecção de voz por posição

**Files:**
- Modify: `static/mix-engine.js` (função `detectarTrechosDeVoz`, linha 45; exports, final do arquivo)
- Create: `tests/mix-engine-clips.test.mjs`

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `tests/mix-engine-clips.test.mjs`. O mix-engine é um IIFE que recebe
`window` — no node, injeta-se um objeto no lugar:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
// O arquivo termina em `})(window);` — troca o argumento pra injetar o fake.
new Function('window', src)(janela);
const MixEngine = janela.MixEngine;

// AudioBuffer falso: 1 canal, senoide nos trechos "com voz", zero no resto.
function bufferFalso(sr, duracao, trechosComVoz) {
    const n = Math.floor(sr * duracao);
    const dados = new Float32Array(n);
    for (const [ini, fim] of trechosComVoz) {
        for (let i = Math.floor(ini * sr); i < Math.min(n, Math.floor(fim * sr)); i++) {
            dados[i] = 0.5 * Math.sin(i * 0.3);
        }
    }
    return { sampleRate: sr, duration: duracao, length: n, getChannelData: () => dados };
}

test('detectarTrechosDeClips desloca os trechos pelo inicio do clip', () => {
    // Arquivo com voz de 0..1s; clip posicionado em 5s
    const buf = bufferFalso(8000, 2, [[0, 1]]);
    const clips = [{ buffer: buf, inicio: 5, offset: 0, duracao: 2 }];
    const trechos = MixEngine.detectarTrechosDeClips(clips, 0.7, 0.08);
    assert.equal(trechos.length, 1);
    assert.ok(Math.abs(trechos[0][0] - 5) < 0.1, `ini ${trechos[0][0]} ≈ 5`);
    assert.ok(Math.abs(trechos[0][1] - 6) < 0.15, `fim ${trechos[0][1]} ≈ 6`);
});

test('detectarTrechosDeClips respeita offset/duracao (janela do arquivo)', () => {
    // Voz em 0..1s e 3..4s; o clip mostra SÓ a janela 2..4s do arquivo, em 10s
    const buf = bufferFalso(8000, 4, [[0, 1], [3, 4]]);
    const clips = [{ buffer: buf, inicio: 10, offset: 2, duracao: 2 }];
    const trechos = MixEngine.detectarTrechosDeClips(clips, 0.7, 0.08);
    assert.equal(trechos.length, 1);            // a voz de 0..1 ficou fora da janela
    assert.ok(Math.abs(trechos[0][0] - 11) < 0.1, `ini ${trechos[0][0]} ≈ 11 (10 + (3-2))`);
});

test('detectarTrechosDeClips une clips de faixas diferentes em ordem', () => {
    const b1 = bufferFalso(8000, 1, [[0, 1]]);
    const b2 = bufferFalso(8000, 1, [[0, 1]]);
    const clips = [
        { buffer: b2, inicio: 8, offset: 0, duracao: 1 },
        { buffer: b1, inicio: 2, offset: 0, duracao: 1 },
    ];
    const trechos = MixEngine.detectarTrechosDeClips(clips, 0.7, 0.08);
    assert.equal(trechos.length, 2);
    assert.ok(trechos[0][0] < trechos[1][0]);
});

test('detectarTrechosDeVoz antigo continua funcionando (gerador usa)', () => {
    const buf = bufferFalso(8000, 2, [[0.5, 1.5]]);
    const trechos = MixEngine.detectarTrechosDeVoz([{ audioBuffer: buf }], 0.7);
    assert.equal(trechos.length, 1);
    assert.ok(Math.abs(trechos[0][0] - 0.5) < 0.1);
});

test('clip de faixa só com ruído de fundo não gera trecho (piso absoluto)', () => {
    const n = 8000 * 2;
    const dados = new Float32Array(n);
    for (let i = 0; i < n; i++) dados[i] = 0.001 * Math.sin(i);
    const buf = { sampleRate: 8000, duration: 2, length: n, getChannelData: () => dados };
    const trechos = MixEngine.detectarTrechosDeClips(
        [{ buffer: buf, inicio: 0, offset: 0, duracao: 2 }], 0.7, 0.08);
    assert.equal(trechos.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/mix-engine-clips.test.mjs`
Expected: FAIL (`detectarTrechosDeClips is not a function`)

- [ ] **Step 3: Implementar `detectarTrechosDeClips`**

Em `static/mix-engine.js`, logo APÓS o fechamento de `detectarTrechosDeVoz`
(linha 104, depois do `return unidos;` e da `}`), adicionar:

```js
    // ── DETECÇÃO POR CLIPS POSICIONADOS ──────────────────────────────────
    // Mesmo algoritmo do detectarTrechosDeVoz, mas por CLIP: analisa só a
    // janela [offset, offset+duracao] do arquivo e desloca os trechos achados
    // pra posição do clip na timeline (inicio). É o que faz a trilha abaixar
    // quando a voz ENTRA DE VERDADE — e não a partir do zero do projeto.
    // `clips` = [{buffer, inicio, offset, duracao}] (só os de faixas de VOZ).
    function detectarTrechosDeClips(clips, hold, limiarPct) {
        const JANELA = 0.03;
        const HOLD = hold != null ? hold : DUCK_PADRAO.hold;
        const PCT = Math.min(0.30, Math.max(0.01, limiarPct != null ? limiarPct : 0.08));
        const segmentos = [];

        for (const clip of (clips || [])) {
            const buf = clip.buffer;
            if (!buf) continue;
            const sr = buf.sampleRate;
            const passo = Math.max(1, Math.floor(JANELA * sr));
            const dados = buf.getChannelData(0);
            const a0 = Math.max(0, Math.floor((clip.offset || 0) * sr));
            const a1 = Math.min(dados.length, Math.floor(((clip.offset || 0) + clip.duracao) * sr));

            const rms = [];
            let pico = 0;
            for (let i = a0; i < a1; i += passo) {
                let soma = 0;
                const fim = Math.min(i + passo, a1);
                for (let j = i; j < fim; j++) soma += dados[j] * dados[j];
                const v = Math.sqrt(soma / Math.max(1, fim - i));
                rms.push(v);
                if (v > pico) pico = v;
            }
            // Piso absoluto: janela só com ruído de fundo não conta como voz
            // (mesma proteção do detectarTrechosDeVoz — ver comentário lá).
            if (pico < 0.003) continue;

            const limiar = pico * PCT;
            let inicio = null;
            for (let k = 0; k < rms.length; k++) {
                const temVoz = rms[k] >= limiar;
                if (temVoz && inicio === null) inicio = k * JANELA;
                if (!temVoz && inicio !== null) {
                    segmentos.push([clip.inicio + inicio, clip.inicio + k * JANELA]);
                    inicio = null;
                }
            }
            if (inicio !== null) segmentos.push([clip.inicio + inicio, clip.inicio + rms.length * JANELA]);
        }

        if (!segmentos.length) return [];
        segmentos.sort((a, b) => a[0] - b[0]);
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
```

E no bloco de exports (final do arquivo), acrescentar a função:

```js
    global.MixEngine = {
        renderizarMix, masterizarBuffer, bufferToWav, bufferToMp3,
        detectarTrechosDeVoz, detectarTrechosDeClips, aplicarDucking, aplicarGate,
        DUCK_PADRAO, GATE_PADRAO
    };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/mix-engine-clips.test.mjs`
Expected: PASS (5 testes). Rodar também `node --test tests/clip-model.test.mjs` (segue PASS).

- [ ] **Step 5: Commit**

```bash
git add static/mix-engine.js tests/mix-engine-clips.test.mjs
git commit -m "feat(mix-engine): detectarTrechosDeClips -- deteccao de voz por posicao na timeline"
```

### Task 3: `minidaw.js` — clips por baixo (migração preguiçosa) + agenda por posição

**Files:**
- Modify: `static/minidaw.js` (constructor ~10-64; `calculateDuration` 1019; `agendarVolumeDaFaixa` 1078; `playTrack` 1134; `stop` 1187; `agendarGate` 690; `updateTrackFadeIn/Out` 851-865)
- Modify: `templates/minidaw.html` (carregar `clip-model.js` antes de `minidaw.js`)

- [ ] **Step 1: Carregar o clip-model no template**

Em `templates/minidaw.html`, achar a linha do script do mix-engine
(`grep -n "mix-engine.js" templates/minidaw.html`) e adicionar LOGO ABAIXO:

```html
    <script src="/static/clip-model.js?v=1"></script>
```

- [ ] **Step 2: Migração preguiçosa `_clipsDaFaixa`**

Em `static/minidaw.js`, adicionar método logo ANTES de `calculateDuration()` (linha 1019):

```js
    // ── CLIPS DA FAIXA (migração preguiçosa) ─────────────────────────────
    // O resto do arquivo seta track.audioBuffer em vários pontos (upload, TTS,
    // biblioteca, projeto reaberto). Em vez de caçar todos, o modelo de clips
    // nasce AQUI: na primeira leitura após o buffer mudar, vira 1 clip cobrindo
    // o arquivo. Operações de timeline (dividir/mover/trim) gravam em
    // track.clips e carimbam _clipsBuffer — enquanto o buffer não trocar de
    // novo, os clips editados valem.
    _clipsDaFaixa(track) {
        if (!track.audioBuffer) { track.clips = []; return track.clips; }
        if (!track.clips || !track.clips.length || track._clipsBuffer !== track.audioBuffer) {
            const c = ClipModel.clipInteiro(track.audioBuffer);
            c.fadeIn = track.fadeIn || 0;
            c.fadeOut = track.fadeOut || 0;
            track.clips = [c];
            track._clipsBuffer = track.audioBuffer;
        }
        return track.clips;
    }

    // Fim da última posição de áudio da faixa (tempo do PROJETO). Substitui o
    // track.duration "do arquivo" nos cálculos de duração/gate/fade.
    _fimDaFaixa(track) {
        return ClipModel.fimDaFaixa(this._clipsDaFaixa(track));
    }

    // Todos os clips de VOZ do projeto, no formato do detectarTrechosDeClips.
    _clipsDeVoz() {
        const clips = [];
        for (const t of this.tracks) {
            if (t.type !== 'voice' || !t.audioBuffer) continue;
            for (const c of this._clipsDaFaixa(t)) clips.push(c);
        }
        return clips;
    }
```

- [ ] **Step 3: `calculateDuration` por clips**

Substituir o corpo de `calculateDuration()` (linhas 1019-1036) por:

```js
    calculateDuration() {
        const faixas = this.tracks
            .filter(t => t.audioBuffer)
            .map(t => ({ type: t.type, clips: this._clipsDaFaixa(t) }));
        this.duration = ClipModel.duracaoDoProjeto(faixas);
        this.updateDuration();
    }
```

- [ ] **Step 4: `agendarVolumeDaFaixa` por posição (fades saem daqui)**

Substituir o trecho das linhas 1093-1115 (do `const nivel = ...` até o fim do
método) por:

```js
        const nivel = track.volume / 100;
        // Fades agora são POR CLIP e vivem no clipGain de cada source (ver
        // playTrack) — aqui fica só o nível da faixa + ducking + fade final.
        g.setValueAtTime(nivel, base);

        const haVoz = this.tracks.some(t => t.type === 'voice' && t.audioBuffer);
        if (track.type === 'music' && haVoz) {
            const clipsDeVoz = this._clipsDeVoz();
            const fimDaVoz = ClipModel.fimDaFaixa(clipsDeVoz);
            const trechosDeVoz = MixEngine.detectarTrechosDeClips(clipsDeVoz, this.duckHold);
            const ducou = this.aplicarDucking(g, trechosDeVoz, nivel, fimDaVoz, base);
            if (!ducou) {
                g.linearRampToValueAtTime(nivel, base + fimDaVoz);
            }
            // Fade final: some 1.05s depois do fim da voz (igual ao export).
            g.linearRampToValueAtTime(0, base + fimDaVoz + 1.05);
        }
```

(O bloco `else if (track.fadeOut > 0)` das linhas 1111-1115 é REMOVIDO — o
fade-out manual agora é do último clip, agendado no `playTrack`.)

- [ ] **Step 5: `playTrack` agenda um source POR CLIP**

Substituir o método `playTrack` inteiro (linhas 1134-1175) por:

```js
    playTrack(track) {
        let nodes = this.trackNodes.get(track.id);
        // Faixa com áudio mas sem cadeia de efeitos ficava MUDA no play, e o
        // return calado não deixava pista nenhuma. Se o áudio está aí, remonta
        // a cadeia em vez de desistir.
        if (!nodes && track.audioBuffer) {
            this.createTrackNodes(track);
            if (typeof this.applyEffectStates === 'function') this.applyEffectStates(track);
            nodes = this.trackNodes.get(track.id);
        }
        if (!nodes || !track.audioBuffer) return;

        // Base de tempo: o instante (no relógio do AudioContext) em que o t=0
        // do PROJETO aconteceu (ver comentário do agendarVolumeDaFaixa).
        const base = this.audioContext.currentTime - (this.currentTime || 0);
        this.playbackBase = base;

        // Um BufferSource POR CLIP, cada um com seu clipGain (fades do clip).
        // O clipGain é separado do gainNode da faixa de propósito: fades de
        // clip e ducking da faixa no MESMO AudioParam brigariam (regra da casa).
        nodes.sourceNodes = nodes.sourceNodes || [];
        const agora = this.currentTime || 0;
        for (const clip of this._clipsDaFaixa(track)) {
            const fimClip = ClipModel.fimDoClip(clip);
            if (fimClip <= agora) continue;               // clip já passou

            const source = this.audioContext.createBufferSource();
            source.buffer = clip.buffer;

            const clipGain = this.audioContext.createGain();
            const g = clipGain.gain;
            g.setValueAtTime(1, 0);
            if (clip.fadeIn > 0) {
                g.setValueAtTime(0, Math.max(0, base + clip.inicio));
                g.linearRampToValueAtTime(1, base + clip.inicio + clip.fadeIn);
            }
            if (clip.fadeOut > 0) {
                g.setValueAtTime(1, Math.max(0, base + fimClip - clip.fadeOut));
                g.linearRampToValueAtTime(0, base + fimClip);
            }

            source.connect(clipGain);
            clipGain.connect(nodes.inputNode);

            if (agora > clip.inicio) {
                // Retomando no meio do clip: entra já andado.
                source.start(0, clip.offset + (agora - clip.inicio), fimClip - agora);
            } else {
                source.start(base + clip.inicio, clip.offset, clip.duracao);
            }
            nodes.sourceNodes.push(source);
        }

        // Gate e volume/ducking: agendas centralizadas — e as duas começam
        // CANCELANDO a agenda anterior (ver agendarVolumeDaFaixa).
        this.agendarGate(track, nodes, base);
        this.agendarVolumeDaFaixa(track, nodes, base);

        // O fim do playback é vigiado pelo updatePlaybackTime (currentTime >=
        // duration) — onended por source não serve mais: cada clip acaba numa
        // hora e o primeiro a acabar pararia o projeto inteiro.
    }
```

- [ ] **Step 6: `stop()` para todos os sources**

Substituir as linhas 1193-1203 (bloco `this.trackNodes.forEach(...)`) por:

```js
        // Stop all clip sources
        this.trackNodes.forEach(nodes => {
            for (const s of (nodes.sourceNodes || [])) {
                try { s.stop(); } catch (e) { /* already stopped */ }
            }
            nodes.sourceNodes = [];
            if (nodes.sourceNode) {           // legado (não deve existir mais)
                try { nodes.sourceNode.stop(); } catch (e) { /* ok */ }
                nodes.sourceNode = null;
            }
        });
```

- [ ] **Step 7: Gate por posição**

Substituir o corpo de `agendarGate` (linhas 690-705) por:

```js
    agendarGate(track, nodes, quando) {
        if (!nodes || !nodes.gateGain || !track.audioBuffer) return 0;
        const param = nodes.gateGain.gain;
        param.cancelScheduledValues(quando);
        if (!track.effects.gate) {
            param.setValueAtTime(1, quando);
            return 0;
        }
        const g = track.gateSettings || {};
        const sens = (g.sensibilidade != null ? g.sensibilidade : 12) / 100;
        // hold 0.25s: pausa entre frases é curta; o 0.70 do ducking juntaria
        // tudo num bloco só e o gate não fecharia em lugar nenhum.
        // Por CLIPS: os trechos saem já na posição do projeto, e o gate fecha
        // também nos BURACOS entre clips (não tem fala lá mesmo).
        const clips = this._clipsDaFaixa(track);
        const trechos = MixEngine.detectarTrechosDeClips(clips, 0.25, sens);
        MixEngine.aplicarGate(param, trechos, this._fimDaFaixa(track), quando, g);
        return trechos.length;
    }
```

- [ ] **Step 8: Sliders de fade escrevem no clip**

Substituir `updateTrackFadeIn` e `updateTrackFadeOut` (linhas 851-865) por:

```js
    updateTrackFadeIn(trackId, fadeIn) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.fadeIn = parseFloat(fadeIn);
            // Fades agora moram no CLIP: o slider da faixa controla o primeiro
            // clip (fade de entrada) — comportamento idêntico com 1 clip.
            const clips = this._clipsDaFaixa(track);
            if (clips.length) {
                ClipModel.ordenarClips(clips)[0].fadeIn = track.fadeIn;
            }
            if (this.isPlaying) { this.stop(); this.play(); }   // reagenda sources
            this.saveToLocalStorage();
        }
    }

    updateTrackFadeOut(trackId, fadeOut) {
        const track = this.tracks.find(t => t.id === trackId);
        if (track) {
            track.fadeOut = parseFloat(fadeOut);
            const clips = this._clipsDaFaixa(track);
            if (clips.length) {
                const ord = ClipModel.ordenarClips(clips);
                ord[ord.length - 1].fadeOut = track.fadeOut;
            }
            if (this.isPlaying) { this.stop(); this.play(); }
            this.saveToLocalStorage();
        }
    }
```

(Conferir antes o corpo atual com `sed -n '851,866p' static/minidaw.js` — se os
métodos atuais fizerem algo além de setar o campo, preservar essas linhas.)

- [ ] **Step 9: Verificação de sanidade + versão**

- `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs` → PASS
- `node -e "const s=require('fs').readFileSync('static/minidaw.js','utf8'); new Function(s)"`
  → não lança SyntaxError (só compila, não executa DOM)
- Subir `MINIDAW_VERSAO` para 26 (linha 5) e `?v=26` no `templates/minidaw.html`
  (grep `minidaw.js?v=`)

- [ ] **Step 10: Commit**

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(minidaw): motor por clips -- playback, ducking, gate e duracao por posicao"
```

### Task 4: `mix-engine.js` — export por clips (prévia = arquivo)

**Files:**
- Modify: `static/mix-engine.js` (`renderizarMix`, linhas 233-458)

- [ ] **Step 1: Duração e trechos por clips**

Em `renderizarMix`, substituir as linhas 240-250 (cálculo de `maxVoiceDuration` /
`finalDuration`) por:

```js
        const tracksWithAudio = todasAsTracks.filter(t => t.audioBuffer);
        {
            // Clips: faixa sem clips[] (chamador antigo, ex. Gerador) vira
            // 1 clip cobrindo o arquivo — comportamento idêntico ao de sempre.
            const clipsDe = (t) => (t.clips && t.clips.length)
                ? t.clips
                : [{ buffer: t.audioBuffer, inicio: 0, offset: 0,
                     duracao: t.audioBuffer.duration,
                     fadeIn: t.fadeIn || 0, fadeOut: t.fadeOut || 0 }];
            const fimDoClip = (c) => c.inicio + c.duracao;
            const fimDosClips = (cs) => cs.reduce((m, c) => Math.max(m, fimDoClip(c)), 0);

            const voiceTracks = tracksWithAudio.filter(t => t.type === 'voice');
            const clipsDeVoz = [];
            for (const t of voiceTracks) for (const c of clipsDe(t)) clipsDeVoz.push(c);

            const fimDaVoz = fimDosClips(clipsDeVoz);
            let finalDuration = o.duration;
            if (clipsDeVoz.length > 0) {
                finalDuration = fimDaVoz + 1.05;
            } else {
                let fimTudo = 0;
                for (const t of tracksWithAudio) fimTudo = Math.max(fimTudo, fimDosClips(clipsDe(t)));
                if (fimTudo > 0) finalDuration = fimTudo;
            }
```

- [ ] **Step 2: Um source por clip com clipGain**

Ainda em `renderizarMix`, substituir as linhas 268-270 (`// Create source` até
`source.buffer = ...`) por:

```js
                // Um BufferSource POR CLIP, cada um com clipGain de fades —
                // espelho exato do playTrack (regra da casa: prévia = arquivo).
                const clips = clipsDe(track);
                const sources = [];
                for (const clip of clips) {
                    const source = offlineContext.createBufferSource();
                    source.buffer = clip.buffer;
                    const clipGain = offlineContext.createGain();
                    const cg = clipGain.gain;
                    cg.setValueAtTime(1, 0);
                    if (clip.fadeIn > 0) {
                        cg.setValueAtTime(0, clip.inicio);
                        cg.linearRampToValueAtTime(1, clip.inicio + clip.fadeIn);
                    }
                    if (clip.fadeOut > 0) {
                        cg.setValueAtTime(1, Math.max(clip.inicio, clip.inicio + clip.duracao - clip.fadeOut));
                        cg.linearRampToValueAtTime(0, clip.inicio + clip.duracao);
                    }
                    source.connect(clipGain);
                    sources.push({ source, clipGain, clip });
                }
```

- [ ] **Step 3: Gate por posição no export**

Substituir o bloco do gate (linhas 365-375, `const gateGain = ...` até o `}` do
`if (track.effects.gate)`) por:

```js
                const gateGain = offlineContext.createGain();
                gateGain.gain.value = 1;
                if (track.effects.gate) {
                    const g = track.gateSettings || {};
                    const sens = (g.sensibilidade != null ? g.sensibilidade : 12) / 100;
                    const trechosDaFaixa = detectarTrechosDeClips(
                        clips.map(c => ({ buffer: c.buffer, inicio: c.inicio, offset: c.offset, duracao: c.duracao })),
                        0.25, sens);
                    aplicarGate(gateGain.gain, trechosDaFaixa, fimDosClips(clips), 0, g);
                }
```

- [ ] **Step 4: Fades da faixa saem; ducking por clipsDeVoz; fade final por fimDaVoz**

Substituir as linhas 383-427 (`// Apply fades` até o fim do `else` do fade
manual) por:

```js
                // Nível da faixa (fades agora são por clip, no clipGain).
                trackGain.gain.setValueAtTime(track.volume / 100, 0);

                if (track.type === 'music' && clipsDeVoz.length > 0) {
                    // DUCKING por posição: a trilha abaixa quando a voz ENTRA
                    // de verdade na timeline, não a partir do zero.
                    const trechosDeVoz = detectarTrechosDeClips(clipsDeVoz, duck.hold);
                    const ducou = aplicarDucking(
                        trackGain.gain, trechosDeVoz, track.volume / 100, fimDaVoz, 0, duck
                    );
                    if (!ducou) {
                        trackGain.gain.linearRampToValueAtTime(track.volume / 100, fimDaVoz);
                    }
                    // Fade final continua igual: some 1.05s depois do fim da voz.
                    trackGain.gain.linearRampToValueAtTime(0, fimDaVoz + 1.05);
                }
```

- [ ] **Step 5: Conexão e start por clip**

Substituir a linha 430 (`source.connect(hpfNode);`) por:

```js
                for (const s of sources) s.clipGain.connect(hpfNode);
```

E substituir a linha 453 (`source.start(0);`) por:

```js
                for (const s of sources) s.source.start(s.clip.inicio, s.clip.offset, s.clip.duracao);
```

- [ ] **Step 6: Verificar e commitar**

- `node --test tests/mix-engine-clips.test.mjs` → PASS
- `node -e "const f=require('fs').readFileSync('static/mix-engine.js','utf8'); new Function('window',f)({});"` → sem SyntaxError

```bash
git add static/mix-engine.js
git commit -m "feat(mix-engine): renderizarMix por clips -- export identico ao playback"
```

### Task 5: Entrega A no ar + teste de ouvido

- [ ] **Step 1: Push**

```bash
git push origin testes-local:main
```

- [ ] **Step 2: Roteiro de teste (usuário, em produção — /minidaw)**

Comportamento deve ser IDÊNTICO ao de ontem (é o aceite da Entrega A):
1. F12 → console mostra `MiniDAW v26`.
2. Importar voz do TTS + trilha da Biblioteca → play: ducking abaixa/sobe igual.
3. Gate ligado na voz: respiração some igual.
4. Fade in/out da trilha: sliders funcionam.
5. Tesoura: remover trecho e dividir seguem funcionando (ainda no modo antigo).
6. Otimizar e Exportar → MP3 soa igual à prévia.
7. Gerador (/gerador): gerar um spot → mix normal.

**GATE: não seguir pra Entrega B sem o "tá igual" do usuário.**

---

# ENTREGA B — Timeline visual + 4 gestos

### Task 6: Régua, escala única e clips como blocos

**Files:**
- Modify: `static/minidaw.js` (`createTrackUI` 178+, `drawWaveform` 735, `updateTrackUI` 2000)
- Modify: `templates/minidaw.html` (CSS + régua acima de `#tracksContainer`)

- [ ] **Step 1: Estado de escala no constructor**

Após `this.playbackBase = null;` (linha ~26), adicionar:

```js
        // ── TIMELINE ─────────────────────────────────────────────────────
        // Escala ÚNICA de tempo (px por segundo) compartilhada por régua e
        // todas as pistas — sem ela "10 segundos" teria tamanhos diferentes em
        // cada faixa e arrastar entre faixas não teria sentido geométrico.
        this.pxPorSegundo = 24;
        this.clipDrag = null;     // estado do arrasto em andamento (Task 7)
```

- [ ] **Step 2: CSS da timeline**

Em `templates/minidaw.html`, no `<style>` existente, adicionar:

```css
/* ── TIMELINE DE CLIPS ─────────────────────────────────────────────── */
.timeline-regua {
    position: sticky; top: 0; z-index: 5;
    height: 26px; margin-bottom: 4px;
    background: #0e1424; border: 1px solid #2a3350; border-radius: 6px;
    position: relative; overflow: hidden;
}
.timeline-regua .marca {
    position: absolute; top: 0; bottom: 0;
    border-left: 1px solid rgba(255,255,255,.18);
    color: #8b93a7; font-size: .62rem; padding-left: 3px;
    pointer-events: none;
}
.clips-lane {
    position: relative; height: 84px; overflow-x: auto; overflow-y: hidden;
    background: linear-gradient(180deg, rgba(59,130,246,.08), rgba(168,85,247,.08));
    border-radius: 6px;
}
.clips-lane .lane-conteudo { position: relative; height: 100%; }
.clip-bloco {
    position: absolute; top: 4px; bottom: 4px;
    border: 1px solid rgba(255,255,255,.35); border-radius: 5px;
    background: rgba(20,26,46,.85); overflow: hidden;
    cursor: grab; user-select: none;
}
.clip-bloco:active { cursor: grabbing; }
.clip-bloco.arrastando { opacity: .75; z-index: 10; box-shadow: 0 0 0 2px #ec4899; }
.clip-bloco canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.clip-alca {
    position: absolute; top: 0; bottom: 0; width: 7px; z-index: 3;
    cursor: ew-resize; background: rgba(236,72,153,0);
}
.clip-alca:hover { background: rgba(236,72,153,.55); }
.clip-alca.ini { left: 0; } .clip-alca.fim { right: 0; }
.clip-nome {
    position: absolute; left: 8px; top: 2px; z-index: 2;
    color: #e6e8f0; font-size: .6rem; pointer-events: none;
    text-shadow: 0 1px 2px #000;
}
```

- [ ] **Step 3: Régua no HTML**

Em `templates/minidaw.html`, imediatamente ANTES de
`<div id="tracksContainer" ...>` (localizar com grep), inserir:

```html
        <div class="timeline-regua" id="timelineRegua"></div>
```

- [ ] **Step 4: Renderização da régua e dos clips**

Em `static/minidaw.js`, adicionar antes de `drawWaveform` (linha 735):

```js
    // ── TIMELINE: régua + blocos de clip ─────────────────────────────────
    _larguraDaTimeline() {
        // Sempre um respiro à direita pra ter onde soltar clip no fim.
        return Math.max(60, (this.duration + 10) * this.pxPorSegundo);
    }

    desenharRegua() {
        const regua = document.getElementById('timelineRegua');
        if (!regua) return;
        const largura = this._larguraDaTimeline();
        regua.style.width = '100%';
        // Marca a cada 5s (a cada 1s com zoom alto).
        const passo = this.pxPorSegundo >= 60 ? 1 : 5;
        let html = '';
        for (let t = 0; t * this.pxPorSegundo <= largura; t += passo) {
            html += `<div class="marca" style="left:${t * this.pxPorSegundo}px">${this.formatTime(t)}</div>`;
        }
        regua.innerHTML = html;
    }

    // Redesenha os blocos de clip de UMA faixa dentro da lane dela.
    renderizarClips(track) {
        const lane = document.getElementById(`lane_${track.id}`);
        if (!lane) return;
        const conteudo = lane.querySelector('.lane-conteudo');
        conteudo.style.width = this._larguraDaTimeline() + 'px';
        conteudo.innerHTML = '';
        for (const clip of this._clipsDaFaixa(track)) {
            const el = document.createElement('div');
            el.className = 'clip-bloco';
            el.id = `clip_el_${clip.id}`;
            el.style.left = (clip.inicio * this.pxPorSegundo) + 'px';
            el.style.width = Math.max(8, clip.duracao * this.pxPorSegundo) + 'px';
            el.innerHTML = `
                <canvas></canvas>
                <span class="clip-nome">${track.name}</span>
                <div class="clip-alca ini" data-borda="ini"></div>
                <div class="clip-alca fim" data-borda="fim"></div>`;
            el.addEventListener('mousedown', (ev) => this.mousedownClip(ev, track.id, clip.id));
            conteudo.appendChild(el);
            this.desenharOndaDoClip(track, clip, el.querySelector('canvas'));
        }
    }

    // Waveform da JANELA do clip (offset..offset+duracao) — mesmo algoritmo
    // de envelope min/max por coluna do drawWaveform clássico.
    desenharOndaDoClip(track, clip, canvas) {
        if (!canvas || !clip.buffer) return;
        const width = Math.floor(canvas.offsetWidth);
        const height = Math.floor(canvas.offsetHeight);
        if (!width || !height) {
            requestAnimationFrame(() => this.desenharOndaDoClip(track, clip, canvas));
            return;
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        const dados = clip.buffer.getChannelData(0);
        const sr = clip.buffer.sampleRate;
        const a0 = Math.floor(clip.offset * sr);
        const a1 = Math.min(dados.length, Math.floor((clip.offset + clip.duracao) * sr));
        const meio = height / 2;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(0, Math.round(meio), width, 1);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        const amostrasPorPixel = (a1 - a0) / width;
        for (let px = 0; px < width; px++) {
            const ini = a0 + Math.floor(px * amostrasPorPixel);
            const fim = Math.min(a0 + Math.floor((px + 1) * amostrasPorPixel), a1);
            if (fim <= ini) continue;
            let min = 1.0, max = -1.0;
            for (let i = ini; i < fim; i++) {
                const v = dados[i];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const topo = meio - max * meio;
            ctx.fillRect(px, topo, 1, Math.max(1, (max - min) * meio));
        }
    }

    // Redesenha timeline inteira (régua + todas as lanes). Chamar depois de
    // qualquer mudança de clip, zoom ou duração.
    renderizarTimeline() {
        this.calculateDuration();
        this.desenharRegua();
        for (const t of this.tracks) {
            if (t.audioBuffer) this.renderizarClips(t);
        }
    }
```

- [ ] **Step 5: Trocar o canvas único pela lane no card**

Em `createTrackUI` (bloco das linhas 247-254), substituir:

```js
                <div class="waveform-container" id="wfbox_${track.id}"
                     onmousedown="minidaw.iniciarSelecao(event, '${track.id}')">
                    <canvas id="waveform_${track.id}" class="waveform"></canvas>
                    <!-- Guia do corte: região destacada + as duas hastes -->
                    <div class="sel-regiao" id="selreg_${track.id}"></div>
                    <div class="sel-haste sel-haste-ini" id="selini_${track.id}"></div>
                    <div class="sel-haste sel-haste-fim" id="selfim_${track.id}"></div>
                </div>
```

por:

```js
                <div class="clips-lane" id="lane_${track.id}">
                    <div class="lane-conteudo">
                        <!-- Guia do corte da Tesoura (agora dentro da lane) -->
                        <div class="sel-regiao" id="selreg_${track.id}"></div>
                        <div class="sel-haste sel-haste-ini" id="selini_${track.id}"></div>
                        <div class="sel-haste sel-haste-fim" id="selfim_${track.id}"></div>
                    </div>
                </div>
```

E ao FINAL de `createTrackUI` (depois do `container.appendChild(trackCard)` —
localizar), acrescentar:

```js
        if (track.audioBuffer) requestAnimationFrame(() => this.renderizarTimeline());
```

- [ ] **Step 6: `drawWaveform` legado redireciona**

Substituir o CORPO de `drawWaveform(track)` (linhas 735-792) por:

```js
    drawWaveform(track) {
        // A onda agora é desenhada POR CLIP na lane (desenharOndaDoClip).
        // Mantido porque meia dúzia de pontos do arquivo chama drawWaveform
        // depois de mexer no áudio — todos querem dizer "redesenha a faixa".
        this.renderizarTimeline();
    }
```

- [ ] **Step 7: Zoom global controla a escala**

Substituir `zoomIn`/`zoomOut` (linhas 2599-2609) e `trackZoomIn`/`trackZoomOut`
(2611-2625) por:

```js
    zoomIn() {
        this.pxPorSegundo = Math.min(200, this.pxPorSegundo * 1.4);
        this.renderizarTimeline();
        this.updateZoomIndicator();
    }

    zoomOut() {
        this.pxPorSegundo = Math.max(6, this.pxPorSegundo / 1.4);
        this.renderizarTimeline();
        this.updateZoomIndicator();
    }

    // Zoom por faixa não existe mais: a timeline tem UMA escala (senão "10s"
    // teria tamanhos diferentes por faixa e arrastar entre elas não fecharia).
    trackZoomIn() { this.zoomIn(); }
    trackZoomOut() { this.zoomOut(); }
```

- [ ] **Step 8: Compilar, versão, commit**

- `node -e "const s=require('fs').readFileSync('static/minidaw.js','utf8'); new Function(s)"` → ok
- `MINIDAW_VERSAO = 27` + `?v=27` no template

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(minidaw): timeline visual -- regua, escala unica e clips como blocos"
```

### Task 7: Gesto 1+2 — arrastar no tempo e entre faixas (com imã)

**Files:**
- Modify: `static/minidaw.js`

- [ ] **Step 1: Handler central `mousedownClip`**

Adicionar após `renderizarTimeline()` (Task 6):

```js
    // ── ARRASTO DE CLIP (tempo + entre faixas) ───────────────────────────
    // Um handler só decide o gesto pelo alvo: alça = trim (Task 9), corpo com
    // Tesoura armada = seleção de corte, corpo normal = arrastar.
    mousedownClip(ev, trackId, clipId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        const clip = this._clipsDaFaixa(track).find(c => c.id === clipId);
        if (!clip) return;

        const borda = ev.target.dataset && ev.target.dataset.borda;
        if (borda) return this.iniciarTrim(ev, track, clip, borda);
        if (this.trackTesoura === trackId) return this.iniciarSelecao(ev, trackId);

        ev.preventDefault();
        const el = document.getElementById(`clip_el_${clip.id}`);
        const x0 = ev.clientX, y0 = ev.clientY;
        const inicioOriginal = clip.inicio;
        this.clipDrag = { track, clip, moveu: false };
        el.classList.add('arrastando');

        const mover = (e) => {
            const dx = e.clientX - x0;
            if (!this.clipDrag.moveu && Math.abs(dx) < 3 && Math.abs(e.clientY - y0) < 3) return;
            this.clipDrag.moveu = true;

            // Alvos do imã: bordas dos OUTROS clips (todas as faixas), 0:00 e
            // o cursor de reprodução — igual ao "Snap to objects".
            const alvos = [0, this.currentTime || 0];
            for (const t of this.tracks) {
                for (const c of this._clipsDaFaixa(t)) {
                    if (c.id === clip.id) continue;
                    alvos.push(c.inicio, ClipModel.fimDoClip(c));
                    alvos.push(c.inicio - clip.duracao, ClipModel.fimDoClip(c) - clip.duracao);
                }
            }
            const tol = 8 / this.pxPorSegundo;    // 8px de imã, em segundos
            let novoInicio = ClipModel.calcularSnap(
                Math.max(0, inicioOriginal + dx / this.pxPorSegundo), alvos, tol);

            // Faixa de destino: a lane sob o mouse (vertical).
            const alvo = document.elementFromPoint(e.clientX, e.clientY);
            const laneAlvo = alvo && alvo.closest ? alvo.closest('.clips-lane') : null;
            const idAlvo = laneAlvo ? laneAlvo.id.replace('lane_', '') : track.id;
            this.clipDrag.trackAlvoId = idAlvo;

            const faixaAlvo = this.tracks.find(t => t.id === idAlvo) || track;
            const clipsAlvo = (faixaAlvo === track)
                ? this._clipsDaFaixa(track)
                : this._clipsDaFaixa(faixaAlvo).concat([clip]);
            novoInicio = ClipModel.moverClip(clipsAlvo, clip, novoInicio);

            clip.inicio = novoInicio;
            el.style.left = (novoInicio * this.pxPorSegundo) + 'px';
            document.querySelectorAll('.clips-lane').forEach(l =>
                l.style.outline = (l.id === `lane_${idAlvo}` && idAlvo !== track.id)
                    ? '2px dashed #ec4899' : '');
        };

        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            el.classList.remove('arrastando');
            document.querySelectorAll('.clips-lane').forEach(l => l.style.outline = '');
            const d = this.clipDrag; this.clipDrag = null;
            if (!d || !d.moveu) return;

            if (d.trackAlvoId && d.trackAlvoId !== track.id) {
                this.moverClipParaFaixa(track, clip, d.trackAlvoId);
            } else {
                track.clips = ClipModel.ordenarClips(this._clipsDaFaixa(track));
                this.aposMudancaDeClips([track]);
            }
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }

    // Move o clip pra outra faixa. O clip HERDA o canal de destino: efeitos,
    // volume e o TIPO (voz→trilha muda ducking) são da faixa, não do clip.
    moverClipParaFaixa(origem, clip, destinoId) {
        const destino = this.tracks.find(t => t.id === destinoId);
        if (!destino) return;
        origem.clips = this._clipsDaFaixa(origem).filter(c => c.id !== clip.id);
        const clipsDestino = this._clipsDaFaixa(destino);
        clip.inicio = ClipModel.moverClip(clipsDestino.concat([clip]), clip, clip.inicio);
        destino.clips = ClipModel.ordenarClips(clipsDestino.concat([clip]));
        // Sincroniza os campos derivados legados dos DOIS lados.
        this._sincronizarDerivados(origem);
        this._sincronizarDerivados(destino);
        this.aposMudancaDeClips([origem, destino]);
    }

    // Campos legados derivados dos clips — o resto do arquivo (e o export)
    // ainda lê audioBuffer/duration da faixa.
    _sincronizarDerivados(track) {
        const clips = track.clips || [];
        track.audioBuffer = clips.length ? clips[0].buffer : null;
        track._clipsBuffer = track.audioBuffer;
        track.duration = ClipModel.fimDaFaixa(clips);
        if (!clips.length) track.audioUrl = null;
    }

    // Pós-edição de clips: re-render + reagendamento se estiver tocando +
    // persistência local. UMA porta de saída pra todos os gestos.
    aposMudancaDeClips(faixas) {
        this.renderizarTimeline();
        if (this.isPlaying) { this.stop(); this.play(); }
        else {
            // Ducking/gate agendados mudaram de lugar — limpa pro próximo play.
            for (const t of (faixas || [])) {
                const nodes = this.trackNodes.get(t.id);
                if (nodes) this.aplicarVolumeAgora(t, nodes);
            }
        }
        this.saveToLocalStorage();
    }
```

- [ ] **Step 2: Compilar + versão + commit**

- `node -e "const s=require('fs').readFileSync('static/minidaw.js','utf8'); new Function(s)"` → ok
- `MINIDAW_VERSAO = 28` + `?v=28`

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(minidaw): arrastar clip no tempo e entre faixas, com ima"
```

### Task 8: Gesto 3 — Tesoura divide/remova/mantém por CLIPS (não-destrutiva)

**Files:**
- Modify: `static/minidaw.js` (`_tempoNoPonto` 2432, `iniciarSelecao` 2439, `desenharSelecao` 2470, `aplicarCorte` 2513, `cutTrackAtTime` 3081)

- [ ] **Step 1: Seleção em coordenadas da TIMELINE**

Substituir `_tempoNoPonto` (linhas 2432-2437) por:

```js
    _tempoNoPonto(ev, track) {
        // Tempo do PROJETO no ponto do mouse — a lane tem escala única, então
        // é só posição/pxPorSegundo (antes era fração da duração da faixa).
        const lane = document.getElementById(`lane_${track.id}`);
        const conteudo = lane.querySelector('.lane-conteudo');
        const r = conteudo.getBoundingClientRect();
        return Math.max(0, (ev.clientX - r.left) / this.pxPorSegundo);
    }
```

Em `desenharSelecao` (linhas 2470-2504), substituir as DUAS linhas de
porcentagem (2486-2487):

```js
        const pIni = (s.ini / track.duration) * 100;
        const pFim = (s.fim / track.duration) * 100;
```

por posições em pixels na escala única:

```js
        const pIni = s.ini * this.pxPorSegundo;
        const pFim = s.fim * this.pxPorSegundo;
```

e trocar os `+ '%'` dessas hastes/região (linhas 2489-2493) por `+ 'px'`.
Também na checagem da linha 2480, trocar `!track.duration` por
`!track.audioBuffer`. Na linha 2478 o lookup de `wfbox_` não existe mais —
conferir se `desenharSelecao` referencia só os ids `selreg_/selini_/selfim_/
barracorte_/corteinfo_` (que continuam no template da lane e da barra).

- [ ] **Step 2: `aplicarCorte` vira operação de clips**

Substituir o método `aplicarCorte` INTEIRO (linhas 2511-2590) por:

```js
    // modo: 'remover' (tira o trecho), 'manter' (fica só o trecho),
    //       'dividir' (parte o clip no início da marcação)
    // Agora NÃO-DESTRUTIVO: nada de copiar buffers — só matemática de clips
    // (offset/duracao). "Restaurar" deixou de precisar de rede de segurança:
    // esticar a borda de volta (trim) recupera o áudio.
    aplicarCorte(trackId, modo) {
        const track = this.tracks.find(t => t.id === trackId);
        const s = (this.selecoes || {})[trackId];
        if (!track || !track.audioBuffer || !s) return;

        const clips = this._clipsDaFaixa(track);
        const clip = ClipModel.clipNoPonto(clips, s.ini);
        if (!clip) {
            this.showNotification('Marque em cima de um clip (a marcação caiu num buraco)', 'warning');
            return;
        }

        if (modo === 'dividir') {
            const partes = ClipModel.dividirClip(clip, s.ini);
            if (!partes) {
                this.showNotification('Muito perto da borda pra dividir', 'warning');
                return;
            }
            track.clips = ClipModel.ordenarClips(
                clips.filter(c => c.id !== clip.id).concat(partes));
        } else if (modo === 'remover') {
            if (s.fim - s.ini < 0.01) {
                this.showNotification('Arraste sobre a onda pra marcar o trecho primeiro', 'warning');
                return;
            }
            track.clips = ClipModel.removerTrecho(clips, clip, s.ini, s.fim);
            if (!track.clips.length) {
                this.showNotification('Isso apagaria a faixa inteira', 'warning');
                track.clips = clips;
                return;
            }
        } else {   // manter
            if (s.fim - s.ini < 0.01) {
                this.showNotification('Arraste sobre a onda pra marcar o trecho primeiro', 'warning');
                return;
            }
            track.clips = [ClipModel.manterTrecho(clip, s.ini, s.fim)];
        }

        this._sincronizarDerivados(track);
        this.cancelarSelecao(trackId);
        this.aposMudancaDeClips([track]);
        const nomes = { dividir: 'Clip dividido em dois', remover: 'Trecho removido', manter: 'Ficou só o trecho marcado' };
        this.showNotification(`${nomes[modo]} — arraste os clips como quiser`, 'success');
    }
```

- [ ] **Step 3: `cutTrackAtTime` legado**

Substituir o corpo de `cutTrackAtTime(trackId, cutTime)` (linhas 3081-final do
método) por um redirecionamento (não cria mais faixa "Parte 2" — dividir agora
é dentro da própria faixa):

```js
    async cutTrackAtTime(trackId, cutTime) {
        // Legado: dividir criava outra FAIXA ("Parte 2"). No modelo de clips a
        // divisão acontece DENTRO da faixa — mesmo canal, dois objetos.
        this.selecoes = this.selecoes || {};
        this.selecoes[trackId] = { ini: cutTime, fim: cutTime };
        this.aplicarCorte(trackId, 'dividir');
    }
```

- [ ] **Step 4: Compilar + versão + commit**

- `node -e "..."` (compila) → ok; `MINIDAW_VERSAO = 29` + `?v=29`

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(minidaw): tesoura por clips -- dividir/remover/manter nao-destrutivos"
```

### Task 9: Gesto 4 — trim pelas bordas

**Files:**
- Modify: `static/minidaw.js`

- [ ] **Step 1: `iniciarTrim`**

Adicionar após `mousedownClip` (Task 7):

```js
    // ── TRIM PELAS BORDAS (não-destrutivo) ───────────────────────────────
    iniciarTrim(ev, track, clip, borda) {
        ev.preventDefault();
        ev.stopPropagation();
        const el = document.getElementById(`clip_el_${clip.id}`);
        const canvas = el.querySelector('canvas');

        const mover = (e) => {
            const lane = document.getElementById(`lane_${track.id}`);
            const r = lane.querySelector('.lane-conteudo').getBoundingClientRect();
            const t = (e.clientX - r.left) / this.pxPorSegundo;

            // Imã nas bordas dos outros clips + 0 + cursor.
            const alvos = [0, this.currentTime || 0];
            for (const tr of this.tracks) {
                for (const c of this._clipsDaFaixa(tr)) {
                    if (c.id === clip.id) continue;
                    alvos.push(c.inicio, ClipModel.fimDoClip(c));
                }
            }
            const ajustado = ClipModel.calcularSnap(t, alvos, 8 / this.pxPorSegundo);

            const novo = ClipModel.aplicarTrim(clip, borda, ajustado);
            // Não deixa a borda invadir o clip vizinho.
            const inicioValido = ClipModel.moverClip(this._clipsDaFaixa(track), novo, novo.inicio);
            if (Math.abs(inicioValido - novo.inicio) > 1e-6) return;

            Object.assign(clip, novo, { id: clip.id });   // muta in-place, id fica
            el.style.left = (clip.inicio * this.pxPorSegundo) + 'px';
            el.style.width = Math.max(8, clip.duracao * this.pxPorSegundo) + 'px';
            this.desenharOndaDoClip(track, clip, canvas);
        };
        const soltar = () => {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            this._sincronizarDerivados(track);
            this.aposMudancaDeClips([track]);
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }
```

- [ ] **Step 2: Compilar + versão + commit**

- `MINIDAW_VERSAO = 30` + `?v=30`

```bash
git add static/minidaw.js templates/minidaw.html
git commit -m "feat(minidaw): trim nao-destrutivo pelas bordas do clip"
```

### Task 10: Entrega B no ar + teste de ouvido

- [ ] **Step 1: Testes node + push**

```bash
node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs
git push origin testes-local:main
```

- [ ] **Step 2: Roteiro de teste (usuário, produção)**

O critério da spec — montar o "LMN AGOSTO DOURADO" dentro do app:
1. Console: `MiniDAW v30`. Régua em cima, faixas na mesma escala.
2. Importar 2 vozes + 1 trilha. Arrastar a voz 2 pra entrar depois da voz 1.
3. Tesoura → Dividir uma voz em 2 clips; arrastar o segundo pra frente.
4. Arrastar um clip de voz pra OUTRA faixa (cima/baixo).
5. Trim: encurtar a borda final de um clip; esticar de volta (áudio retorna).
6. Play: ducking abaixa a trilha NAS POSIÇÕES da voz (não do zero).
7. Otimizar e Exportar → MP3 = prévia.
8. Imã: soltar um clip perto do fim de outro → gruda.

**GATE: aval do usuário antes da Entrega C.**

---

# ENTREGA C — Persistência + acabamento

### Task 11: Salvar/reabrir projeto com clips

**Files:**
- Modify: `static/minidaw.js` (`salvarProjetoSupabase` 2867, `carregarProjetoSupabase` 2979)
- Modify: `backend/app.py` (GET `/api/projects/<id>`, linhas 9000-9014)

- [ ] **Step 1: Salvar — um WAV por BUFFER distinto + clips por índice**

Em `salvarProjetoSupabase`, substituir o loop das linhas 2879-2905 por:

```js
            const tracks = [];
            for (let i = 0; i < comAudio.length; i++) {
                const t = comAudio[i];
                const clips = this._clipsDaFaixa(t);
                const td = {
                    name: t.name, type: t.type,
                    volume: t.volume, pan: t.pan,
                    fadeIn: t.fadeIn, fadeOut: t.fadeOut,
                    effects: t.effects, eqSettings: t.eqSettings,
                    gateSettings: t.gateSettings,
                    buffers: [], clips: []
                };
                // Um upload por BUFFER DISTINTO (clips de um corte compartilham
                // o arquivo — subir por clip duplicaria áudio à toa).
                const indicePorBuffer = new Map();
                for (const c of clips) {
                    if (!indicePorBuffer.has(c.buffer)) {
                        const idx = td.buffers.length;
                        indicePorBuffer.set(c.buffer, idx);
                        if (c.buffer === t.audioBuffer && t.audioUrl && /^https?:/i.test(t.audioUrl)) {
                            passo = `referenciar faixa ${i + 1} (${t.name}) — já no Storage`;
                            console.log('[projeto] ' + passo);
                            td.buffers.push({ audio_url_direct: t.audioUrl });
                        } else {
                            passo = `converter áudio ${idx + 1} da faixa ${i + 1} (${t.name}) para WAV`;
                            console.log('[projeto] ' + passo);
                            const wav = this.bufferToWav(c.buffer);
                            passo = `enviar áudio ${idx + 1} da faixa ${i + 1} — ${(wav.size / 1024 / 1024).toFixed(1)}MB`;
                            console.log('[projeto] ' + passo);
                            td.buffers.push({ audio_path: await this._uploadAudioProjeto(wav) });
                        }
                    }
                    td.clips.push({
                        buffer: indicePorBuffer.get(c.buffer),
                        inicio: c.inicio, offset: c.offset, duracao: c.duracao,
                        fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0
                    });
                }
                tracks.push(td);
            }
```

- [ ] **Step 2: Backend assina os buffers**

Em `backend/app.py`, dentro do loop `for tr in (project.get('tracks') or []):`
(linha 9000), ANTES do `tr['audio_url'] = None`, adicionar:

```python
            # Projeto novo (timeline de clips): cada faixa tem buffers[] com
            # audio_path próprio — assina um a um, mesma regra do audio_path.
            for b in (tr.get('buffers') or []):
                b['audio_url'] = None
                bpath = b.get('audio_path')
                if bpath:
                    try:
                        signed_b = supabase_manager.newpost_manager_client.storage \
                            .from_(CLIENT_DELIVERIES_BUCKET).create_signed_url(bpath, 3600)
                        b['audio_url'] = signed_b.get('signedURL') or signed_b.get('signedUrl')
                    except Exception as serr:
                        print(f'[VIP] erro ao assinar buffer {bpath}: {serr}')
                elif b.get('audio_url_direct'):
                    b['audio_url'] = b['audio_url_direct']
```

- [ ] **Step 3: Reabrir — reconstrói clips (com retrocompatibilidade)**

Em `carregarProjetoSupabase`, substituir o bloco das linhas 3002-3005
(`if (td.audio_url) {...}` + `this.updateTrackUI(track)`) por:

```js
                if (td.clips && td.clips.length && td.buffers) {
                    // Projeto novo: baixa cada buffer e reconstrói os clips.
                    const buffers = [];
                    for (const b of td.buffers) {
                        if (!b.audio_url) { buffers.push(null); continue; }
                        const resp = await fetch(b.audio_url);
                        const arr = await resp.arrayBuffer();
                        buffers.push(await this.audioContext.decodeAudioData(arr));
                    }
                    track.clips = td.clips
                        .filter(c => buffers[c.buffer])
                        .map(c => ({
                            id: ClipModel.novoId(), buffer: buffers[c.buffer],
                            inicio: c.inicio, offset: c.offset, duracao: c.duracao,
                            fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0
                        }));
                    this._sincronizarDerivados(track);
                    track.audioUrl = 'projeto://clips';   // marca "tem áudio" pro card
                } else if (td.audio_url) {
                    // Projeto antigo: 1 áudio por faixa → _clipsDaFaixa migra
                    // pra 1 clip em 0:00 na primeira leitura. Nada quebra.
                    await this.loadAudioFromUrl(td.audio_url, track.id, td.name);
                }
                this.updateTrackUI(track);
```

E logo APÓS o loop de faixas (antes do `this.projetoId = proj.id;`), adicionar:

```js
            this.renderizarTimeline();
```

- [ ] **Step 4: Compilar + testes + versão + commit**

- `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs` → PASS
- `python -m py_compile backend/app.py` → ok
- `MINIDAW_VERSAO = 31` + `?v=31`

```bash
git add static/minidaw.js templates/minidaw.html backend/app.py
git commit -m "feat(minidaw): projetos salvam e reabrem clips posicionados"
```

### Task 12: Entrega C no ar + verificação final

- [ ] **Step 1: Push + roteiro**

```bash
git push origin testes-local:main
```

Roteiro (usuário, produção):
1. Montar spot com clips espalhados (2+ faixas), salvar projeto.
2. Fechar aba, reabrir, abrir o projeto → clips nas MESMAS posições.
3. Abrir um projeto ANTIGO (pré-timeline) → abre como antes (1 clip por faixa em 0:00).
4. Gerador → "Abrir na MiniDAW" → voz+trilha chegam normais.
5. Exportar MP3 do projeto reaberto → soa igual à prévia.

- [ ] **Step 2: Memória**

Atualizar `project_minidaw_timeline_clips.md` (memória persistente) com o
resultado da verificação de ouvido e o número de versão final.

---

## ADITIVO — Entrega B.1 (pedido do usuário no teste de 05/08/2026)

Testando a Entrega B em produção, o usuário pediu os gestos de PRECISÃO do
Samplitude (screenshots com traços verticais e atalhos anotados):

### Task 13: Linha de corte + atalhos D/T (dividir no ponto do mouse)

- **Linha de corte vertical** seguindo o mouse por TODAS as lanes (não só a
  atual) + etiqueta de tempo — o traço vermelho que ele desenhou nos prints.
  Estado: `this.cursorTempo` (tempo do projeto sob o mouse) e
  `this.cursorLane` (trackId sob o mouse), atualizados por mousemove nas lanes.
- **Atalho D (e T como sinônimo)**: divide o clip sob o mouse no ponto exato
  (`aplicarCorte(trackId, 'dividir')` com seleção pontual em `cursorTempo`).
  Guard: não dispara com foco em input/textarea. Sem Tesoura armada — o atalho
  é o caminho rápido; a Tesoura continua pros trechos (remover/manter).
- Versão 30 → 31.

### Task 14: Undo/Redo de clips (Ctrl+Z / Ctrl+Y)

- Snapshot do estado de clips de TODAS as faixas no INÍCIO de cada gesto
  mutador (drag commit, trim, aplicarCorte) — cópia rasa dos objetos clip
  (buffers por referência, barato). Pilha de undo (cap 30) + pilha de redo.
- Ctrl+Z restaura o snapshot (por trackId; faixa que não existe mais é
  ignorada), Ctrl+Y / Ctrl+Shift+Z refaz. Restauração passa por
  `_sincronizarDerivados` + `aposMudancaDeClips`.
- Escopo: SÓ operações de clips. Efeitos/volume/Encurtar Pausas ficam fora
  (Encurtar já tem o próprio Desfazer).
- Versão 31 → 32.

## Riscos monitorados durante a execução

1. **`updateTrackUI` recria o card** — `renderizarClips` roda de novo após
   qualquer recriação (o hook no fim de `createTrackUI` cobre isso), e
   `applyEffectStates` continua obrigatório (regra da casa).
2. **Automação fora da agenda central** — os clipGains são por-source
   (recriados a cada play, morrem no stop), então não acumulam agenda; ducking
   e gate seguem nas agendas canceláveis. Nenhum `setValueAtTime` novo em
   `gainNode.gain` fora de `agendarVolumeDaFaixa`.
3. **Gerador/mix-engine** — `renderizarMix` aceita faixa SEM clips (fallback
   interno), então `gerador.js` não muda nesta fase.
4. **`baixarFaixa`/`encurtarPausas`/`desfazerEncurtar`** operam no
   `track.audioBuffer` (arquivo inteiro) — continuam válidos com 1 buffer por
   faixa; com clips multi-buffer o botão 💾 baixa o primeiro arquivo (limitação
   aceita da v1, anotar no teste).
5. **Cache/produção** — cada entrega sobe `MINIDAW_VERSAO` e `?v=` juntos;
   conferir `git show origin/main:templates/minidaw.html | grep -o "minidaw.js?v=[0-9]*"`.
