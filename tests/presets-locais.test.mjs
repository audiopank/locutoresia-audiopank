// tests/presets-locais.test.mjs — Presets da MiniDAW guardados no navegador (02/10/2026).
// Com o Supabase bloqueado, "Meus presets" do master sumiu e não guardava nada.
// Agora a fonte da verdade é o navegador; a nuvem é só bônus quando volta.
// Rodar: node --test tests/presets-locais.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../static/presets-locais.js');

function memoria(inicial = {}) {
    const m = Object.assign({}, inicial);
    return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
}

test('guardar cria, mesmo nome (sem caixa) substitui', () => {
    let b = P.vazio();
    let r = P.guardar(b, 'master', { nome: 'Rádio Crato', master: { eq: 1 } }, '2026-10-02T10:00:00Z');
    assert.equal(r.substituiu, false);
    r = P.guardar(r.banco, 'master', { nome: 'rádio crato', master: { eq: 2 } }, '2026-10-02T11:00:00Z');
    assert.equal(r.substituiu, true);
    assert.deepEqual(P.lista(r.banco, 'master').map(p => [p.nome, p.master.eq]), [['rádio crato', 2]]);
});

test('apagar some e não ressuscita com cópia velha da nuvem', () => {
    let b = P.guardar(P.vazio(), 'master', { nome: 'A', master: {} }, '2026-10-01T10:00:00Z').banco;
    b = P.apagar(b, 'master', 'A', '2026-10-02T10:00:00Z');
    assert.equal(P.lista(b, 'master').length, 0);
    const nuvem = [{ nome: 'A', master: {}, salvo_em: '2026-10-01T10:00:00Z' }];
    assert.equal(P.mesclar(b, 'master', nuvem).length, 0);                       // apagado depois: fica apagado
    const nova = [{ nome: 'A', master: {}, salvo_em: '2026-10-03T10:00:00Z' }];
    assert.equal(P.mesclar(b, 'master', nova).length, 1);                        // regravado depois: volta
});

test('mesclar: une por nome e o mais novo vence', () => {
    let b = P.guardar(P.vazio(), 'master', { nome: 'Crato', master: { v: 'local' } }, '2026-10-02T10:00:00Z').banco;
    const nuvem = [{ nome: 'Crato', master: { v: 'nuvem-velha' }, salvo_em: '2026-09-23T10:00:00Z' },
                   { nome: 'Só na nuvem', master: { v: 'n' }, salvo_em: '2026-09-23T10:00:00Z' }];
    const l = P.mesclar(b, 'master', nuvem);
    assert.deepEqual(l.map(p => [p.nome, p.master.v]), [['Crato', 'local'], ['Só na nuvem', 'n']]);
});

test('ler/gravar no localStorage e migrar a chave antiga do master', () => {
    const antigo = [{ nome: 'Preset 01- Crato', master: { x: 1 }, salvo_em: '2026-09-23T12:00:00Z' }];
    const st = memoria({ minidaw_master_presets: JSON.stringify(antigo) });
    const b = P.ler(st);
    assert.deepEqual(P.lista(b, 'master').map(p => p.nome), ['Preset 01- Crato']);
    P.gravar(st, b);
    assert.ok(JSON.parse(st._m[P.CHAVE]).master.length === 1);
    // leitura que quebra não derruba a tela
    const ruim = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('x'); } };
    assert.deepEqual(P.ler(ruim), P.vazio());
    assert.equal(P.gravar(ruim, b), false);
});

test('lista da faixa filtra pelo tipo (voz x trilha)', () => {
    let b = P.vazio();
    b = P.guardar(b, 'faixa', { nome: 'Voz Charon spot', tipoFaixa: 'voice', efeitos: {} }, '2026-10-02T10:00:00Z').banco;
    b = P.guardar(b, 'faixa', { nome: 'Trilha de fundo', tipoFaixa: 'music', efeitos: {} }, '2026-10-02T10:00:00Z').banco;
    assert.deepEqual(P.lista(b, 'faixa', 'voice').map(p => p.nome), ['Voz Charon spot']);
    assert.deepEqual(P.lista(b, 'faixa', 'music').map(p => p.nome), ['Trilha de fundo']);
    assert.equal(P.lista(b, 'faixa').length, 2);
});

test('exportar e importar (backup / outra máquina)', () => {
    let b = P.guardar(P.vazio(), 'master', { nome: 'Crato', master: { a: 1 } }, '2026-10-02T10:00:00Z').banco;
    b = P.guardar(b, 'faixa', { nome: 'Voz', tipoFaixa: 'voice', efeitos: { e: 1 } }, '2026-10-02T10:00:00Z').banco;
    const texto = P.exportar(b);
    const obj = JSON.parse(texto);
    assert.equal(obj.formato, 'locutores-ia-presets');
    const r = P.importar(P.vazio(), texto);
    assert.equal(r.novos, 2);
    assert.deepEqual(P.lista(r.banco, 'faixa').map(p => p.efeitos.e), [1]);
    // 02/10: ele importou o arquivo que acabara de exportar e viu "0 novo, 0 atualizado"
    // — parecia que não funcionou. Agora diz o que tinha no arquivo e o que já estava aqui.
    const deNovo = P.importar(r.banco, texto);
    assert.deepEqual([deNovo.novos, deNovo.atualizados, deNovo.iguais], [0, 0, 2]);
    assert.deepEqual(deNovo.noArquivo, { master: 1, faixa: 1 });
    assert.throws(() => P.importar(P.vazio(), '{"qualquer":1}'), /não é um arquivo de presets/);
    assert.throws(() => P.importar(P.vazio(), 'lixo'), /não é um arquivo de presets/);
});
