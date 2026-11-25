// tests/comandos-minidaw.test.mjs — 🗣️ tradutor de comandos da MiniDAW clássica.
// Rodar: node --test tests/comandos-minidaw.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../static/comandos-minidaw.js');

// Projeto típico vindo do "Abrir fatiado": 2 vozes + trilha.
const FAIXAS = [
    { id: 'v1', name: 'Locução', type: 'voice' },
    { id: 'tr', name: 'Mp3', type: 'music' },
    { id: 'v2', name: 'Voz 2', type: 'voice' },
];
const i = (frase) => C.interpretar(frase, FAIXAS);

// ── As 6 frases do dia a dia (pedido dele) ──────────────────────────────────
test('"silencia a trilha"', () => {
    assert.deepEqual(i('silencia a trilha').acoes, [{ tipo: 'mudo', faixa: 'tr', valor: true }]);
});

test('"aumenta a voz em 3 dB" vale pras duas vozes do fatiado', () => {
    assert.deepEqual(i('aumenta a voz em 3 dB').acoes,
        [{ tipo: 'volume', faixa: 'v1', db: 3 }, { tipo: 'volume', faixa: 'v2', db: 3 }]);
});

test('"renomeia a faixa 1 pra Locução Principal e deixa vermelha"', () => {
    assert.deepEqual(i('renomeia a faixa 1 pra Locução Principal e deixa vermelha').acoes, [
        { tipo: 'renomear', faixa: 'v1', nome: 'Locução Principal' },
        { tipo: 'cor', faixa: 'v1', cor: '#ef4444', nomeCor: 'vermelho' },
    ]);
});

test('"coloca reverb na voz"', () => {
    const a = i('coloca reverb na voz').acoes;
    assert.equal(a.length, 2);
    assert.ok(a.every(x => x.tipo === 'efeito' && x.efeito === 'reverb' && x.valor === true));
});

test('"fade out de 2 segundos na trilha"', () => {
    assert.deepEqual(i('fade out de 2 segundos na trilha').acoes,
        [{ tipo: 'fade', faixa: 'tr', campo: 'fadeOut', segundos: 2 }]);
});

test('"mixar tudo"', () => {
    assert.deepEqual(i('mixar tudo').acoes, [{ tipo: 'mixar' }]);
});

// ── Andamento (Time Stretch com nome de gente) ──────────────────────────────
test('"deixa mais lento" / "mais rápido" / "volta ao normal" mexem nas vozes', () => {
    assert.deepEqual(i('deixa mais lento').acoes, [{ tipo: 'andamento', faixas: ['v1', 'v2'], estado: 'lento' }]);
    assert.equal(i('deixa mais rápido').acoes[0].estado, 'rapido');
    assert.equal(i('volta ao normal').acoes[0].estado, 'normal');
    assert.deepEqual(i('deixa a trilha mais rápida').acoes[0].faixas, ['tr']);
    assert.equal(C.rotuloAndamento(1.1), 'Mais Lento');
    assert.equal(C.rotuloAndamento(0.9), 'Mais Rápido');
    assert.equal(C.rotuloAndamento(1), 'Normal');
    assert.equal(C.rotuloAndamento(null), 'Normal');
});

// ── Armadilhas ───────────────────────────────────────────────────────────────
test('o número do nome da faixa não vira o valor', () => {
    assert.deepEqual(i('aumenta a Voz 2 em 3 dB').acoes, [{ tipo: 'volume', faixa: 'v2', db: 3 }]);
    assert.deepEqual(i('abaixa a faixa 3 em 2 dB').acoes, [{ tipo: 'volume', faixa: 'v2', db: -2 }]);
});

test('nome com " e " no meio não é partido', () => {
    assert.equal(i('renomeia a faixa 2 pra Pão e Leite').acoes[0].nome, 'Pão e Leite');
});

test('desligar efeito, tirar mudo, solo e volume em %', () => {
    assert.equal(i('tira o reverb da voz').acoes[0].valor, false);
    assert.deepEqual(i('tira o mudo da trilha').acoes, [{ tipo: 'mudo', faixa: 'tr', valor: false }]);
    assert.deepEqual(i('solo na faixa 2').acoes, [{ tipo: 'solo', faixa: 'tr', valor: true }]);
    assert.deepEqual(i('deixa a trilha em 30%').acoes, [{ tipo: 'volume', faixa: 'tr', pct: 30 }]);
    assert.equal(i('coloca eco na voz').acoes[0].efeito, 'delay');
});

