/**
 * 🧲 ALINHAR FALAS (29/10/2026, ideia dele vendo o Reaper) — MiniDAW clássica.
 *
 * Um clique: apara o silêncio das bordas de cada trecho de VOZ e põe as falas
 * em fila na ordem da linha do tempo — a 1ª entra em "voz entra em" (a trilha
 * abre o spot e a voz vem em 0,2–0,3 s, como em rádio) e cada uma começa no fim
 * da anterior + respiro. Cada trecho continua na MESMA faixa; trilha e efeito
 * não se movem; trecho com cadeado fica de fora. Aparar só mexe nas bordas
 * (offset/duração): o áudio original fica inteiro. Ctrl+Z desfaz tudo.
 *
 * Matemática pura — testada em tests/alinhar-falas.test.mjs.
 */
(function (global) {
    'use strict';

    const JANELA_S = 0.01;
    const ABAIXO_DA_FALA_DB = 35;     // borda = 35 dB abaixo do nível típico da fala
    const PISO_DB = -60;              // nunca considera fala o que estiver abaixo disto
    const FOLGA_ANTES = 0.04;         // não come o ataque da 1ª sílaba
    const FOLGA_DEPOIS = 0.08;        // nem o fim do "s"/respiração da última

    /** Bordas da fala dentro de [ini, fim) (amostras). → { ini, fim } ou null (só silêncio). */
    function bordasDaFala(amostras, sr, ini, fim) {
        const tam = Math.max(1, Math.round(sr * JANELA_S));
        const nJ = Math.floor((fim - ini) / tam);
        if (nJ < 1) return null;
        const db = new Float32Array(nJ);
        for (let j = 0; j < nJ; j++) {
            let s = 0;
            const a0 = ini + j * tam;
            for (let k = a0; k < a0 + tam; k++) s += amostras[k] * amostras[k];
            db[j] = 10 * Math.log10(s / tam + 1e-12);
        }
        const ord = Array.from(db).sort((a, b) => a - b);
        const fala = ord[Math.floor(ord.length * 0.9)];
        if (!(fala > PISO_DB)) return null;
        const limiar = Math.max(PISO_DB, fala - ABAIXO_DA_FALA_DB);
        let p = 0, u = nJ - 1;
        while (p < nJ && db[p] < limiar) p++;
        while (u > p && db[u] < limiar) u--;
        if (p >= nJ) return null;
        return {
            ini: Math.max(ini, ini + p * tam - Math.round(FOLGA_ANTES * sr)),
            fim: Math.min(fim, ini + (u + 1) * tam + Math.round(FOLGA_DEPOIS * sr)),
        };
    }

    /**
     * itens: [{ chave, inicio, offset, duracao, cortaIni, cortaFim }] — corta* em
     * segundos a partir do começo do trecho. → [{ chave, inicio, offset, duracao }]
     * na ordem da linha do tempo. entrada = s da 1ª fala (null = onde já começava).
     */
    function planejar(itens, { entrada = 0.3, respiro = 0.1 } = {}) {
        const ord = itens.slice().sort((a, b) => (a.inicio + a.cortaIni) - (b.inicio + b.cortaIni));
        const out = [];
        let t = null;
        for (const it of ord) {
            const dur = Math.max(0.05, it.cortaFim - it.cortaIni);
            if (t == null) t = entrada == null ? it.inicio + it.cortaIni : Math.max(0, entrada);
            out.push({ chave: it.chave, inicio: t, offset: it.offset + it.cortaIni, duracao: dur });
            t = t + dur + Math.max(0, respiro);
        }
        return out;
    }

    function contarSobreposicoes(clips) {
        const l = clips.slice().sort((a, b) => a.inicio - b.inicio);
        let n = 0;
        for (let i = 0; i < l.length; i++)
            for (let j = i + 1; j < l.length && l[j].inicio < l[i].inicio + l[i].duracao - 1e-6; j++) n++;
        return n;
    }

    const AlinharFalas = { bordasDaFala, planejar, contarSobreposicoes, FOLGA_ANTES, FOLGA_DEPOIS };
    global.AlinharFalas = AlinharFalas;
    if (typeof module !== 'undefined' && module.exports) module.exports = AlinharFalas;
})(typeof window !== 'undefined' ? window : globalThis);
