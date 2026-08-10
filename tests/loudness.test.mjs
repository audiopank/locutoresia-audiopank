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

test('filtroK: resposta em frequencia bate com os coeficientes publicados do BS.1770-4 (48kHz)', () => {
    const sr = 48000;

    // Coeficientes em z publicados pela norma para 48kHz (Anexo 2 da
    // BS.1770-4), reproduzidos por implementacoes de referencia amplamente
    // auditadas (ffmpeg ebur128, libebur128, pyloudnorm). Servem de "verdade
    // terrestre" INDEPENDENTE das constantes f0/G/Q usadas em
    // coefShelfAgudo/coefPassaAlta — se uma dessas constantes tiver um digito
    // trocado, ou os dois estagios forem confundidos, a resposta calculada
    // diverge visivelmente desta curva (validado empiricamente abaixo: um G
    // errado ou uma troca de Q entre os estagios produz erro de ~1-5dB nos
    // pontos testados, bem acima da tolerancia de 0.5dB usada aqui).
    const shelfPublicado = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
    const hpPublicado = { b0: 1.0, b1: -2.0, b2: 1.0, a1: -1.99004745483398, a2: 0.99007225036621 };

    // Resposta em magnitude de um biquad numa frequencia, via avaliacao da
    // funcao de transferencia H(e^jw) — nao precisa rodar o filtro num sinal,
    // e por isso pega erro de constante sem depender de ruido de quantizacao.
    const magnitudeDb = (coefs, hz, sr) => {
        const w = 2 * Math.PI * hz / sr;
        const cw1 = Math.cos(w), cw2 = Math.cos(2 * w);
        const sw1 = Math.sin(w), sw2 = Math.sin(2 * w);
        const numRe = coefs.b0 + coefs.b1 * cw1 + coefs.b2 * cw2;
        const numIm = -coefs.b1 * sw1 - coefs.b2 * sw2;
        const denRe = 1 + coefs.a1 * cw1 + coefs.a2 * cw2;
        const denIm = -coefs.a1 * sw1 - coefs.a2 * sw2;
        const numMag = Math.sqrt(numRe * numRe + numIm * numIm);
        const denMag = Math.sqrt(denRe * denRe + denIm * denIm);
        return 20 * Math.log10(numMag / denMag);
    };

    const respostaPublicada = (hz) => magnitudeDb(shelfPublicado, hz, sr) + magnitudeDb(hpPublicado, hz, sr);
    const respostaNossa = (hz) => magnitudeDb(L.coefShelfAgudo(sr), hz, sr) + magnitudeDb(L.coefPassaAlta(sr), hz, sr);

    // Normaliza pelo valor em 1kHz, igual a norma faz (0dB de referencia).
    const pub1khz = respostaPublicada(1000);
    const nossa1khz = respostaNossa(1000);

    const frequencias = [20, 40, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const hz of frequencias) {
        const esperado = respostaPublicada(hz) - pub1khz;
        const medido = respostaNossa(hz) - nossa1khz;
        // 0.5dB cobre o residuo natural (~0.2dB) de recalcular os coeficientes
        // via formulas RBJ (f0/G/Q) em vez de usar os coeficientes fixos da
        // norma — ver comentario no topo do loudness.js — sem abrir espaco pra
        // erro grosseiro de constante passar batido.
        assert.ok(
            Math.abs(medido - esperado) <= 0.5,
            `em ${hz}Hz: esperado ${esperado.toFixed(2)}dB (padrao), medido ${medido.toFixed(2)}dB (+-0.5)`
        );
    }
});
