// tests/multimax.test.mjs — MultiMax (compressor de 3 bandas do master), Suíte v2 D2 (22/09/2026).
// Rodar: node --test tests/multimax.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const MixEngine = janela.MixEngine;

function contextoFalso() {
    const nos = [];
    const param = (v) => ({ value: v });
    const no = (tipo) => {
        const n = { tipo, saidas: [], connect(alvo) { this.saidas.push(alvo); return alvo; } };
        if (tipo === 'gain') n.gain = param(1);
        if (tipo === 'biquad') { n.type = ''; n.frequency = param(350); n.Q = param(1); n.gain = param(0); }
        if (tipo === 'comp') { n.threshold = param(-24); n.ratio = param(12); n.knee = param(30); n.attack = param(0.003); n.release = param(0.25); n.reduction = 0; }
        nos.push(n);
        return n;
    };
    return { nos, createGain: () => no('gain'), createBiquadFilter: () => no('biquad'), createDynamicsCompressor: () => no('comp') };
}

test('presets: 7 do Samplitude, todos sãos (limiar ≤ 0, ratio ≥ 1, ganho moderado), padrão = Loudness médio', () => {
    const P = MixEngine.PRESETS_MULTIMAX;
    assert.equal(P.length, 7);
    assert.deepEqual(P.map(p => p.chave), ['loud1', 'loud2', 'loud3', 'radio', 'presenca', 'graves', 'sib']);
    for (const p of P) {
        assert.equal(p.bandas.length, 3, p.chave);
        for (const [thr, ratio, ganho] of p.bandas) {
            assert.ok(thr <= -20 && thr >= -40, `${p.chave} limiar ${thr}`);
            assert.ok(ratio >= 1.5 && ratio <= 8, `${p.chave} ratio ${ratio}`);
            assert.ok(ganho >= 0 && ganho <= 3, `${p.chave} ganho ${ganho}`);   // o limiter vem depois: nada de +10
        }
        assert.ok(p.rotulo && p.dica);
    }
    assert.equal(MixEngine.MULTIMAX_PRESET_PADRAO, 'loud2');
    assert.equal(MixEngine.presetMultimax('nao-existe').chave, 'loud2');
    // Loudness sobe em intensidade; "Voz sibilante" só morde o agudo.
    const [l1, l2, l3] = ['loud1', 'loud2', 'loud3'].map(MixEngine.presetMultimax);
    assert.ok(l1.bandas[1][0] > l2.bandas[1][0] && l2.bandas[1][0] > l3.bandas[1][0]);
    const sib = MixEngine.presetMultimax('sib');
    assert.ok(sib.bandas[2][1] >= 5 && sib.bandas[0][1] <= 2.5);
});

test('paramsMultimax: makeup anulado por banda, ganho do preset + knob (±6), ataque grave lento / agudo rápido', () => {
    const q = MixEngine.paramsMultimax('loud2', [1, -2, 9]);
    assert.equal(q.ativo, true);
    assert.deepEqual(q.cortes, [100, 5000]);
    assert.equal(q.bandas.length, 3);
    assert.equal(q.bandas[0].threshold, -28);
    assert.equal(q.bandas[0].ratio, 3);
    assert.ok(Math.abs(q.bandas[0].compDb - 0.6 * -28 * (1 - 1 / 3)) < 1e-9);
    assert.equal(q.bandas[0].ganhoDb, 2 + 1);          // preset +2 e knob +1
    assert.equal(q.bandas[1].ganhoDb, 1.5 - 2);
    assert.equal(q.bandas[2].ganhoDb, 1.5 + 6);        // knob 9 gruda em +6
    assert.ok(q.bandas[0].attack > q.bandas[1].attack && q.bandas[1].attack > q.bandas[2].attack);
    assert.ok(q.bandas[0].release > q.bandas[2].release);
    for (const b of q.bandas) assert.equal(b.knee, 0);  // joelho 0: a conta do makeup fecha
    // Sem knobs = só o preset; preset inválido = padrão.
    assert.equal(MixEngine.paramsMultimax('loud1').bandas[0].ganhoDb, 1);
    assert.equal(MixEngine.paramsMultimax('zzz', null).preset, 'loud2');
});

