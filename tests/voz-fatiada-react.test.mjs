// Voz fatiada por parágrafo na MiniDAW React (23/10/2026): 1 faixa por parágrafo.
// Rodar: node --test tests/voz-fatiada-react.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedacosDosCortes } from '../minidaw-react/src/lib/vozFatiada.js';

test('pedaços colados cobrem o arquivo inteiro, sem buraco nem sobra', () => {
    const p = pedacosDosCortes(48000 * 10, 48000, [2.5, 6.25]);
    assert.deepEqual(p, [
        { ini: 0, fim: 120000, inicio: 0 },
        { ini: 120000, fim: 300000, inicio: 2.5 },
        { ini: 300000, fim: 480000, inicio: 6.25 },
    ]);
});

test('sem cortes = um pedaço só (a voz inteira em 0)', () => {
    assert.deepEqual(pedacosDosCortes(1000, 100, []), [{ ini: 0, fim: 1000, inicio: 0 }]);
});

test('cortes fora de ordem, repetidos ou fora do arquivo são ignorados/ordenados', () => {
    const p = pedacosDosCortes(1000, 100, [7, 3, 3, -1, 50]);
    assert.deepEqual(p.map(x => [x.ini, x.fim]), [[0, 300], [300, 700], [700, 1000]]);
});
