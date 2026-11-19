// 🎚️ Ducking ajustável por trilha — MiniDAW clássica (19/11/2026).
// Sem ajuste = padrão de sempre (Regra do Eudes); com ajuste = a agenda muda de verdade.
// Rodar: node --test tests/ducking-faixa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const ME = janela.MixEngine;

function paramFalso() {
    const ev = [];
    return { ev, setValueAtTime: (v, t) => ev.push(['set', v, t]), linearRampToValueAtTime: (v, t) => ev.push(['ramp', v, t]) };
}

test('trilha sem ajuste usa o padrão — mesmo objeto, som idêntico', () => {
    const base = { ...ME.DUCK_PADRAO };
    assert.equal(ME.duckDaFaixa({}, base), base);
    assert.equal(ME.duckDaFaixa(null, base), base);
    assert.equal(ME.duckDaFaixa({ duckSettings: undefined }), ME.DUCK_PADRAO);
});

test('ajuste vira ganho/tempos; campo ausente ou lixo fica no padrão; limites seguram', () => {
    const d = ME.duckDaFaixa({ duckSettings: { abaixaDb: 12, attack: 'x' } });
    assert.ok(Math.abs(d.gain - Math.pow(10, -12 / 20)) < 1e-12);
    assert.equal(d.attack, ME.DUCK_PADRAO.attack);
    assert.equal(d.release, ME.DUCK_PADRAO.release);
    assert.equal(d.hold, ME.DUCK_PADRAO.hold);
    assert.equal(ME.duckDaFaixa({ duckSettings: { abaixaDb: 0 } }).gain, 1);          // 0 dB = não abaixa
    const lim = ME.duckDaFaixa({ duckSettings: { abaixaDb: 99, attack: 0, release: 99 } });
    assert.ok(Math.abs(lim.gain - Math.pow(10, -24 / 20)) < 1e-12);
    assert.equal(lim.attack, 0.01);
    assert.equal(lim.release, 4);
});

test('a agenda de ganho segue o ajuste (nível abaixado, ataque e release)', () => {
    const trechos = [[2, 5]];
    const p0 = paramFalso(), p1 = paramFalso();
    ME.aplicarDucking(p0, trechos, 1, 30, 0, ME.duckDaFaixa({}));
    ME.aplicarDucking(p1, trechos, 1, 30, 0, ME.duckDaFaixa({ duckSettings: { abaixaDb: 12, attack: 0.5, release: 2 } }));
    assert.deepEqual(p0.ev, [['set', 1, 1.8], ['ramp', 0.45, 2], ['set', 0.45, 5], ['ramp', 1, 5.65]]);
    const g = Math.pow(10, -12 / 20);
    assert.deepEqual(p1.ev, [['set', 1, 1.5], ['ramp', g, 2], ['set', g, 5], ['ramp', 1, 7]]);
});
