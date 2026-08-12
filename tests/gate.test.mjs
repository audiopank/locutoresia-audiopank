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
