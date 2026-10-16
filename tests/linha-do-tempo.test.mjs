// Linha do tempo do mix da MiniDAW React (17/10/2026): faixa com "Entra em" e
// fade da trilha em 3 modos — pra assinatura cantada do jingle entrar no fim.
// Rodar: node --test tests/linha-do-tempo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhaDoTempo, fimDaVoz } from '../minidaw-react/src/lib/linhaDoTempo.js';

const F = 1.1;

test('padrão de hoje: voz 22 s + trilha 34 s → trilha desce na voz, spot 23,1 s', () => {
    const r = linhaDoTempo([
        { type: 'voiceover', duracao: 22 },
        { type: 'music', duracao: 34 },
    ], F);
    assert.equal(r.fimDaVoz, 22);
    assert.equal(r.duracao, 23.1);
    assert.deepEqual(r.faixas[1], { inicio: 0, fadeEm: 22 });
    assert.deepEqual(r.faixas[0], { inicio: 0, fadeEm: null });
});

test('jingle: voz 22 + trilha de fundo "no fim do spot" + assinatura 6 s entrando aos 22 s sem fade', () => {
    const r = linhaDoTempo([
        { type: 'voiceover', duracao: 22 },
        { type: 'music', duracao: 34, fade: 'fim' },
        { type: 'music', duracao: 6, inicio: 22, fade: 'nenhum' },
    ], F);
    assert.equal(r.fimDoSpot, 28, 'o spot acaba no fim da assinatura');
    assert.deepEqual(r.faixas[1], { inicio: 0, fadeEm: 28 }, 'a trilha de fundo desce quando a assinatura termina');
    assert.deepEqual(r.faixas[2], { inicio: 22, fadeEm: null });
    assert.equal(r.duracao, 29.1);
});

test('trilha "sem fade" sozinha com a voz: toca até o próprio fim', () => {
    const r = linhaDoTempo([
        { type: 'voiceover', duracao: 22 },
        { type: 'music', duracao: 34, fade: 'nenhum' },
    ], F);
    assert.equal(r.duracao, 34);
    assert.equal(r.faixas[1].fadeEm, null);
});

test('modo "voz" é o padrão e a voz pode entrar depois (Entra em)', () => {
    const r = linhaDoTempo([
        { type: 'voiceover', duracao: 10, inicio: 2 },
        { type: 'music', duracao: 30 },
    ], F);
    assert.equal(r.fimDaVoz, 12);
    assert.equal(r.faixas[1].fadeEm, 12);
    assert.equal(r.duracao, 13.1);
});

test('fade não pode cair depois do fim da própria trilha', () => {
    const r = linhaDoTempo([
        { type: 'voiceover', duracao: 22 },
        { type: 'music', duracao: 15 },   // trilha acaba antes da voz
    ], F);
    assert.equal(r.faixas[1].fadeEm, null);
    assert.equal(r.duracao, 22);
});

test('sem locução: só trilhas — "voz" vira "fim do spot", que é a mais longa', () => {
    const r = linhaDoTempo([{ type: 'music', duracao: 30 }, { type: 'music', duracao: 5, inicio: 2, fade: 'nenhum' }], F);
    assert.equal(r.duracao, 30);
    assert.equal(r.faixas[0].fadeEm, null);
});

test('"Entra em" negativo ou inválido vira 0', () => {
    const r = linhaDoTempo([{ type: 'voiceover', duracao: 3, inicio: -5 }, { type: 'music', duracao: 9, inicio: 'abc' }], F);
    assert.equal(r.faixas[0].inicio, 0);
    assert.equal(r.faixas[1].inicio, 0);
});

test('fimDaVoz: o "logo depois da voz" usa a última fala, contando o Entra em', () => {
    assert.equal(fimDaVoz([{ type: 'voiceover', duracao: 10, inicio: 2 }, { type: 'voiceover', duracao: 4 }, { type: 'music', duracao: 60 }]), 12);
    assert.equal(fimDaVoz([{ type: 'music', duracao: 60 }]), 0);
});

// ── alças de fade-in / fade-out no objeto (17/10/2026) ──────────────────────
import { envelopeGanho } from '../minidaw-react/src/lib/linhaDoTempo.js';

const valor = (pts, t) => {          // interpola a envoltória (pontos [t, ganho])
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
        const [ta, ga] = pts[i - 1], [tb, gb] = pts[i];
        if (t <= tb) return tb === ta ? gb : ga + (gb - ga) * (t - ta) / (tb - ta);
    }
    return pts[pts.length - 1][1];
};

test('envelopeGanho sem fade: volume cheio do início ao fim', () => {
    const p = envelopeGanho({ volume: 0.8, inicio: 2, duracao: 10 });
    assert.equal(valor(p, 2), 0.8);
    assert.equal(valor(p, 11.9), 0.8);
});

test('fade-in de 1 s e fade-out de 2 s nas alças do objeto', () => {
    const p = envelopeGanho({ volume: 1, inicio: 2, duracao: 10, fadeIn: 1, fadeOut: 2 });
    assert.equal(valor(p, 2), 0);
    assert.ok(Math.abs(valor(p, 2.5) - 0.5) < 1e-9);
    assert.equal(valor(p, 3), 1);
    assert.equal(valor(p, 10), 1);
    assert.ok(Math.abs(valor(p, 11) - 0.5) < 1e-9);
    assert.ok(valor(p, 12) < 0.001);
});

test('fade automático da trilha + fade-out da alça: vale o mais baixo', () => {
    // trilha 0–30 s, auto-fade começa aos 20 s (1,1 s); alça de fade-out de 4 s no fim (26–30 s)
    const p = envelopeGanho({ volume: 1, inicio: 0, duracao: 30, fadeOut: 4, fadeEm: 20, fadeDepois: 1.1 });
    assert.equal(valor(p, 19.9), 1);
    assert.ok(valor(p, 21.1) < 0.001, 'auto-fade zera aos 21,1 s');
    assert.ok(valor(p, 27) < 0.001, 'continua zerado depois');
});

test('fades maiores que o objeto são limitados (in + out nunca passam da duração)', () => {
    const p = envelopeGanho({ volume: 1, inicio: 0, duracao: 4, fadeIn: 3, fadeOut: 3 });
    assert.ok(valor(p, 2) <= 1);
    assert.ok(valor(p, 0) === 0 && valor(p, 4) < 0.001);
});
