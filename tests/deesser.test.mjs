// tests/deesser.test.mjs — De-esser split-band da MiniDAW clássica (Suíte v2 D1, 22/09/2026).
// Rodar: node --test tests/deesser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const MixEngine = janela.MixEngine;

// AudioContext falso: só o que criarDeesser usa. Registra as conexões pra
// conferir a fiação do grafo sem navegador.
function contextoFalso() {
    const nos = [];
    const param = (v) => ({ value: v });
    const no = (tipo) => {
        const n = { tipo, saidas: [], connect(alvo) { this.saidas.push(alvo); return alvo; } };
        if (tipo === 'gain') n.gain = param(1);
        if (tipo === 'biquad') { n.type = ''; n.frequency = param(350); n.Q = param(1); n.gain = param(0); }
        if (tipo === 'comp') { n.threshold = param(-24); n.ratio = param(12); n.knee = param(30); n.attack = param(0.003); n.release = param(0.25); }
        nos.push(n);
        return n;
    };
    return {
        nos,
        createGain: () => no('gain'),
        createBiquadFilter: () => no('biquad'),
        createDynamicsCompressor: () => no('comp'),
    };
}

test('paramsDeesser: forca sobe, threshold desce, ratio sobe; makeup anulado; lixo = bypass', () => {
    const p1 = MixEngine.paramsDeesser(1), p5 = MixEngine.paramsDeesser(5), p10 = MixEngine.paramsDeesser(10);
    assert.ok(p1.ativo && p5.ativo && p10.ativo);
    assert.ok(p1.threshold > p5.threshold && p5.threshold > p10.threshold);
    assert.ok(p1.ratio < p5.ratio && p5.ratio < p10.ratio);
    assert.equal(p5.threshold, -33);
    assert.equal(p5.ratio, 7);
    assert.equal(p10.threshold, -48);                                  // força 10 quase limita a banda do sss
    assert.equal(p10.ratio, 12);
    assert.equal(p5.knee, 0);                                          // joelho 0: a conta do makeup fecha
    assert.ok(Math.abs(p5.compDb - 0.6 * -33 * (1 - 1 / 7)) < 1e-9);  // anula o makeup automático
    assert.ok(p1.attack <= 0.002 && p1.release <= 0.1);                 // "sss" é rápido
    // Fora da faixa: gruda nos limites.
    assert.deepEqual(MixEngine.paramsDeesser(50), p10);
    assert.deepEqual(MixEngine.paramsDeesser(0.2), p1);
    for (const lixo of [null, undefined, 0, -3, 'x', NaN]) {
        const b = MixEngine.paramsDeesser(lixo);
        assert.equal(b.ativo, false);
        assert.equal(b.ratio, 1);
        assert.equal(b.compDb, 0);
    }
});

test('criarDeesser: crossover LR4 em 5 kHz (2+2 biquads Q=1/√2), alta no compressor, baixa intacta, desligado = seco', () => {
    const ctx = contextoFalso();
    const de = MixEngine.criarDeesser(ctx);
    assert.equal(de.freqHz, 5000);
    for (const n of de.lp) { assert.equal(n.type, 'lowpass');  assert.equal(n.frequency.value, 5000); assert.ok(Math.abs(n.Q.value - Math.SQRT1_2) < 1e-12); }
    for (const n of de.hp) { assert.equal(n.type, 'highpass'); assert.equal(n.frequency.value, 5000); assert.ok(Math.abs(n.Q.value - Math.SQRT1_2) < 1e-12); }
    // Fiação: entrada → dry → saída; entrada → lp1 → lp2 → wet; entrada → hp1 → hp2 → comp → compGain → wet; wet → saída.
    assert.ok(de.input.saidas.includes(de.dry) && de.dry.saidas.includes(de.output));
    assert.ok(de.input.saidas.includes(de.lp[0]) && de.lp[0].saidas.includes(de.lp[1]) && de.lp[1].saidas.includes(de.wet));
    assert.ok(de.input.saidas.includes(de.hp[0]) && de.hp[0].saidas.includes(de.hp[1]) && de.hp[1].saidas.includes(de.comp));
    assert.ok(de.comp.saidas.includes(de.compGain) && de.compGain.saidas.includes(de.wet) && de.wet.saidas.includes(de.output));
    assert.ok(!de.lp[1].saidas.includes(de.comp));                    // a banda baixa NUNCA passa pelo compressor
    // Nasce desligado: seco 1, molhado 0, compressor em bypass.
    assert.equal(de.dry.gain.value, 1);
    assert.equal(de.wet.gain.value, 0);
    assert.equal(de.comp.ratio.value, 1);
    // Liga com força 5: seco 0, molhado 1, parâmetros e makeup anulado.
    const q = de.aplicar(MixEngine.paramsDeesser(5));
    assert.equal(de.dry.gain.value, 0);
    assert.equal(de.wet.gain.value, 1);
    assert.equal(de.comp.threshold.value, -33);
    assert.equal(de.comp.ratio.value, 7);
    // Faixa do sss ao vivo: os 4 biquads mudam; valor fora da lista é ignorado.
    assert.equal(de.setFreq(3500), 3500);
    for (const n of [...de.lp, ...de.hp]) assert.equal(n.frequency.value, 3500);
    assert.equal(de.setFreq(4200), 3500);
    for (const n of [...de.lp, ...de.hp]) assert.equal(n.frequency.value, 3500);
    assert.equal(MixEngine.criarDeesser(contextoFalso(), 6500).freqHz, 6500);
    assert.ok(Math.abs(de.compGain.gain.value - Math.pow(10, q.compDb / 20)) < 1e-12);
    // Desliga de novo: volta ao seco sem reconectar nada (mesmo número de nós).
    const antes = ctx.nos.length;
    de.aplicar(null);
    assert.equal(de.dry.gain.value, 1);
    assert.equal(de.wet.gain.value, 0);
    assert.equal(ctx.nos.length, antes);
});

test('forcaDeesserDaFaixa / freqDeesserDaFaixa: projeto antigo sem o campo = 5 e 5 kHz', () => {
    assert.equal(MixEngine.forcaDeesserDaFaixa({}), 5);
    assert.equal(MixEngine.forcaDeesserDaFaixa({ deesserSettings: { forca: 8 } }), 8);
    assert.equal(MixEngine.forcaDeesserDaFaixa({ deesserSettings: {} }), 5);
    assert.equal(MixEngine.forcaDeesserDaFaixa(null), 5);
    assert.equal(MixEngine.freqDeesserDaFaixa({}), 5000);
    assert.equal(MixEngine.freqDeesserDaFaixa({ deesserSettings: { freq: 3500 } }), 3500);
    assert.equal(MixEngine.freqDeesserDaFaixa({ deesserSettings: { freq: '6500' } }), 6500);   // vem do <select> como string
    assert.equal(MixEngine.freqDeesserDaFaixa({ deesserSettings: { freq: 4200 } }), 5000);
    assert.deepEqual(MixEngine.DEESSER_FREQS, [3500, 5000, 6500]);
});
