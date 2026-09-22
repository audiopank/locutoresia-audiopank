// tests/largura.test.mjs — largura estéreo (Mid/Side) da MiniDAW clássica, Suíte v2 D3 (22/09/2026).
// Rodar: node --test tests/largura.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const MixEngine = janela.MixEngine;

function contextoFalso() {
    const nos = [];
    const no = (tipo) => {
        const n = { tipo, saidas: [], connect(alvo, out, inp) { this.saidas.push({ alvo, out, inp }); return alvo; } };
        if (tipo === 'gain') n.gain = { value: 1 };
        nos.push(n);
        return n;
    };
    return {
        nos,
        createGain: () => no('gain'),
        createChannelSplitter: (n) => Object.assign(no('splitter'), { canais: n }),
        createChannelMerger: (n) => Object.assign(no('merger'), { canais: n }),
    };
}
const liga = (a, b) => a.saidas.some(s => s.alvo === b);

test('criarLargura: M/S com S × largura; largura 1 = seco; 0 = mono; 2 = aberto; lixo = 1', () => {
    const ctx = contextoFalso();
    const lg = MixEngine.criarLargura(ctx);
    // Nasce seco.
    assert.equal(lg.largura, 1);
    assert.equal(lg.dry.gain.value, 1);
    assert.equal(lg.wet.gain.value, 0);
    // Fiação: entrada → dry → saída; entrada → splitter; L (0) → lM, lS; R (1) → rM, rS; somas → outL/outR → merger 0/1 → wet → saída.
    const split = ctx.nos.find(n => n.tipo === 'splitter'), merge = ctx.nos.find(n => n.tipo === 'merger');
    assert.equal(split.canais, 2); assert.equal(merge.canais, 2);
    assert.ok(liga(lg.input, lg.dry) && liga(lg.dry, lg.output) && liga(lg.input, split));
    const porCanal = (c) => split.saidas.filter(s => s.out === c).map(s => s.alvo);
    assert.equal(porCanal(0).length, 2); assert.equal(porCanal(1).length, 2);
    // Os ganhos de L e R somam em M com +0,5/+0,5 e em S com +0,5/−0,5.
    const ganhosL = porCanal(0).map(n => n.gain.value).sort(), ganhosR = porCanal(1).map(n => n.gain.value).sort();
    assert.deepEqual(ganhosL, [0.5, 0.5]);
    assert.deepEqual(ganhosR, [-0.5, 0.5]);
    assert.ok(porCanal(0).every(n => liga(n, lg.somaM) || liga(n, lg.somaS)));
    // somaS entra em L direto e em R invertido (gain −1).
    const inv = lg.somaS.saidas.map(s => s.alvo).find(n => n.gain && n.gain.value === -1);
    assert.ok(inv, 'S invertido pra R');
    const entradasMerge = merge.saidas.length === 0 ? null : merge;   // merger só recebe
    const quemLigaNoMerge = ctx.nos.filter(n => n.saidas.some(s => s.alvo === merge));
    assert.equal(quemLigaNoMerge.length, 2);                            // outL e outR
    assert.deepEqual(quemLigaNoMerge.map(n => n.saidas.find(s => s.alvo === merge).inp).sort(), [0, 1]);
    assert.ok(liga(merge, lg.wet) && liga(lg.wet, lg.output));
    // Aplicar.
    assert.equal(lg.aplicar(0), 0);        // mono
    assert.equal(lg.somaS.gain.value, 0);
    assert.equal(lg.dry.gain.value, 0);
    assert.equal(lg.wet.gain.value, 1);
    assert.equal(lg.aplicar(2), 2);        // aberto
    assert.equal(lg.somaS.gain.value, 2);
    assert.equal(lg.aplicar(1.001), 1.001);
    assert.equal(lg.dry.gain.value, 1);    // ~1 = seco
    assert.equal(lg.wet.gain.value, 0);
    assert.equal(lg.aplicar(9), 2);        // gruda em 2
    assert.equal(lg.aplicar('x'), 1);      // lixo = seco
    assert.equal(lg.aplicar(-1), 0);
});

test('larguraDaFaixa: só trilha; voz e projeto antigo = 1; gruda em 0..2', () => {
    assert.equal(MixEngine.larguraDaFaixa({ type: 'voice', largura: 0 }), 1);
    assert.equal(MixEngine.larguraDaFaixa({ type: 'music' }), 1);
    assert.equal(MixEngine.larguraDaFaixa({ type: 'music', largura: 1.5 }), 1.5);
    assert.equal(MixEngine.larguraDaFaixa({ type: 'music', largura: '0.4' }), 0.4);
    assert.equal(MixEngine.larguraDaFaixa({ type: 'music', largura: 7 }), 2);
    assert.equal(MixEngine.larguraDaFaixa({ type: 'music', largura: 'lixo' }), 1);
    assert.equal(MixEngine.larguraDaFaixa(null), 1);
});
