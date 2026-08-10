// minidaw-react/src/lib/correcaoTom.js
/**
 * Quanto mexer em cada uma das 4 bandas para aproximar o material da
 * referência. É aqui que mora o "imitar referência" — e o teto de ±6 dB NÃO É
 * NEGOCIÁVEL: correção sem limite destrói material, e o produtor perde a
 * confiança na ferramenta no primeiro susto.
 *
 * Sem referência não há correção: preset só mexe em volume, não em tom.
 */
export const TETO_CORRECAO_DB = 6;

export function calcularCorrecao(balancoFonte, balancoAlvo, intensidade) {
    if (!balancoAlvo) return balancoFonte.map(() => 0);
    const forca = Math.max(0, Math.min(1, intensidade ?? 1));
    return balancoFonte.map((db, i) => {
        const diferenca = (balancoAlvo[i] - db) * forca;
        return Math.max(-TETO_CORRECAO_DB, Math.min(TETO_CORRECAO_DB, diferenca));
    });
}
