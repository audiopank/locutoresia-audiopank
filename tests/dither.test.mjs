// Dither na exportação do Masterizar (21/10/2026, pedido dele: "senti falta apenas dos dither").
// Rodar: node --test tests/dither.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizar16 } from '../minidaw-react/src/lib/dither.js';

const LSB = 1 / 32768;
function sorteio(semente = 1) {               // aleatório determinístico pro teste
    let s = semente;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function seno(n, amp, f = 440, sr = 44100) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * f * i / sr);
    return a;
}

test('sem dither: igual à conversão de antes (corta as casas decimais)', () => {
    const x = new Float32Array([0, 0.5, -0.5, 1, -1, 0.33333, -0.77777, 2, -2]);
    const antes = (v) => { v = Math.max(-1, Math.min(1, v)); return v < 0 ? Math.trunc(v * 0x8000) : Math.trunc(v * 0x7fff); };
    assert.deepEqual([...quantizar16(x, null)], [...x].map(antes));
});

test('TPDF: erro pequeno (no máximo 2 bits) e sem desvio médio', () => {
    const x = seno(44100, 0.5);
    const y = quantizar16(x, 'tpdf', sorteio(3));
    let soma = 0, maxErr = 0;
    for (let i = 0; i < x.length; i++) {
        const e = y[i] - x[i] * 32768;
        soma += e;
        maxErr = Math.max(maxErr, Math.abs(e));
    }
    assert.ok(maxErr <= 2.01, `erro máximo ${maxErr.toFixed(2)} LSB`);
    assert.ok(Math.abs(soma / x.length) < 0.05, 'sem desvio');
});

test('TPDF salva o som baixinho que a conversão seca apagava (final de fade)', () => {
    const x = seno(44100, 0.45 * LSB, 220);              // abaixo de 1 bit: some sem dither
    const seco = quantizar16(x, null);
    assert.ok(seco.every((v) => v === 0), 'sem dither: vira silêncio');
    const y = quantizar16(x, 'tpdf', sorteio(7));
    let corr = 0, ex = 0;
    for (let i = 0; i < x.length; i++) { corr += y[i] * x[i]; ex += x[i] * x[i]; }
    const ganho = corr / ex / 32768;                      // ≈ 1 se o seno sobreviveu no meio do ruído
    assert.ok(ganho > 0.7 && ganho < 1.3, `o seno sobrevive dentro do dither (${ganho.toFixed(2)})`);
});

test('noise shaping empurra o ruído pros agudos (menos ruído no grave/médio)', () => {
    const x = seno(44100 * 2, 0.3);
    const erro = (modo, sem) => { const y = quantizar16(x, modo, sorteio(sem)); return Float64Array.from(x, (v, i) => y[i] - v * 32768); };
    // energia do erro em baixa frequência ≈ média móvel de 32 amostras (passa-baixa)
    const baixas = (e) => { let s = 0, acc = 0; for (let i = 0; i < e.length; i++) { acc += e[i]; if (i >= 32) acc -= e[i - 32]; s += (acc / 32) ** 2; } return s; };
    const plano = baixas(erro('tpdf', 5)), moldado = baixas(erro('tpdf_shaped', 5));
    assert.ok(moldado < plano * 0.5, `ruído no grave/médio cai (plano ${plano.toFixed(0)} → moldado ${moldado.toFixed(0)})`);
});
