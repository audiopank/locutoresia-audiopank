// minidaw-react/src/lib/edicaoOnda.js
/**
 * Onda real e edição destrutiva por faixa da MiniDAW React (17/10/2026).
 * Pedido dele: "só falta aparecer as ondas sonoras pra ficar profissional e poder
 * editar erro de locução". Funções puras sobre Float32Array (um por canal) —
 * nada de AudioContext aqui, pra testar no Node (tests/edicao-onda.test.mjs).
 * Nunca mexem no array recebido: o Desfazer depende do original intacto.
 */

/** Envelope por pixel: [[min, max], ...] com `largura` posições. */
export function picos(canal, largura) {
    const n = canal.length;
    const saida = [];
    for (let px = 0; px < largura; px++) {
        const ini = Math.min(n - 1, Math.floor((px * n) / largura));
        const fim = Math.min(n, Math.max(ini + 1, Math.floor(((px + 1) * n) / largura)));
        let mn = Infinity, mx = -Infinity;
        for (let i = ini; i < fim; i++) {
            const v = canal[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        saida.push(n ? [mn, mx] : [0, 0]);
    }
    return saida;
}

/** Ordena, limita a [0, duracao] e recusa trecho menor que 20 ms (clique sem arrastar). */
export function trechoValido(a, b, duracao) {
    const ini = Math.max(0, Math.min(a, b));
    const fim = Math.min(duracao, Math.max(a, b));
    return fim - ini < 0.02 ? null : [ini, fim];
}

function indices(n, sr, ini, fim) {
    const i0 = Math.max(0, Math.min(n, Math.round(ini * sr)));
    const i1 = Math.max(0, Math.min(n, Math.round(fim * sr)));
    if (i1 <= i0) throw new Error('Marque um trecho na onda primeiro.');
    return [i0, i1];
}

/**
 * Remove [ini, fim) segundos e junta as pontas. Micro-fade de `fadeMs` dos dois
 * lados da emenda (desce até zero antes, sobe de zero depois) pra não estalar.
 */
export function cortarTrecho(canais, sr, ini, fim, fadeMs = 10) {
    const n = canais[0].length;
    const [i0, i1] = indices(n, sr, ini, fim);
    if (i0 === 0 && i1 === n) throw new Error('Não dá pra cortar o áudio inteiro — apague a faixa.');
    const f = Math.round((fadeMs / 1000) * sr);
    return canais.map((c) => {
        const out = new Float32Array(n - (i1 - i0));
        out.set(c.subarray(0, i0), 0);
        out.set(c.subarray(i1), i0);
        const fAntes = Math.min(f, i0);
        for (let k = 0; k < fAntes; k++) out[i0 - 1 - k] *= k / fAntes;
        const fDepois = Math.min(f, n - i1);
        for (let k = 0; k < fDepois; k++) out[i0 + k] *= k / fDepois;
        return out;
    });
}

/** Zera [ini, fim) mantendo a duração, com fade nas bordas (respiração, ruído). */
export function silenciarTrecho(canais, sr, ini, fim, fadeMs = 10) {
    const n = canais[0].length;
    const [i0, i1] = indices(n, sr, ini, fim);
    const f = Math.round((fadeMs / 1000) * sr);
    return canais.map((c) => {
        const out = new Float32Array(c);
        out.fill(0, i0, i1);
        for (let k = 1; k <= f && i0 - k >= 0; k++) out[i0 - k] *= k / (f + 1);
        for (let k = 1; k <= f && i1 - 1 + k < n; k++) out[i1 - 1 + k] *= k / (f + 1);
        return out;
    });
}

// ── Zoom + rolagem por faixa (17/10/2026) ──────────────────────────────────
// Pedido dele: zoom +/− nos objetos (voz e trilha) e barra de rolagem embaixo.
// Conteúdo "virtual" = largura × zoom pixels; a tela mostra `largura` px a
// partir da rolagem. O canvas nunca cresce (limite de ~32 mil px do navegador).

/** [t0, t1] em segundos do que aparece na tela. */
export function janelaVisivel(duracao, largura, zoom, rolagem) {
    const total = largura * zoom;
    const r = Math.max(0, Math.min(total - largura, rolagem || 0));
    return [(r / total) * duracao, ((r + largura) / total) * duracao];
}

/** Rolagem que deixa o tempo `t` no pixel `xTela` com este zoom (limitada ao conteúdo). */
export function rolagemParaAncora(t, xTela, duracao, largura, zoom) {
    const total = largura * zoom;
    const r = (duracao ? t / duracao : 0) * total - xTela;
    return Math.round(Math.max(0, Math.min(total - largura, r)));
}

/** Envelope só do trecho [t0, t1] do áudio, em `largura` pixels. */
export function picosDaJanela(canal, sr, t0, t1, largura) {
    const i0 = Math.max(0, Math.min(canal.length - 1, Math.floor(t0 * sr)));
    const i1 = Math.max(i0 + 1, Math.min(canal.length, Math.ceil(t1 * sr)));
    return picos(canal.subarray(i0, i1), largura);
}