test('criarMultiband: crossover LR4 3 vias (8 biquads Q=1/√2), 1 compressor por banda, desligado = seco, reduções por banda', () => {
    const ctx = contextoFalso();
    const mb = MixEngine.criarMultiband(ctx);
    assert.deepEqual(mb.cortes, [100, 5000]);
    const F = mb.filtros;
    for (const n of F.low)  { assert.equal(n.type, 'lowpass');  assert.equal(n.frequency.value, 100); }
    for (const n of F.rest) { assert.equal(n.type, 'highpass'); assert.equal(n.frequency.value, 100); }
    for (const n of F.mid)  { assert.equal(n.type, 'lowpass');  assert.equal(n.frequency.value, 5000); }
    for (const n of F.hi)   { assert.equal(n.type, 'highpass'); assert.equal(n.frequency.value, 5000); }
    for (const n of [...F.low, ...F.rest, ...F.mid, ...F.hi]) assert.ok(Math.abs(n.Q.value - Math.SQRT1_2) < 1e-12);
    // Fiação: entrada → low[0] → low[1] → comp0; entrada → rest[0] → rest[1] → (mid[0] → mid[1] → comp1 | hi[0] → hi[1] → comp2); cada comp → gain → wet → saída.
    assert.ok(mb.input.saidas.includes(F.low[0]) && F.low[0].saidas.includes(F.low[1]) && F.low[1].saidas.includes(mb.bandas[0].comp));
    assert.ok(mb.input.saidas.includes(F.rest[0]) && F.rest[0].saidas.includes(F.rest[1]));
    assert.ok(F.rest[1].saidas.includes(F.mid[0]) && F.mid[0].saidas.includes(F.mid[1]) && F.mid[1].saidas.includes(mb.bandas[1].comp));
    assert.ok(F.rest[1].saidas.includes(F.hi[0]) && F.hi[0].saidas.includes(F.hi[1]) && F.hi[1].saidas.includes(mb.bandas[2].comp));
    for (const b of mb.bandas) assert.ok(b.comp.saidas.includes(b.gain) && b.gain.saidas.includes(mb.wet));
    assert.ok(mb.wet.saidas.includes(mb.output) && mb.input.saidas.includes(mb.dry) && mb.dry.saidas.includes(mb.output));
    assert.equal(ctx.nos.filter(n => n.tipo === 'comp').length, 3);
    // Nasce desligado.
    assert.equal(mb.dry.gain.value, 1);
    assert.equal(mb.wet.gain.value, 0);
    for (const b of mb.bandas) { assert.equal(b.comp.ratio.value, 1); assert.equal(b.gain.gain.value, 1); }
    // Liga com o preset Rádio + knob no grave.
    const q = MixEngine.paramsMultimax('radio', [2, 0, 0]);
    assert.equal(mb.aplicar(q), true);
    assert.equal(mb.dry.gain.value, 0);
    assert.equal(mb.wet.gain.value, 1);
    assert.equal(mb.bandas[0].comp.threshold.value, -30);
    assert.equal(mb.bandas[1].comp.ratio.value, 2.5);
    assert.ok(Math.abs(mb.bandas[0].gain.gain.value - Math.pow(10, (q.bandas[0].compDb + q.bandas[0].ganhoDb) / 20)) < 1e-12);
    // Reduções lidas do compressor de cada banda.
    mb.bandas[1].comp.reduction = -4.2;
    assert.deepEqual(mb.reducoes(), [0, -4.2, 0]);
    // Desliga: seco, sem reconectar nada.
    const antes = ctx.nos.length;
    assert.equal(mb.aplicar(null), false);
    assert.equal(mb.dry.gain.value, 1);
    assert.equal(mb.wet.gain.value, 0);
    assert.equal(ctx.nos.length, antes);
});
