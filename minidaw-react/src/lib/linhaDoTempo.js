// minidaw-react/src/lib/linhaDoTempo.js
/**
 * Linha do tempo do mix (17/10/2026). Pedido dele: a assinatura cantada do jingle
 * (ex.: Crato) entra num track NOVO depois da locução, e o fade da trilha não pode
 * derrubar o som antes dela. Cada faixa ganha:
 *   inicio  — "Entra em" (segundos; antes toda faixa começava no 0)
 *   fade    — só trilha: 'voz' (padrão: desce quando a locução acaba),
 *             'fim' (desce quando o SPOT acaba — fica por baixo do jingle),
 *             'nenhum' (toca até o próprio fim — o jingle usa este).
 * Puro (sem AudioContext), testado em tests/linha-do-tempo.test.mjs; o mixer usa.
 */

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function inicioValido(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fim da última fala (Entra em + duração). 0 sem locução. */
export function fimDaVoz(faixas) {
    return r6(Math.max(0, ...faixas.filter((f) => f.type === 'voiceover').map((f) => inicioValido(f.inicio) + (f.duracao || 0))));
}

/**
 * faixas: [{ type, duracao, inicio?, fade? }] → {
 *   fimDaVoz, fimDoSpot, duracao (do mix),
 *   faixas: [{ inicio, fadeEm }]   (fadeEm = segundo em que a trilha começa a descer; null = sem fade)
 * }
 */
export function linhaDoTempo(faixas, fadeDepois = 1.1) {
    const vozFim = fimDaVoz(faixas);
    const temVoz = faixas.some((f) => f.type === 'voiceover');
    const base = faixas.map((f) => {
        const inicio = inicioValido(f.inicio);
        const fim = r6(inicio + (f.duracao || 0));
        let modo = null;
        if (f.type === 'music') {
            modo = ['voz', 'fim', 'nenhum'].includes(f.fade) ? f.fade : 'voz';
            if (!temVoz && modo === 'voz') modo = 'nenhum';   // sem locução a trilha toca inteira (como antes)
        }
        return { inicio, fim, modo };
    });

    // Fim de cada faixa que NÃO depende do fim do spot.
    const terminoProprio = (b) => {
        if (b.modo === 'voz' && vozFim < b.fim) return r6(vozFim + fadeDepois);
        return b.fim;
    };
    const quemDefine = base.filter((b) => b.modo !== 'fim');
    const fimDoSpot = quemDefine.length
        ? r6(Math.max(...quemDefine.map(terminoProprio)))
        : r6(Math.max(0, ...base.map((b) => b.fim)));

    let duracao = 0;
    const saida = base.map((b) => {
        let fadeEm = null;
        if (b.modo === 'voz' && vozFim < b.fim) fadeEm = vozFim;
        if (b.modo === 'fim' && quemDefine.length && fimDoSpot < b.fim) fadeEm = fimDoSpot;
        const termina = fadeEm != null ? r6(fadeEm + fadeDepois) : b.fim;
        duracao = Math.max(duracao, termina);
        return { inicio: b.inicio, fadeEm };
    });
    return { fimDaVoz: vozFim, fimDoSpot, duracao: r6(duracao), faixas: saida };
}
