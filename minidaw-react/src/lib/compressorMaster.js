// minidaw-react/src/lib/compressorMaster.js
/**
 * Compressor do Masterizar (21/10/2026) — padrão visual do "Dynamics" da Acon
 * Digital, que ele mostrou. Escrito em JS (não é o DynamicsCompressorNode do
 * navegador) pra DESENHAR exatamente o que ele fez: curva de transferência e a
 * redução de ganho (o vermelho) ao longo do áudio.
 *
 * Feed-forward, detector de pico em dB, estéreo LINKADO (mesmo ganho nos dois
 * lados), attack/release no domínio do dB, joelho suave, make-up e mix (paralelo).
 * Puro: testado no Node (tests/compressor-master.test.mjs).
 */

/** Presets na escola do "Clarity" da Acon (prints dele): ratio moderado, attack
 *  8–12 ms, release 80–250 ms, knee 2–7 dB. "clarity" = média das 4 bandas do print. */
export const PRESETS = [
    { id: 'clarity', nome: 'Clarity (padrão Acon)', gainIn: 2.5, threshold: -17, ratio: 2.6, knee: 4, attack: 11, release: 150, makeup: 0, mix: 100, sidechainHz: 100 },
    { id: 'radio', nome: 'Spot de rádio', gainIn: 0, threshold: -18, ratio: 3, knee: 4, attack: 10, release: 120, makeup: 0, mix: 100, sidechainHz: 100 },
    { id: 'redes', nome: 'Redes sociais', gainIn: 0, threshold: -16, ratio: 2, knee: 4, attack: 12, release: 160, makeup: 0, mix: 100, sidechainHz: 100 },
    { id: 'locucao', nome: 'Locução falada (podcast)', gainIn: 0, threshold: -20, ratio: 2, knee: 7, attack: 12, release: 250, makeup: 0, mix: 100, sidechainHz: 100 },
    { id: 'suave', nome: 'Suave (só cola)', gainIn: 0, threshold: -12, ratio: 2, knee: 7, attack: 12, release: 250, makeup: 0, mix: 100, sidechainHz: 100 },
    { id: 'volante', nome: 'Propaganda Volante', gainIn: 3, threshold: -20, ratio: 3.5, knee: 2, attack: 8, release: 80, makeup: 0, mix: 100, sidechainHz: 100 },
];

export const PADRAO = { ativo: false, preset: 'clarity', ...PRESETS[0] };

/** Limites dos botões (pra tela e pra validar). */
export const LIMITES = {
    gainIn: [-12, 12], threshold: [-60, 0], ratio: [1, 20], knee: [0, 24],
    attack: [0.1, 200], release: [10, 1000], makeup: [-12, 24], mix: [0, 100],
    sidechainHz: [0, 500],
};

/** Curva de transferência (dB de entrada → dB de saída), joelho suave. */
export function curva(x, { threshold: T, ratio: R, knee: W }) {
    const d = x - T;
    if (W > 0 && 2 * Math.abs(d) <= W) return x + ((1 / R - 1) * (d + W / 2) ** 2) / (2 * W);
    if (2 * d < -W || d <= 0) return x;
    return T + d / R;
}

const dbParaLin = (db) => Math.pow(10, db / 20);

/**
 * Filtro de SIDECHAIN (21/10/2026, pedido dele: "senti falta de grave"): passa-alta
 * de 24 dB/oitava (2 biquads Butterworth em série) SÓ no detector — o compressor
 * deixa de reagir ao grave (bumbo, baixo da trilha, peito da voz) e o grave passa
 * inteiro no áudio. Como o botão "Side chain filter" do Dynamics da Acon.
 * Devolve uma função (amostra) => amostra filtrada, com estado próprio.
 */
export function passaAlta(hz, sr) {
    const w = (2 * Math.PI * hz) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + al;
    const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = (1 + cs) / 2 / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
    const estagio = () => {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        return (x) => {
            const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            return y;
        };
    };
    const e1 = estagio(), e2 = estagio();
    return (x) => e2(e1(x));
}

/**
 * Comprime `canais` (Float32Array[]). Devolve { canais, reducaoDb, blocoS, maxReducaoDb }:
 * reducaoDb = maior redução (dB, ≥ 0) em cada bloco de ~10 ms, pra desenhar o vermelho.
 * Nunca altera os arrays recebidos.
 */
export function comprimir(canais, sr, p) {
    const n = canais[0].length;
    const gIn = dbParaLin(p.gainIn || 0);
    const mk = dbParaLin(p.makeup || 0);
    const k = Math.max(0, Math.min(100, p.mix ?? 100)) / 100;
    const aA = Math.exp(-1 / (Math.max(0.1, p.attack) / 1000 * sr));
    const aR = Math.exp(-1 / (Math.max(1, p.release) / 1000 * sr));
    const bloco = Math.max(1, Math.round(sr * 0.01));
    const saida = canais.map(() => new Float32Array(n));
    const reducao = new Float32Array(Math.ceil(n / bloco));
    let gr = 0, maxGr = 0;
    const sc = p.sidechainHz > 0 && p.sidechainHz < sr / 2 ? canais.map(() => passaAlta(p.sidechainHz, sr)) : null;
    for (let i = 0; i < n; i++) {
        let pico = 0;
        for (let c = 0; c < canais.length; c++) {
            const bruto = canais[c][i] * gIn;
            const v = Math.abs(sc ? sc[c](bruto) : bruto);   // detector ouve sem o grave; o áudio, não
            if (v > pico) pico = v;
        }
        const nivel = 20 * Math.log10(pico + 1e-12);
        const alvo = Math.max(0, nivel - curva(nivel, p));
        gr = alvo > gr ? aA * gr + (1 - aA) * alvo : aR * gr + (1 - aR) * alvo;
        const g = dbParaLin(-gr) * mk;
        for (let c = 0; c < canais.length; c++) {
            const seco = canais[c][i] * gIn;
            saida[c][i] = seco * g * k + seco * (1 - k);
        }
        const b = (i / bloco) | 0;
        if (gr > reducao[b]) reducao[b] = gr;
        if (gr > maxGr) maxGr = gr;
    }
    return { canais: saida, reducaoDb: reducao, blocoS: bloco / sr, maxReducaoDb: maxGr };
}
