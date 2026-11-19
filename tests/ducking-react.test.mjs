// 🎚️ Ducking da trilha na MiniDAW React (19/11/2026): nasce desligado; ligado abaixa onde a voz fala.
// Rodar: node --test tests/ducking-react.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paramsDucking, trechosDeVoz, pontosDucking, DUCK_PADRAO } from '../minidaw-react/src/lib/ducking.js';

test('desligado/ausente = null (o mixer não cria nó nenhum)', () => {
    assert.equal(paramsDucking(undefined), null);
    assert.equal(paramsDucking({ ativo: false, abaixaDb: 12 }), null);
});

test('ligado: padrão, lixo e limites', () => {
    const p = paramsDucking({ ativo: true });
    assert.ok(Math.abs(p.ganho - Math.pow(10, -DUCK_PADRAO.abaixaDb / 20)) < 1e-12);
    assert.deepEqual([p.attack, p.release], [0.2, 0.65]);
    const l = paramsDucking({ ativo: true, abaixaDb: 99, attack: 'x', release: 0 });
    assert.ok(Math.abs(l.ganho - Math.pow(10, -24 / 20)) < 1e-12);
    assert.deepEqual([l.attack, l.release], [0.2, 0.05]);
});

test('trechos de voz no tempo do mix (com "Entra em") e hold de 0,7 s', () => {
    const sr = 1000;
    const dados = new Float32Array(6 * sr);                       // fala 1–2 s, pausa 0,5 s, fala 2,5–3 s, pausa 2 s, fala 5–6 s
    for (const [a, b] of [[1, 2], [2.5, 3], [5, 6]]) for (let i = a * sr; i < b * sr; i++) dados[i] = 0.5;
    const t = trechosDeVoz([{ dados, sr, inicio: 10 }]).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
    assert.deepEqual(t, [[10.99, 13], [14.98, 16]]);   // janelas de 30 ms; pausa de 0,5 s uniu, a de 2 s soltou
});

test('agenda: desce no ataque, segura, sobe no release', () => {
    assert.deepEqual(pontosDucking([[2, 5]], { ganho: 0.25, attack: 0.5, release: 1 }),
        [['set', 1, 1.5], ['ramp', 0.25, 2], ['set', 0.25, 5], ['ramp', 1, 6]]);
});

test('mixer: ganho separado só pra trilha com ducking; Play/Exportar levam o campo', () => {
    const mixer = readFileSync(new URL('../minidaw-react/src/lib/mixer.ts', import.meta.url), 'utf8');
    assert.match(mixer, /const duck = d\.type === "music" \? paramsDucking\(d\.ducking\) : null;/);
    assert.match(mixer, /saida\.connect\(limiter\);/);
    const tela = readFileSync(new URL('../minidaw-react/src/components/MiniDAWIntegrated.tsx', import.meta.url), 'utf8');
    assert.match(tela, /t\.type === "music" && t\.ducking\?\.ativo \? \{ ducking: t\.ducking \} : \{\}/);
});
