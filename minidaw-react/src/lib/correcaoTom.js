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

// Diferença de tom entre a fonte e a referência, banda a banda -- SÓ a forma,
// nunca o nível geral. balancoTonal() devolve energia ABSOLUTA por banda; se
// subtraíssemos direto, um material simplesmente mais baixo ou mais alto que
// a referência (o caso comum: mix crua vs. jingle comercial já masterizado)
// dominaria a conta e toda banda saturaria no mesmo +-6dB, sem forma nenhuma.
// O nível geral já é resolvido à parte pelo ganho mirando o alvoLufs -- aqui
// interessa só o desenho grave/médio/agudo relativo.
function centralizar(balanco) {
    const media = balanco.reduce((s, v) => s + v, 0) / balanco.length;
    return balanco.map((v) => v - media);
}

export function calcularCorrecao(balancoFonte, balancoAlvo, intensidade) {
    if (!balancoAlvo) return balancoFonte.map(() => 0);
    const forca = Math.max(0, Math.min(1, intensidade ?? 1));
    const fonteCentrada = centralizar(balancoFonte);
    const alvoCentrado = centralizar(balancoAlvo);
    return fonteCentrada.map((db, i) => {
        const diferenca = (alvoCentrado[i] - db) * forca;
        return Math.max(-TETO_CORRECAO_DB, Math.min(TETO_CORRECAO_DB, diferenca));
    });
}
