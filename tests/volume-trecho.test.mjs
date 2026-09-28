// tests/volume-trecho.test.mjs — Volume do trecho na MiniDAW clássica (28/09/2026).
// Pedido dele (Samplitude): marcar o trecho que o locutor falou mais baixo e subir
// o volume SÓ ali ("editor de performance"). O trecho vira um objeto próprio com
// `ganhoDb`; as emendas ganham rampa curta no motor pra não estalar.
// Rodar: node --test tests/volume-trecho.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CM = require('../static/clip-model.js');

const src = readFileSync(new URL('../static/mix-engine.js', import.meta.url), 'utf8');
const janela = {};
new Function('window', src)(janela);
const ME = janela.MixEngine;

const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// AudioBuffer falso: amplitude por trecho [ini, fim, amp] (senoide), zero no resto.
function bufferFalso(sr, duracao, trechos) {
    const n = Math.floor(sr * duracao);
    const dados = new Float32Array(n);
    for (const [ini, fim, amp] of trechos) {
        for (let i = Math.floor(ini * sr); i < Math.min(n, Math.floor(fim * sr)); i++) dados[i] = amp * Math.sin(i * 0.3);
    }
    return { sampleRate: sr, duration: duracao, length: n, getChannelData: () => dados };
}

// ── Modelo: volumeNoTrecho ───────────────────────────────────────────────
test('volumeNoTrecho parte o objeto em 3 NO LUGAR e só o do meio ganha o volume', () => {
    const buf = { duration: 10 };
    const c = { id: 'a', buffer: buf, inicio: 2, offset: 1, duracao: 6, fadeIn: 0.5, fadeOut: 0.7 };
    const r = CM.volumeNoTrecho([c], 4, 5, 3);
    assert.equal(r.length, 3);
    const [antes, meio, depois] = r;
    assert.ok(perto(antes.inicio, 2) && perto(antes.duracao, 2) && perto(antes.offset, 1));
    assert.ok(perto(meio.inicio, 4) && perto(meio.duracao, 1) && perto(meio.offset, 3));
    assert.ok(perto(depois.inicio, 5) && perto(depois.duracao, 3) && perto(depois.offset, 4));
    assert.equal(antes.ganhoDb || 0, 0);
    assert.equal(meio.ganhoDb, 3);
    assert.equal(depois.ganhoDb || 0, 0);
    // Fades das bordas ORIGINAIS ficam onde estavam; as emendas nascem secas
    // (a rampa anti-estalo é do motor, não fade até o zero).
    assert.equal(antes.fadeIn, 0.5); assert.equal(antes.fadeOut, 0);
    assert.equal(meio.fadeIn, 0); assert.equal(meio.fadeOut, 0);
    assert.equal(depois.fadeIn, 0); assert.equal(depois.fadeOut, 0.7);
    // Tudo o mesmo arquivo, contínuo: o off não muda de tempo.
    assert.ok(r.every(x => x.buffer === buf));
    assert.ok(perto(CM.fimDaFaixa(r), CM.fimDoClip(c)));
});

test('volumeNoTrecho soma no que já tinha (Ctrl+Q de novo sobe mais) e limita em ±18 dB', () => {
    const c = { id: 'a', buffer: { duration: 5 }, inicio: 0, offset: 0, duracao: 5, fadeIn: 0, fadeOut: 0, ganhoDb: 2 };
    const r = CM.volumeNoTrecho([c], 1, 2, 3);
    assert.equal(r[0].ganhoDb, 2);          // pedaços de fora mantêm o volume que já tinham
    assert.equal(r[1].ganhoDb, 5);
    assert.equal(r[2].ganhoDb, 2);
    const muito = CM.volumeNoTrecho(r, 1, 2, 40);
    assert.equal(muito[1].ganhoDb, 18);
    const pouco = CM.volumeNoTrecho(r, 1, 2, -40);
    assert.equal(pouco[1].ganhoDb, -18);
});

test('volumeNoTrecho: trecho cobrindo o objeto inteiro muda o volume SEM partir (e guarda o id)', () => {
    const c = { id: 'inteiro', buffer: { duration: 3 }, inicio: 1, offset: 0, duracao: 3, fadeIn: 0.2, fadeOut: 0.3 };
    const r = CM.volumeNoTrecho([c], 0.98, 4.2, -4);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'inteiro');
    assert.equal(r[0].ganhoDb, -4);
    assert.equal(r[0].fadeIn, 0.2); assert.equal(r[0].fadeOut, 0.3);
    assert.equal(c.ganhoDb, undefined);     // não muta o original (Ctrl+Z depende disso)
});

