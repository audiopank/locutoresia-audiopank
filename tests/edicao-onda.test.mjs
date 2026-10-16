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

// ── zoom + rolagem (17/10/2026) ─────────────────────────────────────────────
test('janelaVisivel: sem zoom mostra tudo; com zoom 4x e rolagem mostra 1/4', () => {
    assert.deepEqual(E.janelaVisivel(20, 1000, 1, 0), [0, 20]);
    assert.deepEqual(E.janelaVisivel(20, 1000, 4, 0), [0, 5]);
    assert.deepEqual(E.janelaVisivel(20, 1000, 4, 2000), [10, 15]);
    // rolagem além do fim é limitada
    assert.deepEqual(E.janelaVisivel(20, 1000, 4, 99999), [15, 20]);
});

test('rolagemParaAncora: o ponto do tempo fica no mesmo x da tela ao mudar o zoom', () => {
    // t=10 s no x=300 com zoom 8x: conteúdo de 8000 px, t=10 s está em 4000 px → rolagem 3700
    assert.equal(E.rolagemParaAncora(10, 300, 20, 1000, 8), 3700);
    assert.equal(E.rolagemParaAncora(0.1, 900, 20, 1000, 2), 0);        // não passa do começo
    assert.equal(E.rolagemParaAncora(19.9, 0, 20, 1000, 2), 1000);      // nem do fim
    const [t0, t1] = E.janelaVisivel(20, 1000, 8, 3700);
    assert.ok(Math.abs(t0 + (300 / 1000) * (t1 - t0) - 10) < 1e-9);
});

test('picosDaJanela: envelope só do trecho visível', () => {
    const canal = new Float32Array(1000);
    canal[750] = 0.9;   // pico em 75% do áudio
    const sr = 100;     // 10 s
    const p = E.picosDaJanela(canal, sr, 7, 8, 10);
    assert.equal(p.length, 10);
    assert.ok(p.some(([, mx]) => mx === Math.fround(0.9)));
    assert.ok(E.picosDaJanela(canal, sr, 0, 5, 10).every(([, mx]) => mx === 0));
});

// ── linha do tempo comum + mover objeto + ímã (17/10/2026) ─────────────────
test('picosDaFaixa: desenha o áudio só a partir do "Entra em"; fora dele é vazio (null)', () => {
    const sr = 100;
    const canal = new Float32Array(200).fill(0.5);   // 2 s de áudio
    const p = E.picosDaFaixa(canal, sr, 3, 0, 10, 10); // entra aos 3 s; tela 0–10 s em 10 px (1 s/px)
    assert.equal(p.length, 10);
    assert.equal(p[0], null);
    assert.equal(p[2], null);
    assert.deepEqual(p[3], [0.5, 0.5]);
    assert.deepEqual(p[4], [0.5, 0.5]);
    assert.equal(p[5], null);
});

test('imantar: gruda na marca mais perto dentro da tolerância; longe dela, fica onde soltou', () => {
    assert.equal(E.imantar(21.6, [0, 21.8, 23.7], 0.3), 21.8);
    assert.equal(E.imantar(22.5, [0, 21.8, 23.7], 0.3), 22.5);
    assert.equal(E.imantar(23.5, [21.8, 23.7], 0.3), 23.7);
    assert.equal(E.imantar(-2, [], 0.3), 0, 'nunca antes do zero');
});

test('totalDaLinha: fim da faixa mais longa + folga pra arrastar pra direita', () => {
    assert.equal(E.totalDaLinha([{ inicio: 0, duracao: 21.8 }, { inicio: 21.8, duracao: 10 }]), 31.8 + 5);
    assert.equal(E.totalDaLinha([]), 10);
});
