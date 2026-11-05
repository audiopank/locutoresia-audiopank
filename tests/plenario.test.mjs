// 🏛️ Ambiente "Plenário" no reverb da MiniDAW clássica (05/11/2026, pedido dele).
// A sala "Estúdio" (padrão) TEM que continuar idêntica (Regra do Eudes); o Plenário é
// uma sala média (~1,2 s) com pré-delay, primeiras reflexões e cauda que escurece, e o
// retorno passa por uma "cara de caixa de som" antes de entrar na sala.
// Rodar: node --test tests/plenario.test.mjs
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

test('salaDaFaixa: só "plenario" é Plenário; ausente ou lixo = Estúdio', () => {
    assert.equal(ME.salaDaFaixa({ sala: 'plenario' }), 'plenario');
    assert.equal(ME.salaDaFaixa({ sala: 'estudio' }), 'estudio');
    assert.equal(ME.salaDaFaixa({}), 'estudio');
    assert.equal(ME.salaDaFaixa({ sala: 'catedral' }), 'estudio');
    assert.equal(ME.salaDaFaixa(null), 'estudio');
});

test('Estúdio continua IDÊNTICO ao reverb de sempre (sem sala = com "estudio")', () => {
    const a = ME.criarImpulsoReverb(contextoFalso(8000));
    const b = ME.criarImpulsoReverb(contextoFalso(8000), 'estudio');
    assert.equal(a.length, b.length);
    for (let c = 0; c < 2; c++) {
        const x = a.getChannelData(c), y = b.getChannelData(c);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) assert.fail(`canal ${c} amostra ${i}`);
    }
    assert.equal(ME.criarEnvioSala(contextoFalso(8000), 'estudio'), null);   // sem filtro nenhum no caminho
});

test('Plenário: sala determinística (play = arquivo), estéreo e diferente do Estúdio', () => {
    const sr = 16000;
    const a = ME.criarImpulsoReverb(contextoFalso(sr), 'plenario');
    const b = ME.criarImpulsoReverb(contextoFalso(sr), 'plenario');
    assert.equal(a.length, Math.floor(sr * ME.PLENARIO.DURACAO_S));
    const e = a.getChannelData(0), d = a.getChannelData(1);
    for (let i = 0; i < e.length; i++) if (e[i] !== b.getChannelData(0)[i]) assert.fail('mudou entre duas criações');
    let iguais = 0;
    for (let i = 0; i < e.length; i++) if (e[i] === d[i]) iguais++;
    assert.ok(iguais < e.length * 0.2, 'esquerda e direita deviam ser diferentes');
});

test('Plenário: pré-delay mudo, reflexões logo depois e cauda que cai ~60 dB em ~1,2 s', () => {
    const sr = 16000, P = ME.PLENARIO;
    const ir = ME.criarImpulsoReverb(contextoFalso(sr), 'plenario').getChannelData(0);
    const pre = Math.round(P.PRE_DELAY_S * sr);
    assert.equal(rms(ir, 0, pre - 1), 0);                                   // a voz chega antes da sala
    assert.ok(rms(ir, pre, pre + Math.round(0.05 * sr)) > 0.05);           // primeiras reflexões
    const cedo = rms(ir, pre + Math.round(0.08 * sr), pre + Math.round(0.18 * sr));
    const tarde = rms(ir, pre + Math.round(1.18 * sr), pre + Math.round(1.28 * sr));
    const queda = db(cedo) - db(tarde);
    assert.ok(queda > 45 && queda < 75, `queda ${queda.toFixed(1)} dB`);
});

test('Plenário: a cauda escurece (perde agudo com o tempo, como sala com gente e cadeira)', () => {
    const sr = 48000, P = ME.PLENARIO;      // taxa real do navegador (a 16 kHz o 7 kHz já é quase Nyquist)
    const ir = ME.criarImpulsoReverb(contextoFalso(sr), 'plenario').getChannelData(0);
    const pre = Math.round(P.PRE_DELAY_S * sr);
    // agudo relativo = energia da diferença entre amostras / energia do sinal
    const brilho = (t0, t1) => {
        const i0 = pre + Math.round(t0 * sr), i1 = pre + Math.round(t1 * sr);
        let s = 0, df = 0;
        for (let i = i0 + 1; i < i1; i++) { s += ir[i] * ir[i]; df += (ir[i] - ir[i - 1]) ** 2; }
        return df / s;
    };
    const cedo = brilho(0.06, 0.2), meio = brilho(0.6, 0.9), fim = brilho(1.0, 1.2);
    assert.ok(meio < cedo * 0.8 && fim < meio * 0.8 && fim < cedo * 0.6,
        `a cauda devia escurecer sem parar: ${cedo.toFixed(2)} → ${meio.toFixed(2)} → ${fim.toFixed(2)}`);
});

test('Envio do Plenário: cara de caixa de som (corta grave e agudo extremo, realça o meio)', () => {
    const ctx = contextoFalso(48000);
    const env = ME.criarEnvioSala(ctx, 'plenario');
    assert.ok(env && env.input && env.output);
    const [hp, meio, lp] = ctx.filtros;
    assert.equal(env.input, hp);
    assert.equal(env.output, lp);
    assert.deepEqual([hp.type, hp.frequency.value], ['highpass', ME.PLENARIO.CAIXA_HP_HZ]);
    assert.deepEqual([meio.type, meio.frequency.value, meio.gain.value], ['peaking', ME.PLENARIO.CAIXA_MEIO_HZ, ME.PLENARIO.CAIXA_MEIO_DB]);
    assert.deepEqual([lp.type, lp.frequency.value], ['lowpass', ME.PLENARIO.CAIXA_LP_HZ]);
    assert.deepEqual([hp.ligado[0], meio.ligado[0]], [meio, lp]);          // hp → meio → lp
});
