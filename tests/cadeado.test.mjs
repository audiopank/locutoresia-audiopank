// tests/cadeado.test.mjs — Cadeado no objeto da MiniDAW clássica (28/09/2026).
// Pedido dele (Samplitude): travar o objeto pra ninguém mexer. As operações de
// TRECHO do modelo (silenciar, volume) passam por cima do objeto travado sem
// tocar nele — defesa em profundidade; a tela ainda recusa antes.
// Rodar: node --test tests/cadeado.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CM = require('../static/clip-model.js');

const buf = { duration: 20 };
const obj = (id, inicio, duracao, extra) => Object.assign(
    { id, buffer: buf, inicio, offset: inicio, duracao, fadeIn: 0, fadeOut: 0 }, extra || {});

test('estaTravado: só `travado: true` trava', () => {
    assert.equal(CM.estaTravado(obj('a', 0, 2, { travado: true })), true);
    assert.equal(CM.estaTravado(obj('a', 0, 2)), false);
    assert.equal(CM.estaTravado(null), false);
});

test('silenciarTrecho não parte nem silencia objeto travado (mesma referência)', () => {
    const t = obj('t', 0, 5, { travado: true });
    const livre = obj('l', 6, 4);
    const r = CM.silenciarTrecho([t, livre], 1, 8);
    assert.ok(r.includes(t));
    assert.equal(r.filter(c => c.buffer === buf && c.inicio < 5).length, 1);
    assert.ok(!r.includes(livre));                       // o livre foi silenciado de 6 a 8
    assert.ok(r.some(c => Math.abs(c.inicio - 8) < 1e-9));
});

test('volumeNoTrecho não mexe no volume do objeto travado', () => {
    const t = obj('t', 0, 5, { travado: true });
    const r = CM.volumeNoTrecho([t], 1, 2, 6);
    assert.equal(r.length, 1);
    assert.equal(r[0], t);
    assert.equal(r[0].ganhoDb, undefined);
});

test('pedaços e cópias NÃO herdam a trava (colar gera objeto livre)', () => {
    const t = obj('t', 0, 5, { travado: true });
    assert.equal(CM.clonarClip(t, 10).travado, undefined);
    assert.ok(CM.dividirClip(t, 2).every(c => c.travado === undefined));
});
