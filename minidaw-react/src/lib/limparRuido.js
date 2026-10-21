// minidaw-react/src/lib/limparRuido.js
/**
 * "🧹 Limpar ruído" da MiniDAW React (21/10/2026, pedido dele: voz gravada em
 * ambiente ruidoso; escolheu o RNNoise por ser grátis e rodar no navegador).
 * RNNoise (Xiph) em WebAssembly — pacote @shiguredo/rnnoise-wasm (Apache-2.0).
 * Bom pra ruído CONTÍNUO (ventilador, ar-condicionado, rua, chiado); fraco com
 * TV, música ou gente falando ao fundo.
 *
 * É EFEITO (liga/desliga no painel da faixa): o mixer aplica na cópia decodificada
 * na hora do Play verde/Prévia/Exportar — o arquivo da faixa nunca é alterado.
 * O RNNoise trabalha em 48 kHz, quadros de 480 amostras, escala de 16 bits.
 */

/** Atraso do RNNoise (amostras a 48 kHz), medido no Chrome em 21/10/2026. */
export const ATRASO_RNNOISE = 960;   // 2 quadros (20 ms) — medido por correlação com locução real

/**
 * Passa `canal` pelo limpador em quadros de `tamanhoQuadro` (completa o fim com
 * zero) e devolve um NOVO Float32Array do mesmo tamanho, já sem o `atraso` do
 * limpador. Puro: o RNNoise entra por `processar(quadro)` (altera o quadro na hora).
 */
export function limparCanal(canal, tamanhoQuadro, processar, atraso = 0) {
    const n = canal.length;
    const quadros = Math.ceil((n + atraso) / tamanhoQuadro);
    const saida = new Float32Array(quadros * tamanhoQuadro);
    const q = new Float32Array(tamanhoQuadro);
    for (let k = 0; k < quadros; k++) {
        const ini = k * tamanhoQuadro;
        for (let i = 0; i < tamanhoQuadro; i++) {
            const j = ini + i;
            q[i] = j < n ? canal[j] * 32768 : 0;
        }
        processar(q);
        for (let i = 0; i < tamanhoQuadro; i++) saida[ini + i] = q[i] / 32768;
    }
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) r[i] = Math.max(-1, Math.min(1, saida[i + atraso]));
    return r;
}

// O RNNoise vem do jsDelivr com a VERSÃO TRAVADA: o arquivo tem 4,8 MB (modelo embutido)
// e na Vercel tudo passa pela função, que recusa resposta acima de 4,5 MB — servido
// pelo app ele daria HTTP 500. Só baixa na 1ª vez que alguém liga o efeito; o
// navegador guarda em cache.
const URL_RNNOISE = 'https://cdn.jsdelivr.net/npm/@shiguredo/rnnoise-wasm@2025.1.5/dist/rnnoise.js';
let carregando = null;

/** AudioBuffer → AudioBuffer limpo, a 48 kHz (o mixer reamostra sozinho). Só navegador. */
export async function limparRuidoBuffer(buffer) {
    if (!carregando) {
        carregando = import(/* @vite-ignore */ URL_RNNOISE).then((m) => m.Rnnoise.load());
        carregando.catch(() => { carregando = null; });   // falhou (sem internet?): tenta de novo na próxima
    }
    let rnnoise;
    try {
        rnnoise = await carregando;
    } catch (e) {
        throw new Error('Não consegui carregar o limpador de ruído (precisa de internet). Desligue "Limpar ruído" ou tente de novo.');
    }
    const SR = 48000;
    let fonte = buffer;
    if (buffer.sampleRate !== SR) {
        const off = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * SR), SR);
        const src = off.createBufferSource();
        src.buffer = buffer;
        src.connect(off.destination);
        src.start(0);
        fonte = await off.startRendering();
    }
    const limpo = new AudioBuffer({ length: fonte.length, numberOfChannels: fonte.numberOfChannels, sampleRate: SR });
    for (let c = 0; c < fonte.numberOfChannels; c++) {
        const estado = rnnoise.createDenoiseState();   // um estado por canal
        try {
            limpo.copyToChannel(limparCanal(fonte.getChannelData(c), rnnoise.frameSize, (q) => estado.processFrame(q), ATRASO_RNNOISE), c);
        } finally {
            estado.destroy();
        }
    }
    return limpo;
}
