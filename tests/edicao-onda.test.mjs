// Onda real + cortar/silenciar trecho na MiniDAW React (17/10/2026).
// Rodar: node --test tests/edicao-onda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../minidaw-react/src/lib/edicaoOnda.js';

const SR = 1000;   // 1 amostra = 1 ms, conta fácil

function rampa(n, valor = 1) {
    return new Float32Array(n).fill(valor);
}

test('picos: um par [min, max] por pixel, do envelope real (não aleatório)', () => {
    const canal = new Float32Array([0, 0.5, -0.25, 0, 1, -1, 0.1, 0.2]);
    const p = E.picos(canal, 4);
    assert.equal(p.length, 4);
    assert.deepEqual(p[0], [0, 0.5]);
    assert.deepEqual(p[1], [-0.25, 0]);
    assert.deepEqual(p[2], [-1, 1]);
    assert.deepEqual(p[3], [0.1, 0.2].map(Math.fround).sort((a, b) => a - b));
    // Mesma entrada, mesma saída (o componente antigo usava Math.random).
    assert.deepEqual(E.picos(canal, 4), p);
});

test('picos: mais pixels que amostras não quebra', () => {
    const p = E.picos(new Float32Array([0.5, -0.5]), 6);
    assert.equal(p.length, 6);
    p.forEach(([mn, mx]) => assert.ok(mn <= mx));
});

test('cortarTrecho: remove o trecho e junta as pontas, em todos os canais', () => {
    const esq = rampa(1000), dir = rampa(1000, 0.5);
    const [a, b] = E.cortarTrecho([esq, dir], SR, 0.3, 0.5, 0);   // sem fade: conta exata
    assert.equal(a.length, 800);
    assert.equal(b.length, 800);
    assert.equal(a[299], 1);
    assert.equal(b[300], 0.5);
});

test('cortarTrecho: micro-fade nas pontas da emenda (sem estalo)', () => {
    const [a] = E.cortarTrecho([rampa(1000)], SR, 0.3, 0.5, 10);   // 10 ms = 10 amostras
    assert.equal(a.length, 800);
    assert.ok(a[299] < 0.2, 'fim antes do corte desce até perto de zero');
    assert.ok(a[300] < 0.2, 'começo depois do corte sobe de perto de zero');
    assert.equal(a[289], 1, 'fora do fade fica intacto');
    assert.equal(a[310], 1);
});

test('cortarTrecho: não deixa cortar o áudio inteiro nem trecho vazio', () => {
    assert.throws(() => E.cortarTrecho([rampa(1000)], SR, 0, 1, 10), /inteiro/);
    assert.throws(() => E.cortarTrecho([rampa(1000)], SR, 0.5, 0.5, 10), /trecho/i);
});

test('silenciarTrecho: mantém a duração e zera o meio, com fade nas bordas', () => {
    const orig = rampa(1000);
    const [a] = E.silenciarTrecho([orig], SR, 0.3, 0.5, 10);
    assert.equal(a.length, 1000);
    assert.equal(a[400], 0);
    assert.equal(a[300], 0);
    assert.equal(a[499], 0);
    assert.ok(a[295] < 1 && a[295] > 0, 'desce suave antes');
    assert.ok(a[505] < 1 && a[505] > 0, 'sobe suave depois');
    assert.equal(a[200], 1);
    assert.equal(a[700], 1);
    assert.equal(orig[400], 1, 'não mexe no original (o Desfazer depende dele)');
});

test('trechoValido: ordena, limita à duração e recusa trecho menor que 20 ms', () => {
    assert.deepEqual(E.trechoValido(5, 2, 10), [2, 5]);
    assert.deepEqual(E.trechoValido(-1, 3, 10), [0, 3]);
    assert.deepEqual(E.trechoValido(8, 12, 10), [8, 10]);
    assert.equal(E.trechoValido(2, 2.01, 10), null);
});
