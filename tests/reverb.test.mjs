// tests/reverb.test.mjs — Reverb da MiniDAW clássica: prévia = arquivo (29/09/2026).
// Achado na análise do protótipo da Lovable: no PLAY o retorno do reverb ia direto
// pro pan (pulava volume, ducking, fade final, automação e o Mudo); no ARQUIVO
// passava pelo volume da faixa. E cada um gerava a sua sala com Math.random.
// Agora os dois usam as MESMAS funções do motor: quantidade, wet e sala.
// Rodar: node --test tests/reverb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const ME = janela.MixEngine;

const perto = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('quantidadeReverbDaFaixa: padrão 30% (projetos antigos soam igual), limite 0..1, lixo = padrão', () => {
    assert.equal(ME.REVERB_QUANTIDADE_PADRAO, 0.3);
    assert.equal(ME.quantidadeReverbDaFaixa({ effects: { reverb: true } }), 0.3);
    assert.equal(ME.quantidadeReverbDaFaixa({ effects: { reverb: true }, reverbAmount: 0.15 }), 0.15);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: '0.2' }), 0.2);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: 7 }), 1);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: -1 }), 0);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: 'abc' }), 0.3);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: null }), 0.3);
    assert.equal(ME.quantidadeReverbDaFaixa(null), 0.3);
    assert.equal(ME.quantidadeReverbDaFaixa({ reverbAmount: 0 }), 0);          // zero é escolha, não lixo
});

test('wetReverbDaFaixa: desligado = 0 mesmo com quantidade; ligado = a quantidade', () => {
    assert.equal(ME.wetReverbDaFaixa({ effects: { reverb: false }, reverbAmount: 0.5 }), 0);
    assert.equal(ME.wetReverbDaFaixa({ effects: {} }), 0);
    assert.equal(ME.wetReverbDaFaixa({}), 0);
    assert.equal(ME.wetReverbDaFaixa({ effects: { reverb: true } }), 0.3);
    assert.equal(ME.wetReverbDaFaixa({ effects: { reverb: true }, reverbAmount: 0.12 }), 0.12);
});

function contextoFalso(sr) {
    return {
        sampleRate: sr,
        createBuffer(canais, n, taxa) {
            const dados = Array.from({ length: canais }, () => new Float32Array(n));
            return { numberOfChannels: canais, length: n, sampleRate: taxa, getChannelData: (c) => dados[c] };
        }
    };
}
const rms = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / (i1 - i0)); };

test('criarImpulsoReverb: sala DETERMINÍSTICA — play e arquivo usam exatamente a mesma', () => {
    const a = ME.criarImpulsoReverb(contextoFalso(8000));
    const b = ME.criarImpulsoReverb(contextoFalso(8000));
    assert.equal(a.numberOfChannels, 2);
    assert.equal(a.length, 8000 * ME.REVERB_DURACAO_S);
    for (let c = 0; c < 2; c++) {
        const x = a.getChannelData(c), y = b.getChannelData(c);
        for (let i = 0; i < x.length; i += 97) assert.ok(perto(x[i], y[i]), `canal ${c} amostra ${i}`);
    }
});

test('criarImpulsoReverb: estéreo descorrelacionado, dentro de ±1 e com cauda que morre', () => {
    const ir = ME.criarImpulsoReverb(contextoFalso(8000));
    const L = ir.getChannelData(0), R = ir.getChannelData(1);
    let iguais = 0, fora = 0;
    for (let i = 0; i < L.length; i++) {
        if (L[i] === R[i]) iguais++;
        if (Math.abs(L[i]) > 1 || Math.abs(R[i]) > 1) fora++;
    }
    assert.ok(iguais < L.length / 100, 'L e R não podem ser a mesma sequência (a sala ficaria mono)');
    assert.equal(fora, 0);
    const n = L.length, dec = Math.floor(n / 10);
    assert.ok(rms(L, 0, dec) > 10 * rms(L, n - dec, n), 'o começo da cauda é bem mais forte que o fim');
    assert.ok(rms(L, 0, dec) > 0.3, 'a cauda tem corpo (ruído cheio, não silêncio)');
});

test('renderizarMix: arquivo usa a MESMA sala e a MESMA quantidade do play, com retorno pelo volume da faixa', () => {
    assert.ok(src.includes('reverbNode.buffer = criarImpulsoReverb(offlineContext);'));
    assert.ok(src.includes('reverbGain.gain.value = wetReverbDaFaixa(track);'));
    assert.ok(src.includes('reverbGain.connect(trackGain);'));
    assert.ok(!src.includes('track.effects.reverb ? 0.3 : 0'), 'nada de 30% fixo no motor');
    const bloco = src.slice(src.indexOf('// 6. Reverb'), src.indexOf('// 7. Delay'));
    assert.ok(!bloco.includes('Math.random'), 'sala sorteada a cada export = arquivo diferente a cada vez');
});
