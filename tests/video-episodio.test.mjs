// tests/video-episodio.test.mjs — Vídeo do episódio, molde do Filmora (06/10/2026).
// Rodar: node --test tests/video-episodio.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../static/video-episodio.js');

const ativas = (rot, t) => V.camadasEm(rot, t).map(c => c.tipo).sort();

test('episódio de 1:56 segue o molde: capa → Episódio N → capa + dica → final', () => {
    const rot = V.roteiro(116.5);
    assert.deepEqual(ativas(rot, 1), ['capa']);
    assert.deepEqual(ativas(rot, 7), ['episodio']);            // tela só com "Episódio N"
    assert.deepEqual(ativas(rot, 13), ['capa']);
    assert.deepEqual(ativas(rot, 18), ['capa', 'dica']);       // ESCUTE A DICA por cima da capa
    assert.deepEqual(ativas(rot, 60), ['capa']);
    assert.deepEqual(ativas(rot, 110), ['final']);             // SEGUIR / INFORMAÇÕES / capa / WhatsApp / LIKE
    assert.deepEqual(ativas(rot, 116.4), ['final']);
    const fim = rot.find(c => c.tipo === 'final');
    assert.equal(fim.fim, 116.5);
    assert.ok(Math.abs(fim.ini - 103.5) < 0.01);               // últimos 13 s
});

test('áudio curto (spot de 30 s) não sobrepõe nem deixa buraco', () => {
    const rot = V.roteiro(30);
    for (let t = 0; t < 30; t += 0.25) {
        const a = ativas(rot, t);
        assert.ok(a.length >= 1, `buraco em ${t}s`);
        assert.ok(!(a.includes('final') && a.includes('episodio')), `final e episódio juntos em ${t}s`);
    }
    assert.ok(rot.every(c => c.ini >= 0 && c.fim <= 30 && c.fim > c.ini));
});

test('sem número de episódio, a tela do episódio vira capa', () => {
    const rot = V.roteiro(90, { semEpisodio: true });
    assert.deepEqual(ativas(rot, 7), ['capa']);
    assert.ok(!rot.some(c => c.tipo === 'episodio'));
});

// 07/10: Achadinhos (spot em cenas, sem programa): o título de cada cena aparece
// na hora dela; sem tela de episódio; final curto (6 s) com a chamada dele.
test('spot com cenas: capa o tempo todo + título de cada cena na hora certa', () => {
    const cenas = [{ ini: 0, fim: 6, titulo: 'Chega de Perder' }, { ini: 6, fim: 13, titulo: 'Seu Novo Jeito' },
                   { ini: 33, fim: 40, titulo: 'Sua Vantagem' }];
    const rot = V.roteiro(43, { semEpisodio: true, cenas, finalCurto: true });
    assert.deepEqual(ativas(rot, 1), ['capa', 'cena']);
    assert.equal(V.camadasEm(rot, 1).find(c => c.tipo === 'cena').texto, 'Chega de Perder');
    assert.equal(V.camadasEm(rot, 8).find(c => c.tipo === 'cena').texto, 'Seu Novo Jeito');
    assert.deepEqual(ativas(rot, 20), ['capa']);                        // sem cena nesse trecho
    assert.ok(!rot.some(c => c.tipo === 'dica' || c.tipo === 'episodio'));
    const fim = rot.find(c => c.tipo === 'final');
    assert.ok(Math.abs(fim.ini - 37) < 0.01);                           // final curto: últimos 6 s
    assert.deepEqual(ativas(rot, 38), ['final']);                       // cena que invade o final não aparece
});

test('programa sem cenas continua igual (Vida Saudável)', () => {
    const rot = V.roteiro(116.5, { cenas: [] });
    assert.deepEqual(ativas(rot, 18), ['capa', 'dica']);
    assert.ok(Math.abs(rot.find(c => c.tipo === 'final').ini - 103.5) < 0.01);
});

test('lê as cenas do texto do Gerador', () => {
    const linhas = ['Cena 1 · 00:00–00:06 · Chega de Perder', 'Cena 2 · 00:06–00:13 · Seu Novo Jeito', 'lixo'];
    assert.deepEqual(V.cenasDoTexto(linhas), [{ ini: 0, fim: 6, titulo: 'Chega de Perder' },
                                              { ini: 6, fim: 13, titulo: 'Seu Novo Jeito' }]);
    assert.deepEqual(V.cenasDoTexto(['Cena 3 · 01:02–01:10 · Com · ponto']), [{ ini: 62, fim: 70, titulo: 'Com · ponto' }]);
});

test('WhatsApp no formato do vídeo', () => {
    assert.equal(V.formatarWhatsApp('Informações pelo WhatsApp: 85 9 9226- 2297.'), '85 9 9226-2297');
    assert.equal(V.formatarWhatsApp('(85) 99226-2297'), '85 9 9226-2297');
    assert.equal(V.formatarWhatsApp('85 3226-2297'), '85 3226-2297');
    assert.equal(V.formatarWhatsApp(''), '');
    assert.equal(V.formatarWhatsApp('ligue já'), 'ligue já');
});
