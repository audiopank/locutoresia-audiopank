// Voz fatiada por parágrafo na chegada à MiniDAW clássica (22/10/2026).
// Rodar: node --test tests/fatiar-paragrafos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FP = require('../static/fatiar-paragrafos.js');

const SR = 8000;
// Monta "fala" (seno) e pausas (silêncio com chiado baixinho), em segundos.
function locucao(partes) {
    const total = partes.reduce((s, p) => s + p.s, 0);
    const a = new Float32Array(Math.round(total * SR));
    let i = 0, sem = 1;
    for (const p of partes) {
        const n = Math.round(p.s * SR);
        for (let k = 0; k < n; k++, i++) {
            sem = (sem * 16807) % 2147483647;
            const chiado = (sem / 2147483647 - 0.5) * 0.002;        // ~−60 dB
            a[i] = p.fala ? 0.5 * Math.sin(2 * Math.PI * 220 * k / SR) + chiado : chiado;
        }
    }
    return a;
}
const fala = (s) => ({ fala: true, s });
const pausa = (s) => ({ fala: false, s });

test('contarParagrafos: cada linha com texto é um parágrafo; linhas vazias não contam', () => {
    assert.equal(FP.contarParagrafos('Tem coisa.\nÉ uma descoberta.\n\n  \nE a família.'), 3);
    assert.equal(FP.contarParagrafos('Uma linha só.'), 1);
    assert.equal(FP.contarParagrafos(''), 0);
    assert.equal(FP.contarParagrafos('A\r\nB\r\n'), 2);
});

test('acha os cortes no meio das pausas entre parágrafos', () => {
    // 3 parágrafos: pausas longas (0,6 s) entre eles; pausa curta (0,15 s) DENTRO do 2º
    const a = locucao([pausa(0.3), fala(2), pausa(0.6), fala(1), pausa(0.15), fala(1), pausa(0.6), fala(2), pausa(0.4)]);
    const cortes = FP.acharCortes(a, SR, 3);
    assert.equal(cortes.length, 2);
    assert.ok(Math.abs(cortes[0] - 2.6) < 0.05, `1º corte em ${cortes[0]}`);   // meio de 2,3–2,9
    assert.ok(Math.abs(cortes[1] - 5.35) < 0.05, `2º corte em ${cortes[1]}`);  // meio de 5,05–5,65
});

test('ignora o silêncio do começo e do fim', () => {
    const a = locucao([pausa(1.5), fala(1), pausa(0.5), fala(1), pausa(2)]);
    const cortes = FP.acharCortes(a, SR, 2);
    assert.equal(cortes.length, 1);
    assert.ok(Math.abs(cortes[0] - 2.75) < 0.05);
});

test('menos pausas que parágrafos: devolve só as que achou, em ordem', () => {
    const a = locucao([fala(1), pausa(0.5), fala(1)]);
    assert.deepEqual(FP.acharCortes(a, SR, 4).length, 1);
    assert.deepEqual(FP.acharCortes(a, SR, 1), []);
    assert.deepEqual(FP.acharCortes(new Float32Array(SR), SR, 3), []);   // só silêncio
});

test('cortes sempre em ordem crescente', () => {
    const a = locucao([fala(1), pausa(0.9), fala(1), pausa(0.3), fala(1), pausa(0.6), fala(1)]);
    const c = FP.acharCortes(a, SR, 4);
    assert.equal(c.length, 3);
    for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
});
