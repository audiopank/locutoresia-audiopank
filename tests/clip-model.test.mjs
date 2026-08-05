import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CM = require('../static/clip-model.js');

const buf = { duration: 10 };   // AudioBuffer é opaco pro modelo

test('clipInteiro cobre o arquivo a partir de 0', () => {
    const c = CM.clipInteiro(buf);
    assert.equal(c.inicio, 0);
    assert.equal(c.offset, 0);
    assert.equal(c.duracao, 10);
    assert.equal(c.buffer, buf);
    assert.ok(c.id.startsWith('clip_'));
});

test('fimDoClip e fimDaFaixa', () => {
    const a = { inicio: 2, duracao: 3 };
    const b = { inicio: 8, duracao: 4 };
    assert.equal(CM.fimDoClip(a), 5);
    assert.equal(CM.fimDaFaixa([a, b]), 12);
    assert.equal(CM.fimDaFaixa([]), 0);
});

test('duracaoDoProjeto: fim do último clip de VOZ + 2.02 (fade final de ouvido)', () => {
    const faixas = [
        { type: 'voice', clips: [{ inicio: 1, duracao: 4 }] },      // fim 5
        { type: 'music', clips: [{ inicio: 0, duracao: 60 }] },
    ];
    assert.ok(Math.abs(CM.duracaoDoProjeto(faixas) - 7.02) < 1e-9);
});

test('duracaoDoProjeto sem voz: maior fim de clip', () => {
    const faixas = [{ type: 'music', clips: [{ inicio: 2, duracao: 30 }] }];
    assert.equal(CM.duracaoDoProjeto(faixas), 32);
});

test('clipNoPonto acha o clip que cobre o tempo t', () => {
    const a = { inicio: 0, duracao: 5 }, b = { inicio: 8, duracao: 2 };
    assert.equal(CM.clipNoPonto([a, b], 3), a);
    assert.equal(CM.clipNoPonto([a, b], 9), b);
    assert.equal(CM.clipNoPonto([a, b], 6), null);   // buraco
});

test('dividirClip parte no tempo do projeto, offsets certos', () => {
    const c = { id: 'clip_x', buffer: buf, inicio: 2, offset: 1, duracao: 6, fadeIn: 0.5, fadeOut: 0.5 };
    const [a, b] = CM.dividirClip(c, 5);            // 3s dentro do clip
    assert.equal(a.inicio, 2); assert.equal(a.offset, 1); assert.equal(a.duracao, 3);
    assert.equal(b.inicio, 5); assert.equal(b.offset, 4); assert.equal(b.duracao, 3);
    assert.equal(a.buffer, buf); assert.equal(b.buffer, buf);
    assert.equal(a.fadeIn, 0.5); assert.equal(a.fadeOut, 0);   // fade só na borda original
    assert.equal(b.fadeIn, 0);   assert.equal(b.fadeOut, 0.5);
    assert.notEqual(a.id, b.id);
});

test('dividirClip fora do miolo devolve null', () => {
    const c = { inicio: 2, offset: 0, duracao: 6, buffer: buf };
    assert.equal(CM.dividirClip(c, 2.001), null);    // < 50ms da borda
    assert.equal(CM.dividirClip(c, 9), null);
});

test('removerTrecho: some o meio e a direita PUXA pra esquerda', () => {
    const c = { id: 'c', buffer: buf, inicio: 0, offset: 0, duracao: 10, fadeIn: 0, fadeOut: 0 };
    const novos = CM.removerTrecho([c], c, 3, 5);    // tira 2s
    assert.equal(novos.length, 2);
    assert.equal(novos[0].duracao, 3);               // 0..3
    assert.equal(novos[1].inicio, 3);                // colou
    assert.equal(novos[1].offset, 5);                // pula o trecho no arquivo
    assert.equal(novos[1].duracao, 5);
});

