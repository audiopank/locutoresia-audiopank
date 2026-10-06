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

test('WhatsApp no formato do vídeo', () => {
    assert.equal(V.formatarWhatsApp('Informações pelo WhatsApp: 85 9 9226- 2297.'), '85 9 9226-2297');
    assert.equal(V.formatarWhatsApp('(85) 99226-2297'), '85 9 9226-2297');
    assert.equal(V.formatarWhatsApp('85 3226-2297'), '85 3226-2297');
    assert.equal(V.formatarWhatsApp(''), '');
    assert.equal(V.formatarWhatsApp('ligue já'), 'ligue já');
});
