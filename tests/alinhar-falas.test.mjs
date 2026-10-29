// 🧲 Alinhar falas (29/10/2026, ideia dele vendo o Reaper): apara o silêncio das bordas
// de cada trecho de voz e põe as falas em fila, sem encavalar.
// Rodar: node --test tests/alinhar-falas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AF = require('../static/alinhar-falas.js');

const SR = 8000;
function trecho(partes) {          // [[fala?, segundos], ...] → amostras
    const n = partes.reduce((s, p) => s + Math.round(p[1] * SR), 0);
    const a = new Float32Array(n);
    let i = 0, sem = 3;
    for (const [fala, s] of partes) for (let k = 0; k < Math.round(s * SR); k++, i++) {
        sem = (sem * 16807) % 2147483647;
        a[i] = (sem / 2147483647 - 0.5) * 0.001 + (fala ? 0.5 * Math.sin(2 * Math.PI * 200 * k / SR) : 0);
    }
    return a;
}

test('bordasDaFala: acha onde a fala começa e termina (com folguinha), ignora silêncio', () => {
    const a = trecho([[0, 0.8], [1, 1.5], [0, 0.3], [1, 0.5], [0, 1.2]]);   // fala 0,8→3,1 s
    const b = AF.bordasDaFala(a, SR, 0, a.length);
    assert.ok(Math.abs(b.ini / SR - (0.8 - AF.FOLGA_ANTES)) < 0.02, `início ${b.ini / SR}`);
    assert.ok(Math.abs(b.fim / SR - (3.1 + AF.FOLGA_DEPOIS)) < 0.02, `fim ${b.fim / SR}`);
});

test('bordasDaFala: respeita o recorte do trecho (offset/duração) e devolve null se for só silêncio', () => {
    const a = trecho([[1, 1], [0, 1], [1, 1]]);
    const b = AF.bordasDaFala(a, SR, Math.round(0.5 * SR), Math.round(1.5 * SR));   // só pega o fim da 1ª fala
    assert.ok(b.ini >= 0.5 * SR && b.fim <= 1.5 * SR);
    assert.equal(AF.bordasDaFala(new Float32Array(SR), SR, 0, SR), null);
});

test('planejar: 1ª fala entra em "voz entra em"; cada uma começa no fim da anterior + respiro', () => {
    const itens = [
        { chave: 'b', inicio: 3.0, offset: 0, duracao: 4, cortaIni: 0.5, cortaFim: 3.5 },   // encavalada com a 1ª
        { chave: 'a', inicio: 0.0, offset: 0, duracao: 4, cortaIni: 1.0, cortaFim: 3.0 },
        { chave: 'c', inicio: 9.0, offset: 2, duracao: 3, cortaIni: 0.2, cortaFim: 2.2 },   // com buraco antes
    ];
    const p = AF.planejar(itens, { entrada: 0.3, respiro: 0.2 });
    assert.deepEqual(p.map(x => x.chave), ['a', 'b', 'c']);          // ordem da linha do tempo
    const r = (x) => Math.round(x * 1000) / 1000;
    assert.deepEqual(p.map(x => [r(x.inicio), r(x.offset), r(x.duracao)]), [
        [0.3, 1.0, 2.0],          // a: fala aparada (1→3) e posta em 0,3
        [2.5, 0.5, 3.0],          // b: 0,3+2,0+0,2
        [5.7, 2.2, 2.0],          // c: 2,5+3,0+0,2 ; offset original 2 + 0,2
    ]);
});

test('planejar: sem "voz entra em", a 1ª fala fica onde a fala dela já começava', () => {
    const p = AF.planejar([{ chave: 'a', inicio: 1.0, offset: 0, duracao: 3, cortaIni: 0.4, cortaFim: 2.4 }],
        { entrada: null, respiro: 0.2 });
    assert.ok(Math.abs(p[0].inicio - 1.4) < 1e-9);
});

test('contarSobreposicoes: pares de trechos que se encavalam', () => {
    assert.equal(AF.contarSobreposicoes([{ inicio: 0, duracao: 4 }, { inicio: 3, duracao: 4 }, { inicio: 9, duracao: 1 }]), 1);
    assert.equal(AF.contarSobreposicoes([{ inicio: 0, duracao: 1 }, { inicio: 1, duracao: 1 }]), 0);
});
