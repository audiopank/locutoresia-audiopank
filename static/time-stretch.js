/**
 * Time Stretch da MiniDAW clássica — encurta ou alonga a FALA sem mudar o tom.
 *
 * É a alça do canto inferior direito do objeto no Samplitude (21/09/2026): o
 * off do locutor saiu com 37 s e o spot é de 30 s; puxa o canto pra esquerda,
 * a fala acelera e a voz continua a mesma (fator 0,83× = 30/37).
 *
 * Algoritmo: WSOLA (Waveform-Similarity Overlap-Add). Corta o áudio em frames
 * de 20 ms com janela Hann e recola com passo diferente do original — pra
 * acelerar, pula um pouco de áudio a cada frame; pra desacelerar, repete.
 * Antes de colar cada frame, procura em ±6 ms o ponto em que a onda "casa"
 * com a continuação do frame anterior (correlação normalizada), que é o que
 * evita o estalo/batimento do OLA cego. Feito pra FALA: em música, que tem
 * ritmo, ele borra transientes — por isso a MiniDAW só oferece em VOZ.
 *
 * MATEMÁTICA PURA: sem DOM e sem Web Audio (só o esticarBuffer, no fim, monta
 * um AudioBuffer a partir do resultado). Testável com `node --test`.
 */
(function (global) {
    'use strict';

    const FATOR_MIN = 0.5;      // metade do tempo (2× mais rápido)
    const FATOR_MAX = 2.0;      // o dobro do tempo (2× mais lento)
    const JANELA_S = 0.020;     // frame de 20 ms
    const BUSCA_S = 0.006;      // procura a emenda em ±6 ms

    // Fora de 0,75×–1,33× a fala começa a soar processada; a tela avisa.
    const FATOR_NATURAL_MIN = 0.75;
    const FATOR_NATURAL_MAX = 1.33;

    function limitarFator(f) {
        if (!(f > 0) || !isFinite(f)) return 1;
        return Math.max(FATOR_MIN, Math.min(FATOR_MAX, f));
    }

    // Hann periódica: com passo de N/2 as janelas somam exatamente 1.
    function janelaHann(n) {
        const w = new Float32Array(n);
        for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
        return w;
    }

    // Quão bem ref[a..a+n] continua ref[b..b+n]. Normaliza pela energia do
    // candidato pra não preferir simplesmente o trecho mais alto.
    function semelhanca(ref, a, b, n) {
        let sxy = 0, sxx = 0;
        for (let i = 0; i < n; i++) {
            const x = ref[a + i];
            sxy += x * ref[b + i];
            sxx += x * x;
        }
        return sxx < 1e-12 ? 0 : sxy / Math.sqrt(sxx);
    }

    // `canais` = [Float32Array, ...] (mesmo comprimento); `fator` = duração
    // nova / duração original (0,83 = mais rápido; 1,2 = mais lento).
    // Devolve {sampleRate, numberOfChannels, length, canais} — canais NOVOS,
    // nunca muta a entrada.
    function esticarCanais(canais, sampleRate, fator) {
        fator = limitarFator(fator);
        const nCh = canais.length;
        const nIn = nCh ? canais[0].length : 0;
        if (!nIn) return { sampleRate, numberOfChannels: nCh, length: 0, canais: canais.map(() => new Float32Array(0)) };
        if (Math.abs(fator - 1) < 1e-4) {
            return { sampleRate, numberOfChannels: nCh, length: nIn, canais: canais.map(c => new Float32Array(c)) };
        }

        const N = Math.max(64, 2 * Math.round(JANELA_S * sampleRate / 2));   // par, pra Hs = N/2 inteiro
        const Hs = N / 2;                       // passo de SAÍDA (fixo)
        const Ha = Hs / fator;                  // passo de ENTRADA (o que estica/encolhe)
        const busca = Math.max(1, Math.round(BUSCA_S * sampleRate));
        const nOut = Math.round(nIn * fator);
        const win = janelaHann(N);

        // Referência mono pra escolher a emenda — estéreo usa a MESMA emenda
        // nos dois canais, senão a imagem estéreo balança.
        let ref = canais[0];
        if (nCh > 1) {
            ref = new Float32Array(nIn);
            for (let ch = 0; ch < nCh; ch++) {
                const c = canais[ch];
                for (let i = 0; i < nIn; i++) ref[i] += c[i] / nCh;
            }
        }

        const saida = canais.map(() => new Float32Array(nOut + N));
        const peso = new Float32Array(nOut + N);
        let posAnterior = -1;

        for (let k = 0; k * Hs < nOut; k++) {
            const outPos = k * Hs;
            let pos = Math.round(k * Ha);           // posição NOMINAL (sem deriva acumulada)
            if (pos > nIn - 1) break;

            if (posAnterior >= 0) {
                const alvo = posAnterior + Hs;      // continuação natural do frame anterior
                const lo = Math.max(0, pos - busca);
                const hi = Math.min(nIn - Hs, pos + busca);
                if (alvo + Hs <= nIn && hi >= lo) {
                    // Busca grossa (passo 2) e depois fina (±1) em volta do melhor.
                    let melhor = pos, melhorNota = -Infinity;
                    for (let c = lo; c <= hi; c += 2) {
                        const nota = semelhanca(ref, c, alvo, Hs);
                        if (nota > melhorNota) { melhorNota = nota; melhor = c; }
                    }
                    for (let c = Math.max(lo, melhor - 1); c <= Math.min(hi, melhor + 1); c++) {
                        const nota = semelhanca(ref, c, alvo, Hs);
                        if (nota > melhorNota) { melhorNota = nota; melhor = c; }
                    }
                    pos = melhor;
                }
            }

            const len = Math.min(N, nIn - pos);
            for (let ch = 0; ch < nCh; ch++) {
                const src = canais[ch], dst = saida[ch];
                for (let i = 0; i < len; i++) dst[outPos + i] += win[i] * src[pos + i];
            }
            for (let i = 0; i < len; i++) peso[outPos + i] += win[i];
            posAnterior = pos;
        }

        // Divide pela soma das janelas: no miolo dá 1 (Hann a 50%), nas pontas
        // e nos frames truncados devolve a amplitude original em vez de um fade.
        const resultado = canais.map(() => new Float32Array(nOut));
        for (let i = 0; i < nOut; i++) {
            const p = peso[i];
            if (p > 1e-3) for (let ch = 0; ch < nCh; ch++) resultado[ch][i] = saida[ch][i] / p;
        }
        return { sampleRate, numberOfChannels: nCh, length: nOut, canais: resultado };
    }

    // ── Matemática do clip (buffer opaco) ────────────────────────────────
    // O clip esticado guarda de onde veio: `origem` = {buffer, offset, duracao}
    // do áudio ORIGINAL e `stretch` = fator aplicado sobre ele. Esticar de novo
    // parte sempre da origem (fator composto), não do já esticado — senão cada
    // ajuste degrada o anterior. Se o produtor APAROU o clip esticado pelas
    // bordas, o aparo é levado de volta à origem (offset/duracao ÷ fator).
    function baseDoStretch(clip) {
        if (!clip.origem || !clip.origem.buffer) {
            return { buffer: clip.buffer, offset: clip.offset || 0, duracao: clip.duracao };
        }
        const s = (clip.stretch > 0) ? clip.stretch : 1;
        return {
            buffer: clip.origem.buffer,
            offset: (clip.origem.offset || 0) + (clip.offset || 0) / s,
            duracao: clip.duracao / s
        };
    }

    // Fator que leva a base do clip até `novaDuracao` (já limitado).
    function fatorPara(clip, novaDuracao) {
        const base = baseDoStretch(clip);
        return limitarFator(novaDuracao / base.duracao);
    }

    // Devolve os campos NOVOS do clip depois de esticar (o chamador faz o
    // Object.assign — o id e o `inicio` ficam). Fator ~1 = volta ao original.
    function camposEsticados(clip, base, novoBuffer, fator) {
        if (Math.abs(fator - 1) < 1e-3) {
            return { buffer: base.buffer, offset: base.offset, duracao: base.duracao, stretch: undefined, origem: undefined };
        }
        return {
            buffer: novoBuffer, offset: 0, duracao: novoBuffer.duration,
            stretch: fator,
            origem: { buffer: base.buffer, offset: base.offset, duracao: base.duracao }
        };
    }

    function soaNatural(fator) {
        return fator >= FATOR_NATURAL_MIN && fator <= FATOR_NATURAL_MAX;
    }

    // ── Web Audio (só aqui) ──────────────────────────────────────────────
    // Estica a JANELA [offset, offset+duracao] do buffer e devolve um
    // AudioBuffer novo. Marca `_esticado`: ao salvar o projeto esse buffer
    // NUNCA pode ser "referenciado" pela URL do arquivo original — tem que
    // subir como WAV, senão reabrir traz a voz na velocidade antiga.
    function esticarBuffer(ctx, buffer, offset, duracao, fator) {
        const sr = buffer.sampleRate;
        const a0 = Math.max(0, Math.floor((offset || 0) * sr));
        const a1 = Math.max(a0 + 1, Math.min(buffer.length, Math.round(((offset || 0) + duracao) * sr)));
        const canais = [];
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) canais.push(buffer.getChannelData(ch).subarray(a0, a1));
        const r = esticarCanais(canais, sr, fator);
        const novo = ctx.createBuffer(r.numberOfChannels, Math.max(1, r.length), sr);
        for (let ch = 0; ch < r.numberOfChannels; ch++) novo.copyToChannel(r.canais[ch], ch);
        try { novo._esticado = true; } catch (e) { /* buffer não extensível: o guarda do save também olha clip.stretch */ }
        return novo;
    }

    const TimeStretch = {
        FATOR_MIN, FATOR_MAX, FATOR_NATURAL_MIN, FATOR_NATURAL_MAX,
        limitarFator, esticarCanais, baseDoStretch, fatorPara, camposEsticados, soaNatural, esticarBuffer
    };

    global.TimeStretch = TimeStretch;
    if (typeof module !== 'undefined' && module.exports) module.exports = TimeStretch;
})(typeof window !== 'undefined' ? window : globalThis);
