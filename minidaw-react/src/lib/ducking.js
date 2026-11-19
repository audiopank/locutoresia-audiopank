// minidaw-react/src/lib/ducking.js
/**
 * 🎚️ Ducking (sidechain da voz) na trilha — 19/11/2026, pedido dele.
 * A trilha abaixa quando a voz entra e sobe nas pausas. Mesma escola da clássica
 * (static/mix-engine.js: detecção RMS 8% do pico, hold 0,7 s, rampas lineares).
 * Nasce DESLIGADO: trilha sem `ducking.ativo` não ganha nó nenhum (som idêntico).
 * Puro (sem AudioContext), testado em tests/ducking-react.test.mjs; o mixer usa.
 */
import { detectarTrechos } from './gate.js';

export const DUCK_PADRAO = { abaixaDb: 7, attack: 0.2, release: 0.65 };
export const DUCK_LIMITES = { abaixaDb: [0, 24], attack: [0.01, 2], release: [0.05, 4] };
const HOLD = 0.7;          // pausa menor que isso não solta a trilha
const SENSIBILIDADE = 8;   // 8% do pico = "tem voz" (o mesmo da clássica)

function campo(d, nome) {
    const v = Number(d[nome]);
    if (d[nome] == null || !Number.isFinite(v)) return DUCK_PADRAO[nome];
    const [min, max] = DUCK_LIMITES[nome];
    return Math.min(max, Math.max(min, v));
}

/** Ajuste da faixa → {ganho, attack, release}; null = desligado. */
export function paramsDucking(d) {
    if (!d || !d.ativo) return null;
    return { ganho: Math.pow(10, -campo(d, 'abaixaDb') / 20), attack: campo(d, 'attack'), release: campo(d, 'release') };
}

/** vozes: [{dados: Float32Array, sr, inicio}] → trechos [ini, fim] no tempo do mix, unidos pelo hold. */
export function trechosDeVoz(vozes) {
    const seg = [];
    for (const v of vozes) {
        for (const [a, b] of detectarTrechos(v.dados, v.sr, SENSIBILIDADE)) seg.push([v.inicio + a, v.inicio + b]);
    }
    if (!seg.length) return [];
    seg.sort((x, y) => x[0] - y[0]);
    const unidos = [seg[0].slice()];
    for (const s of seg.slice(1)) {
        const ult = unidos[unidos.length - 1];
        if (s[0] - ult[1] <= HOLD) ult[1] = Math.max(ult[1], s[1]);
        else unidos.push(s.slice());
    }
    return unidos;
}

/** Agenda do ganho de ducking (nível 1 = sem abaixar): [['set'|'ramp', valor, segundo]]. */
export function pontosDucking(trechos, p) {
    const ev = [];
    for (const [ini, fim] of trechos) {
        const t0 = Math.max(0, ini - p.attack);
        if (t0 > 0) ev.push(['set', 1, t0]);
        ev.push(['ramp', p.ganho, ini]);
        ev.push(['set', p.ganho, fim]);       // segura embaixo enquanto fala
        ev.push(['ramp', 1, fim + p.release]);
    }
    return ev;
}
