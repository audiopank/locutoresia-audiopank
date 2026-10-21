// minidaw-react/src/lib/mastering.js
/**
 * A cadeia de masterização, em OfflineAudioContext.
 *
 * ⚠️ NÃO importa nem modifica mixer.ts. A masterização é um estágio separado,
 * que recebe um AudioBuffer PRONTO — de onde quer que ele venha (React,
 * MiniDAW clássica, teclado do produtor, terceiros).
 *
 * Ordem fixa: corte baixo → 4 bandas de tom → corte alto → ganho → limiter.
 * Depois de renderizar, o resultado é MEDIDO DE NOVO: o número que a tela
 * mostra é sempre o medido, nunca o pedido.
 */
import { lufsIntegrado, picoRealDbTodos, balancoTonal, BANDAS } from './loudness.js';
import { calcularCorrecao } from './correcaoTom.js';
import { comprimir } from './compressorMaster.js';

/** Extrai os canais de um AudioBuffer como Float32Array[]. */
export function canaisDe(buffer) {
    const out = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
    return out;
}

/** Medição completa de um AudioBuffer. Usada no original E no resultado. */
export function medir(buffer) {
    const canais = canaisDe(buffer);
    const sr = buffer.sampleRate;
    // lufs e picoDb calculados UMA vez e reaproveitados -- faixaDinamica()
    // solta os recalcularia do zero por dentro, dobrando o custo (medido:
    // ~7.7s em vez de ~3.6s num arquivo de 5min estereo).
    const lufs = lufsIntegrado(canais, sr);
    const picoDb = picoRealDbTodos(canais, sr);
    return {
        lufs,
        picoDb,
        faixaDinamica: (Number.isFinite(lufs) && Number.isFinite(picoDb)) ? (picoDb - lufs) : 0,
        balanco: balancoTonal(canais, sr),
        duracao: buffer.duration,
        sampleRate: sr,
        canais: buffer.numberOfChannels,
    };
}

/**
 * Masteriza. `opcoes`:
 *   alvoLufs, tetoDb        — do destino escolhido
 *   corteBaixoHz            — 0 desliga
 *   corteAltoHz             — 0 desliga
 *   intensidade             — 0..1, força da correção de tom
 *   balancoReferencia       — array de 4 dB, ou null (sem referência = sem correção de tom)
 *   gravesDb                — 0..8: reforço de grave (low-shelf em 100 Hz). 0 = cadeia igual à de antes.
 *   compressor              — { ativo, gainIn, threshold, ratio, knee, attack, release, makeup, mix, sidechainHz }
 *                             (compressorMaster.js). Desligado = cadeia IGUAL à de antes.
 * Devolve { buffer, medicao, ganhoAplicadoDb, correcaoDb, compressor? }.
 */
