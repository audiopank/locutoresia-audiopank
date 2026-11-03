// 🎬 Vídeo do cliente na MiniDAW clássica (03/11/2026): o mix vai junto com as imagens
// que o cliente mandou, num MP4 — a imagem é COPIADA (não regravada).
// Rodar: node --test tests/video-cliente.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const VC = require('../static/video-cliente.js');

test('codecMuxer: H.264, HEVC (iPhone), VP9 e AV1 dão pra copiar; o resto não', () => {
    assert.equal(VC.codecMuxer('avc1.64001f'), 'avc');
    assert.equal(VC.codecMuxer('avc3.42E01E'), 'avc');
    assert.equal(VC.codecMuxer('hvc1.1.6.L93.B0'), 'hevc');
    assert.equal(VC.codecMuxer('hev1.1.6.L93.B0'), 'hevc');
    assert.equal(VC.codecMuxer('vp09.00.10.08'), 'vp9');
    assert.equal(VC.codecMuxer('av01.0.04M.08'), 'av1');
    assert.equal(VC.codecMuxer('mp4v.20.9'), null);
    assert.equal(VC.codecMuxer(''), null);
});

test('matrizDoMp4box: números do arquivo (16.16 e 2.30) → matriz que o empacotador entende', () => {
    const id = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
    assert.deepEqual(VC.matrizDoMp4box(id), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const rot90 = [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824];          // celular em pé
    assert.deepEqual(VC.matrizDoMp4box(rot90), [0, 1, 0, -1, 0, 0, 0, 0, 1]);
    assert.equal(VC.matrizDoMp4box(null), 0);
});

test('chunksDasAmostras: tempos em µs, quadro-chave e diferença apresentação−decodificação', () => {
    const s = [
        { data: new Uint8Array([1]), cts: 0, dts: 0, duration: 512, timescale: 15360, is_sync: true },
        { data: new Uint8Array([2]), cts: 1536, dts: 512, duration: 512, timescale: 15360, is_sync: false },
    ];
    const c = VC.chunksDasAmostras(s);
    assert.deepEqual(c.map(x => [x.key, x.pts, x.dur, x.cto]), [[true, 0, 33333, 0], [false, 100000, 33333, 66667]]);
});

test('ajustarAoVideo: mix mais longo é cortado no fim do vídeo (com fade curto); mais curto ganha silêncio', () => {
    const sr = 1000;
    const longo = VC.ajustarAoVideo([new Float32Array(1500).fill(0.5)], sr, 1.0);
    assert.equal(longo.canais[0].length, 1000);
    assert.equal(longo.cortouS, 0.5);
    assert.equal(longo.canais[0][999], 0);              // fade no corte: sem estalo
    assert.equal(longo.canais[0][500], 0.5);
    const curto = VC.ajustarAoVideo([new Float32Array(500).fill(0.5)], sr, 1.0);
    assert.equal(curto.canais[0].length, 1000);
    assert.equal(curto.cortouS, 0);
    assert.equal(curto.canais[0][499], 0.5);
    assert.equal(curto.canais[0][700], 0);
});

test('nomeDoArquivo: nome do vídeo do cliente + " - com locução.mp4"', () => {
    assert.equal(VC.nomeDoArquivo('Spot Mercado Crato.MOV'), 'Spot Mercado Crato - com locução.mp4');
    assert.equal(VC.nomeDoArquivo(''), 'video - com locução.mp4');
});

test('ajustarAoVideo: o rabo SILENCIOSO do mix não conta como "cortado"', () => {
    const sr = 1000;
    const c = new Float32Array(3000);
    c.fill(0.5, 0, 800);                                 // som até 0,8 s, silêncio até 3 s
    assert.equal(VC.ajustarAoVideo([c], sr, 1.0).cortouS, 0);
    c.fill(0.5, 0, 1600);                                // som até 1,6 s num vídeo de 1 s
    assert.equal(VC.ajustarAoVideo([c], sr, 1.0).cortouS, 0.6);
});
