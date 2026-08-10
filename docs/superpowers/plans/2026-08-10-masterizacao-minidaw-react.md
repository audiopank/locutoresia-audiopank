# Masterização no Audio Pank Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao produtor uma aba "Masterizar" que mede o áudio de verdade (LUFS e pico real), corrige para o alvo do destino ou de uma faixa de referência, e entrega várias versões comparáveis de ouvido — tudo no navegador.

**Architecture:** Matemática de medição em JavaScript puro (`loudness.js`), testável por `node --test` sem navegador, no mesmo padrão de `static/clip-model.js`. Processamento em `OfflineAudioContext` (`mastering.js`). Interface numa aba nova. **Nada do que já existe é modificado** além de duas linhas aditivas no array de abas.

**Tech Stack:** JavaScript ESM puro (medição), Web Audio API / OfflineAudioContext (processamento), React + TypeScript + Tailwind (tela), `lamejs` (MP3, já instalado), `node --test` (testes).

**Spec:** `docs/superpowers/specs/2026-08-10-masterizacao-minidaw-react-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `minidaw-react/src/lib/loudness.js` (novo) | Só medição. Funções puras, sem DOM e sem Web Audio. |
| `tests/loudness.test.mjs` (novo) | Testes da medição, rodando na raiz do repo. |
| `minidaw-react/src/lib/mastering.js` (novo) | Só a cadeia de processamento em OfflineAudioContext. |
| `minidaw-react/src/lib/audioFile.js` (novo) | Decodificar arquivo, gerar WAV e MP3 para download. |
| `minidaw-react/src/components/MasterizarPanel.tsx` (novo) | A tela: soltar arquivo, presets, referência, pilha de versões. |
| `minidaw-react/src/components/MiniDAWIntegrated.tsx` (modificar) | Duas linhas: entrada no array `TABS` + bloco de render. |
| `minidaw-react/src/components/LUFSMeter.tsx` (apagar) | Código morto que exibe LUFS fabricado. |

**Por que `.js` e não `.ts` na medição:** `node --test` roda `.js` ESM direto, sem
compilador. O build (`vite build`) não roda `tsc`, então importar `.js` de um
`.tsx` funciona normalmente. É o mesmo motivo que fez `static/clip-model.js` dar
certo: matemática testável em segundos, sem cerimônia.

---

### Task 1: Filtro K e blocos de loudness

**Files:**
- Create: `minidaw-react/src/lib/loudness.js`
- Test: `tests/loudness.test.mjs`

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// tests/loudness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../minidaw-react/src/lib/loudness.js';

// Gera um seno de 1 kHz com a amplitude pedida.
function seno(amplitude, segundos = 3, sr = 48000) {
    const n = Math.floor(segundos * sr);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / sr);
    return a;
}

test('biquad: coeficientes do shelf sao finitos e a0 normalizado', () => {
    const c = L.coefShelfAgudo(48000);
    for (const v of [c.b0, c.b1, c.b2, c.a1, c.a2]) assert.ok(Number.isFinite(v));
    // Ganho DC do shelf de agudos tem que ser ~1 (0 dB nos graves).
    const dc = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
    assert.ok(Math.abs(dc - 1) < 0.02, `ganho DC ${dc}`);
});

test('filtroK nao altera o comprimento nem produz NaN', () => {
    const x = seno(0.5, 0.5);
    const y = L.filtroK(x, 48000);
    assert.equal(y.length, x.length);
    assert.ok(y.every(Number.isFinite));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/loudness.test.mjs`
Expected: FAIL — `Cannot find module` ou `coefShelfAgudo is not a function`.

- [ ] **Step 3: Implementar o mínimo**

```javascript
// minidaw-react/src/lib/loudness.js
/**
 * Medição de loudness — MATEMÁTICA PURA, sem DOM e sem Web Audio.
 *
 * Existe em .js (e não .ts) de propósito: `node --test` roda isto direto, sem
 * compilador. Mesmo motivo de static/clip-model.js. Toda conta de medição entra
 * AQUI, não solta nos componentes.
 *
 * Base: ITU-R BS.1770-4. Os coeficientes do padrão são publicados para 48 kHz;
 * aqui eles são recalculados para a taxa real do arquivo pelas fórmulas de
 * biquad (RBJ), o que reproduz o padrão em 48k e se comporta certo em 44,1k.
 */

/** Shelf de agudos do BS.1770: f0 1681,97 Hz, +3,9998 dB, Q 0,7071. */
export function coefShelfAgudo(sr) {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const A = Math.pow(10, G / 40);
    const w0 = 2 * Math.PI * f0 / sr;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const raizA2alpha = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * cw + raizA2alpha;
    return {
        b0: A * ((A + 1) + (A - 1) * cw + raizA2alpha) / a0,
        b1: -2 * A * ((A - 1) + (A + 1) * cw) / a0,
        b2: A * ((A + 1) + (A - 1) * cw - raizA2alpha) / a0,
        a1: 2 * ((A - 1) - (A + 1) * cw) / a0,
        a2: ((A + 1) - (A - 1) * cw - raizA2alpha) / a0,
    };
}

/** Passa-alta RLB do BS.1770: f0 38,13 Hz, Q 0,5003. */
export function coefPassaAlta(sr) {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const w0 = 2 * Math.PI * f0 / sr;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
        b0: ((1 + cw) / 2) / a0,
        b1: (-(1 + cw)) / a0,
        b2: ((1 + cw) / 2) / a0,
        a1: (-2 * cw) / a0,
        a2: (1 - alpha) / a0,
    };
}

/** Aplica um biquad (forma direta I) sobre o canal, devolvendo um array novo. */
export function biquad(canal, c) {
    const y = new Float32Array(canal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < canal.length; i++) {
        const x0 = canal[i];
        const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        y[i] = y0;
    }
    return y;
}

/** Os dois estágios do filtro K, em sequência. */
export function filtroK(canal, sr) {
    return biquad(biquad(canal, coefShelfAgudo(sr)), coefPassaAlta(sr));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/loudness.test.mjs`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/lib/loudness.js tests/loudness.test.mjs
