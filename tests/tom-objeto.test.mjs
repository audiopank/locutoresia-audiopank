// tests/tom-objeto.test.mjs — 🐥👹 Tom do objeto (pitch) na MiniDAW clássica (11/11/2026).
// Voz fininha (patinho) / grossa (monstro) SEM mudar a duração: WSOLA no fator×razão e reamostra.
// Rodar: node --test tests/tom-objeto.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TS = require('../static/time-stretch.js');
const SR = 44100;

function seno(hz, segundos) {
    const a = new Float32Array(Math.round(segundos * SR));
    for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / SR);
    return a;
}
function frequencia(x) {
    const ini = Math.floor(x.length * 0.1), fim = Math.floor(x.length * 0.9);
    let subidas = 0;
    for (let i = ini + 1; i < fim; i++) if (x[i - 1] <= 0 && x[i] > 0) subidas++;
    return subidas / ((fim - ini) / SR);
}
const perto = (a, b, tolRel) => assert.ok(Math.abs(a - b) <= b * tolRel, `${a.toFixed(1)} ≠ ${b.toFixed(1)}`);

test('semitons: livre com 1 casa decimal (−3,2 vale), limite ±12, lixo = 0', () => {
    assert.equal(TS.limitarSemitons(-3.2), -3.2);
    assert.equal(TS.limitarSemitons('-3.24'), -3.2);
    assert.equal(TS.limitarSemitons(20), 12);
    assert.equal(TS.limitarSemitons(-20), -12);
    assert.equal(TS.limitarSemitons('abc'), 0);
});

test('+12 semitons (patinho extremo): mesmo tempo, tom dobra', () => {
    const r = TS.processarCanais([seno(220, 1)], SR, 1, 12, 'voz');
    perto(r.length, SR, 0.01);
    perto(frequencia(r.canais[0]), 440, 0.03);
});

test('−3,2 semitons (monstro leve): mesmo tempo, tom desce 3,2 semitons', () => {
    const r = TS.processarCanais([seno(220, 1)], SR, 1, -3.2, 'voz');
    perto(r.length, SR, 0.01);
    perto(frequencia(r.canais[0]), 220 * Math.pow(2, -3.2 / 12), 0.03);
});

test('tom + Time Stretch juntos: dura o fator do stretch E muda o tom', () => {
    const r = TS.processarCanais([seno(220, 1)], SR, 0.8, 7, 'voz');
    perto(r.length, 0.8 * SR, 0.02);
    perto(frequencia(r.canais[0]), 220 * Math.pow(2, 7 / 12), 0.03);
});

test('cabeNoStretch: fator×razão precisa ficar em 0,5×–2× (o WSOLA não vai além)', () => {
    assert.ok(TS.cabeNoStretch(1, 12));
    assert.ok(TS.cabeNoStretch(1, -12));
    assert.ok(!TS.cabeNoStretch(1.5, 12));
    assert.ok(!TS.cabeNoStretch(0.6, -12));
});

test('camposEsticados guarda o tom e volta ao original com tom 0 e fator 1', () => {
    const original = { duration: 2 };
    const clip = { id: 'c', inicio: 1, offset: 0.5, duracao: 1, buffer: original };
    const base = TS.baseDoStretch(clip);
    const novo = { duration: 1 };
    const c1 = TS.camposEsticados(clip, base, novo, 1, -3.2);
    assert.deepEqual([c1.buffer, c1.stretch, c1.pitch, c1.origem.buffer], [novo, undefined, -3.2, original]);
    const c2 = TS.camposEsticados(Object.assign({}, clip, c1), base, null, 1, 0);
    assert.deepEqual([c2.buffer, c2.offset, c2.pitch, c2.origem], [original, 0.5, undefined, undefined]);
    const c3 = TS.camposEsticados(clip, base, novo, 0.8);          // Time Stretch puro, como antes
    assert.deepEqual([c3.stretch, c3.pitch], [0.8, undefined]);
});
