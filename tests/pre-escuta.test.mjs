// Pré-escuta de trilhas do PC na MiniDAW clássica (23/10/2026).
// Rodar: node --test tests/pre-escuta.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PE = require('../static/pre-escuta.js');

test('ehAudio: só formatos que o navegador toca, sem lixo do sistema', () => {
    for (const n of ['a.mp3', 'B.WAV', 'c.ogg', 'd.m4a', 'e.flac', 'f.aac', 'g.opus']) assert.ok(PE.ehAudio(n), n);
    for (const n of ['capa.jpg', 'projeto.json', 'Thumbs.db', '._trilha.mp3', 'semextensao', '.mp3'])
        assert.ok(!PE.ehAudio(n), n);
});

test('ordenarNomes: ordem natural (Trilha 2 antes de Trilha 10), sem diferenciar acento/maiúscula', () => {
    const l = [{ nome: 'Trilha 10.mp3' }, { nome: 'trilha 2.mp3' }, { nome: 'Ásia.mp3' }, { nome: 'abc.mp3' }];
    assert.deepEqual(PE.ordenarNomes(l).map(x => x.nome), ['abc.mp3', 'Ásia.mp3', 'trilha 2.mp3', 'Trilha 10.mp3']);
});

test('faixaDestino: primeira trilha VAZIA; nunca uma com áudio, nem voz, nem efeito', () => {
    const tracks = [
        { id: 'v', type: 'voice', audioBuffer: null },
        { id: 'fx', type: 'music', sfx: true, audioBuffer: null },
        { id: 't1', type: 'music', audioBuffer: {} },
        { id: 't2', type: 'music', audioBuffer: null },
    ];
    assert.equal(PE.faixaDestino(tracks), 't2');
    assert.equal(PE.faixaDestino(tracks.slice(0, 3)), null);   // nenhuma vazia → criar nova
    assert.equal(PE.faixaDestino([]), null);
});

test('tempo: m:ss', () => {
    assert.equal(PE.tempo(0), '0:00');
    assert.equal(PE.tempo(30.4), '0:30');
    assert.equal(PE.tempo(95), '1:35');
    assert.equal(PE.tempo(NaN), '—');
});

test('picos: N colunas com o maior valor absoluto de cada pedaço', () => {
    const c = new Float32Array([0, 0.5, -0.9, 0.1, 0.2, -0.3, 0, 0]);
    assert.deepEqual(Array.from(PE.picos(c, 4)).map(v => +v.toFixed(2)), [0.5, 0.9, 0.3, 0]);
    assert.equal(PE.picos(new Float32Array(0), 10).length, 10);
});

// ── Marcas ✓ usada / ⭐ aprovada (23/10/2026) ──────────────────────────────
test('marcarUsada: guarda a data, conta as vezes, chave sem diferenciar maiúscula', () => {
    let m = {};
    m = PE.marcarUsada(m, 'Trilha Pank.mp3', new Date(2026, 9, 23));
    m = PE.marcarUsada(m, 'trilha pank.MP3', new Date(2026, 9, 25));
    const r = m[PE.chave('TRILHA PANK.mp3')];
    assert.equal(r.usos, 2);
    assert.equal(r.ultima, '2026-10-25');
    assert.equal(PE.rotuloUsada(r), '✓ usada 2× · última 25/10');
    assert.equal(PE.rotuloUsada({ usos: 1, ultima: '2026-10-23' }), '✓ usada em 23/10');
    assert.equal(PE.rotuloUsada(undefined), '');
});

test('alternarAprovada: liga e desliga; não apaga o histórico de uso', () => {
    let m = PE.marcarUsada({}, 'a.mp3', new Date(2026, 9, 23));
    m = PE.alternarAprovada(m, 'a.mp3');
    assert.equal(m[PE.chave('a.mp3')].aprovada, true);
    m = PE.alternarAprovada(m, 'a.mp3');
    assert.equal(m[PE.chave('a.mp3')].aprovada, false);
    assert.equal(m[PE.chave('a.mp3')].usos, 1);
    assert.equal(PE.alternarAprovada({}, 'b.mp3')[PE.chave('b.mp3')].aprovada, true);
});

test('marcas não mudam o objeto recebido', () => {
    const m = {};
    PE.marcarUsada(m, 'a.mp3', new Date());
    PE.alternarAprovada(m, 'a.mp3');
    assert.deepEqual(m, {});
});
