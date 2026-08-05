/**
 * Motor de mixagem — Web Audio puro, sem DOM.
 *
 * Extraído do static/minidaw.js pra ser usado por DUAS telas: a MiniDAW
 * clássica (/minidaw) e o Gerador de Anúncios (/gerador). Antes vivia como
 * método da classe MiniDAW; o corpo é o mesmo, o que mudou é que as
 * dependências que vinham de `this` agora entram por parâmetro.
 *
 * Por que não duplicar: mixagem errada é cara de descobrir (o bug do EQ que
 * disputava um filtro só passou despercebido até o export sair sem graves).
 * Uma fonte de verdade só.
 *
 * Não use `document` aqui dentro. Se precisar de UI, é sinal de que a função
 * pertence à tela, não ao motor.
 */
(function (global) {
    'use strict';

    // Parâmetros de ducking. Eram campos do constructor da MiniDAW (linhas
    // 25-35); viram default do módulo pra quem não quiser configurar. A MiniDAW
    // continua passando os dela, então mexer lá segue valendo.
    const DUCK_PADRAO = {
        // gain: o quanto a trilha abaixa embaixo da voz (multiplicador).
        gain: 0.45,
        // attack: tempo pra ABAIXAR quando a voz entra. Menor = mais brusco.
        attack: 0.20,
        // release: tempo pra SUBIR quando a voz para. Maior = mais suave.
        release: 0.65,
        // hold: pausas menores que isso NÃO soltam a trilha.
        hold: 0.70
    };

    // ── DUCKING AUTOMÁTICO ───────────────────────────────────────────────
    // Abaixa a trilha quando a voz entra e devolve o volume nas pausas — é o que
    // separa "voz por cima de música" de spot de rádio. Antes a trilha tocava no
    // volume cheio durante toda a locução e só caía no fade final.
    //
    // Detecta fala de verdade (RMS por janela) em vez de simplesmente abaixar do
    // início ao fim: nas respiradas entre frases a trilha sobe, que é o movimento
    // que dá vida ao spot.
    // `limiarPct` (0.01..0.30) é o quanto do pico conta como "tem voz". O gate
    // usa isso como sensibilidade: quanto MAIOR, mais coisa vira pausa — e
    // respiração some junto. O ducking não passa esse parâmetro e fica no 8%
    // de sempre.
    function detectarTrechosDeVoz(voiceTracks, hold, limiarPct) {
        const JANELA = 0.03;      // 30ms — resolução da análise
        const HOLD = hold != null ? hold : DUCK_PADRAO.hold; // junta trechos separados por menos que isso
        const PCT = Math.min(0.30, Math.max(0.01, limiarPct != null ? limiarPct : 0.08));
        const segmentos = [];

        for (const track of voiceTracks) {
            const buf = track.audioBuffer;
            if (!buf) continue;
            const sr = buf.sampleRate;
            const passo = Math.max(1, Math.floor(JANELA * sr));
            const dados = buf.getChannelData(0);

            // RMS por janela + pico, pra calibrar o limiar na gravação real
            // (locução baixinha e locução alta precisam do mesmo comportamento).
            const rms = [];
            let pico = 0;
            for (let i = 0; i < dados.length; i += passo) {
                let soma = 0;
                const fim = Math.min(i + passo, dados.length);
                for (let j = i; j < fim; j++) soma += dados[j] * dados[j];
                const v = Math.sqrt(soma / Math.max(1, fim - i));
                rms.push(v);
                if (v > pico) pico = v;
            }

            // Piso ABSOLUTO antes do limiar relativo. Sem ele, uma faixa que só
            // tem ruído de fundo (pico ~-60dBFS) passaria no "8% do próprio pico"
            // e a trilha ficaria abaixada o spot inteiro sem ninguém falando.
            // 0.003 ≈ -50 dBFS: bem abaixo de qualquer locução real.
            if (pico < 0.003) continue;

            const limiar = pico * PCT;               // acima disso = tem voz
            let inicio = null;
            for (let k = 0; k < rms.length; k++) {
                const temVoz = rms[k] >= limiar;
                if (temVoz && inicio === null) inicio = k * JANELA;
                if (!temVoz && inicio !== null) {
                    segmentos.push([inicio, k * JANELA]);
                    inicio = null;
                }
            }
            if (inicio !== null) segmentos.push([inicio, rms.length * JANELA]);
        }

        if (!segmentos.length) return [];

        // Une trechos próximos (respiradas curtas não devem soltar a trilha).
        segmentos.sort((a, b) => a[0] - b[0]);
        const unidos = [segmentos[0].slice()];
        for (let i = 1; i < segmentos.length; i++) {
            const ult = unidos[unidos.length - 1];
            if (segmentos[i][0] - ult[1] <= HOLD) {
                ult[1] = Math.max(ult[1], segmentos[i][1]);
            } else {
                unidos.push(segmentos[i].slice());
            }
        }
        return unidos;
    }

    // ── DETECÇÃO POR CLIPS POSICIONADOS ──────────────────────────────────
    // Mesmo algoritmo do detectarTrechosDeVoz, mas por CLIP: analisa só a
    // janela [offset, offset+duracao] do arquivo e desloca os trechos achados
    // pra posição do clip na timeline (inicio). É o que faz a trilha abaixar
    // quando a voz ENTRA DE VERDADE — e não a partir do zero do projeto.
    // `clips` = [{buffer, inicio, offset, duracao}] (só os de faixas de VOZ).
    function detectarTrechosDeClips(clips, hold, limiarPct) {
        const JANELA = 0.03;
        const HOLD = hold != null ? hold : DUCK_PADRAO.hold;
        const PCT = Math.min(0.30, Math.max(0.01, limiarPct != null ? limiarPct : 0.08));
        const segmentos = [];

        for (const clip of (clips || [])) {
            const buf = clip.buffer;
            if (!buf) continue;
            const sr = buf.sampleRate;
            const passo = Math.max(1, Math.floor(JANELA * sr));
            const dados = buf.getChannelData(0);
            const a0 = Math.max(0, Math.floor((clip.offset || 0) * sr));
            const a1 = Math.min(dados.length, Math.floor(((clip.offset || 0) + clip.duracao) * sr));

            const rms = [];
            let pico = 0;
            for (let i = a0; i < a1; i += passo) {
                let soma = 0;
                const fim = Math.min(i + passo, a1);
                for (let j = i; j < fim; j++) soma += dados[j] * dados[j];
                const v = Math.sqrt(soma / Math.max(1, fim - i));
                rms.push(v);
                if (v > pico) pico = v;
            }
            // Piso absoluto: janela só com ruído de fundo não conta como voz
            // (mesma proteção do detectarTrechosDeVoz — ver comentário lá).
            if (pico < 0.003) continue;

            const limiar = pico * PCT;
            let inicio = null;
            for (let k = 0; k < rms.length; k++) {
                const temVoz = rms[k] >= limiar;
                if (temVoz && inicio === null) inicio = k * JANELA;
                if (!temVoz && inicio !== null) {
                    segmentos.push([clip.inicio + inicio, clip.inicio + k * JANELA]);
                    inicio = null;
                }
            }
            if (inicio !== null) segmentos.push([clip.inicio + inicio, clip.inicio + rms.length * JANELA]);
        }

        if (!segmentos.length) return [];
        segmentos.sort((a, b) => a[0] - b[0]);
        const unidos = [segmentos[0].slice()];
        for (let i = 1; i < segmentos.length; i++) {
            const ult = unidos[unidos.length - 1];
            if (segmentos[i][0] - ult[1] <= HOLD) {
                ult[1] = Math.max(ult[1], segmentos[i][1]);
            } else {
                unidos.push(segmentos[i].slice());
            }
        }
        return unidos;
    }

    // Escreve a automação de ganho da trilha a partir dos trechos de voz.
    // `nivel` é o volume normal da faixa (0..1); devolve true se ducou algo.
    //
    // `offset` existe porque os dois caminhos usam bases de tempo diferentes:
    // o export (OfflineAudioContext) agenda a partir de 0, e o playback agenda a
    // partir de audioContext.currentTime. Sem o offset, o ducking no preview
    // cairia todo no passado e não aconteceria nada.
    function aplicarDucking(gainParam, trechos, nivel, ateQuando, offset, duck) {
        const d = duck || DUCK_PADRAO;
        const off = offset || 0;
        const ATTACK = d.attack, RELEASE = d.release;
        if (!trechos.length) return false;
        const abaixado = nivel * d.gain;

        // NÃO ancora em t=0: quem cuida do início é o fade-in do chamador (mexer
        // aqui criaria dois eventos no mesmo instante e brigaria com ele).
        for (const [ini, fim] of trechos) {
            if (ini >= ateQuando) break;
            const t0 = Math.max(0, ini - ATTACK);
            const t1 = Math.min(fim, ateQuando);
            if (t0 > 0) gainParam.setValueAtTime(nivel, off + t0);
            gainParam.linearRampToValueAtTime(abaixado, off + Math.min(ini, ateQuando));
            gainParam.setValueAtTime(abaixado, off + t1);   // segura embaixo
            // Release NÃO é cortado em `ateQuando`: no último trecho isso criaria
            // dois eventos no mesmo instante e a trilha saltaria do valor abaixado
            // pra cheia de uma vez (clique). Deixando passar, ela sobe suave e o
            // fade final leva a zero por cima.
            gainParam.linearRampToValueAtTime(nivel, off + t1 + RELEASE);
        }
        return true;
    }

    // ── GATE (silenciador de respiração) ─────────────────────────────────
    // Voz de IA respira alto: entre uma frase e outra fica um chiado de ar que
    // some no fone mas aparece no rádio, ainda mais depois do limiter puxar
    // tudo pra cima. O gate abaixa a faixa nos trechos SEM fala e devolve o
    // volume quando ela volta.
    //
    // Reusa o detectarTrechosDeVoz do ducking — a mesma análise que já sabe
    // onde tem fala serve pra saber onde NÃO tem.
    //
    // Não zera: piso de -24dB (0.06). Silêncio absoluto entre frases soa
    // artificial, como se a gravação tivesse buracos; o que se quer é a
    // respiração sumir por baixo, não o ambiente desaparecer.
    const GATE_PADRAO = {
        piso: 0.06,        // -24dB nas pausas
        attack: 0.02,      // abre 20ms ANTES da palavra (não come o começo)
        release: 0.12      // fecha suave, pra não cortar a cauda da fala
    };

    function aplicarGate(gainParam, trechos, duracao, offset, opcoes) {
        if (!trechos || !trechos.length) return false;
        const o = opcoes || {};
        const piso = o.piso != null ? o.piso : GATE_PADRAO.piso;
        const ATTACK = o.attack != null ? o.attack : GATE_PADRAO.attack;
        const RELEASE = o.release != null ? o.release : GATE_PADRAO.release;
        const off = offset || 0;

        // Começa fechado: quase todo spot tem um respiro antes da primeira palavra.
        gainParam.setValueAtTime(piso, off);

        for (const [ini, fim] of trechos) {
            const abre = Math.max(0, ini - ATTACK);
            gainParam.setValueAtTime(piso, off + abre);
            gainParam.linearRampToValueAtTime(1, off + ini);
            gainParam.setValueAtTime(1, off + fim);
            gainParam.linearRampToValueAtTime(
                piso, off + Math.min(duracao, fim + RELEASE));
        }
        return true;
    }

    // Normaliza o loudness do mix renderizado pro alvo (dBFS RMS aprox.) e aplica
    // um soft-limiter (tanh) no teto de -1dB. Dá o "alto e consistente": todo
    // export sai no mesmo nível, sem clipar. Trabalha in-place no buffer.
    // NÃO é LUFS certificado (o navegador não mede LUFS de verdade) — é uma
    // normalização por RMS, honesta e consistente.
    function masterizarBuffer(buffer, alvoDbfs) {
        const nch = buffer.numberOfChannels;
        // 1. mede RMS global e pico
        let soma = 0, n = 0, pico = 0;
        for (let ch = 0; ch < nch; ch++) {
            const d = buffer.getChannelData(ch);
            for (let i = 0; i < d.length; i++) {
                soma += d[i] * d[i];
                const a = Math.abs(d[i]);
                if (a > pico) pico = a;
            }
            n += d.length;
        }
        const rms = Math.sqrt(soma / Math.max(1, n));
        if (rms <= 0) return buffer;   // silêncio: nada a fazer

        // 2. ganho pro alvo, com teto de +18dB (não amplifica faixa quase muda a ponto
        //    de trazer ruído de fundo pra frente).
        const alvoLin = Math.pow(10, alvoDbfs / 20);
        let ganho = Math.min(alvoLin / rms, 7.94);   // 7.94 ≈ +18dB

        // 3. aplica ganho + soft-limiter tanh no teto -1dBFS (0.891). tanh é
        //    quase linear nos níveis normais e arredonda os picos suavemente,
        //    mantendo alto sem clip duro.
        const C = 0.8913;   // -1 dBFS
        for (let ch = 0; ch < nch; ch++) {
            const d = buffer.getChannelData(ch);
            for (let i = 0; i < d.length; i++) {
                d[i] = C * Math.tanh((d[i] * ganho) / C);
            }
        }
        return buffer;
    }

    // ═══════════════════════════════════════════════════════════════════
    // RENDER — o motor de mixagem num lugar só (antes vivia inline dentro
    // do exportMix). Recebe QUAIS faixas entram no render, mas a duração e
    // o ducking continuam vindo do projeto INTEIRO: renderizar uma faixa
    // sozinha (stem) devolve exatamente o que ela é DENTRO do mix, então
    // os stems somam de volta no mix final — é isso que faz stem ser stem.
    //
    // @param {Object}   o
    // @param {Array}    o.tracks         faixas que entram no arquivo
    // @param {Array}    o.todasAsTracks  projeto inteiro — duração e ducking saem daqui
    // @param {number}   o.duration       duração do projeto em segundos
    // @param {number}   o.sampleRate     ex: 44100
    // @param {Function} [o.aoProgredir]  (percentual, texto) => void
    // @param {Object}   [o.duck]         {gain, attack, release, hold}
    // @returns {Promise<AudioBuffer>}
    // ═══════════════════════════════════════════════════════════════════
    async function renderizarMix(o) {
        const tracksParaRenderizar = o.tracks || [];
        const todasAsTracks = o.todasAsTracks || tracksParaRenderizar;
        const sampleRate = o.sampleRate;
        const aoProgredir = o.aoProgredir;
        const duck = o.duck || DUCK_PADRAO;

        const tracksWithAudio = todasAsTracks.filter(t => t.audioBuffer);
        {
            // Clips: faixa sem clips[] (chamador antigo, ex. Gerador) vira
            // 1 clip cobrindo o arquivo — comportamento idêntico ao de sempre.
            const clipsDe = (t) => (t.clips && t.clips.length)
                ? t.clips
                : [{ buffer: t.audioBuffer, inicio: 0, offset: 0,
                     duracao: t.audioBuffer.duration,
                     fadeIn: t.fadeIn || 0, fadeOut: t.fadeOut || 0 }];
            // Espelhos de ClipModel.fimDoClip/fimDaFaixa (aqui não dá pra usar o
            // módulo direto porque roda dentro do OfflineAudioContext) — mudou
            // lá, muda aqui também.
            const fimDoClip = (c) => c.inicio + c.duracao;
            const fimDosClips = (cs) => cs.reduce((m, c) => Math.max(m, fimDoClip(c)), 0);

            const voiceTracks = tracksWithAudio.filter(t => t.type === 'voice');
            const clipsDeVoz = [];
            for (const t of voiceTracks) for (const c of clipsDe(t)) clipsDeVoz.push(c);

            const fimDaVoz = fimDosClips(clipsDeVoz);
            let finalDuration = o.duration;
            if (clipsDeVoz.length > 0) {
                finalDuration = fimDaVoz + 1.05;
            } else {
                let fimTudo = 0;
                for (const t of tracksWithAudio) fimTudo = Math.max(fimTudo, fimDosClips(clipsDe(t)));
                if (fimTudo > 0) finalDuration = fimTudo;
            }

            // Create offline audio context for rendering
            const offlineContext = new OfflineAudioContext(
                2, // stereo
                finalDuration * sampleRate,
                sampleRate
            );

            // Create master gain
            const masterGain = offlineContext.createGain();
            masterGain.connect(offlineContext.destination);

            // Mix all tracks
            for (let i = 0; i < tracksParaRenderizar.length; i++) {
                const track = tracksParaRenderizar[i];
                if (aoProgredir) aoProgredir((i / tracksParaRenderizar.length) * 80, `Processando ${track.name}...`);

                // Um BufferSource POR CLIP, cada um com clipGain de fades —
                // espelho exato do playTrack (regra da casa: prévia = arquivo).
                const clips = clipsDe(track);
                const sources = [];
                for (const clip of clips) {
                    const source = offlineContext.createBufferSource();
                    source.buffer = clip.buffer;
                    const clipGain = offlineContext.createGain();
                    const cg = clipGain.gain;
                    cg.setValueAtTime(1, 0);
                    if (clip.fadeIn > 0) {
                        cg.setValueAtTime(0, clip.inicio);
                        cg.linearRampToValueAtTime(1, clip.inicio + clip.fadeIn);
                    }
                    if (clip.fadeOut > 0) {
                        cg.setValueAtTime(1, Math.max(clip.inicio, clip.inicio + clip.duracao - clip.fadeOut));
                        cg.linearRampToValueAtTime(0, clip.inicio + clip.duracao);
                    }
                    source.connect(clipGain);
                    sources.push({ source, clipGain, clip });
                }

                // Build effect chain
                // 1. High-pass filter
                const hpfNode = offlineContext.createBiquadFilter();
                hpfNode.type = 'highpass';
                if (track.effects.hpf) {
                    hpfNode.frequency.value = 80;
                } else {
                    hpfNode.frequency.value = 10; // Bypass
                }

                // 2. EQ
                // EQ de 4 bandas — MESMAS frequências do playback, senão o que
                // você ouve não é o que sai no arquivo. Antes o export só aplicava
                // os médios: os sliders de Graves e Agudos não saíam no MP3.
                const eqLig = track.effects.eq;
                const eqSet = track.eqSettings || {};

                const eqLowNode = offlineContext.createBiquadFilter();
                eqLowNode.type = 'lowshelf';
                eqLowNode.frequency.value = 200;
                eqLowNode.gain.value = eqLig ? (eqSet.low || 0) : 0;

                const eqNode = offlineContext.createBiquadFilter();
                eqNode.type = 'peaking';
                eqNode.frequency.value = 1000;
                eqNode.gain.value = eqLig ? (eqSet.mid || 0) : 0;
                eqNode.Q.value = 1;

                const eqHighNode = offlineContext.createBiquadFilter();
                eqHighNode.type = 'peaking';
                eqHighNode.frequency.value = 3500;
                eqHighNode.gain.value = eqLig ? (eqSet.high || 0) : 0;
                eqHighNode.Q.value = 0.9;

                const eqAirNode = offlineContext.createBiquadFilter();
                eqAirNode.type = 'highshelf';
                eqAirNode.frequency.value = 10000;
                eqAirNode.gain.value = eqLig ? (eqSet.air || 0) : 0;

                // 3. Presence
                const presenceNode = offlineContext.createBiquadFilter();
                presenceNode.type = 'highshelf';
                presenceNode.frequency.value = 4000;
                presenceNode.gain.value = track.effects.presence ? 4 : 0;

                // 4. Compressor
                const compressorNode = offlineContext.createDynamicsCompressor();
                compressorNode.threshold.value = track.effects.compressor ? -24 : 0;
                compressorNode.knee.value = 30;
                compressorNode.ratio.value = 12;
                compressorNode.attack.value = 0.003;
                compressorNode.release.value = 0.25;

                // 5. Limiter
                const limiterNode = offlineContext.createDynamicsCompressor();
                if (track.effects.limiter) {
                    limiterNode.threshold.value = -6;
                    limiterNode.knee.value = 0;
                    limiterNode.ratio.value = 20;
                    limiterNode.attack.value = 0.001;
                    limiterNode.release.value = 0.1;
                } else {
                    limiterNode.threshold.value = 0;
                    limiterNode.ratio.value = 1; // Bypass
                }

                // 6. Reverb
                const reverbNode = offlineContext.createConvolver();
                const sampleRateLocal = offlineContext.sampleRate;
                const length = sampleRateLocal * 2;
                const impulse = offlineContext.createBuffer(2, length, sampleRateLocal);
                for (let channel = 0; channel < 2; channel++) {
                    const channelData = impulse.getChannelData(channel);
                    for (let j = 0; j < length; j++) {
                        channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
                    }
                }
                reverbNode.buffer = impulse;
                reverbNode.normalize = true;

                const reverbGain = offlineContext.createGain();
                reverbGain.gain.value = track.effects.reverb ? 0.3 : 0;

                // 7. Delay — MESMOS valores do playback (280ms, feedback 0.28,
                // mix 0.35). Se divergirem, o que se ouve na prévia não é o que
                // sai no arquivo, que é o pior tipo de bug de mixagem.
                const delayNode = offlineContext.createDelay(2.0);
                delayNode.delayTime.value = 0.28;
                const delayFeedback = offlineContext.createGain();
                delayFeedback.gain.value = 0.06;
                const delayMix = offlineContext.createGain();
                delayMix.gain.value = track.effects.delay ? 0.12 : 0;

                // GATE — nó próprio, antes do volume. Não dá pra usar o
                // trackGain: ele já carrega volume, fades e ducking, e as duas
                // automações brigariam no mesmo AudioParam.
                const gateGain = offlineContext.createGain();
                gateGain.gain.value = 1;
                if (track.effects.gate) {
                    const g = track.gateSettings || {};
                    const sens = (g.sensibilidade != null ? g.sensibilidade : 12) / 100;
                    const trechosDaFaixa = detectarTrechosDeClips(
                        clips.map(c => ({ buffer: c.buffer, inicio: c.inicio, offset: c.offset, duracao: c.duracao })),
                        0.25, sens);
                    aplicarGate(gateGain.gain, trechosDaFaixa, fimDosClips(clips), 0, g);
                }

                const trackGain = offlineContext.createGain();
                trackGain.gain.value = track.volume / 100;

                const pan = offlineContext.createStereoPanner();
                pan.pan.value = track.pan;

                // Nível da faixa (fades agora são por clip, no clipGain).
                trackGain.gain.setValueAtTime(track.volume / 100, 0);

                if (track.type === 'music' && clipsDeVoz.length > 0) {
                    // DUCKING por posição: a trilha abaixa quando a voz ENTRA
                    // de verdade na timeline, não a partir do zero.
                    const trechosDeVoz = detectarTrechosDeClips(clipsDeVoz, duck.hold);
                    const ducou = aplicarDucking(
                        trackGain.gain, trechosDeVoz, track.volume / 100, fimDaVoz, 0, duck
                    );
                    if (!ducou) {
                        trackGain.gain.linearRampToValueAtTime(track.volume / 100, fimDaVoz);
                    }
                    // Fade final continua igual: some 1.05s depois do fim da voz.
                    trackGain.gain.linearRampToValueAtTime(0, fimDaVoz + 1.05);
                }

                // Connect the entire chain
                for (const s of sources) s.clipGain.connect(hpfNode);
                hpfNode.connect(eqLowNode);
                eqLowNode.connect(eqNode);
                eqNode.connect(eqHighNode);
                eqHighNode.connect(eqAirNode);
                eqAirNode.connect(presenceNode);
                presenceNode.connect(compressorNode);
                compressorNode.connect(limiterNode);
                limiterNode.connect(gateGain);
                gateGain.connect(trackGain);
                limiterNode.connect(reverbNode);
                reverbNode.connect(reverbGain);
                reverbGain.connect(trackGain);
                // Delay em paralelo, igual ao playback
                limiterNode.connect(delayNode);
                delayNode.connect(delayFeedback);
                delayFeedback.connect(delayNode);
                delayNode.connect(delayMix);
                delayMix.connect(trackGain);
                trackGain.connect(pan);
                pan.connect(masterGain);

                // Start source
                for (const s of sources) s.source.start(s.clip.inicio, s.clip.offset, s.clip.duracao);
            }

            if (aoProgredir) aoProgredir(90, 'Renderizando áudio...');
            return await offlineContext.startRendering();
        }
    }

    function bufferToWav(buffer) {
        const length = buffer.length * buffer.numberOfChannels * 2;
        const arrayBuffer = new ArrayBuffer(44 + length);
        const view = new DataView(arrayBuffer);
        const channels = [];
        let offset = 0;
        let pos = 0;

        // Write WAV header
        const setUint16 = (data) => {
            view.setUint16(pos, data, true);
            pos += 2;
        };
        const setUint32 = (data) => {
            view.setUint32(pos, data, true);
            pos += 4;
        };

        // RIFF identifier
        setUint32(0x46464952);
        // file length
        setUint32(36 + length);
        // WAVE identifier
        setUint32(0x45564157);
        // fmt chunk identifier
        setUint32(0x20746d66);
        // chunk length
        setUint32(16);
        // sample format (PCM)
        setUint16(1);
        // channel count
        setUint16(buffer.numberOfChannels);
        // sample rate
        setUint32(buffer.sampleRate);
        // byte rate
        setUint32(buffer.sampleRate * buffer.numberOfChannels * 2);
        // block align
        setUint16(buffer.numberOfChannels * 2);
        // bits per sample
        setUint16(16);
        // data chunk identifier
        setUint32(0x61746164);
        // data chunk length
        setUint32(length);

        // Write interleaved data
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (offset < buffer.length) {
            for (let i = 0; i < buffer.numberOfChannels; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    // MP3 DE VERDADE. Antes esta função devolvia o WAV com nome .mp3 — o
    // arquivo "mp3" tinha 10x o tamanho e podia ser recusado por player/WhatsApp.
    // O lamejs já vinha carregado no minidaw.html e nunca era usado.
    // Se o encoder não estiver disponível, devolve WAV MESMO (type audio/wav) e
    // quem chama ajusta a extensão — melhor entregar .wav do que mentir no nome.
    async function bufferToMp3(buffer, kbps) {
        const bitrate = parseInt(kbps, 10) || 192;
        try {
            if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) throw new Error('lamejs ausente');

            const nch = Math.min(2, buffer.numberOfChannels);
            const encoder = new lamejs.Mp3Encoder(nch, buffer.sampleRate, bitrate);
            const total = buffer.length;

            // Float32 (-1..1) → Int16, que é o que o lamejs come.
            const paraInt16 = (f32) => {
                const out = new Int16Array(f32.length);
                for (let i = 0; i < f32.length; i++) {
                    const s = Math.max(-1, Math.min(1, f32[i]));
                    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                return out;
            };

            const left = paraInt16(buffer.getChannelData(0));
            const right = nch > 1 ? paraInt16(buffer.getChannelData(1)) : null;

            const partes = [];
            const BLOCO = 1152;   // tamanho de frame do MP3
            for (let i = 0; i < total; i += BLOCO) {
                const l = left.subarray(i, i + BLOCO);
                const r = right ? right.subarray(i, i + BLOCO) : null;
                const buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
                if (buf.length > 0) partes.push(new Uint8Array(buf));
            }
            const fim = encoder.flush();
            if (fim.length > 0) partes.push(new Uint8Array(fim));

            return new Blob(partes, { type: 'audio/mpeg' });
        } catch (e) {
            console.warn('[mp3] encoder indisponível, exportando WAV:', e);
            return bufferToWav(buffer);   // type: 'audio/wav'
        }
    }

    global.MixEngine = {
        renderizarMix, masterizarBuffer, bufferToWav, bufferToMp3,
        detectarTrechosDeVoz, detectarTrechosDeClips, aplicarDucking, aplicarGate,
        DUCK_PADRAO, GATE_PADRAO
    };
})(window);
