// tests/crossfade.test.mjs — Crossfade dentro da faixa, MiniDAW clássica (28/09/2026).
// Pedido dele (Samplitude): objeto por cima do vizinho na MESMA faixa = crossfade.
// Rodar: node --test tests/crossfade.test.mjs
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

const buf = { duration: 60 };
const obj = (id, inicio, duracao, extra) => Object.assign(
    { id, buffer: buf, inicio, offset: 0, duracao, fadeIn: 0, fadeOut: 0 }, extra || {});
const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── Modelo: o que é sobreposição válida ──────────────────────────────────
test('sobreposicaoInvalida: encostar ou crossfade parcial = ok', () => {
    const a = obj('a', 0, 5);
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', 5, 4)), false);     // encostado
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', 4, 4)), false);     // 1 s de crossfade
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', 7, 4)), false);     // longe
});

test('sobreposicaoInvalida: dentro do vizinho, começo junto, três juntos e cadeado = recusa', () => {
    const a = obj('a', 0, 5);
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', 1, 2)), true);      // b inteiro dentro de a
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', 0.02, 8)), true);   // começa praticamente junto
    assert.equal(CM.sobreposicaoInvalida([a], obj('b', -1, 8)), true);     // a inteiro dentro de b
    const c = obj('c', 4.5, 5);
    assert.equal(CM.sobreposicaoInvalida([a, c], obj('b', 4, 3)), true);   // a, b e c ao mesmo tempo
    assert.equal(CM.sobreposicaoInvalida([obj('a', 0, 5, { travado: true })], obj('b', 4, 4)), true);
    // A lista pode conter o próprio objeto na posição velha: vale a nova.
    assert.equal(CM.sobreposicaoInvalida([a, obj('b', 20, 4)], obj('b', 4, 4)), false);
});

test('moverComCrossfade: aceita a sobreposição válida; a inválida encosta no vizinho como antes', () => {
    const a = obj('a', 0, 5), b = obj('b', 10, 4);
    assert.ok(perto(CM.moverComCrossfade([a, b], b, 4.2), 4.2));           // crossfade de 0,8 s
    assert.ok(perto(CM.moverComCrossfade([a, b], b, 1), 5));               // cairia dentro: encosta
    assert.ok(perto(CM.moverComCrossfade([a, b], b, -3), CM.moverClip([a, b], b, -3)));   // igual à regra antiga
    const t = obj('t', 0, 5, { travado: true });
    assert.ok(perto(CM.moverComCrossfade([t, b], b, 4.2), 5));             // travado: sem crossfade
});

// ── Motor ────────────────────────────────────────────────────────────────
test('crossfadesDoClip: quem sai ganha saída, quem entra ganha entrada, do tamanho da sobreposição', () => {
    const a = obj('a', 0, 5), b = obj('b', 4.2, 4), c = obj('c', 20, 2);
    const clips = [a, b, c];
    assert.equal(ME.crossfadesDoClip(clips, a).entrada, 0);
    assert.ok(perto(ME.crossfadesDoClip(clips, a).saida, 0.8));
    assert.ok(perto(ME.crossfadesDoClip(clips, b).entrada, 0.8));
    assert.equal(ME.crossfadesDoClip(clips, b).saida, 0);
    assert.deepEqual(ME.crossfadesDoClip(clips, c), { entrada: 0, saida: 0 });
    // Encostado não é crossfade.
    assert.deepEqual(ME.crossfadesDoClip([a, obj('d', 5, 1)], a), { entrada: 0, saida: 0 });
});

function paramFalso() {
    const ev = [];
    return {
        ev,
        setValueAtTime: (v, t) => ev.push({ t, v, tipo: 'set' }),
        linearRampToValueAtTime: (v, t) => ev.push({ t, v, tipo: 'ramp' }),
        valorEm(t) {                                 // interpreta set + rampas lineares
            let v = 1, tAnt = 0, vAnt = 1;
            for (const e of ev) {
                if (e.t > t) {
                    if (e.tipo === 'ramp') return vAnt + (e.v - vAnt) * (t - tAnt) / Math.max(1e-12, e.t - tAnt);
                    return v;
                }
                v = e.v; tAnt = e.t; vAnt = e.v;
            }
            return v;
        }
    };
}

test('agendarCrossfadeDoClip: potência constante — no meio, sai² + entra² ≈ 1 (sem buraco de volume)', () => {
    const a = obj('a', 0, 5), b = obj('b', 4, 4);
    const pa = paramFalso(), pb = paramFalso();
    ME.agendarCrossfadeDoClip(pa, [a, b], a, 0);
    ME.agendarCrossfadeDoClip(pb, [a, b], b, 0);
    for (const t of [4.1, 4.25, 4.5, 4.75, 4.9]) {
        const s = pa.valorEm(t) ** 2 + pb.valorEm(t) ** 2;
        assert.ok(Math.abs(s - 1) < 0.02, `t=${t}: ${s}`);
    }
    assert.ok(perto(pa.valorEm(3.9), 1) && perto(pa.valorEm(5), 0, 1e-9));
    assert.ok(perto(pb.valorEm(4), 0, 1e-9) && perto(pb.valorEm(5.1), 1));
    // Sem vizinho sobreposto: só um set em 1.
    const p = paramFalso();
    ME.agendarCrossfadeDoClip(p, [a], a, 0);
    assert.deepEqual(p.ev, [{ t: 0, v: 1, tipo: 'set' }]);
});

test('agendarCrossfadeDoClip respeita a base de tempo do play', () => {
    const a = obj('a', 0, 5), b = obj('b', 4, 4);
    const p = paramFalso();
    ME.agendarCrossfadeDoClip(p, [a, b], b, 100);
    assert.ok(p.ev.some(e => e.tipo === 'set' && e.v === 0 && perto(e.t, 104)));
    assert.ok(p.ev.some(e => e.tipo === 'ramp' && perto(e.v, 1) && perto(e.t, 105)));
});

test('renderizarMix: crossfade num ganho próprio depois do volume do objeto', () => {
    assert.ok(src.includes('const xfGain = offlineContext.createGain();'));
    assert.ok(src.includes('agendarCrossfadeDoClip(xfGain.gain, clips, clip, 0);'));
    assert.ok(src.includes('volGain.connect(xfGain);'));
    assert.ok(src.includes('sources.push({ source, clipGain: xfGain, clip });'));
});
