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
