// tests/time-stretch.test.mjs — Time Stretch (WSOLA) da MiniDAW clássica.
// Rodar: node --test tests/time-stretch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TS = require('../static/time-stretch.js');

const SR = 44100;

// Seno puro: o tom é fácil de medir (cruzamentos por zero).
function seno(hz, segundos, amplitude = 0.5, sr = SR) {
    const n = Math.round(segundos * sr);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = amplitude * Math.sin(2 * Math.PI * hz * i / sr);
    return a;
}

// Frequência estimada pelos cruzamentos por zero (subidas) no miolo do sinal.
function frequencia(x, sr = SR) {
    const ini = Math.floor(x.length * 0.1), fim = Math.floor(x.length * 0.9);
    let subidas = 0;
    for (let i = ini + 1; i < fim; i++) if (x[i - 1] <= 0 && x[i] > 0) subidas++;
    return subidas / ((fim - ini) / sr);
}

// Amplitude de um seno estacionário em `hz` dentro de x (Goertzel).
function goertzel(x, hz, sr = SR) {
    const k = 2 * Math.PI * hz / sr, c = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
}

function rms(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
}

test('acelerar 37s -> 30s (0,81x): duracao encolhe e o TOM fica o mesmo', () => {
    const x = seno(220, 3.7);
    const fator = 30 / 37;
    const r = TS.esticarCanais([x], SR, fator);
    assert.equal(r.numberOfChannels, 1);
    assert.equal(r.length, Math.round(x.length * fator));           // 3,7 s viram 3,0 s
    const y = r.canais[0];
    assert.ok(y.every(Number.isFinite));
    const f = frequencia(y);
    assert.ok(Math.abs(f - 220) < 4, `tom mudou: ${f.toFixed(1)} Hz (playbackRate daria ${(220 / fator).toFixed(0)} Hz)`);
    assert.ok(Math.abs(rms(y) - rms(x)) / rms(x) < 0.1, `volume mudou: ${rms(y)} vs ${rms(x)}`);
    assert.ok(y.length >= 4 && Math.abs(y[Math.floor(y.length / 2)]) <= 0.5 + 1e-6);   // nada acima da amplitude original
});

test('desacelerar 1,25x: alonga sem mudar o tom', () => {
    const x = seno(330, 2.0);
    const r = TS.esticarCanais([x], SR, 1.25);
    assert.equal(r.length, Math.round(x.length * 1.25));
    const f = frequencia(r.canais[0]);
    assert.ok(Math.abs(f - 330) < 5, `tom mudou: ${f.toFixed(1)} Hz`);
});

test('fator 1 devolve copia identica (e nao a mesma referencia)', () => {
    const x = seno(440, 0.5);
    const r = TS.esticarCanais([x], SR, 1);
    assert.notEqual(r.canais[0], x);
    assert.deepEqual(Array.from(r.canais[0].subarray(0, 50)), Array.from(x.subarray(0, 50)));
});

test('estereo usa a mesma emenda nos dois canais', () => {
    const l = seno(200, 1.5), rch = seno(200, 1.5, 0.25);
    const r = TS.esticarCanais([l, rch], SR, 0.8);
    assert.equal(r.numberOfChannels, 2);
    // R = L/2 na entrada; se a emenda fosse escolhida por canal, essa relação quebraria.
    for (let i = 1000; i < r.length - 1000; i += 97) {
        assert.ok(Math.abs(r.canais[1][i] - r.canais[0][i] / 2) < 1e-4, `amostra ${i}`);
    }
});

