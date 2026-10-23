// Gravação ao vivo (botão ● na faixa) da MiniDAW clássica (24/10/2026).
// Rodar: node --test tests/gravacao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../static/gravacao.js');

test('wav24: cabeçalho certo e amostras em 24 bits (mono, 48 kHz)', () => {
    const buf = G.wav24([new Float32Array([0, 1, -1, 0.5])], 48000);
    const v = new DataView(buf);
    const txt = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
    assert.equal(txt(0, 4), 'RIFF');
    assert.equal(txt(8, 4), 'WAVE');
    assert.equal(v.getUint16(20, true), 1);        // PCM
    assert.equal(v.getUint16(22, true), 1);        // 1 canal
    assert.equal(v.getUint32(24, true), 48000);
    assert.equal(v.getUint16(34, true), 24);       // 24 bits
    assert.equal(v.getUint32(40, true), 4 * 3);    // 4 amostras × 3 bytes
    const a = (i) => { const o = 44 + i * 3; let x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); return x & 0x800000 ? x - 0x1000000 : x; };
    assert.deepEqual([a(0), a(1), a(2), a(3)], [0, 8388607, -8388608, 4194304]);
    assert.equal(buf.byteLength, 44 + 12);
});

test('posicionarTake: desconta o atraso de entrada+saída', () => {
    // Play começou com o 0:00 do projeto no instante 10,0 do relógio; cursor em 5 s → o
    // 1º bloco gravado chegou no instante 15,0; atraso total 40 ms.
    const p = G.posicionarTake(15.0, 10.0, 0.040, 48000);
    assert.ok(Math.abs(p.inicio - 4.96) < 1e-9);
    assert.equal(p.descartar, 0);
});

test('posicionarTake: nunca antes do 0:00 (descarta o que sobrar no começo)', () => {
    const p = G.posicionarTake(10.01, 10.0, 0.040, 48000);   // cursor em 0, atraso 40 ms
    assert.equal(p.inicio, 0);
    assert.equal(p.descartar, Math.round(0.030 * 48000));
});

test('sobrepoe: take cai em cima de voz que já existe?', () => {
    const clips = [{ inicio: 0, duracao: 3 }, { inicio: 10, duracao: 2 }];
    assert.equal(G.sobrepoe(clips, 3, 9.99), false);   // no vão
    assert.equal(G.sobrepoe(clips, 2.5, 4), true);
    assert.equal(G.sobrepoe(clips, 11, 20), true);
    assert.equal(G.sobrepoe([], 0, 30), false);
});

test('nomeDoTake: data, hora e faixa, sem caractere proibido no Windows', () => {
    const n = G.nomeDoTake(new Date(2026, 9, 24, 9, 5, 7), 'Voz 1 / Crato: 30"', 3);
    assert.equal(n, 'Take 3 - Voz 1 - Crato - 30 - 2026-10-24 09h05m07s.wav');
});

test('picoDb: pico em dBFS; silêncio = -Infinity', () => {
    assert.equal(G.picoDb(new Float32Array([0, 0.5, -1])), 0);
    assert.ok(Math.abs(G.picoDb(new Float32Array([0.5])) - (-6.0206)) < 1e-3);
    assert.equal(G.picoDb(new Float32Array([0, 0])), -Infinity);
});

// ── 24/10/2026: placa USB com o microfone na ENTRADA 2 (o take saía mudo) ──
test('escolherCanal: automático pega a entrada que tem voz', () => {
    assert.deepEqual(G.escolherCanal([1e-8, 0.02], 'auto'), { modo: 'canal', canal: 1 });   // mic na entrada 2
    assert.deepEqual(G.escolherCanal([0.02, 1e-8], 'auto'), { modo: 'canal', canal: 0 });
    assert.deepEqual(G.escolherCanal([0.02, 0.015], 'auto'), { modo: 'mistura' });          // as duas com sinal
    assert.deepEqual(G.escolherCanal([0.02], 'auto'), { modo: 'canal', canal: 0 });         // mono
    assert.deepEqual(G.escolherCanal([1e-8, 0.02], '0'), { modo: 'canal', canal: 0 });      // travado na entrada 1
    assert.deepEqual(G.escolherCanal([0.02], '1'), { modo: 'canal', canal: 0 });            // pediu a 2, só existe 1
});

test('juntarCanais: mistura = média; canal = cópia daquele', () => {
    const c = [new Float32Array([0.2, 0.4]), new Float32Array([0.0, 0.2])];
    assert.deepEqual(Array.from(G.juntarCanais(c, { modo: 'mistura' })).map(v => +v.toFixed(2)), [0.1, 0.3]);
    assert.deepEqual(Array.from(G.juntarCanais(c, { modo: 'canal', canal: 1 })).map(v => +v.toFixed(2)), [0, 0.2]);
});