git commit -m "feat(master): filtro K do BS.1770 em JS puro, testavel"
```

---

### Task 2: LUFS integrado com os dois portões

**Files:**
- Modify: `minidaw-react/src/lib/loudness.js`
- Test: `tests/loudness.test.mjs`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `tests/loudness.test.mjs`:

```javascript
test('LUFS: dobrar a amplitude sobe ~6 LU', () => {
    const a = L.lufsIntegrado([seno(0.1)], 48000);
    const b = L.lufsIntegrado([seno(0.2)], 48000);
    assert.ok(Math.abs((b - a) - 6.02) < 0.1, `subiu ${(b - a).toFixed(2)} LU`);
});

test('LUFS: seno de -20 dBFS mede perto de -20 LUFS', () => {
    // 0.1 de amplitude = -20 dBFS. O filtro K desloca um pouco no 1 kHz,
    // por isso a tolerancia de 1,5 LU em vez de igualdade exata.
    const v = L.lufsIntegrado([seno(0.1), seno(0.1)], 48000);
    assert.ok(v > -21.5 && v < -18.5, `mediu ${v.toFixed(2)} LUFS`);
});

test('LUFS: silencio total devolve -Infinity', () => {
    assert.equal(L.lufsIntegrado([new Float32Array(48000)], 48000), -Infinity);
});

