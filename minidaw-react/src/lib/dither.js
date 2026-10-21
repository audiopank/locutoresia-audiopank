// minidaw-react/src/lib/dither.js
/**
 * Dither na conversão pra 16 bits (21/10/2026, pedido dele: "senti falta apenas
 * dos dither"). Sem dither, cortar as casas decimais vira distorção áspera nos
 * fades e finais; o dither troca isso por um chiado finíssimo (~−96 dB).
 *   'tpdf'        — ruído triangular de ±1 bit (o padrão de estúdio)
 *   'tpdf_shaped' — TPDF + noise shaping de 1ª ordem: o chiado vai pros agudos
 *                   extremos, onde o ouvido quase não escuta
 *   null          — conversão seca, IGUAL à de antes
 * Aplicar UMA vez só, na exportação final (Masterizar) — nunca em edição
 * intermediária (acumularia ruído). Testado em tests/dither.test.mjs.
 */

export const MODOS_DITHER = [
    { id: 'tpdf', nome: 'TPDF (padrão de estúdio)' },
    { id: 'tpdf_shaped', nome: 'TPDF + noise shaping' },
    { id: '', nome: 'Desligado' },
];

/** Float32 (−1..1) → Int16Array. `aleatorio` () => [0,1) (injetável pro teste). */
export function quantizar16(f32, modo = null, aleatorio = Math.random) {
    const out = new Int16Array(f32.length);
    if (!modo) {
        for (let i = 0; i < f32.length; i++) {
            const v = Math.max(-1, Math.min(1, f32[i]));
            out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;          // mesma conversão de antes
        }
        return out;
    }
    const moldar = modo === 'tpdf_shaped';
    let erroAnterior = 0;
    for (let i = 0; i < f32.length; i++) {
        let alvo = Math.max(-1, Math.min(1, f32[i])) * 32768;
        if (moldar) alvo -= erroAnterior;                        // devolve o erro passado (empurra pro agudo)
        const tpdf = aleatorio() - aleatorio();                  // triangular, ±1 LSB
        let q = Math.round(alvo + tpdf);
        if (q > 32767) q = 32767; else if (q < -32768) q = -32768;
        if (moldar) erroAnterior = q - alvo;
        out[i] = q;
    }
    return out;
}