test('volumeNoTrecho: borda a menos de 50 ms da ponta não cria farelo', () => {
    const c = { id: 'a', buffer: { duration: 4 }, inicio: 0, offset: 0, duracao: 4, fadeIn: 0, fadeOut: 0 };
    const r = CM.volumeNoTrecho([c], 0.02, 2, 3);
    assert.equal(r.length, 2);
    assert.ok(perto(r[0].inicio, 0) && r[0].ganhoDb === 3);
    assert.ok(perto(r[1].inicio, 2) && (r[1].ganhoDb || 0) === 0);
});

test('volumeNoTrecho: objeto fora do trecho fica intacto (mesma referência); dois objetos no trecho, os dois mudam', () => {
    const buf = { duration: 20 };
    const a = { id: 'a', buffer: buf, inicio: 0, offset: 0, duracao: 2, fadeIn: 0, fadeOut: 0 };
    const b = { id: 'b', buffer: buf, inicio: 3, offset: 3, duracao: 2, fadeIn: 0, fadeOut: 0 };
    const c = { id: 'c', buffer: buf, inicio: 9, offset: 9, duracao: 2, fadeIn: 0, fadeOut: 0 };
    const r = CM.volumeNoTrecho([a, b, c], 1, 4, 6);
    assert.ok(r.includes(c));
    const comVolume = r.filter(x => x.ganhoDb === 6);
    assert.equal(comVolume.length, 2);
    assert.ok(perto(comVolume[0].inicio, 1) && perto(comVolume[0].duracao, 1));   // fim do 'a'
    assert.ok(perto(comVolume[1].inicio, 3) && perto(comVolume[1].duracao, 1));   // começo do 'b'
    assert.equal(CM.volumeNoTrecho([a, b, c], 5.5, 8, 6).length, 3);               // buraco: nada muda
    assert.equal(CM.volumeNoTrecho([a], 0.5, 1, 0)[0], a);                         // 0 dB: nada muda
});

// ── Modelo: o volume sobrevive às outras edições ─────────────────────────
test('dividir, remover, silenciar, manter e clonar carregam o volume do objeto', () => {
    const buf = { duration: 10 };
    const c = { id: 'a', buffer: buf, inicio: 0, offset: 0, duracao: 10, fadeIn: 0, fadeOut: 0, ganhoDb: 4.5 };
    assert.ok(CM.dividirClip(c, 5).every(x => x.ganhoDb === 4.5));
    assert.ok(CM.removerTrecho([c], c, 2, 3).every(x => x.ganhoDb === 4.5));
    assert.ok(CM.silenciarTrecho([c], 2, 3).every(x => x.ganhoDb === 4.5));
    assert.equal(CM.manterTrecho(c, 2, 3).ganhoDb, 4.5);
    assert.equal(CM.clonarClip(c, 12).ganhoDb, 4.5);
    // Objeto sem volume continua sem o campo (projetos antigos idênticos).
    const limpo = { id: 'b', buffer: buf, inicio: 0, offset: 0, duracao: 10, fadeIn: 0, fadeOut: 0 };
    assert.ok(!('ganhoDb' in CM.dividirClip(limpo, 5)[0]));
    assert.ok(!('ganhoDb' in CM.clonarClip(limpo, 1)));
});

test('arquivo inteiro no zero, mas com volume mudado, CONTA como edição (Encurtar Pausas não pode apagar)', () => {
    const buf = { duration: 10 };
    assert.equal(CM.ehArquivoInteiroNoZero({ buffer: buf, inicio: 0, offset: 0, duracao: 10 }), true);
    assert.equal(CM.ehArquivoInteiroNoZero({ buffer: buf, inicio: 0, offset: 0, duracao: 10, ganhoDb: 3 }), false);
});

// ── Modelo: Igualar (mede e sugere o dB) ─────────────────────────────────
test('igualarDb: trecho 6 dB mais baixo que o resto da fala pede +6 dB', () => {
    const sr = 8000;
    const alto = 0.4, baixo = 0.4 / Math.pow(10, 6 / 20);
    const buf = bufferFalso(sr, 6, [[0, 2, alto], [2, 3, baixo], [3, 6, alto]]);
    const c = { id: 'v', buffer: buf, inicio: 0, offset: 0, duracao: 6, fadeIn: 0, fadeOut: 0 };
    const d = CM.igualarDb([c], 2, 3);
    assert.ok(Math.abs(d - 6) <= 0.5, `pediu ${d} dB`);
});

