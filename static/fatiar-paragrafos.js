/**
 * Voz fatiada por parágrafo (22/10/2026, ideia dele): a locução gerada chega na
 * MiniDAW clássica já cortada nos intervalos de parágrafo do roteiro.
 *
 * Uma geração só (não gasta cota do TTS nem muda a interpretação): conta os N
 * parágrafos do roteiro e corta a voz no MEIO das N−1 maiores pausas. Cortar no
 * meio da pausa = os pedaços colados soam IDÊNTICOS ao arquivo.
 *
 * MATEMÁTICA PURA (sem DOM/Web Audio) — testado em tests/fatiar-paragrafos.test.mjs.
 */
(function (global) {
    'use strict';

    const JANELA_S = 0.01;        // envelope em blocos de 10 ms
    const PAUSA_MIN_S = 0.08;     // menos que isso é respiro entre palavras
    const ABAIXO_DA_FALA_DB = 30; // pausa = 30 dB abaixo do nível típico da fala

    /** Cada linha com texto é um parágrafo (o roteiro chega com quebra de linha). */
    function contarParagrafos(texto) {
        return String(texto || '').split(/\r?\n/).filter(l => l.trim()).length;
    }

    /**
     * Tempos (s) dos cortes: o meio das N−1 maiores pausas internas, em ordem.
     * `amostras` = Float32Array mono. Devolve menos cortes se não houver pausas.
     */
    function acharCortes(amostras, sr, nParagrafos) {
        if (!amostras || !amostras.length || nParagrafos < 2) return [];
        const tam = Math.max(1, Math.round(sr * JANELA_S));
        const nJ = Math.floor(amostras.length / tam);
        const db = new Float32Array(nJ);
        for (let j = 0; j < nJ; j++) {
            let s = 0;
            for (let k = j * tam; k < (j + 1) * tam; k++) s += amostras[k] * amostras[k];
            db[j] = 10 * Math.log10(s / tam + 1e-12);
        }
        // Nível típico da fala = percentil 90 do envelope (ignora picos isolados).
        const ord = Array.from(db).sort((a, b) => a - b);
        const fala = ord[Math.floor(ord.length * 0.9)];
        if (!(fala > -60)) return [];                       // arquivo é só silêncio
        const limiar = fala - ABAIXO_DA_FALA_DB;

        // Trechos contínuos abaixo do limiar, sem os que encostam no começo/fim.
        const pausas = [];
        let ini = -1;
        for (let j = 0; j <= nJ; j++) {
            const quieto = j < nJ && db[j] < limiar;
            if (quieto && ini < 0) ini = j;
            if (!quieto && ini >= 0) {
                if (ini > 0 && j < nJ && (j - ini) * JANELA_S >= PAUSA_MIN_S) pausas.push({ ini, fim: j });
                ini = -1;
            }
        }
        return pausas
            .sort((a, b) => (b.fim - b.ini) - (a.fim - a.ini))
            .slice(0, nParagrafos - 1)
            .map(p => ((p.ini + p.fim) / 2) * tam / sr)
            .sort((a, b) => a - b);
    }

    const FatiarParagrafos = { contarParagrafos, acharCortes };
    global.FatiarParagrafos = FatiarParagrafos;
    if (typeof module !== 'undefined' && module.exports) module.exports = FatiarParagrafos;
})(typeof window !== 'undefined' ? window : globalThis);
