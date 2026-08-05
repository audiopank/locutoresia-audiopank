/**
 * Modelo de clips da timeline — MATEMÁTICA PURA, sem DOM e sem Web Audio.
 *
 * Um clip é um RECORTE POSICIONADO de um arquivo: {buffer, inicio, offset,
 * duracao, fadeIn, fadeOut}. `inicio` é onde ele entra na timeline do PROJETO;
 * `offset` é a partir de onde o ARQUIVO toca (trim não-destrutivo: encurtar só
 * mexe em offset/duracao, o áudio continua inteiro no buffer).
 *
 * Vive num arquivo separado pra ser testável com `node --test` — o buffer aqui
 * é opaco (só se lê .duration), então os testes rodam sem navegador.
 */
(function (global) {
    'use strict';

    // Menor clip que faz sentido segurar com o mouse. Também é a distância
    // mínima da borda pra "Dividir" (dividir a 1ms da ponta cria um farelo
    // inaudível que só atrapalha).
    const DURACAO_MIN = 0.05;

    let _seq = 0;
    function novoId() {
        // Date.now sozinho colide quando dois clips nascem no mesmo ms
        // (dividir cria dois de uma vez) — o contador desempata.
        return 'clip_' + Date.now() + '_' + (_seq++);
    }

    function clipInteiro(buffer) {
        return {
            id: novoId(), buffer: buffer,
            inicio: 0, offset: 0, duracao: buffer.duration,
            fadeIn: 0, fadeOut: 0
        };
    }

    function fimDoClip(c) { return c.inicio + c.duracao; }

    function fimDaFaixa(clips) {
        let fim = 0;
        for (const c of (clips || [])) fim = Math.max(fim, fimDoClip(c));
        return fim;
    }

    // Duração do projeto = fim do último clip de VOZ + 1.05s (regra da casa:
    // a trilha "respira" 1.05s depois da última palavra e o mix acaba).
    // Sem voz nenhuma, vale o clip que termina mais tarde.
    function duracaoDoProjeto(faixas) {
        let fimVoz = 0, fimTudo = 0;
        for (const f of (faixas || [])) {
            const fim = fimDaFaixa(f.clips);
            fimTudo = Math.max(fimTudo, fim);
            if (f.type === 'voice') fimVoz = Math.max(fimVoz, fim);
        }
        return fimVoz > 0 ? fimVoz + 1.05 : fimTudo;
    }

    function ordenarClips(clips) {
        return (clips || []).slice().sort((a, b) => a.inicio - b.inicio);
    }

    function clipNoPonto(clips, t) {
        for (const c of (clips || [])) {
            if (t >= c.inicio && t <= fimDoClip(c)) return c;
        }
        return null;
    }

    // Divide no tempo `t` DO PROJETO. Fades ficam nas bordas originais: a
    // emenda nasce seca de propósito — os dois pedaços colados têm que soar
    // como o áudio contínuo que eram.
    function dividirClip(c, t) {
        if (t < c.inicio + DURACAO_MIN || t > fimDoClip(c) - DURACAO_MIN) return null;
        const antes = t - c.inicio;
        const a = {
            id: novoId(), buffer: c.buffer,
            inicio: c.inicio, offset: c.offset, duracao: antes,
            fadeIn: c.fadeIn || 0, fadeOut: 0
        };
        const b = {
            id: novoId(), buffer: c.buffer,
            inicio: t, offset: c.offset + antes, duracao: c.duracao - antes,
            fadeIn: 0, fadeOut: c.fadeOut || 0
        };
        return [a, b];
    }

    // Remove o trecho [ini, fim] (tempo do projeto) de DENTRO do clip e puxa a
    // parte direita pra esquerda — mesmo resultado audível do corte destrutivo
    // antigo, mas o arquivo continua inteiro (offset pula o trecho).
    function removerTrecho(clips, clip, ini, fim) {
        ini = Math.max(clip.inicio, ini);
        fim = Math.min(fimDoClip(clip), fim);
        if (fim - ini < 0.001) return clips;
        const resto = [];
        const antes = ini - clip.inicio;
        if (antes >= DURACAO_MIN) {
            resto.push({
                id: novoId(), buffer: clip.buffer,
                inicio: clip.inicio, offset: clip.offset, duracao: antes,
                fadeIn: clip.fadeIn || 0, fadeOut: 0
            });
        }
        const depois = fimDoClip(clip) - fim;
        if (depois >= DURACAO_MIN) {
            resto.push({
                id: novoId(), buffer: clip.buffer,
                inicio: ini,                                   // puxa pra esquerda
                offset: clip.offset + (fim - clip.inicio),     // pula o trecho no arquivo
                duracao: depois,
                fadeIn: 0, fadeOut: clip.fadeOut || 0
            });
        }
        return ordenarClips(clips.filter(c => c.id !== clip.id).concat(resto));
    }

    // Fica só o trecho [ini, fim] do clip (tempo do projeto), no lugar onde está.
    function manterTrecho(clip, ini, fim) {
        ini = Math.max(clip.inicio, ini);
        fim = Math.min(fimDoClip(clip), fim);
        return {
            id: novoId(), buffer: clip.buffer,
            inicio: ini, offset: clip.offset + (ini - clip.inicio),
            duracao: Math.max(DURACAO_MIN, fim - ini),
            fadeIn: 0, fadeOut: 0
        };
    }

    // Trim NÃO-DESTRUTIVO pela borda. `novoTempo` é onde a borda deve ficar
    // (tempo do projeto). Borda 'ini' também recupera áudio escondido (offset
    // desce até 0); borda 'fim' estica até o fim do arquivo. Devolve um clip
    // NOVO (não muta) — o chamador substitui no array.
    function aplicarTrim(c, borda, novoTempo) {
        const arquivo = c.buffer && c.buffer.duration != null ? c.buffer.duration : Infinity;
        if (borda === 'ini') {
            // O quanto a borda anda (negativo = recuperando áudio pela esquerda)
            let delta = novoTempo - c.inicio;
            delta = Math.max(-c.offset, Math.min(delta, c.duracao - DURACAO_MIN));
            return Object.assign({}, c, {
                inicio: c.inicio + delta,
                offset: c.offset + delta,
                duracao: c.duracao - delta
            });
        }
        // borda 'fim'
        let novaDur = novoTempo - c.inicio;
        novaDur = Math.max(DURACAO_MIN, Math.min(novaDur, arquivo - c.offset));
        return Object.assign({}, c, { duracao: novaDur });
    }

    function calcularSnap(t, alvos, tolerancia) {
        let melhor = t, dist = tolerancia;
        for (const alvo of (alvos || [])) {
            const d = Math.abs(alvo - t);
            if (d <= dist) { melhor = alvo; dist = d; }
        }
        return melhor;
    }

    // Devolve o `inicio` VÁLIDO mais próximo do pedido: clampa no 0 e nos
    // vizinhos da MESMA faixa (clips não se sobrepõem na v1 — sobreposição
    // criaria dois áudios somados sem crossfade, que soa a erro, não a recurso).
    function moverClip(clips, clip, inicioPedido) {
        let minIni = 0, maxIni = Infinity;
        for (const c of (clips || [])) {
            if (c.id === clip.id) continue;
            if (fimDoClip(c) <= clip.inicio + 1e-9) minIni = Math.max(minIni, fimDoClip(c));
            else if (c.inicio >= fimDoClip(clip) - 1e-9) maxIni = Math.min(maxIni, c.inicio - clip.duracao);
        }
        return Math.max(minIni, Math.min(inicioPedido, maxIni));
    }

    const ClipModel = {
        DURACAO_MIN, novoId, clipInteiro, fimDoClip, fimDaFaixa,
        duracaoDoProjeto, ordenarClips, clipNoPonto, dividirClip,
        removerTrecho, manterTrecho, aplicarTrim, calcularSnap, moverClip
    };

    global.ClipModel = ClipModel;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClipModel;
})(typeof window !== 'undefined' ? window : globalThis);