test('LUFS: o portao ignora o silencio (metade muda mede igual)', () => {
    const puro = seno(0.1, 4);
    const comSilencio = new Float32Array(48000 * 8);
    comSilencio.set(puro, 0);                       // 4s de som + 4s de silencio
    const a = L.lufsIntegrado([puro], 48000);
    const b = L.lufsIntegrado([comSilencio], 48000);
    assert.ok(Math.abs(a - b) < 0.5, `sem portao daria ~3 LU de diferenca: ${a} vs ${b}`);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/loudness.test.mjs`
Expected: FAIL — `lufsIntegrado is not a function`.

- [ ] **Step 3: Implementar**

Adicione ao fim de `minidaw-react/src/lib/loudness.js`:

```javascript
/** Peso por canal do BS.1770. Estéreo e mono usam 1,0; surround pesa mais. */
const PESO_CANAL = [1.0, 1.0, 1.0, 1.41, 1.41];

/**
 * Média quadrática de cada bloco de 400 ms, com 75% de sobreposição.
 * Devolve [{ ms, l }]: a soma ponderada dos canais e o loudness do bloco.
 */
export function blocosDeLoudness(canais, sr) {
    const filtrados = canais.map((c) => filtroK(c, sr));
    const tamanho = Math.round(0.4 * sr);          // bloco de 400 ms
    const passo = Math.round(0.1 * sr);            // avanço de 100 ms = 75% de sobreposição
    const n = filtrados[0].length;
    const blocos = [];
    if (n < tamanho) return blocos;                // curto demais para um bloco
    for (let ini = 0; ini + tamanho <= n; ini += passo) {
        let soma = 0;
        for (let ch = 0; ch < filtrados.length; ch++) {
            const dados = filtrados[ch];
            let acc = 0;
            for (let i = ini; i < ini + tamanho; i++) acc += dados[i] * dados[i];
            soma += (PESO_CANAL[ch] ?? 1.0) * (acc / tamanho);
        }
        blocos.push({ ms: soma, l: -0.691 + 10 * Math.log10(soma || Number.MIN_VALUE) });
    }
    return blocos;
}

/**
 * LUFS integrado. Os DOIS portões do padrão importam aqui:
 * o absoluto (-70) joga fora silêncio digital; o relativo (-10 abaixo da média
 * dos que passaram) impede que as pausas entre as frases puxem a média para
 * baixo — é ele que faz um spot com respiros medir igual a um sem.
 */
export function lufsIntegrado(canais, sr) {
    const blocos = blocosDeLoudness(canais, sr);
    if (!blocos.length) return -Infinity;

    const passouAbsoluto = blocos.filter((b) => b.l > -70);
    if (!passouAbsoluto.length) return -Infinity;

    const mediaMs = (lista) => lista.reduce((s, b) => s + b.ms, 0) / lista.length;
    const gamma = -0.691 + 10 * Math.log10(mediaMs(passouAbsoluto)) - 10;

    const passouRelativo = passouAbsoluto.filter((b) => b.l > gamma);
    if (!passouRelativo.length) return -Infinity;

    return -0.691 + 10 * Math.log10(mediaMs(passouRelativo));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/loudness.test.mjs`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/lib/loudness.js tests/loudness.test.mjs
git commit -m "feat(master): LUFS integrado com portao absoluto e relativo"
```

---

### Task 3: Pico real, faixa dinâmica e balanço tonal

**Files:**
- Modify: `minidaw-react/src/lib/loudness.js`
- Test: `tests/loudness.test.mjs`

- [ ] **Step 1: Escrever os testes que falham**

```javascript
test('picoReal: nunca menor que o pico das amostras', () => {
    const x = seno(0.9, 0.2);
    const amostra = Math.max(...Array.from(x, Math.abs));
    const real = Math.pow(10, L.picoRealDb(x, 48000) / 20);
    assert.ok(real >= amostra - 1e-6, `real ${real} < amostra ${amostra}`);
});

test('picoReal: silencio devolve -Infinity', () => {
    assert.equal(L.picoRealDb(new Float32Array(1000), 48000), -Infinity);
});

test('balancoTonal: devolve 4 bandas somando energia positiva', () => {
    const b = L.balancoTonal([seno(0.5, 1)], 48000);
    assert.equal(b.length, 4);
    assert.ok(b.every((v) => Number.isFinite(v)));
});

test('faixaDinamica: seno constante tem faixa pequena', () => {
    const fd = L.faixaDinamica([seno(0.5, 2)], 48000);
    assert.ok(fd >= 0 && fd < 12, `faixa ${fd}`);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/loudness.test.mjs`
Expected: FAIL — `picoRealDb is not a function`.

- [ ] **Step 3: Implementar**

```javascript
/**
 * Pico REAL (inter-amostra), em dB. O pico que estoura na conversão para MP3
 * mora ENTRE as amostras e não aparece num medidor comum — é por isso que um
 * áudio "limpo" no fone chia no alto-falante do cliente. Sobre-amostragem 4x
 * por interpolação linear: não é a precisão de um medidor de laboratório, mas
 * pega o caso que interessa, que é o pico escondido logo depois do limiter.
 */
export function picoRealDb(canal, _sr) {
    let pico = 0;
    for (let i = 0; i < canal.length - 1; i++) {
        const a = canal[i], b = canal[i + 1];
        for (let k = 0; k < 4; k++) {
            const v = Math.abs(a + (b - a) * (k / 4));
            if (v > pico) pico = v;
        }
    }
    const ultimo = Math.abs(canal[canal.length - 1] || 0);
    if (ultimo > pico) pico = ultimo;
    return pico > 0 ? 20 * Math.log10(pico) : -Infinity;
}

/** Pico real do conjunto de canais (o maior deles). */
export function picoRealDbTodos(canais, sr) {
    return Math.max(...canais.map((c) => picoRealDb(c, sr)));
}

/**
 * Distância entre o pico e o volume médio. Número alto = material dinâmico;
 * número baixo = já espremido (e portanto pouco espaço para masterizar).
 */
export function faixaDinamica(canais, sr) {
    const lufs = lufsIntegrado(canais, sr);
    const pico = picoRealDbTodos(canais, sr);
    if (!Number.isFinite(lufs) || !Number.isFinite(pico)) return 0;
    return pico - lufs;
}

/** Bordas das 4 bandas largas: grave, médio-grave, médio-agudo, agudo. */
export const BANDAS = [
    { nome: 'grave', de: 20, ate: 200 },
    { nome: 'medio-grave', de: 200, ate: 1200 },
    { nome: 'medio-agudo', de: 1200, ate: 5000 },
    { nome: 'agudo', de: 5000, ate: 16000 },
];

/**
 * Energia média de cada banda, em dB. É a base do "imitar referência": mede-se
 * o seu material e o da referência, e a diferença vira a correção.
 * Quatro bandas e não mais: cada banda a mais é uma chance a mais de artefato
 * e uma explicação a menos que o produtor consegue dar ao ouvir o resultado.
 *
 * Usa Goertzel em algumas frequências por banda em vez de FFT completa — é
 * barato, suficiente para um balanço grosso, e não traz dependência nova.
 */
export function balancoTonal(canais, sr) {
    const mono = misturarMono(canais);
    const amostrasMax = Math.min(mono.length, sr * 30);   // 30s bastam para o balanço
    return BANDAS.map((b) => {
        const freqs = [b.de * 1.3, Math.sqrt(b.de * b.ate), b.ate * 0.77];
        let energia = 0;
        for (const f of freqs) energia += goertzel(mono, amostrasMax, sr, f);
        const media = energia / freqs.length;
        return media > 0 ? 10 * Math.log10(media) : -120;
    });
}

/** Média dos canais num só (o balanço tonal não precisa de estéreo). */
export function misturarMono(canais) {
    const n = canais[0].length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (const c of canais) s += c[i];
        out[i] = s / canais.length;
    }
    return out;
}

/** Energia numa frequência única, sem FFT. */
export function goertzel(dados, n, sr, freq) {
    const k = 2 * Math.cos(2 * Math.PI * freq / sr);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
        s0 = dados[i] + k * s1 - s2;
        s2 = s1; s1 = s0;
    }
    const potencia = s1 * s1 + s2 * s2 - k * s1 * s2;
    return Math.max(0, potencia) / n;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/loudness.test.mjs`
Expected: PASS — 10 testes.

- [ ] **Step 5: Rodar a suíte inteira do repo**

Run: `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs tests/loudness.test.mjs`
Expected: 33 testes passando (23 antigos + 10 novos), 0 falhas.

- [ ] **Step 6: Commit**

```bash
git add minidaw-react/src/lib/loudness.js tests/loudness.test.mjs
git commit -m "feat(master): pico real, faixa dinamica e balanco tonal em 4 bandas"
```

---

### Task 4: Alvos por destino

**Files:**
- Create: `minidaw-react/src/lib/destinos.js`
- Test: `tests/loudness.test.mjs`

- [ ] **Step 1: Escrever o teste que falha**

```javascript
import * as D from '../minidaw-react/src/lib/destinos.js';

test('destinos: todos tem alvo, teto e rotulo', () => {
    assert.ok(D.DESTINOS.length >= 4);
    for (const d of D.DESTINOS) {
        assert.equal(typeof d.chave, 'string');
        assert.equal(typeof d.rotulo, 'string');
        assert.ok(d.alvoLufs < 0 && d.alvoLufs > -30);
        assert.ok(d.tetoDb <= 0 && d.tetoDb > -3);
    }
});

test('destinos: radio e o alvo mais baixo (a emissora processa depois)', () => {
    const radio = D.acharDestino('radio');
    for (const d of D.DESTINOS) assert.ok(radio.alvoLufs <= d.alvoLufs);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/loudness.test.mjs`
Expected: FAIL — módulo `destinos.js` não existe.

- [ ] **Step 3: Implementar**

```javascript
// minidaw-react/src/lib/destinos.js
/**
 * Alvos por LUGAR DE ESCUTA, não por plataforma. O produtor entrega para os
 * quatro, e cada um pede um volume diferente.
 *
 * ⚠️ Estes números são ponto de partida informado e DEVEM se mover no ouvido do
 * produtor — foi assim que o fade final da MiniDAW clássica saiu de 1,05 s para
 * 3,05 s. Se ele pedir para mudar, mude aqui e em lugar nenhum mais.
 */
export const DESTINOS = [
    {
        chave: 'radio', rotulo: 'Rádio FM/AM', alvoLufs: -16, tetoDb: -1.0,
        // Mais baixo DE PROPÓSITO: a emissora tem processador próprio, e
        // material espremido faz o processador dela brigar com o nosso.
        dica: 'A rádio processa de novo. Entregar espremido piora o que sai no ar.',
    },
    {
        chave: 'redes', rotulo: 'Redes (Reels/TikTok)', alvoLufs: -14, tetoDb: -1.0,
        dica: 'As plataformas normalizam por volta de -14. Mandar mais alto só perde dinâmica.',
    },
    {
        chave: 'whatsapp', rotulo: 'WhatsApp / cliente', alvoLufs: -12, tetoDb: -1.0,
        dica: 'O cliente escuta no alto-falante do celular. Aqui volume ajuda de verdade.',
    },
    {
        chave: 'pdv', rotulo: 'PDV / carro de som', alvoLufs: -9, tetoDb: -0.5,
        dica: 'Ambiente barulhento e caixa ruim: pouca dinâmica para não sumir.',
    },
];

export function acharDestino(chave) {
    return DESTINOS.find((d) => d.chave === chave) || DESTINOS[0];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/loudness.test.mjs`
Expected: PASS — 12 testes.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/lib/destinos.js tests/loudness.test.mjs
git commit -m "feat(master): alvos por destino de escuta (radio, redes, whatsapp, pdv)"
```

---

### Task 5: Cálculo da correção de tom

**Files:**
- Create: `minidaw-react/src/lib/correcaoTom.js`
- Test: `tests/loudness.test.mjs`

- [ ] **Step 1: Escrever os testes que falham**

```javascript
import * as C from '../minidaw-react/src/lib/correcaoTom.js';

test('correcaoTom: sem referencia devolve tudo zero', () => {
    assert.deepEqual(C.calcularCorrecao([-10, -12, -14, -20], null, 1), [0, 0, 0, 0]);
});

test('correcaoTom: fecha a diferenca multiplicada pela intensidade', () => {
    const fonte = [-20, -20, -20, -20];
    const alvo  = [-16, -20, -24, -20];   // referencia tem +4 no grave, -4 no medio-agudo
    const meio = C.calcularCorrecao(fonte, alvo, 0.5);
    assert.ok(Math.abs(meio[0] - 2) < 0.01, `grave ${meio[0]}`);
    assert.ok(Math.abs(meio[2] + 2) < 0.01, `medio-agudo ${meio[2]}`);
    assert.equal(meio[1], 0);
});

test('correcaoTom: NUNCA passa de +-6 dB, nem com diferenca absurda', () => {
    const c = C.calcularCorrecao([-60, -60, -60, -60], [0, 0, 0, 0], 1);
    for (const v of c) assert.ok(v <= 6 && v >= -6, `estourou o teto: ${v}`);
});

test('correcaoTom: intensidade zero nao mexe em nada', () => {
    assert.deepEqual(C.calcularCorrecao([-10, -10, -10, -10], [0, 0, 0, 0], 0), [0, 0, 0, 0]);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test tests/loudness.test.mjs`
Expected: FAIL — módulo `correcaoTom.js` não existe.

- [ ] **Step 3: Implementar**

```javascript
// minidaw-react/src/lib/correcaoTom.js
/**
 * Quanto mexer em cada uma das 4 bandas para aproximar o material da
 * referência. É aqui que mora o "imitar referência" — e o teto de ±6 dB NÃO É
 * NEGOCIÁVEL: correção sem limite destrói material, e o produtor perde a
 * confiança na ferramenta no primeiro susto.
 *
 * Sem referência não há correção: preset só mexe em volume, não em tom.
 */
export const TETO_CORRECAO_DB = 6;

export function calcularCorrecao(balancoFonte, balancoAlvo, intensidade) {
    if (!balancoAlvo) return balancoFonte.map(() => 0);
    const forca = Math.max(0, Math.min(1, intensidade ?? 1));
    return balancoFonte.map((db, i) => {
        const diferenca = (balancoAlvo[i] - db) * forca;
        return Math.max(-TETO_CORRECAO_DB, Math.min(TETO_CORRECAO_DB, diferenca));
    });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test tests/loudness.test.mjs`
Expected: PASS — 16 testes.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/lib/correcaoTom.js tests/loudness.test.mjs
git commit -m "feat(master): correcao de tom por 4 bandas com teto de +-6dB"
```

---

### Task 6: A cadeia de masterização

**Files:**
- Create: `minidaw-react/src/lib/mastering.js`

Sem teste automatizado: `OfflineAudioContext` não existe no Node. A verificação
é a Task 11 (comparação de ouvido). A matemática que dava para testar já foi
testada nas tasks 1-5.

- [ ] **Step 1: Implementar a cadeia**

```javascript
// minidaw-react/src/lib/mastering.js
/**
 * A cadeia de masterização, em OfflineAudioContext.
 *
 * ⚠️ NÃO importa nem modifica mixer.ts. A masterização é um estágio separado,
 * que recebe um AudioBuffer PRONTO — de onde quer que ele venha (React,
 * MiniDAW clássica, teclado do produtor, terceiros).
 *
 * Ordem fixa: corte baixo → 4 bandas de tom → corte alto → ganho → limiter.
 * Depois de renderizar, o resultado é MEDIDO DE NOVO: o número que a tela
 * mostra é sempre o medido, nunca o pedido.
 */
import { lufsIntegrado, picoRealDbTodos, faixaDinamica, balancoTonal, BANDAS } from './loudness.js';
import { calcularCorrecao } from './correcaoTom.js';

/** Extrai os canais de um AudioBuffer como Float32Array[]. */
export function canaisDe(buffer) {
    const out = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
    return out;
}

/** Medição completa de um AudioBuffer. Usada no original E no resultado. */
export function medir(buffer) {
    const canais = canaisDe(buffer);
    const sr = buffer.sampleRate;
    return {
        lufs: lufsIntegrado(canais, sr),
        picoDb: picoRealDbTodos(canais, sr),
        faixaDinamica: faixaDinamica(canais, sr),
        balanco: balancoTonal(canais, sr),
        duracao: buffer.duration,
        sampleRate: sr,
        canais: buffer.numberOfChannels,
    };
}

/**
 * Masteriza. `opcoes`:
 *   alvoLufs, tetoDb        — do destino escolhido
 *   corteBaixoHz            — 0 desliga
 *   corteAltoHz             — 0 desliga
 *   intensidade             — 0..1, força da correção de tom
 *   balancoReferencia       — array de 4 dB, ou null (sem referência = sem correção de tom)
 * Devolve { buffer, medicao, ganhoAplicadoDb, correcaoDb }.
 */
export async function masterizar(bufferOriginal, opcoes) {
    const {
        alvoLufs, tetoDb,
        corteBaixoHz = 20, corteAltoHz = 0,
        intensidade = 0.5, balancoReferencia = null,
    } = opcoes;

    const medicaoOriginal = medir(bufferOriginal);
    const correcaoDb = calcularCorrecao(medicaoOriginal.balanco, balancoReferencia, intensidade);

    // Ganho para alcançar o alvo. Se o original é silêncio, não há o que fazer.
    const ganhoDb = Number.isFinite(medicaoOriginal.lufs)
        ? (alvoLufs - medicaoOriginal.lufs) : 0;

    const ctx = new OfflineAudioContext(
        bufferOriginal.numberOfChannels,
        bufferOriginal.length,
        bufferOriginal.sampleRate,
    );
    const fonte = ctx.createBufferSource();
    fonte.buffer = bufferOriginal;

    let no = fonte;
    const ligar = (novo) => { no.connect(novo); no = novo; };

    if (corteBaixoHz > 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = corteBaixoHz; hp.Q.value = 0.707;
        ligar(hp);
    }

    // Uma banda de tom por faixa de frequência, centrada geometricamente.
    correcaoDb.forEach((db, i) => {
        if (Math.abs(db) < 0.05) return;      // ganho irrelevante: não gasta nó
        const banda = BANDAS[i];
        const f = ctx.createBiquadFilter();
        if (i === 0) { f.type = 'lowshelf'; f.frequency.value = banda.ate; }
        else if (i === BANDAS.length - 1) { f.type = 'highshelf'; f.frequency.value = banda.de; }
        else {
            f.type = 'peaking';
            f.frequency.value = Math.sqrt(banda.de * banda.ate);
            f.Q.value = 0.9;
        }
        f.gain.value = db;
        ligar(f);
    });

    if (corteAltoHz > 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = corteAltoHz; lp.Q.value = 0.707;
        ligar(lp);
    }

    const ganho = ctx.createGain();
    ganho.gain.value = Math.pow(10, ganhoDb / 20);
    ligar(ganho);

    // Limiter: razão alta, joelho zero e ataque curto. O threshold fica um
    // pouco abaixo do teto porque o DynamicsCompressor deixa passar um tico.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = tetoDb - 0.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    ligar(limiter);

    no.connect(ctx.destination);
    fonte.start(0);
    const renderizado = await ctx.startRendering();

    // Rede de segurança: se ainda passou do teto, abaixa o suficiente. Sem
    // isto o arquivo sai estourando e o medidor mentiria por omissão.
    const medicaoBruta = medir(renderizado);
    let buffer = renderizado;
    if (Number.isFinite(medicaoBruta.picoDb) && medicaoBruta.picoDb > tetoDb) {
        const corte = Math.pow(10, (tetoDb - medicaoBruta.picoDb) / 20);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            const dados = buffer.getChannelData(c);
            for (let i = 0; i < dados.length; i++) dados[i] *= corte;
        }
    }

    return {
        buffer,
        medicao: medir(buffer),      // MEDIDO no resultado, nunca o pedido
        ganhoAplicadoDb: ganhoDb,
        correcaoDb,
    };
}
```

- [ ] **Step 2: Verificar que compila no build**

Run: `cd minidaw-react && npx vite build`
Expected: build conclui sem erro. (Ainda não há tela usando o módulo; isto só
prova que a sintaxe e os imports estão corretos.)

- [ ] **Step 3: Commit**

```bash
git add minidaw-react/src/lib/mastering.js
git commit -m "feat(master): cadeia de masterizacao em OfflineAudioContext"
```

---

### Task 7: Decodificar arquivo e gerar WAV/MP3

**Files:**
- Create: `minidaw-react/src/lib/audioFile.js`

- [ ] **Step 1: Implementar**

```javascript
// minidaw-react/src/lib/audioFile.js
/**
 * Entrada e saída de arquivo da aba Masterizar. Isolado do resto para a
 * masterização não saber nada de File nem de Blob.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

/** Decodifica qualquer arquivo suportado pelo navegador num AudioBuffer. */
export async function decodificar(file) {
    const bytes = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        return await ctx.decodeAudioData(bytes);
    } finally {
        ctx.close();
    }
}

/** AudioBuffer → WAV 16 bits. */
export function paraWav(buffer) {
    const nCh = buffer.numberOfChannels;
    const n = buffer.length;
    const sr = buffer.sampleRate;
    const bytes = 44 + n * nCh * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const texto = (pos, s) => { for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i)); };

    texto(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    texto(8, 'WAVE');
    texto(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, nCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * nCh * 2, true);
    view.setUint16(32, nCh * 2, true);
    view.setUint16(34, 16, true);
    texto(36, 'data');
    view.setUint32(40, n * nCh * 2, true);

    let pos = 44;
    const canais = [];
    for (let c = 0; c < nCh; c++) canais.push(buffer.getChannelData(c));
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < nCh; c++) {
            const v = Math.max(-1, Math.min(1, canais[c][i]));
            view.setInt16(pos, v < 0 ? v * 0x8000 : v * 0x7fff, true);
            pos += 2;
        }
    }
    return new Blob([view], { type: 'audio/wav' });
}

/** AudioBuffer → MP3. Bitrate alto: é entrega para cliente, não streaming. */
export function paraMp3(buffer, kbps = 192) {
    const nCh = Math.min(2, buffer.numberOfChannels);
    const enc = new Mp3Encoder(nCh, buffer.sampleRate, kbps);
    const paraInt16 = (f32) => {
        const out = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            const v = Math.max(-1, Math.min(1, f32[i]));
            out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        return out;
    };
    const esq = paraInt16(buffer.getChannelData(0));
    const dir = nCh > 1 ? paraInt16(buffer.getChannelData(1)) : esq;

    const partes = [];
    const bloco = 1152;
    for (let i = 0; i < esq.length; i += bloco) {
        const buf = nCh > 1
            ? enc.encodeBuffer(esq.subarray(i, i + bloco), dir.subarray(i, i + bloco))
            : enc.encodeBuffer(esq.subarray(i, i + bloco));
        if (buf.length) partes.push(buf);
    }
    const fim = enc.flush();
    if (fim.length) partes.push(fim);
    return new Blob(partes, { type: 'audio/mpeg' });
}

/** Dispara o download de um Blob com o nome dado. */
export function baixar(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
```

- [ ] **Step 2: Verificar o build**

Run: `cd minidaw-react && npx vite build`
Expected: build sem erro (o import do lamejs resolve).

- [ ] **Step 3: Commit**

```bash
git add minidaw-react/src/lib/audioFile.js
git commit -m "feat(master): decodificar arquivo e exportar WAV/MP3"
```

---

### Task 8: A tela — soltar arquivo e ver a medição do original

**Files:**
- Create: `minidaw-react/src/components/MasterizarPanel.tsx`

- [ ] **Step 1: Implementar a primeira metade da tela**

```tsx
// minidaw-react/src/components/MasterizarPanel.tsx
import { useCallback, useState } from "react";
import { Upload, Loader2, Activity } from "lucide-react";
import { decodificar } from "@/lib/audioFile.js";
import { medir } from "@/lib/mastering.js";

type Medicao = {
  lufs: number; picoDb: number; faixaDinamica: number;
  balanco: number[]; duracao: number; sampleRate: number; canais: number;
};

/** Um número medido, ou um traço quando não há o que mostrar. */
function Numero({ rotulo, valor, unidade }: { rotulo: string; valor: number; unidade: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold tabular-nums">
        {Number.isFinite(valor) ? valor.toFixed(1) : "—"}
        <span className="text-sm text-white/50 ml-1">{unidade}</span>
      </div>
      <div className="text-xs text-white/50 mt-1">{rotulo}</div>
    </div>
  );
}

export default function MasterizarPanel() {
  const [nome, setNome] = useState<string>("");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [medicao, setMedicao] = useState<Medicao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string>("");

  const carregar = useCallback(async (file: File) => {
    setCarregando(true); setErro("");
    try {
      const buf = await decodificar(file);
      setBuffer(buf);
      setNome(file.name);
      setMedicao(medir(buf));
    } catch (e: any) {
      setErro(`Não consegui ler "${file.name}". ${e?.message || ""}`);
      setBuffer(null); setMedicao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) carregar(f);
        }}
        className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center"
      >
        <Upload className="w-12 h-12 mx-auto mb-3 text-white/40" />
        <h3 className="text-lg font-semibold mb-1">Arraste o áudio para masterizar</h3>
        <p className="text-sm text-white/60 mb-4">
          Mix desta MiniDAW, da clássica, do seu teclado ou de terceiros. MP3, WAV, OGG, M4A.
        </p>
        <label className="inline-block px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
          Escolher arquivo
          <input
            type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) carregar(f); }}
          />
        </label>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" /> Lendo e medindo…
        </div>
      )}
      {erro && <div className="text-red-300 text-sm">{erro}</div>}

      {medicao && (
        <div className="rounded-xl bg-black/30 border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="font-medium">{nome}</span>
            <span className="text-xs text-white/50">
              {medicao.duracao.toFixed(1)}s · {medicao.sampleRate} Hz · {medicao.canais === 1 ? "mono" : "estéreo"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Numero rotulo="Volume medido" valor={medicao.lufs} unidade="LUFS" />
            <Numero rotulo="Pico real" valor={medicao.picoDb} unidade="dB" />
            <Numero rotulo="Faixa dinâmica" valor={medicao.faixaDinamica} unidade="dB" />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ligar a aba (mudança ADITIVA, não mexe no que existe)**

Em `minidaw-react/src/components/MiniDAWIntegrated.tsx`:

1. No topo, junto dos outros imports de componente:

```tsx
import MasterizarPanel from "./MasterizarPanel";
```

2. No array `TABS` (linha ~36), acrescente ao FIM da lista, sem alterar as
   entradas existentes:

```tsx
  { key: "master", label: "Masterizar", icon: Wand2 },
```

3. Depois do último bloco `{activeTab === "mix" && (...)}`, acrescente:

```tsx
        {activeTab === "master" && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
            <MasterizarPanel />
          </div>
        )}
```

- [ ] **Step 3: Verificar o build e a aba**

Run: `cd minidaw-react && npx vite build`
Expected: build sem erro.

Run: `cd minidaw-react && npm run dev`
Abra a aba "Masterizar", solte um MP3 e confirme que aparecem três números.
Expected: LUFS negativo plausível (entre −30 e −5), pico ≤ 0 dB.

- [ ] **Step 4: Commit**

```bash
git add minidaw-react/src/components/MasterizarPanel.tsx minidaw-react/src/components/MiniDAWIntegrated.tsx
git commit -m "feat(master): aba Masterizar com medicao real do arquivo original"
```

---

### Task 9: Presets, geração de versões e a pilha comparável

**Files:**
- Modify: `minidaw-react/src/components/MasterizarPanel.tsx`

- [ ] **Step 1: Acrescentar estado e controles**

Adicione os imports no topo do arquivo:

```tsx
import { Play, Pause, Trash2, Download, Wand2 } from "lucide-react";
import { DESTINOS, acharDestino } from "@/lib/destinos.js";
import { masterizar } from "@/lib/mastering.js";
import { paraWav, paraMp3, baixar } from "@/lib/audioFile.js";
```

Acrescente o tipo e o estado dentro do componente:

```tsx
type Versao = {
  id: string;
  rotulo: string;
  buffer: AudioBuffer;
  medicao: Medicao;
  alvoLufs: number;
  ganhoAplicadoDb: number;
};

  const [destino, setDestino] = useState("radio");
  const [intensidade, setIntensidade] = useState(0.5);
  const [corteBaixo, setCorteBaixo] = useState(20);
  const [corteAlto, setCorteAlto] = useState(0);
  const [versoes, setVersoes] = useState<Versao[]>([]);
  const [processando, setProcessando] = useState(false);
  const [tocandoId, setTocandoId] = useState<string>("");
```

- [ ] **Step 2: Acrescentar a função que gera uma versão**

```tsx
  const gerar = useCallback(async () => {
    if (!buffer) return;
    setProcessando(true);
    try {
      const d = acharDestino(destino);
      const r = await masterizar(buffer, {
        alvoLufs: d.alvoLufs,
        tetoDb: d.tetoDb,
        corteBaixoHz: corteBaixo,
        corteAltoHz: corteAlto,
        intensidade,
        balancoReferencia: null,
      });
      setVersoes((v) => [
        ...v,
        {
          id: `v_${v.length + 1}_${d.chave}`,
          rotulo: d.rotulo,
          buffer: r.buffer,
          medicao: r.medicao,
          alvoLufs: d.alvoLufs,
          ganhoAplicadoDb: r.ganhoAplicadoDb,
        },
      ]);
    } catch (e: any) {
      setErro(`Falhou ao masterizar: ${e?.message || e}`);
    } finally {
      setProcessando(false);
    }
  }, [buffer, destino, intensidade, corteBaixo, corteAlto]);
```

- [ ] **Step 3: Acrescentar o player simples**

```tsx
  // Um player só para a pilha inteira: tocar duas versões ao mesmo tempo
  // atrapalharia a comparação, que é justamente o ponto da pilha.
  const tocar = useCallback((id: string, buf: AudioBuffer) => {
    (window as any).__pankMasterCtx?.close?.();
    if (tocandoId === id) { setTocandoId(""); return; }
    const ctx = new AudioContext();
    (window as any).__pankMasterCtx = ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setTocandoId("");
    src.start(0);
    setTocandoId(id);
  }, [tocandoId]);
```

- [ ] **Step 4: Acrescentar a interface dos controles e da pilha**

Dentro do `{medicao && (...)}`, logo depois da grade de números:

```tsx
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Destino</span>
              <select
                value={destino} onChange={(e) => setDestino(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2"
              >
                {DESTINOS.map((d) => (
                  <option key={d.chave} value={d.chave}>
                    {d.rotulo} — alvo {d.alvoLufs} LUFS
                  </option>
                ))}
              </select>
              <span className="block text-xs text-white/40 mt-1">{acharDestino(destino).dica}</span>
            </label>

            <div className="text-sm space-y-2">
              <label className="block">
                <span className="text-white/60">Intensidade do acabamento: {intensidade.toFixed(2)}</span>
                <input type="range" min={0} max={1} step={0.05} value={intensidade}
                       onChange={(e) => setIntensidade(parseFloat(e.target.value))} className="w-full" />
              </label>
              <label className="block">
                <span className="text-white/60">Corte baixo: {corteBaixo || "desligado"} Hz</span>
                <input type="range" min={0} max={120} step={5} value={corteBaixo}
                       onChange={(e) => setCorteBaixo(parseInt(e.target.value))} className="w-full" />
              </label>
              <label className="block">
                <span className="text-white/60">Corte alto: {corteAlto || "desligado"} Hz</span>
                <input type="range" min={0} max={20000} step={500} value={corteAlto}
                       onChange={(e) => setCorteAlto(parseInt(e.target.value))} className="w-full" />
              </label>
            </div>
          </div>

          <button
            onClick={gerar} disabled={processando}
            className="mt-4 px-5 py-2.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 font-medium inline-flex items-center gap-2"
          >
            {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {processando ? "Masterizando…" : "Masterizar"}
          </button>
```

E depois do bloco `{medicao && (...)}`, a pilha:

```tsx
      {versoes.length > 0 && (
        <div className="space-y-2">
          {versoes.map((v) => {
            const alcancou = Math.abs(v.medicao.lufs - v.alvoLufs) <= 1;
            return (
              <div key={v.id} className="rounded-xl bg-black/30 border border-white/10 p-3 flex items-center gap-3">
                <button onClick={() => tocar(v.id, v.buffer)}
                        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                  {tocandoId === v.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{v.rotulo}</div>
                  <div className="text-xs text-white/50 tabular-nums">
                    medido {v.medicao.lufs.toFixed(1)} LUFS · pico {v.medicao.picoDb.toFixed(1)} dB ·
                    ganho {v.ganhoAplicadoDb >= 0 ? "+" : ""}{v.ganhoAplicadoDb.toFixed(1)} dB
                    {!alcancou && (
                      <span className="text-amber-300"> · não alcançou o alvo de {v.alvoLufs} LUFS</span>
                    )}
                  </div>
                </div>
                <button onClick={() => baixar(paraMp3(v.buffer), `${nome.replace(/\.[^.]+$/, "")} - ${v.rotulo}.mp3`)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-1">
                  <Download className="w-4 h-4" /> MP3
                </button>
                <button onClick={() => baixar(paraWav(v.buffer), `${nome.replace(/\.[^.]+$/, "")} - ${v.rotulo}.wav`)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
                  WAV
                </button>
                <button onClick={() => setVersoes((lista) => lista.filter((x) => x.id !== v.id))}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-red-300">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 5: Verificar no navegador**

Run: `cd minidaw-react && npm run dev`
Solte um MP3, escolha "Rádio FM/AM", clique em Masterizar.
Expected: aparece uma versão na pilha com o LUFS medido perto de −16; o play
toca; o download MP3 baixa um arquivo audível.
Gere também "PDV / carro de som" e confirme que ela mede perto de −9 e soa
nitidamente mais alta que a de rádio.

- [ ] **Step 6: Commit**

```bash
git add minidaw-react/src/components/MasterizarPanel.tsx
git commit -m "feat(master): presets por destino, geracao de versoes e pilha comparavel"
```

---

### Task 10: Faixa de referência

**Files:**
- Modify: `minidaw-react/src/components/MasterizarPanel.tsx`

- [ ] **Step 1: Acrescentar estado e carregamento da referência**

```tsx
  const [refNome, setRefNome] = useState("");
  const [refBalanco, setRefBalanco] = useState<number[] | null>(null);

  const carregarReferencia = useCallback(async (file: File) => {
    setErro("");
    try {
      const buf = await decodificar(file);
      setRefBalanco(medir(buf).balanco);
      setRefNome(file.name);
    } catch (e: any) {
      setErro(`Não consegui ler a referência "${file.name}". ${e?.message || ""}`);
    }
  }, []);
```

- [ ] **Step 2: Passar a referência para a masterização**

Em `gerar`, troque a linha `balancoReferencia: null,` por:

```tsx
        balancoReferencia: refBalanco,
```

E no rótulo da versão, troque `rotulo: d.rotulo,` por:

```tsx
          rotulo: refBalanco ? `${d.rotulo} + ref.` : d.rotulo,
```

- [ ] **Step 3: Acrescentar o controle na tela**

Logo abaixo do botão "Masterizar":

```tsx
          <div className="mt-4 pt-3 border-t border-white/10 text-sm">
            <div className="text-white/60 mb-1">Faixa de referência (opcional)</div>
            <p className="text-xs text-white/40 mb-2">
              Suba um jingle que você admira. O acabamento puxa o seu material na direção
              do equilíbrio dele — grave, médio e agudo. Não copia arranjo nem instrumento.
            </p>
            <label className="inline-block px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
              {refNome || "Escolher referência"}
              <input type="file" accept="audio/*" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarReferencia(f); }} />
            </label>
            {refBalanco && (
              <button onClick={() => { setRefBalanco(null); setRefNome(""); }}
                      className="ml-2 text-xs text-white/50 hover:text-white underline">
                remover
              </button>
            )}
          </div>
```

- [ ] **Step 4: Verificar no navegador**

Run: `cd minidaw-react && npm run dev`
Suba um jingle brilhante como referência e masterize um material abafado.
Expected: a versão gerada soa mais brilhante que a sem referência, e o rótulo
mostra "+ ref.". Com intensidade em 0, as duas soam iguais.

- [ ] **Step 5: Commit**

```bash
git add minidaw-react/src/components/MasterizarPanel.tsx
git commit -m "feat(master): faixa de referencia guiando o acabamento de tom"
```

---

### Task 11: Apagar o medidor falso

**Files:**
- Delete: `minidaw-react/src/components/LUFSMeter.tsx`

- [ ] **Step 1: Confirmar que ninguém usa**

Run: `cd minidaw-react && grep -rn "LUFSMeter" src --include=*.tsx --include=*.ts`
Expected: só o próprio arquivo aparece. Se aparecer outro, PARE e reporte.

- [ ] **Step 2: Apagar**

```bash
git rm minidaw-react/src/components/LUFSMeter.tsx
```

- [ ] **Step 3: Verificar o build**

Run: `cd minidaw-react && npx vite build`
Expected: build sem erro.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(master): apaga LUFSMeter morto que exibia LUFS fabricado

Nao era importado por ninguem. O numero vinha da media das barras do
getByteFrequencyData mapeada para -24..0 e rotulada LUFS -- nao era LUFS nem
RMS -- e o componente desenhava uma vez e congelava. Agora existe medicao de
verdade em src/lib/loudness.js, testada."
```

---

### Task 12: Build e publicação

**Files:**
- Modify: `templates/minidaw-react.html`
- Modify: `static/minidaw-react/index.html`

⚠️ **A armadilha desta etapa:** o build da React é manual e os hashes vivem em
DOIS arquivos. Atualizar só um entrega página velha em produção.

- [ ] **Step 1: Rodar a suíte completa antes de publicar**

Run: `node --test tests/clip-model.test.mjs tests/mix-engine-clips.test.mjs tests/loudness.test.mjs`
Expected: 0 falhas.

- [ ] **Step 2: Build**

```bash
cd minidaw-react && npm run build
```

- [ ] **Step 3: Copiar para static**

```bash
cp -r minidaw-react/dist/assets/* static/minidaw-react/assets/
```

Os arquivos antigos ficam para trás (o nome tem hash). Não apague no mesmo
commit: uma aba já aberta ainda pode estar pedindo o arquivo velho. Limpe os
hashes órfãos num commit posterior, quando ninguém mais estiver com a página
antiga carregada.

- [ ] **Step 4: Descobrir os nomes novos**

Run: `ls static/minidaw-react/assets/`
Anote o `index-XXXX.js` e o `index-XXXX.css` recém-criados.

- [ ] **Step 5: Atualizar os DOIS arquivos de hash**

Em `templates/minidaw-react.html` e em `static/minidaw-react/index.html`,
substitua os nomes antigos de `index-*.js` e `index-*.css` pelos novos.

- [ ] **Step 6: Conferir que os dois batem**

Run: `grep -o "index-[A-Za-z0-9_-]*\.\(js\|css\)" templates/minidaw-react.html static/minidaw-react/index.html | sort -u`
Expected: exatamente dois nomes distintos (um .js e um .css), e ambos existem
em `static/minidaw-react/assets/`.

- [ ] **Step 7: Commit e publicar**

```bash
git add static/minidaw-react templates/minidaw-react.html
git commit -m "build(master): publica aba Masterizar no Audio Pank Studio"
git push origin testes-local:main
```

- [ ] **Step 8: Confirmar que subiu**

Run: `git show origin/main:templates/minidaw-react.html | grep -o "index-[A-Za-z0-9_-]*\.js"`
Expected: o hash novo.

---

### Task 13: Verificação de ouvido (gate do produtor)

Sem código. É o critério de sucesso da spec.

- [ ] **Step 1: Pedir ao produtor o teste do Mauro Filho**

Ele já masterizou o "JINGLE MAURO FILHO 01-4455-Pankilhas" no Moises. Peça que
passe o MESMO arquivo original pela nossa aba, com destino Rádio, e compare as
duas saídas de ouvido, no mesmo volume.

- [ ] **Step 2: Anotar o veredito e calibrar**

Se ele disser que o nosso está mais fraco, mais duro ou mais abafado, o ajuste
é nos números de `src/lib/destinos.js` e na intensidade padrão — não na
arquitetura. Registre o valor final que ele aprovar, do mesmo jeito que o fade
final da clássica virou 3,05 s.

---

## Self-review

**Cobertura da spec:**

| Requisito da spec | Task |
|---|---|
| `loudness.js` puro e testável | 1, 2, 3 |
| Filtro K | 1 |
| LUFS integrado com os dois portões | 2 |
| Pico real por sobre-amostragem | 3 |
| Faixa dinâmica | 3 |
| Balanço tonal (base do match) | 3 |
| Alvos por destino | 4 |
| Match de referência em 4 bandas, teto ±6 dB | 5, 10 |
| Cadeia na ordem definida | 6 |
| Re-medição do resultado | 6 (e exibida na Task 9) |
| Aba própria aceitando qualquer arquivo | 8 |
| Pilha de versões comparáveis | 9 |
| Export WAV/MP3 | 7, 9 |
| Apagar LUFSMeter | 11 |
| Não tocar em mixer.ts | nenhuma task o modifica |
| Build manual com dois hashes | 12 |
| Empatar com o Moises de ouvido | 13 |

**Nomes conferidos entre tasks:** `medir`, `masterizar`, `canaisDe`
(mastering.js); `lufsIntegrado`, `picoRealDbTodos`, `faixaDinamica`,
`balancoTonal`, `BANDAS`, `filtroK` (loudness.js); `calcularCorrecao`,
`TETO_CORRECAO_DB` (correcaoTom.js); `DESTINOS`, `acharDestino` (destinos.js);
`decodificar`, `paraWav`, `paraMp3`, `baixar` (audioFile.js). Todos definidos
antes de serem usados.

**Sem placeholders:** nenhum passo diz "implementar depois" ou "tratar erros
apropriadamente"; todo passo de código traz o código.