test('dois comandos na mesma frase', () => {
    const a = i('silencia a trilha e aumenta a voz em 2 dB').acoes;
    assert.deepEqual(a.map(x => x.tipo), ['mudo', 'volume', 'volume']);
});

// ── Teste real dele (25/11), escrito em CAIXA ALTA e com "espaçoes" ──────────
test('"AUMENTE A VOZ EM 4 DB E ELEMINE OS ESPAÇOES ENTRE OS TRECHOS DA VOZ , TIPO TIRANDO A RESPIRAÇÃO"', () => {
    const r = i('AUMENTE A VOZ EM 4 DB E ELEMINE OS ESPAÇOES ENTRE OS TRECHOS DA VOZ , TIPO TIRANDO A RESPIRAÇÃO');
    assert.deepEqual(r.acoes, [
        { tipo: 'volume', faixa: 'v1', db: 4 }, { tipo: 'volume', faixa: 'v2', db: 4 },
        { tipo: 'pausas', faixas: ['v1', 'v2'], max: null },
        { tipo: 'efeito', faixa: 'v1', efeito: 'gate', rotulo: 'Gate (respiração)', valor: true },
        { tipo: 'efeito', faixa: 'v2', efeito: 'gate', rotulo: 'Gate (respiração)', valor: true },
    ]);
    assert.deepEqual(r.naoEntendi, []);
});

test('todas as formas do verbo e o que ele vai falar no dia a dia', () => {
    for (const f of ['coloque reverb na voz', 'adicione reverb na voz', 'COLOCA REVERB NA VOZ', 'põe reverber na voz']) {
        assert.equal(i(f).acoes[0].efeito, 'reverb', f);
        assert.equal(i(f).acoes[0].valor, true, f);
    }
    assert.deepEqual(i('abaixa a trilha').acoes, [{ tipo: 'volume', faixa: 'tr', db: -6 }]);   // sem número: 6 dB
    assert.deepEqual(i('aumente a voz').acoes.map(a => a.db), [6, 6]);
    assert.equal(i('coloca reverb sobre a voz').acoes.length, 2);                              // "sobre" não sobe volume
    assert.ok(i('coloca reverb sobre a voz').acoes.every(a => a.tipo === 'efeito'));
    assert.equal(i('volta a respiração').acoes[0].valor, false);
    assert.equal(i('tira o chiado da voz').acoes[0].efeito, 'deesser');
    assert.deepEqual(i('tira os silêncios da voz').acoes.map(a => a.tipo), ['pausas']);          // pausa, não mudo
    assert.deepEqual(i('abaixa mais a trilha quando a voz entra').acoes, [{ tipo: 'ducking', faixa: 'tr', db: 12 }]);
});

test('quantidade de reverb/eco: não confunde com volume da faixa', () => {
    assert.deepEqual(i('reverb na voz em 25%').acoes.map(a => [a.tipo, a.pct]), [['quantidade', 25], ['quantidade', 25]]);
    assert.deepEqual(i('aumenta o reverb da voz').acoes.map(a => [a.tipo, a.passo]), [['quantidade', 10], ['quantidade', 10]]);
    assert.deepEqual(i('menos eco na trilha').acoes, [{ tipo: 'quantidade', faixa: 'tr', efeito: 'delay', rotulo: 'Eco', pct: null, passo: -10 }]);
    assert.equal(i('tira o reverb da voz').acoes[0].tipo, 'efeito');   // tirar continua desligando
});

test('frase longa: faz o que entendeu e conta o que não entendeu', () => {
    const r = i('silencia a trilha e faz um café');
    assert.deepEqual(r.acoes, [{ tipo: 'mudo', faixa: 'tr', valor: true }]);
    assert.deepEqual(r.naoEntendi, ['faz um café']);
});

test('não entendeu ou faltou faixa: avisa, nunca chuta', () => {
    assert.match(i('faz um café').erro, /Não entendi/);
    assert.match(i('coloca reverb').erro, /Em qual faixa/);
    assert.match(i('silencia a faixa 9').erro, /não existe/);
    assert.match(C.interpretar('', FAIXAS).erro, /Digite ou fale/);
});