export async function masterizar(bufferOriginal, opcoes) {
    const {
        alvoLufs, tetoDb,
        corteBaixoHz = 20, corteAltoHz = 0,
        intensidade = 0.5, balancoReferencia = null, compressor = null, gravesDb = 0,
    } = opcoes;

    const medicaoOriginal = medir(bufferOriginal);
    const correcaoDb = calcularCorrecao(medicaoOriginal.balanco, balancoReferencia, intensidade);

    const comComp = !!(compressor && compressor.ativo);
    let ganhoDb = Number.isFinite(medicaoOriginal.lufs) ? (alvoLufs - medicaoOriginal.lufs) : 0;
    let infoComp = null;

    const novoContexto = (buf) => {
        const c = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
        const f = c.createBufferSource();
        f.buffer = buf;
        return { c, f };
    };

    // Estágio 1 — tom: corte baixo, 4 bandas, corte alto.
    const cadeiaTom = (ctx, ligar) => {
    if (corteBaixoHz > 0) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = corteBaixoHz; hp.Q.value = 0.707;
        ligar(hp);
    }

    // GRAVES (21/10/2026, pedido dele: "senti falta de grave"): low-shelf em 100 Hz.
    // Zero = nenhum nó a mais (masters antigos saem idênticos).
    if (gravesDb > 0.05) {
        const lsh = ctx.createBiquadFilter();
        lsh.type = 'lowshelf'; lsh.frequency.value = 100; lsh.gain.value = Math.min(8, gravesDb);
        ligar(lsh);
    }

    // Uma banda de tom por faixa de frequência, centrada geometricamente.
    correcaoDb.forEach((db, i) => {
        if (Math.abs(db) < 0.05) return;      // ganho irrelevante: não gasta nó
        const banda = BANDAS[i];
        const f = ctx.createBiquadFilter();
        if (i === 0) { f.type = 'lowshelf'; f.frequency.value = banda.ate; }
        else if (i === BANDAS.length - 1) { f.type = 'highshelf'; f.frequency.value = banda.de; }
        else {
            f.type = 'peaking';
            f.frequency.value = Math.sqrt(banda.de * banda.ate);
            f.Q.value = 0.9;
        }
        f.gain.value = db;
        ligar(f);
    });

    if (corteAltoHz > 0) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = corteAltoHz; lp.Q.value = 0.707;
        ligar(lp);
    }
    };

    // Estágio 2 — ganho até o alvo + limiter no teto.
    const cadeiaFinal = (ctx, ligar) => {
    const ganho = ctx.createGain();
    ganho.gain.value = Math.pow(10, ganhoDb / 20);
    ligar(ganho);

    // Limiter: razão alta, joelho zero e ataque curto. O threshold fica um
    // pouco abaixo do teto porque o DynamicsCompressor deixa passar um tico.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = tetoDb - 0.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    ligar(limiter);
    };

    const rodar = async (buf, ...cadeias) => {
        const { c, f } = novoContexto(buf);
        let no = f;
        const ligar = (novo) => { no.connect(novo); no = novo; };
        cadeias.forEach((m) => m(c, ligar));
        no.connect(c.destination);
        f.start(0);
        return c.startRendering();
    };

    let renderizado;
    if (!comComp) {
        // Sem compressor: exatamente a cadeia de antes (masters já aprovados não mudam).
        renderizado = await rodar(bufferOriginal, cadeiaTom, cadeiaFinal);
    } else {
        // Com compressor (21/10/2026): tom → COMPRESSOR → mede de novo → ganho até o
        // alvo → limiter. O ganho TEM que sair da medição depois da compressão,
        // senão o volume final erra o alvo de LUFS.
        const tom = await rodar(bufferOriginal, cadeiaTom);
        const r = comprimir(canaisDe(tom), tom.sampleRate, compressor);
        const comp = new AudioBuffer({ length: tom.length, numberOfChannels: tom.numberOfChannels, sampleRate: tom.sampleRate });
        r.canais.forEach((d, i) => comp.copyToChannel(d, i));
        const lufsComp = lufsIntegrado(r.canais, comp.sampleRate);
        ganhoDb = Number.isFinite(lufsComp) ? (alvoLufs - lufsComp) : 0;
        infoComp = { reducaoDb: r.reducaoDb, blocoS: r.blocoS, maxReducaoDb: r.maxReducaoDb };
        renderizado = await rodar(comp, cadeiaFinal);
    }

    // Rede de segurança: se ainda passou do teto, abaixa o suficiente. Sem
    // isto o arquivo sai estourando e o medidor mentiria por omissão.
    const medicaoBruta = medir(renderizado);
    let buffer = renderizado;
    let clampou = false;
    if (Number.isFinite(medicaoBruta.picoDb) && medicaoBruta.picoDb > tetoDb) {
        clampou = true;
        const corte = Math.pow(10, (tetoDb - medicaoBruta.picoDb) / 20);
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            const dados = buffer.getChannelData(c);
            for (let i = 0; i < dados.length; i++) dados[i] *= corte;
        }
    }

    return {
        buffer,
        // Reaproveita medicaoBruta quando o clamp nao mexeu no buffer -- medir
        // de novo daria o MESMO resultado a um custo real (~8s num arquivo de
        // 5min). Só remedimos quando o clamp de fato alterou as amostras.
        // Continua sendo "MEDIDO no resultado, nunca o pedido": so pulamos
        // uma medicao redundante, nunca inventamos o numero.
        medicao: clampou ? medir(buffer) : medicaoBruta,      // MEDIDO no resultado, nunca o pedido
        ganhoAplicadoDb: ganhoDb,
        correcaoDb,
        compressor: infoComp,
    };
}
