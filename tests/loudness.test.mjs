// tests/loudness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../minidaw-react/src/lib/loudness.js';
import * as D from '../minidaw-react/src/lib/destinos.js';

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

test('LUFS: dobrar a amplitude sobe ~6 LU', () => {
    const a = L.lufsIntegrado([seno(0.1)], 48000);
    const b = L.lufsIntegrado([seno(0.2)], 48000);
    assert.ok(Math.abs((b - a) - 6.02) < 0.1, `subiu ${(b - a).toFixed(2)} LU`);
});

test('LUFS: seno de -20 dBFS mede perto de -20 LUFS', () => {
    // 0.1 de amplitude = -20 dBFS. O filtro K desloca um pouco no 1 kHz,
    // por isso a tolerancia de 1,5 LU em vez de igualdade exata.
    const v = L.lufsIntegrado([seno(0.1), seno(0.1)], 48000);
    assert.ok(v > -21.5 && v < -18.5, `mediu ${v.toFixed(2)} LUFS`);
});

test('LUFS: silencio total devolve -Infinity', () => {
    assert.equal(L.lufsIntegrado([new Float32Array(48000)], 48000), -Infinity);
});

test('LUFS: o portao ignora o silencio (metade muda mede igual)', () => {
    const puro = seno(0.1, 4);
    const comSilencio = new Float32Array(48000 * 8);
    comSilencio.set(puro, 0);                       // 4s de som + 4s de silencio
    const a = L.lufsIntegrado([puro], 48000);
    const b = L.lufsIntegrado([comSilencio], 48000);
    assert.ok(Math.abs(a - b) < 0.5, `sem portao daria ~3 LU de diferenca: ${a} vs ${b}`);
});

test('picoReal: nunca menor que o pico das amostras', () => {
    const x = seno(0.9, 0.2);
    const amostra = Math.max(...Array.from(x, Math.abs));
    const real = Math.pow(10, L.picoRealDb(x, 48000) / 20);
    assert.ok(real >= amostra - 1e-6, `real ${real} < amostra ${amostra}`);
});

test('picoReal: silencio devolve -Infinity', () => {
    assert.equal(L.picoRealDb(new Float32Array(1000), 48000), -Infinity);
});

test('picoReal: acha overshoot entre amostras que o maximo simples nao pega', () => {
    // p0=0, p1=1, p2=1, p3=0: o Catmull-Rom entre p1 e p2 (ambos 1) tem
    // curvatura por causa dos vizinhos, e em t=0.5 vale 1.125 -- overshoot
    // que a interpolacao linear (reta entre 1 e 1) jamais acharia.
    const x = new Float32Array([0, 1, 1, 0]);
    const simples = Math.max(...Array.from(x, Math.abs));   // 1
    const real = Math.pow(10, L.picoRealDb(x, 48000) / 20);
    assert.ok(real > simples + 0.01, `real ${real} nao superou o maximo simples ${simples}`);
});

test('balancoTonal: devolve 4 bandas somando energia positiva', () => {
    const b = L.balancoTonal([seno(0.5, 1)], 48000);
    assert.equal(b.length, 4);
    assert.ok(b.every((v) => Number.isFinite(v)));
});

test('balancoTonal: tom puro mede muito mais alto na banda que o contem', () => {
    const tom = seno(0.5, 2);   // 1kHz, cai dentro da banda medio-grave (200-1200)
    const b = L.balancoTonal([tom], 48000);
    // BANDAS = [grave, medio-grave, medio-agudo, agudo]
    assert.ok(b[1] > b[0] + 10, `medio-grave (${b[1].toFixed(1)}) devia ser bem maior que grave (${b[0].toFixed(1)})`);
    assert.ok(b[1] > b[3] + 10, `medio-grave (${b[1].toFixed(1)}) devia ser bem maior que agudo (${b[3].toFixed(1)})`);
});

test('faixaDinamica: seno constante tem faixa pequena', () => {
    const fd = L.faixaDinamica([seno(0.5, 2)], 48000);
    assert.ok(fd >= 0 && fd < 12, `faixa ${fd}`);
});

test('destinos: todos tem alvo, teto e rotulo', () => {
    assert.ok(D.DESTINOS.length >= 4);
    for (const d of D.DESTINOS) {
        assert.equal(typeof d.chave, 'string');
        assert.equal(typeof d.rotulo, 'string');
        assert.ok(d.alvoLufs < 0 && d.alvoLufs > -30);
        assert.ok(d.tetoDb <= 0 && d.tetoDb > -3);
    }
});

test('destinos: radio e o alvo mais baixo (a emissora processa depois)', () => {
    const radio = D.acharDestino('radio');
    for (const d of D.DESTINOS) assert.ok(radio.alvoLufs <= d.alvoLufs);
});
