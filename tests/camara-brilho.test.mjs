// 🎻 Sala "Câmara" no reverb + ✨ Brilho (curva sorriso) — MiniDAW clássica (13/11/2026).
// Referência dele no REAPER: ReaFir em sorriso (médios −3 dB, ar forte) + Nectar 4 "Chamber tone".
// Cada opção liga/desliga; desligado = som IDÊNTICO ao de antes (Regra do Eudes).
// Rodar: node --test tests/camara-brilho.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const ME = janela.MixEngine;

function contextoFalso(sr) {
    const filtros = [];
    return {
        sampleRate: sr, filtros,
        createBuffer(canais, n, taxa) {
            const dados = Array.from({ length: canais }, () => new Float32Array(n));
            return { numberOfChannels: canais, length: n, sampleRate: taxa, getChannelData: (c) => dados[c] };
        },
        createBiquadFilter() {
            const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, ligado: [], connect(o) { this.ligado.push(o); return o; } };
            filtros.push(f);
            return f;
        },
    };
}
const rms = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / (i1 - i0)); };
const db = (x) => 20 * Math.log10(x + 1e-12);

test('salaDaFaixa reconhece "camara"; lixo continua Estúdio', () => {
    assert.deepEqual(ME.SALAS, ['estudio', 'plenario', 'camara']);
    assert.equal(ME.salaDaFaixa({ sala: 'camara' }), 'camara');
    assert.equal(ME.salaDaFaixa({ sala: 'catedral' }), 'estudio');
});

test('Câmara: determinística, estéreo, mais curta que o Plenário e diferente das outras', () => {
    const sr = 16000;
    const a = ME.criarImpulsoReverb(contextoFalso(sr), 'camara');
    const b = ME.criarImpulsoReverb(contextoFalso(sr), 'camara');
    assert.deepEqual(Array.from(a.getChannelData(0)), Array.from(b.getChannelData(0)));
    const L = a.getChannelData(0), R = a.getChannelData(1);
    assert.notDeepEqual(Array.from(L.slice(0, 4000)), Array.from(R.slice(0, 4000)));
    const pl = ME.criarImpulsoReverb(contextoFalso(sr), 'plenario');
    assert.ok(a.length < pl.length, 'câmara mais curta que o plenário');
    // pré-delay mudo, depois a sala; ~0,85 s depois a cauda já caiu muito
    const pre = Math.round(ME.CAMARA.PRE_DELAY_S * sr);
    assert.equal(rms(L, 0, pre - 1), 0);
    const ini = rms(L, pre, pre + 800), fim = rms(L, pre + Math.round(0.8 * sr), pre + Math.round(0.85 * sr));
    assert.ok(db(ini) - db(fim) > 40, `caiu ${(db(ini) - db(fim)).toFixed(1)} dB`);
    for (const v of L) assert.ok(Math.abs(v) <= 1.5);
});

test('Plenário continua o mesmo de antes (não mexi nele)', () => {
    const P = ME.PLENARIO;
    assert.equal(P.RT60_S, 1.2);
    assert.equal(P.PRE_DELAY_S, 0.018);
});

test('Envio da Câmara: só tira o grave do retorno (sala sem lama); Estúdio continua sem filtro', () => {
    const ctx = contextoFalso(16000);
    const env = ME.criarEnvioSala(ctx, 'camara');
    assert.equal(env.input, env.output);
    assert.equal(env.input.type, 'highpass');
    assert.equal(env.input.frequency.value, ME.CAMARA.ENVIO_HP_HZ);
    assert.equal(ME.criarEnvioSala(ctx, 'estudio'), null);
});

test('Brilho: médios −3 dB em 1 kHz + ar em 10 kHz; desligado = ganho 0 (som idêntico)', () => {
    const ctx = contextoFalso(48000);
    const b = ME.criarBrilho(ctx);
    const [meio, ar] = ctx.filtros;
    assert.equal(b.input, meio); assert.equal(b.output, ar);
    assert.ok(meio.ligado.includes(ar));
    assert.equal(meio.type, 'peaking'); assert.equal(meio.frequency.value, 1000);
    assert.equal(ar.type, 'highshelf'); assert.equal(ar.frequency.value, 10000);
    assert.equal(meio.gain.value, 0); assert.equal(ar.gain.value, 0);          // nasce desligado
    b.aplicar(true);
    assert.equal(meio.gain.value, -3); assert.equal(ar.gain.value, ME.BRILHO.AR_DB);
    assert.ok(ME.BRILHO.AR_DB > 0);
    b.aplicar(false);
    assert.equal(meio.gain.value, 0); assert.equal(ar.gain.value, 0);
});
