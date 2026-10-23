// minidaw-react/src/lib/vozFatiada.js
/**
 * Voz fatiada por parágrafo na React (23/10/2026, pedido dele). A React guarda
 * UM áudio por faixa (com "Entra em"), então cada parágrafo vira uma faixa de
 * locução própria, entrando no mesmo tempo da gravação: tocadas juntas, as
 * faixas remontam a voz inteira. Os cortes vêm de /static/fatiar-paragrafos.js
 * (o mesmo da clássica). Testado em tests/voz-fatiada-react.test.mjs.
 */

/** Cortes (s) → pedaços contíguos em amostras: [{ ini, fim, inicio (s) }]. */
export function pedacosDosCortes(nAmostras, sr, cortes) {
    const pontos = [...new Set((cortes || [])
        .map((t) => Math.round(t * sr))
        .filter((i) => i > 0 && i < nAmostras))]
        .sort((a, b) => a - b);
    const bordas = [0, ...pontos, nAmostras];
    const out = [];
    for (let k = 0; k < bordas.length - 1; k++) {
        out.push({ ini: bordas[k], fim: bordas[k + 1], inicio: bordas[k] / sr });
    }
    return out;
}
