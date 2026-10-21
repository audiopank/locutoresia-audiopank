// "🧹 Limpar ruído" (RNNoise) na MiniDAW React (21/10/2026).
// O RNNoise de verdade só roda no navegador; aqui testa o fatiamento em quadros
// com um limpador falso. Rodar: node --test tests/limpar-ruido.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparCanal } from '../minidaw-react/src/lib/limparRuido.js';

test('limparCanal: processa em quadros de 480, na escala de 16 bits, e devolve o mesmo tamanho', () => {
    const canal = new Float32Array(1000).fill(0.25);         // 2 quadros cheios + 1 pedaço de 40
    const vistos = [];
    const r = limparCanal(canal, 480, (q) => {
        vistos.push(q.length);
        assert.ok(Math.abs(q[0] - 0.25 * 32768) < 1e-3 || q[0] === 0, 'entra na escala de 16 bits');
        for (let i = 0; i < q.length; i++) q[i] *= 0.5;        // "limpa" pela metade
    });
    assert.equal(r.length, 1000);
    assert.deepEqual(vistos, [480, 480, 480]);                 // o pedaço final vai completado com zero
    assert.ok(Math.abs(r[0] - 0.125) < 1e-6);
    assert.ok(Math.abs(r[999] - 0.125) < 1e-6, 'o finalzinho também é processado');
    assert.equal(canal[0], 0.25, 'não mexe no original (o Desfazer/efeito desligado depende dele)');
});

test('limparCanal: compensa o atraso do limpador (a voz não sai deslocada na linha do tempo)', () => {
    const canal = new Float32Array(2000);
    for (let i = 0; i < canal.length; i++) canal[i] = Math.sin(i / 7) * 0.3;
    // limpador falso que atrasa 480 amostras (como um filtro com 1 quadro de latência)
    let anterior = new Float32Array(480);
    const atrasa = (q) => { const atual = q.slice(); q.set(anterior); anterior = atual; };
    const r = limparCanal(canal, 480, atrasa, 480);
    for (const i of [0, 100, 1000, 1999]) assert.ok(Math.abs(r[i] - canal[i]) < 1e-6, `amostra ${i} no lugar`);
});

test('limparCanal: valor acima do limite volta limitado a [-1, 1]', () => {
    const r = limparCanal(new Float32Array(480).fill(0.9), 480, (q) => { for (let i = 0; i < q.length; i++) q[i] *= 3; });
    assert.equal(r[10], 1);
});

// ── Intensidade (21/10/2026): pedido dele "como aumentar ou diminuir o limpar ruído" ──
import { misturarLimpeza, intensidadeValida } from '../minidaw-react/src/lib/limparRuido.js';

test('misturarLimpeza: 100% = só o limpo; 0% = só o original; 80% = 80/20', () => {
    const seco = new Float32Array([1, 1, 1]);
    const limpo = new Float32Array([0, 0, 0]);
    assert.deepEqual([...misturarLimpeza(seco, limpo, 100)], [0, 0, 0]);
    assert.deepEqual([...misturarLimpeza(seco, limpo, 0)], [1, 1, 1]);
    const m = misturarLimpeza(seco, limpo, 80);
    assert.ok(Math.abs(m[0] - 0.2) < 1e-6);
    assert.equal(seco[0], 1, 'não mexe no original');
});

test('intensidadeValida: padrão 80, limitada a 0–100', () => {
    assert.equal(intensidadeValida(undefined), 80);
    assert.equal(intensidadeValida(150), 100);
    assert.equal(intensidadeValida(-3), 0);
    assert.equal(intensidadeValida(55), 55);
});
