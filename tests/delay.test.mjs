// tests/delay.test.mjs — Delay com quantidade na faixa (30/09/2026).
// Ouvido dele: "só o delay que está espalhando muito". Era 12% fixo, sem controle.
// Agora a quantidade vem da faixa, com a MESMA conta no play e no arquivo.
// Rodar: node --test tests/delay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const ME = janela.MixEngine;

test('quantidadeDelayDaFaixa: padrão 12% (projeto antigo soa igual), limite 0..50%, lixo = padrão', () => {
    assert.equal(ME.DELAY_QUANTIDADE_PADRAO, 0.12);
    assert.equal(ME.quantidadeDelayDaFaixa({}), 0.12);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: 0.05 }), 0.05);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: '0.03' }), 0.03);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: 0.9 }), 0.5);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: -1 }), 0);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: 'x' }), 0.12);
    assert.equal(ME.quantidadeDelayDaFaixa({ delayAmount: 0 }), 0);
    assert.equal(ME.quantidadeDelayDaFaixa(null), 0.12);
});

test('wetDelayDaFaixa: desligado = 0; ligado = a quantidade', () => {
    assert.equal(ME.wetDelayDaFaixa({ effects: { delay: false }, delayAmount: 0.3 }), 0);
    assert.equal(ME.wetDelayDaFaixa({ effects: {} }), 0);
    assert.equal(ME.wetDelayDaFaixa({ effects: { delay: true } }), 0.12);
    assert.equal(ME.wetDelayDaFaixa({ effects: { delay: true }, delayAmount: 0.04 }), 0.04);
});

test('renderizarMix: o arquivo usa a quantidade da faixa, nada de 12% fixo', () => {
    assert.ok(src.includes('delayMix.gain.value = wetDelayDaFaixa(track);'));
    assert.ok(!src.includes('track.effects.delay ? 0.12 : 0'));
});