test('perfil musica: janela maior, apressadinha de 8% na trilha sem mudar o tom (grave + acorde)', () => {
    assert.ok(TS.PERFIS.musica.janelaS > TS.PERFIS.voz.janelaS && TS.PERFIS.musica.buscaS > TS.PERFIS.voz.buscaS);
    // Grave de 65 Hz (o que faz o perfil de fala "bater") + um acorde por cima.
    const n = Math.round(3.0 * SR);
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / SR;
        l[i] = 0.3 * Math.sin(2 * Math.PI * 65 * t) + 0.15 * Math.sin(2 * Math.PI * 262 * t) + 0.1 * Math.sin(2 * Math.PI * 330 * t);
        r[i] = l[i] * 0.8;
    }
    const out = TS.esticarCanais([l, r], SR, 0.92, 'musica');
    assert.equal(out.length, Math.round(n * 0.92));
    assert.ok(out.canais[0].every(Number.isFinite));
    // Num acorde os cruzamentos por zero não medem tom; mede-se a energia de
    // cada nota (Goertzel) no miolo do resultado: as três notas continuam onde
    // estavam, e NÃO aparecem nas frequências pra onde o playbackRate as levaria.
    const meio = out.canais[0].subarray(Math.floor(out.length * 0.25), Math.floor(out.length * 0.75));
    for (const [hz, amp] of [[65, 0.3], [262, 0.15], [330, 0.1]]) {
        const a = goertzel(meio, hz), aSubido = goertzel(meio, hz / 0.92);
        assert.ok(Math.abs(a - amp) / amp < 0.2, `${hz} Hz: amplitude ${a.toFixed(3)} (era ${amp})`);
        assert.ok(aSubido < amp * 0.25, `${hz} Hz vazou pra ${(hz / 0.92).toFixed(1)} Hz: ${aSubido.toFixed(3)}`);
    }
    assert.ok(Math.abs(rms(out.canais[0]) - rms(l)) / rms(l) < 0.12, 'volume mudou');
    for (let i = 2000; i < out.length - 2000; i += 331) {
        assert.ok(Math.abs(out.canais[1][i] - out.canais[0][i] * 0.8) < 1e-4, `estéreo desalinhado na amostra ${i}`);
    }
    // Faixa "natural" da trilha é mais estreita que a da voz.
    assert.ok(TS.soaNatural(0.9, 'musica') && !TS.soaNatural(0.8, 'musica') && TS.soaNatural(0.8, 'voz'));
    assert.equal(TS.perfilDe('qualquer-coisa'), TS.PERFIS.voz);          // perfil desconhecido = fala
});

test('fator e limitado a 0,5x-2x e lixo vira 1', () => {
    assert.equal(TS.limitarFator(0.1), 0.5);
    assert.equal(TS.limitarFator(9), 2);
    assert.equal(TS.limitarFator(NaN), 1);
    assert.equal(TS.limitarFator(-2), 1);
    assert.equal(TS.limitarFator(0.83), 0.83);
    assert.ok(TS.soaNatural(0.83) && TS.soaNatural(1.2) && !TS.soaNatural(0.6) && !TS.soaNatural(1.6));
});

test('entrada vazia nao explode', () => {
    const r = TS.esticarCanais([new Float32Array(0)], SR, 0.8);
    assert.equal(r.length, 0);
});

test('clip: esticar de novo parte da ORIGEM (fator composto), aparo vai junto', () => {
    const original = { duration: 37 };
    const clip = { id: 'v', buffer: original, inicio: 2, offset: 1, duracao: 36, fadeIn: 0.2, fadeOut: 0.3 };
    // 1º stretch: 36 s -> 30 s
    let base = TS.baseDoStretch(clip);
    assert.deepEqual(base, { buffer: original, offset: 1, duracao: 36 });
    const fator1 = TS.fatorPara(clip, 30);
    assert.ok(Math.abs(fator1 - 30 / 36) < 1e-9);
    const esticado = { duration: 30 };
    Object.assign(clip, TS.camposEsticados(clip, base, esticado, fator1));
    assert.equal(clip.buffer, esticado);
    assert.equal(clip.offset, 0);
    assert.equal(clip.duracao, 30);
    assert.equal(clip.stretch, fator1);
    assert.deepEqual(clip.origem, { buffer: original, offset: 1, duracao: 36 });
    assert.equal(clip.inicio, 2);                                    // posição e fades ficam
    assert.equal(clip.fadeIn, 0.2);
    // Produtor apara 3 s do começo do clip ESTICADO (offset 3, duracao 27)…
    clip.offset = 3; clip.duracao = 27;
    // …e estica de novo: a base volta ao original, com o aparo convertido (3 s esticados = 3,6 s originais).
    base = TS.baseDoStretch(clip);
    assert.equal(base.buffer, original);
    assert.ok(Math.abs(base.offset - (1 + 3 / fator1)) < 1e-9);
    assert.ok(Math.abs(base.duracao - 27 / fator1) < 1e-9);
    // Voltar ao fator 1 devolve o áudio original (sem origem/stretch).
    const volta = TS.camposEsticados(clip, base, null, 1);
    assert.equal(volta.buffer, original);
    assert.equal(volta.stretch, undefined);
    assert.equal(volta.origem, undefined);
});
