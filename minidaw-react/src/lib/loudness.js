/**
 * Medição de loudness — MATEMÁTICA PURA, sem DOM e sem Web Audio.
 *
 * Existe em .js (e não .ts) de propósito: `node --test` roda isto direto, sem
 * compilador. Mesmo motivo de static/clip-model.js. Toda conta de medição entra
 * AQUI, não solta nos componentes.
 *
 * Base: ITU-R BS.1770-4. Os coeficientes do padrão são publicados para 48 kHz;
 * aqui eles são recalculados para a taxa real do arquivo pelas fórmulas de
 * biquad (RBJ), o que reproduz o padrão em 48k e se comporta certo em 44,1k.
 */

/** Shelf de agudos do BS.1770: f0 1681,97 Hz, +3,9998 dB, Q 0,7071. */
export function coefShelfAgudo(sr) {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const A = Math.pow(10, G / 40);
    const w0 = 2 * Math.PI * f0 / sr;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const raizA2alpha = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * cw + raizA2alpha;
    return {
        b0: A * ((A + 1) + (A - 1) * cw + raizA2alpha) / a0,
        b1: -2 * A * ((A - 1) + (A + 1) * cw) / a0,
        b2: A * ((A + 1) + (A - 1) * cw - raizA2alpha) / a0,
        a1: 2 * ((A - 1) - (A + 1) * cw) / a0,
        a2: ((A + 1) - (A - 1) * cw - raizA2alpha) / a0,
    };
}

/** Passa-alta RLB do BS.1770: f0 38,13 Hz, Q 0,5003. */
export function coefPassaAlta(sr) {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const w0 = 2 * Math.PI * f0 / sr;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
        b0: ((1 + cw) / 2) / a0,
        b1: (-(1 + cw)) / a0,
        b2: ((1 + cw) / 2) / a0,
        a1: (-2 * cw) / a0,
        a2: (1 - alpha) / a0,
    };
}

/** Aplica um biquad (forma direta I) sobre o canal, devolvendo um array novo. */
export function biquad(canal, c) {
    const y = new Float32Array(canal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < canal.length; i++) {
        const x0 = canal[i];
        const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        y[i] = y0;
    }
    return y;
}

/** Os dois estágios do filtro K, em sequência. */
export function filtroK(canal, sr) {
    return biquad(biquad(canal, coefShelfAgudo(sr)), coefPassaAlta(sr));
}

/** Peso por canal do BS.1770. Estéreo e mono usam 1,0; surround pesa mais. */
const PESO_CANAL = [1.0, 1.0, 1.0, 1.41, 1.41];

/**
 * Média quadrática de cada bloco de 400 ms, com 75% de sobreposição.
 * Devolve [{ ms, l }]: a soma ponderada dos canais e o loudness do bloco.
 */
export function blocosDeLoudness(canais, sr) {
    const filtrados = canais.map((c) => filtroK(c, sr));
    const tamanho = Math.round(0.4 * sr);          // bloco de 400 ms
    const passo = Math.round(0.1 * sr);            // avanço de 100 ms = 75% de sobreposição
    const n = filtrados[0].length;
    const blocos = [];
    if (n < tamanho) return blocos;                // curto demais para um bloco
    for (let ini = 0; ini + tamanho <= n; ini += passo) {
        let soma = 0;
        for (let ch = 0; ch < filtrados.length; ch++) {
            const dados = filtrados[ch];
            let acc = 0;
            for (let i = ini; i < ini + tamanho; i++) acc += dados[i] * dados[i];
            soma += (PESO_CANAL[ch] ?? 1.0) * (acc / tamanho);
        }
        blocos.push({ ms: soma, l: -0.691 + 10 * Math.log10(soma || Number.MIN_VALUE) });
    }
    return blocos;
}

/**
 * LUFS integrado. Os DOIS portões do padrão importam aqui:
 * o absoluto (-70) joga fora silêncio digital; o relativo (-10 abaixo da média
 * dos que passaram) impede que as pausas entre as frases puxem a média para
 * baixo — é ele que faz um spot com respiros medir igual a um sem.
 */
export function lufsIntegrado(canais, sr) {
    const blocos = blocosDeLoudness(canais, sr);
    if (!blocos.length) return -Infinity;

    const passouAbsoluto = blocos.filter((b) => b.l > -70);
    if (!passouAbsoluto.length) return -Infinity;

    const mediaMs = (lista) => lista.reduce((s, b) => s + b.ms, 0) / lista.length;
    const gamma = -0.691 + 10 * Math.log10(mediaMs(passouAbsoluto)) - 10;

    const passouRelativo = passouAbsoluto.filter((b) => b.l > gamma);
    if (!passouRelativo.length) return -Infinity;

    return -0.691 + 10 * Math.log10(mediaMs(passouRelativo));
}
