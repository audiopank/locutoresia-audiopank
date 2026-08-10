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

/**
 * Pico REAL (inter-amostra), em dB. O pico que estoura na conversão para MP3
 * mora ENTRE as amostras e não aparece num medidor comum — é por isso que um
 * áudio "limpo" no fone chia no alto-falante do cliente. Sobre-amostragem 4x
 * por interpolação linear: não é a precisão de um medidor de laboratório, mas
 * pega o caso que interessa, que é o pico escondido logo depois do limiter.
 */
export function picoRealDb(canal, _sr) {
    let pico = 0;
    for (let i = 0; i < canal.length - 1; i++) {
        const a = canal[i], b = canal[i + 1];
        for (let k = 0; k < 4; k++) {
            const v = Math.abs(a + (b - a) * (k / 4));
            if (v > pico) pico = v;
        }
    }
    const ultimo = Math.abs(canal[canal.length - 1] || 0);
    if (ultimo > pico) pico = ultimo;
    return pico > 0 ? 20 * Math.log10(pico) : -Infinity;
}

/** Pico real do conjunto de canais (o maior deles). */
export function picoRealDbTodos(canais, sr) {
    return Math.max(...canais.map((c) => picoRealDb(c, sr)));
}

/**
 * Distância entre o pico e o volume médio. Número alto = material dinâmico;
 * número baixo = já espremido (e portanto pouco espaço para masterizar).
 */
export function faixaDinamica(canais, sr) {
    const lufs = lufsIntegrado(canais, sr);
    const pico = picoRealDbTodos(canais, sr);
    if (!Number.isFinite(lufs) || !Number.isFinite(pico)) return 0;
    return pico - lufs;
}

/** Bordas das 4 bandas largas: grave, médio-grave, médio-agudo, agudo. */
export const BANDAS = [
    { nome: 'grave', de: 20, ate: 200 },
    { nome: 'medio-grave', de: 200, ate: 1200 },
    { nome: 'medio-agudo', de: 1200, ate: 5000 },
    { nome: 'agudo', de: 5000, ate: 16000 },
];

/**
 * Energia média de cada banda, em dB. É a base do "imitar referência": mede-se
 * o seu material e o da referência, e a diferença vira a correção.
 * Quatro bandas e não mais: cada banda a mais é uma chance a mais de artefato
 * e uma explicação a menos que o produtor consegue dar ao ouvir o resultado.
 *
 * Usa Goertzel em algumas frequências por banda em vez de FFT completa — é
 * barato, suficiente para um balanço grosso, e não traz dependência nova.
 */
export function balancoTonal(canais, sr) {
    const mono = misturarMono(canais);
    const amostrasMax = Math.min(mono.length, sr * 30);   // 30s bastam para o balanço
    return BANDAS.map((b) => {
        const freqs = [b.de * 1.3, Math.sqrt(b.de * b.ate), b.ate * 0.77];
        let energia = 0;
        for (const f of freqs) energia += goertzel(mono, amostrasMax, sr, f);
        const media = energia / freqs.length;
        return media > 0 ? 10 * Math.log10(media) : -120;
    });
}

/** Média dos canais num só (o balanço tonal não precisa de estéreo). */
export function misturarMono(canais) {
    const n = canais[0].length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (const c of canais) s += c[i];
        out[i] = s / canais.length;
    }
    return out;
}

/** Energia numa frequência única, sem FFT. */
export function goertzel(dados, n, sr, freq) {
    const k = 2 * Math.cos(2 * Math.PI * freq / sr);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
        s0 = dados[i] + k * s1 - s2;
        s2 = s1; s1 = s0;
    }
    const potencia = s1 * s1 + s2 * s2 - k * s1 * s2;
    return Math.max(0, potencia) / n;
}