test('manterTrecho vira um clip só com o recorte', () => {
    const c = { id: 'c', buffer: buf, inicio: 2, offset: 1, duracao: 8, fadeIn: 0, fadeOut: 0 };
    const m = CM.manterTrecho(c, 4, 7);              // projeto 4..7
    assert.equal(m.inicio, 4);
    assert.equal(m.offset, 3);                       // 1 + (4-2)
    assert.equal(m.duracao, 3);
});

test('aplicarTrim nas duas bordas, não-destrutivo e com limites', () => {
    const c = { inicio: 5, offset: 2, duracao: 6, buffer: { duration: 20 } };
    const ini = CM.aplicarTrim(c, 'ini', 7);         // encolhe 2s pela esquerda
    assert.equal(ini.inicio, 7); assert.equal(ini.offset, 4); assert.equal(ini.duracao, 4);
    const fim = CM.aplicarTrim(c, 'fim', 8);         // encolhe 3s pela direita
    assert.equal(fim.inicio, 5); assert.equal(fim.offset, 2); assert.equal(fim.duracao, 3);
    // esticar a borda final além do arquivo: para no fim do arquivo (offset 2 + 18 = 20)
    const max = CM.aplicarTrim(c, 'fim', 60);
    assert.equal(max.duracao, 18);
    // esticar a borda inicial recupera áudio escondido, até offset 0
    const volta = CM.aplicarTrim(ini, 'ini', 0);
    assert.equal(volta.offset, 0); assert.equal(volta.inicio, 3);   // 7 - 4
    // duração mínima
    const mini = CM.aplicarTrim(c, 'fim', 5.001);
    assert.ok(mini.duracao >= 0.05);
});

test('calcularSnap gruda no alvo mais perto dentro da tolerância', () => {
    assert.equal(CM.calcularSnap(4.9, [0, 5, 10], 0.2), 5);
    assert.equal(CM.calcularSnap(4.5, [0, 5, 10], 0.2), 4.5);   // longe: não gruda
    assert.equal(CM.calcularSnap(0.1, [0, 5], 0.2), 0);
});

test('moverClip clampa entre os vizinhos e no zero', () => {
    const a = { id: 'a', inicio: 0, duracao: 3 };
    const b = { id: 'b', inicio: 5, duracao: 2 };
    const c = { id: 'c', inicio: 10, duracao: 4 };
    // b quer ir pra 1 → bateria em a (fim 3): clampa em 3
    assert.equal(CM.moverClip([a, b, c], b, 1), 3);
    // b quer ir pra 9 → fim 11 invadiria c (início 10): clampa em 8
    assert.equal(CM.moverClip([a, b, c], b, 9), 8);
    // a quer ir pra -2: clampa em 0
    assert.equal(CM.moverClip([a, b, c], a, -2), 0);
    // espaço livre: vale o pedido
    assert.equal(CM.moverClip([a, b, c], b, 3.5), 3.5);
});

test('moverClip com pedido sobrepondo vizinho ainda clampa (classificação por ponto médio)', () => {
    const a = { id: 'a', inicio: 0, duracao: 3 };
    const b = { id: 'b', inicio: 10, duracao: 2 };
    // b arrastado pra CIMA de a (pedido 1, sobrepõe a): ponto médio de a (1.5)
    // <= meio do pedido (2) → a limita por baixo: clampa em 3.
    assert.equal(CM.moverClip([a, b], b, 1), 3);
});

test('temSobreposicao detecta invasão e ignora encostar', () => {
    const a = { id: 'a', inicio: 0, duracao: 3 };
    const b = { id: 'b', inicio: 3, duracao: 2 };     // encosta, não invade
    const c = { id: 'c', inicio: 2, duracao: 2 };     // invade a
    assert.equal(CM.temSobreposicao([a, b], b), false);
    assert.equal(CM.temSobreposicao([a, c], c), true);
});

test('ordenarClips ordena por inicio sem mutar o array original', () => {
    const arr = [{ inicio: 5 }, { inicio: 1 }];
    const ord = CM.ordenarClips(arr);
    assert.equal(ord[0].inicio, 1);
    assert.equal(arr[0].inicio, 5);
});
