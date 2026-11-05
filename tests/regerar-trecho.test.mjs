// 🔁 Regerar trecho (05/11/2026): a IA errou "Silvestre Arruda" no meio da locução —
// o produtor marca só aquele trecho e a fala nova entra no lugar; o resto da MESMA
// faixa de voz anda a diferença. Rodar: node --test tests/regerar-trecho.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.ClipModel = require('../static/clip-model.js');
globalThis.AlinharFalas = require('../static/alinhar-falas.js');
const RT = require('../static/regerar-trecho.js');
const CM = globalThis.ClipModel;

const SR = 1000;
// "voz" de mentira: onda quadrada de amplitude `amp` nos trechos de fala, zero no resto
function voz(dur, falas, amp = 0.5) {
    const d = new Float32Array(Math.round(dur * SR));
    for (const [a, b] of falas) for (let k = Math.round(a * SR); k < Math.round(b * SR); k++) d[k] = (k % 2 ? amp : -amp);
    return { duration: dur, sampleRate: SR, length: d.length, getChannelData: () => d };
}
const perto = (a, b, tol = 0.025) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

// Locução original: fala, pausa, a FRASE ERRADA (4,3–5,8 s), pausa, fala.
const original = voz(10, [[0.5, 4.0], [4.3, 5.8], [6.2, 9.5]]);
const faixa = () => [CM.clipInteiro(original)];
const INI = 4.05, FIM = 6.0;

function regerar(novoBuf, clips = faixa()) {
    const pausas = RT.pausasDoTrecho(clips, INI, FIM, SR);
    const f = RT.falaDoBuffer(novoBuf);
    return RT.costurar(clips, INI, FIM, { buffer: novoBuf, falaIni: f.ini, falaFim: f.fim }, { pausas });
}

test('pausas do trecho: guarda o silêncio que o produtor deixou em volta da frase', () => {
    const p = RT.pausasDoTrecho(faixa(), INI, FIM, SR);
    perto(p.antes, 0.25 - 0.04);          // 4,05 → 4,30, menos a folga do ataque
    perto(p.depois, 0.20 - 0.08);         // 5,80 → 6,00, menos a folga do fim
    assert.deepEqual(RT.pausasDoTrecho([CM.clipInteiro(voz(3, []))], 0.5, 1.5, SR), { antes: 0, depois: 0 });
});

test('fala nova MAIOR: o resto da voz anda a diferença; o começo fica parado', () => {
    const r = regerar(voz(3, [[0.5, 2.5]]));          // 2,0 s de fala no lugar de 1,5 s
    assert.ok(!r.erro, r.erro);
    perto(r.delta, 0.5);
    const [antes, novo, depois] = r.clips;
    assert.equal(antes.inicio, 0); perto(antes.duracao, INI, 0.001);
    assert.equal(novo, r.clipNovo);
    perto(novo.inicio, INI + 0.21);
    perto(depois.inicio, FIM + r.delta, 0.001);
    perto(depois.offset, FIM, 0.001);                  // o áudio de depois é o MESMO de antes
});

test('fala nova MENOR: o resto volta pra esquerda e nada se sobrepõe', () => {
    const r = regerar(voz(2, [[0.5, 1.0]]));
    perto(r.delta, -1.0);
    const l = r.clips;
    for (let i = 1; i < l.length; i++) assert.ok(l[i].inicio >= l[i - 1].inicio + l[i - 1].duracao - 1e-6, 'sobreposição');
});

test('emendas com fade curto (sem estalo)', () => {
    const r = regerar(voz(3, [[0.5, 2.5]]));
    assert.ok(r.clipNovo.fadeIn > 0 && r.clipNovo.fadeIn <= 0.015);
    assert.ok(r.clipNovo.fadeOut > 0 && r.clipNovo.fadeOut <= 0.015);
    assert.ok(r.clips[0].fadeOut > 0 && r.clips[2].fadeIn > 0);
});

test('volume: fala nova 12 dB mais baixa ganha +12 dB pra casar com a voz', () => {
    const r = regerar(voz(3, [[0.5, 2.5]], 0.125));
    assert.equal(r.ganhoDb, 12);
    assert.equal(r.clipNovo.ganhoDb, 12);
    assert.equal(regerar(voz(3, [[0.5, 2.5]])).clipNovo.ganhoDb, undefined);   // mesmo nível: sem campo
});

test('cadeado: no trecho recusa; depois do trecho recusa se precisar andar', () => {
    const travado = Object.assign(CM.clipInteiro(original), { travado: true });
    assert.equal(regerar(voz(3, [[0.5, 2.5]]), [travado]).erro, 'travado');
    const inteiro = CM.clipInteiro(voz(7, [[0.5, 4.0], [4.3, 5.8], [6.2, 6.9]]));
    const assinatura = Object.assign(CM.clipInteiro(voz(1, [[0.1, 0.9]])), { inicio: 8, travado: true });
    assert.equal(regerar(voz(3, [[0.5, 2.5]]), [inteiro, assinatura]).erro, 'travado-depois');
});

test('trecho curto demais ou fala nova vazia: recusa', () => {
    assert.equal(RT.costurar(faixa(), 1, 1.01, { buffer: original, falaIni: 0, falaFim: 1 }).erro, 'trecho-curto');
    assert.equal(RT.costurar(faixa(), INI, FIM, { buffer: original, falaIni: 1, falaFim: 1 }).erro, 'fala-vazia');
    assert.equal(RT.falaDoBuffer(voz(2, [])), null);
});

test('frases do roteiro viram botõezinhos (mesmo sem espaço depois do "!")', () => {
    assert.deepEqual(
        RT.frasesDoRoteiro('Atenção, caçador de ofertas!Agora os Achadinhos chegam.\nEntra agora, é grátis!'),
        ['Atenção, caçador de ofertas!', 'Agora os Achadinhos chegam.', 'Entra agora, é grátis!']);
    assert.deepEqual(RT.frasesDoRoteiro(''), []);
});

test('frases do roteiro: marcação [pausa 0.3s]/[ênfase] não vira botão nem corta número (job real 05/11)', () => {
    assert.deepEqual(
        RT.frasesDoRoteiro('Atenção, caçador de ofertas! [pausa 0.3s]\nCriamos a comunidade [ênfase] oficial. Só R$ 9.90 hoje!'),
        ['Atenção, caçador de ofertas!', 'Criamos a comunidade oficial.', 'Só R$ 9.90 hoje!']);
});

test('voz pelo nome do clip ("Callirrhoe_-_Gemini_…")', () => {
    const vozes = [{ id: 'Zephyr', name: 'Zephyr - Bright' }, { id: 'Callirrhoe', name: 'Callirrhoe - Easy-going' }];
    assert.equal(RT.vozDoNome('Callirrhoe_-_Gemini_1793734796574', vozes).id, 'Callirrhoe');
    assert.equal(RT.vozDoNome('callirrhoe gerada', vozes).id, 'Callirrhoe');
    assert.equal(RT.vozDoNome('Take 2', vozes), null);
    assert.equal(RT.vozDoNome('', vozes), null);
});
