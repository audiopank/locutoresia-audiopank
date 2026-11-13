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

test('Câmara: determinística, estéreo, cauda ~1,4 s (13/11: a de 0,85 s "não mudava quase nada")', () => {
    const sr = 16000;
    const a = ME.criarImpulsoReverb(contextoFalso(sr), 'camara');
    const b = ME.criarImpulsoReverb(contextoFalso(sr), 'camara');
    assert.deepEqual(Array.from(a.getChannelData(0)), Array.from(b.getChannelData(0)));
    const L = a.getChannelData(0), R = a.getChannelData(1);
    assert.notDeepEqual(Array.from(L.slice(0, 4000)), Array.from(R.slice(0, 4000)));
    assert.ok(a.length <= ME.REVERB_DURACAO_S * sr, 'não passa da sala Estúdio');
    // pré-delay mudo, depois a sala; em 0,8 s cai uns 30-40 dB (RT60 ~1,4 s): cauda que se ouve
    const pre = Math.round(ME.CAMARA.PRE_DELAY_S * sr);
    assert.ok(ME.CAMARA.PRE_DELAY_S >= 0.02, 'pré-delay separa a sala da voz');
    assert.equal(rms(L, 0, pre - 1), 0);
    const ini = rms(L, pre, pre + 800), fim = rms(L, pre + Math.round(0.8 * sr), pre + Math.round(0.85 * sr));
    const queda = db(ini) - db(fim);
    assert.ok(queda > 25 && queda < 45, `caiu ${queda.toFixed(1)} dB`);
    for (const v of L) assert.ok(Math.abs(v) <= 1.5);
});

test('Plenário continua o mesmo de antes (não mexi nele)', () => {
    const P = ME.PLENARIO;
    assert.equal(P.RT60_S, 1.2);
    assert.equal(P.PRE_DELAY_S, 0.018);
});

test('Envio da Câmara: tira o grave do retorno (sala sem lama) e entra +8 dB; Estúdio continua sem filtro', () => {
    const ctx = contextoFalso(16000);
    ctx.createGain = () => ({ gain: { value: 1 }, connect(o) { return o; } });
    const env = ME.criarEnvioSala(ctx, 'camara');
    assert.equal(env.input.type, 'highpass');
    assert.equal(env.input.frequency.value, ME.CAMARA.ENVIO_HP_HZ);
    assert.ok(env.input.ligado.includes(env.output));
    assert.ok(Math.abs(env.output.gain.value - Math.pow(10, 8 / 20)) < 1e-9);
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
    b.aplicar(true);                                                           // sem quantidade = padrão 40% = +5 dB (o de antes)
    assert.equal(meio.gain.value, -3); assert.equal(ar.gain.value, 5);
    b.aplicar(false);
    assert.equal(meio.gain.value, 0); assert.equal(ar.gain.value, 0);
});

test('Brilho — intensidade (13/11): 0–100% mexe só no ar, até +12,5 dB; desligado ignora o slider', () => {
    const ctx = contextoFalso(48000);
    const b = ME.criarBrilho(ctx);
    const [meio, ar] = ctx.filtros;
    b.aplicar(true, 1);    assert.equal(ar.gain.value, 12.5); assert.equal(meio.gain.value, -3);
    b.aplicar(true, 0.6);  assert.ok(Math.abs(ar.gain.value - 7.5) < 1e-9);
    b.aplicar(true, 0);    assert.equal(ar.gain.value, 0);  assert.equal(meio.gain.value, -3);   // 0% = só tira o fanho
    b.aplicar(false, 1);   assert.equal(ar.gain.value, 0);  assert.equal(meio.gain.value, 0);
    // quantidade da faixa: ausente/lixo = 40% (projeto de antes soa igual), limite 0..1, 0 vale
    assert.equal(ME.quantidadeBrilhoDaFaixa({}), 0.4);
    assert.equal(ME.quantidadeBrilhoDaFaixa(null), 0.4);
    assert.equal(ME.quantidadeBrilhoDaFaixa({ brilhoAmount: 'x' }), 0.4);
    assert.equal(ME.quantidadeBrilhoDaFaixa({ brilhoAmount: 0 }), 0);
    assert.equal(ME.quantidadeBrilhoDaFaixa({ brilhoAmount: 3 }), 1);
    assert.equal(ME.quantidadeBrilhoDaFaixa({ brilhoAmount: 0.75 }), 0.75);
});
