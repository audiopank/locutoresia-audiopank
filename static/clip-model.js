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

    // VOLUME DO OBJETO (28/09/2026): `ganhoDb` opcional em cada clip (Volume do
    // trecho, Ctrl+Q). Todo pedaço novo HERDA o do pai — dividir, remover,
    // silenciar, manter, colar. Objeto sem volume continua SEM o campo: projeto
    // antigo sai idêntico. Limite ±18 dB (espelho em MixEngine.ganhoDbDoClip).
    const GANHO_MAX_DB = 18;
    function limitarGanhoDb(db) {
        const g = Number(db);
        if (!isFinite(g)) return 0;
        return Math.max(-GANHO_MAX_DB, Math.min(GANHO_MAX_DB, Math.round(g * 10) / 10));
    }
    function herdaVolume(novo, pai) {
        const g = Number(pai && pai.ganhoDb);
        if (g && isFinite(g)) novo.ganhoDb = g;
        return novo;
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

    // Duração do projeto = fim do último clip de VOZ + 3.05s (regra da casa:
    // a trilha "respira" 3.05s depois da última palavra e desce ao zero —
    // valor calibrado pelo produtor comparando com o Samplitude, 05/08/2026;
    // era 1.05s, depois 2.02s). Sem voz nenhuma, vale o clip mais tardio.
    // ⚠️ Espelhado em mix-engine.js (fade final) e minidaw.js (playback):
    // mudou aqui, muda LÁ — senão prévia e arquivo terminam em horas diferentes.
    // Faixa LIVRE do fade final (efeito sonoro, ou trilha com auto fade
    // desligado — a vinheta de assinatura depois da locução, 16/09/2026)
    // toca até o fim dela: o projeto cresce pra caber.
    function duracaoDoProjeto(faixas) {
        let fimVoz = 0, fimTudo = 0, fimLivres = 0;
        for (const f of (faixas || [])) {
            const fim = fimDaFaixa(f.clips);
            fimTudo = Math.max(fimTudo, fim);
            if (f.type === 'voice') fimVoz = Math.max(fimVoz, fim);
            else if (f.sfx || f.autoFade === false) fimLivres = Math.max(fimLivres, fim);
        }
        return fimVoz > 0 ? Math.max(fimVoz + 3.05, fimLivres) : fimTudo;
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
        return [herdaVolume(a, c), herdaVolume(b, c)];
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
        return ordenarClips(clips.filter(c => c.id !== clip.id).concat(resto.map(r => herdaVolume(r, clip))));
    }

    // Fica só o trecho [ini, fim] do clip (tempo do projeto), no lugar onde está.
    // SILENCIA [ini, fim) sem fechar o buraco (17/09/2026: tirar a respiração do
    // locutor SEM encurtar o off). Todo clip que encosta no trecho vira até dois
    // pedaços, cada um NO LUGAR onde já estava — ao contrário do removerTrecho,
    // que puxa o resto pra esquerda. Micro-fade (8 ms) nas bordas novas evita o
    // estalo de cortar a onda fora do zero; bordas originais guardam seus fades.
    function silenciarTrecho(clips, ini, fim, microFade) {
        if (!(fim - ini >= 0.001)) return clips;
        const mf = (typeof microFade === 'number') ? microFade : 0.008;
        const saida = [];
        for (const clip of (clips || [])) {
            const a = Math.max(clip.inicio, ini), b = Math.min(fimDoClip(clip), fim);
            if (b - a < 0.001) { saida.push(clip); continue; }      // não encosta no trecho
            const antes = a - clip.inicio, depois = fimDoClip(clip) - b;
            const temAntes = antes >= DURACAO_MIN, temDepois = depois >= DURACAO_MIN;
            if (temAntes) {
                saida.push(herdaVolume({
                    id: novoId(), buffer: clip.buffer,
                    inicio: clip.inicio, offset: clip.offset, duracao: antes,
                    fadeIn: clip.fadeIn || 0, fadeOut: Math.min(mf, antes / 2)
                }, clip));
            }
            if (temDepois) {
                saida.push(herdaVolume({
                    id: novoId(), buffer: clip.buffer,
                    inicio: b,                                      // FICA onde estava
                    offset: clip.offset + (b - clip.inicio),
                    duracao: depois,
                    fadeIn: Math.min(mf, depois / 2), fadeOut: clip.fadeOut || 0
                }, clip));
            }
        }
        return ordenarClips(saida);
    }

    function manterTrecho(clip, ini, fim) {
        ini = Math.max(clip.inicio, ini);
        fim = Math.min(fimDoClip(clip), fim);
        return herdaVolume({
            id: novoId(), buffer: clip.buffer,
            inicio: ini, offset: clip.offset + (ini - clip.inicio),
            duracao: Math.max(DURACAO_MIN, fim - ini),
            fadeIn: 0, fadeOut: 0
        }, clip);
    }

    // VOLUME DO TRECHO (28/09/2026, pedido dele no estilo Samplitude): sobe ou
    // desce `deltaDb` SÓ em [ini, fim) — "editor de performance" pra igualar a
    // frase que o locutor falou mais baixo. Todo objeto que encosta no trecho
    // vira até três pedaços NO LUGAR: antes e depois guardam o volume que tinham,
    // o do meio SOMA o delta (Ctrl+Q de novo sobe mais). Emendas nascem SECAS: a
    // rampa anti-estalo é do motor (MixEngine.volumeDoClip) — fade até o zero no
    // meio da fala abriria um buraco audível. Borda a menos de DURACAO_MIN da
    // ponta não vira farelo: o pedaço do meio engole a sobra. Não muta nada.
    function volumeNoTrecho(clips, ini, fim, deltaDb) {
        const delta = Number(deltaDb) || 0;
        if (!(fim - ini >= 0.001) || !delta) return clips;
        const saida = [];
        for (const clip of (clips || [])) {
            const fimC = fimDoClip(clip);
            let a = Math.max(clip.inicio, ini), b = Math.min(fimC, fim);
            if (b - a < 0.001) { saida.push(clip); continue; }      // não encosta no trecho
            if (a - clip.inicio < DURACAO_MIN) a = clip.inicio;
            if (fimC - b < DURACAO_MIN) b = fimC;
            const gNovo = limitarGanhoDb((Number(clip.ganhoDb) || 0) + delta);
            const temAntes = a > clip.inicio, temDepois = b < fimC;
            if (!temAntes && !temDepois) {                          // o objeto inteiro: só muda o volume
                saida.push(Object.assign({}, clip, { ganhoDb: gNovo }));
                continue;
            }
            if (temAntes) {
                saida.push(herdaVolume({
                    id: novoId(), buffer: clip.buffer,
                    inicio: clip.inicio, offset: clip.offset, duracao: a - clip.inicio,
                    fadeIn: clip.fadeIn || 0, fadeOut: 0
                }, clip));
            }
            saida.push({
                id: novoId(), buffer: clip.buffer,
                inicio: a, offset: clip.offset + (a - clip.inicio), duracao: b - a,
                fadeIn: temAntes ? 0 : (clip.fadeIn || 0),
                fadeOut: temDepois ? 0 : (clip.fadeOut || 0),
                ganhoDb: gNovo
            });
            if (temDepois) {
                saida.push(herdaVolume({
                    id: novoId(), buffer: clip.buffer,
                    inicio: b, offset: clip.offset + (b - clip.inicio), duracao: fimC - b,
                    fadeIn: 0, fadeOut: clip.fadeOut || 0
                }, clip));
            }
        }
        return ordenarClips(saida);
    }

    // IGUALAR (28/09/2026): quantos dB o trecho [ini, fim) precisa pra ficar no
    // nível da FALA do resto da faixa. Mede em janelas de 20 ms, já com o volume
    // de cada objeto; janela mais de 30 dB abaixo do pico da faixa é pausa ou
    // respiração e não entra na conta. Sem fala no trecho (ou fora dele): null.
    const JANELA_NIVEL_S = 0.02;
    function igualarDb(clips, ini, fim) {
        const dentro = [], fora = [];
        let pico = 0;
        for (const c of (clips || [])) {
            const buf = c.buffer;
            if (!buf || typeof buf.getChannelData !== 'function') continue;
            const dados = buf.getChannelData(0), sr = buf.sampleRate;
            const g = Math.pow(10, (Number(c.ganhoDb) || 0) / 20);
            const n = Math.max(1, Math.round(JANELA_NIVEL_S * sr));
            const i0 = Math.max(0, Math.floor(c.offset * sr));
            const i1 = Math.min(dados.length, Math.floor((c.offset + c.duracao) * sr));
            for (let i = i0; i + n <= i1; i += n) {
                let soma = 0;
                for (let k = i; k < i + n; k++) soma += dados[k] * dados[k];
                const rms = Math.sqrt(soma / n) * g;
                const t = c.inicio + (i - i0) / sr + JANELA_NIVEL_S / 2;   // meio da janela, tempo do projeto
                (t >= ini && t < fim ? dentro : fora).push(rms);
                if (rms > pico) pico = rms;
            }
        }
        const limiar = Math.max(1e-4, pico * Math.pow(10, -30 / 20));
        const nivelDb = (lista) => {
            const fala = lista.filter(r => r >= limiar);
            if (fala.length < 3) return null;
            return 10 * Math.log10(fala.reduce((s, r) => s + r * r, 0) / fala.length);
        };
        const nDentro = nivelDb(dentro), nFora = nivelDb(fora);
        if (nDentro == null || nFora == null) return null;
        return limitarGanhoDb(Math.round((nFora - nDentro) * 2) / 2);
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
        // Classifica cada vizinho pelo PONTO MÉDIO contra a posição pedida:
        // com bordas, vizinho sobreposto à posição atual não caía em ramo
        // nenhum e era ignorado — o clip podia ser solto EM CIMA de outro.
        const meio = inicioPedido + clip.duracao / 2;
        for (const c of (clips || [])) {
            if (c.id === clip.id) continue;
            if (c.inicio + c.duracao / 2 <= meio) minIni = Math.max(minIni, fimDoClip(c));
            else maxIni = Math.min(maxIni, c.inicio - clip.duracao);
        }
        return Math.max(minIni, Math.min(inicioPedido, maxIni));
    }

    // true se `clip` invade qualquer outro clip da lista (invariante da v1:
    // clips da mesma faixa não se sobrepõem — sobreposição = dois áudios
    // somados sem crossfade, que soa a erro).
    function temSobreposicao(clips, clip) {
        for (const c of (clips || [])) {
            if (c.id === clip.id) continue;
            if (clip.inicio < fimDoClip(c) - 1e-9 && c.inicio < fimDoClip(clip) - 1e-9) return true;
        }
        return false;
    }

    // Cópia do clip numa posição nova (Ctrl+C / Ctrl+V, estilo Samplitude).
    // O BUFFER vai por REFERÊNCIA de propósito: colar a mesma voz em 4 faixas
    // não duplica áudio na memória nem vira 4 WAVs no Storage — a persistência
    // já grava 1 arquivo por buffer DISTINTO. O id é novo (dois clips com o
    // mesmo id quebrariam seleção, arrasto e o clipNoPonto).
    function clonarClip(molde, inicio) {
        return herdaVolume({
            id: novoId(),
            buffer: molde.buffer,
            inicio: Math.max(0, inicio || 0),
            offset: molde.offset || 0,
            duracao: molde.duracao,
            fadeIn: molde.fadeIn || 0,
            fadeOut: molde.fadeOut || 0
        }, molde);
    }

    // true se o clip é "o arquivo inteiro, começando em 0:00" — isto é, a faixa
    // NÃO foi editada na timeline. Quem TROCA o buffer da faixa (Encurtar
    // Pausas) precisa saber se existe edição a perder antes de recolar tudo
    // num clip só, porque isso não tem desfazer.
    function ehArquivoInteiroNoZero(clip) {
        if (!clip) return false;
        if (Number(clip.ganhoDb)) return false;                 // volume do objeto mudado = edição
        const tol = 1e-3;
        if (Math.abs(clip.inicio || 0) > tol) return false;    // foi movido
        if (Math.abs(clip.offset || 0) > tol) return false;    // foi aparado pela esquerda
        const dur = clip.buffer && clip.buffer.duration;
        if (dur == null) return true;      // buffer desconhecido: não acusa edição
        return Math.abs(clip.duracao - dur) <= tol;            // foi aparado pela direita?
    }

    const ClipModel = {
        DURACAO_MIN, novoId, clipInteiro, fimDoClip, fimDaFaixa,
        duracaoDoProjeto, ordenarClips, clipNoPonto, dividirClip,
        removerTrecho, silenciarTrecho, manterTrecho, aplicarTrim, calcularSnap, moverClip,
        temSobreposicao, clonarClip, ehArquivoInteiroNoZero,
        GANHO_MAX_DB, limitarGanhoDb, volumeNoTrecho, igualarDb
    };

    global.ClipModel = ClipModel;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClipModel;
})(typeof window !== 'undefined' ? window : globalThis);
