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
