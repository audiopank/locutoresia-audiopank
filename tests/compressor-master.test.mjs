// Compressor visual do Masterizar (MiniDAW React, 21/10/2026) — padrão Dynamics da Acon,
// presets na escola do "Clarity" que ele mostrou. Rodar: node --test tests/compressor-master.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../minidaw-react/src/lib/compressorMaster.js';

const quase = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

test('curva: abaixo do threshold não mexe; acima, T + (x − T)/R', () => {
    const p = { threshold: -20, ratio: 4, knee: 0 };
    assert.equal(C.curva(-40, p), -40);
    assert.ok(quase(C.curva(-20, p), -20));
    assert.ok(quase(C.curva(0, p), -15));          // 20 dB acima / 4 = 5 dB acima
});

test('curva: joelho suave fica entre as duas retas no meio do joelho', () => {
    const p = { threshold: -20, ratio: 4, knee: 8 };
    const y = C.curva(-20, p);
    assert.ok(y < -20 && y > -20 - 2, `no meio do joelho comprime um pouco (${y})`);
    assert.equal(C.curva(-30, p), -30);             // abaixo do joelho: reta 1:1
    assert.ok(quase(C.curva(0, p), -15));           // acima do joelho: reta comprimida
});

function tom(seg, amp, sr) {
    const n = Math.round(seg * sr), a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * 440 * i / sr);
    return a;
}
const rmsDb = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return 10 * Math.log10(s / (i1 - i0)); };
const SR = 8000;

test('comprimir: trecho alto é segurado; trecho baixo passa igual', () => {
    const x = new Float32Array([...tom(1, 0.05, SR), ...tom(1, 0.9, SR)]);   // −26 dBFS e −1 dBFS de pico
    const p = { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 5, release: 100, makeup: 0, mix: 100 };
    const r = C.comprimir([x], SR, p);
    assert.ok(quase(rmsDb(r.canais[0], 2000, 7000), rmsDb(x, 2000, 7000), 0.1), 'baixo: igual');
    const reducao = rmsDb(x, 12000, 15000) - rmsDb(r.canais[0], 12000, 15000);
    assert.ok(reducao > 10 && reducao < 16, `alto: reduziu ~14 dB (${reducao.toFixed(1)})`);
    assert.ok(r.maxReducaoDb > 10, 'informa o máximo segurado');
    assert.ok(r.reducaoDb.length > 0, 'envelope pra desenhar o vermelho');
    assert.equal(x[12000], tom(1, 0.9, SR)[4000], 'não mexe no original');
});

test('comprimir: mix 0 = original (com o gain in), makeup soma no final', () => {
    const x = tom(0.5, 0.9, SR);
    const seco = C.comprimir([x], SR, { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 5, release: 100, makeup: 0, mix: 0 });
    assert.ok(Math.abs(seco.canais[0][1000] - x[1000]) < 1e-6);
    const sub = C.comprimir([tom(0.5, 0.01, SR)], SR, { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 5, release: 100, makeup: 6, mix: 100 });
    assert.ok(quase(rmsDb(sub.canais[0], 1000, 3000) - rmsDb(tom(0.5, 0.01, SR), 1000, 3000), 6, 0.1));
});

test('comprimir: estéreo LINKADO (mesmo ganho nos dois lados, não muda a imagem)', () => {
    const esq = tom(0.5, 0.9, SR), dir = tom(0.5, 0.1, SR);
    const r = C.comprimir([esq, dir], SR, { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 5, release: 100, makeup: 0, mix: 100 });
    const i = 3000;
    assert.ok(Math.abs(r.canais[0][i] / esq[i] - r.canais[1][i] / dir[i]) < 1e-6);
});

test('presets na escola do Clarity: ratio 2–3,5, attack 8–12 ms, release 80–250 ms, knee 2–7', () => {
    const ids = C.PRESETS.map((p) => p.id);
    assert.deepEqual(ids, ['clarity', 'radio', 'redes', 'locucao', 'suave', 'volante']);
    for (const p of C.PRESETS) {
        assert.ok(p.ratio >= 1.5 && p.ratio <= 3.5, p.id);
        assert.ok(p.attack >= 8 && p.attack <= 12, p.id);
        assert.ok(p.release >= 80 && p.release <= 250, p.id);
        assert.ok(p.knee >= 2 && p.knee <= 7, p.id);
    }
    assert.equal(C.PADRAO.ativo, false, 'nasce DESLIGADO (não muda masters já aprovados)');
});

// ── Filtro de sidechain (21/10/2026): pedido dele "senti falta de grave" ──────
function mistura(seg, ampGrave, ampAgudo, sr) {
    const n = Math.round(seg * sr), a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = ampGrave * Math.sin(2 * Math.PI * 50 * i / sr) + ampAgudo * Math.sin(2 * Math.PI * 1000 * i / sr);
    return a;
}

test('sidechain 100 Hz: grave forte NÃO dispara o compressor (o grave passa inteiro)', () => {
    const sr = 44100, x = mistura(1, 0.8, 0.05, sr);              // bumbo/baixo forte + voz baixa
    const base = { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 10, release: 100, makeup: 0, mix: 100 };
    const sem = C.comprimir([x], sr, { ...base, sidechainHz: 0 });
    const com = C.comprimir([x], sr, { ...base, sidechainHz: 100 });
    assert.ok(sem.maxReducaoDb > 8, `sem filtro o grave faz segurar muito (${sem.maxReducaoDb.toFixed(1)})`);
    assert.ok(com.maxReducaoDb < 1, `com filtro quase não segura (${com.maxReducaoDb.toFixed(1)})`);
    assert.ok(Math.abs(com.canais[0][30000] - x[30000]) < 0.05, 'o áudio sai com o grave (o filtro é só no detector)');
});

test('sidechain: agudo forte continua sendo segurado normalmente', () => {
    const sr = 44100, x = mistura(1, 0.0, 0.8, sr);
    const r = C.comprimir([x], sr, { gainIn: 0, threshold: -20, ratio: 4, knee: 0, attack: 10, release: 100, makeup: 0, mix: 100, sidechainHz: 100 });
    assert.ok(r.maxReducaoDb > 8, `1 kHz forte é segurado (${r.maxReducaoDb.toFixed(1)})`);
});

test('todos os presets vêm com o sidechain em 100 Hz', () => {
    for (const p of C.PRESETS) assert.equal(p.sidechainHz, 100, p.id);
});