test('igualarDb: considera o volume que o objeto já tem, ignora silêncio e devolve null sem fala', () => {
    const sr = 8000;
    const buf = bufferFalso(sr, 6, [[0, 2, 0.4], [2, 3, 0.2], [3, 4, 0], [4, 6, 0.4]]);
    const c = { id: 'v', buffer: buf, inicio: 0, offset: 0, duracao: 6, fadeIn: 0, fadeOut: 0 };
    const partes = CM.volumeNoTrecho([c], 2, 3, 6);      // já subiu ~6 dB: 0.2 × 2 ≈ 0.4
    const d = CM.igualarDb(partes, 2, 3);
    assert.ok(Math.abs(d) <= 0.5, `já igualado, pediu ${d} dB`);
    assert.equal(CM.igualarDb([c], 3.1, 3.9), null);      // só silêncio: nada a medir
});

// ── Motor: rampa anti-estalo nas emendas ─────────────────────────────────
test('volumeDoClip: emenda contínua com volume diferente sobe em rampa curta a partir do vizinho', () => {
    const buf = { duration: 10 };
    const c = { id: 'a', buffer: buf, inicio: 0, offset: 0, duracao: 10, fadeIn: 0, fadeOut: 0 };
    const [antes, meio, depois] = CM.volumeNoTrecho([c], 4, 5, 6);
    const clips = [antes, meio, depois];
    const g6 = Math.pow(10, 6 / 20);
    const vA = ME.volumeDoClip(clips, antes);
    assert.ok(perto(vA.de, 1) && perto(vA.g, 1));                 // começo do arquivo: nada a emendar
    const vM = ME.volumeDoClip(clips, meio);
    assert.ok(perto(vM.de, 1) && perto(vM.g, g6));                // entra no nível do vizinho e sobe
    assert.ok(vM.rampa > 0.005 && vM.rampa <= 0.02);
    const vD = ME.volumeDoClip(clips, depois);
    assert.ok(perto(vD.de, g6) && perto(vD.g, 1));                // e desce de volta no pedaço seguinte
    // Pedaço arrastado pra longe: não é mais emenda, entra direto no próprio volume.
    const longe = Object.assign({}, meio, { inicio: 8.5 });
    const vL = ME.volumeDoClip([antes, longe], longe);
    assert.ok(perto(vL.de, g6) && perto(vL.g, g6));
});

test('agendarVolumeDoClip escreve a rampa no AudioParam (play e arquivo usam a MESMA função)', () => {
    const chamadas = [];
    const param = {
        setValueAtTime: (v, t) => chamadas.push(['set', v, t]),
        linearRampToValueAtTime: (v, t) => chamadas.push(['ramp', v, t]),
    };
    const buf = { duration: 10 };
    const c = { id: 'a', buffer: buf, inicio: 1, offset: 0, duracao: 9, fadeIn: 0, fadeOut: 0 };
    const [, meio] = CM.volumeNoTrecho([c], 4, 5, 6);
    ME.agendarVolumeDoClip(param, CM.volumeNoTrecho([c], 4, 5, 6), meio, 100);
    const rampa = chamadas.find(x => x[0] === 'ramp');
    assert.ok(rampa, 'tem rampa');
    assert.ok(perto(rampa[1], Math.pow(10, 6 / 20)));
    assert.ok(rampa[2] > 104 && rampa[2] <= 104.02);               // base 100 + início 4 + rampa
    assert.ok(chamadas.some(x => x[0] === 'set' && perto(x[1], 1) && perto(x[2], 104)));
    // Objeto sem volume e sem emenda: um set só, ganho 1.
    const simples = [];
    ME.agendarVolumeDoClip({ setValueAtTime: (v, t) => simples.push([v, t]), linearRampToValueAtTime: () => simples.push('ramp') },
        [c], c, 0);
    assert.deepEqual(simples, [[1, 0]]);
});

test('renderizarMix: objeto com volume passa por um ganho próprio DEPOIS dos fades', () => {
    assert.ok(src.includes('const volGain = offlineContext.createGain();'));
    assert.ok(src.includes('agendarVolumeDoClip(volGain.gain, clips, clip, 0);'));
    assert.ok(src.includes('clipGain.connect(volGain);'));
    assert.ok(src.includes('sources.push({ source, clipGain: volGain, clip });'));
});
