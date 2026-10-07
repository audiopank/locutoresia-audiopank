// video-episodio.js — Vídeo do episódio, MP4 9:16 pro YouTube Shorts (06/10/2026).
//
// Substitui o Filmora: ele pegava o áudio do Vida Saudável feito no Gerador +
// a capa do programa e montava um Short no canal Genius Social. O molde é o
// DELE (copiado dos prints do Filmora):
//   capa → "Episódio N" (laranja/amarelo) → capa até o fim, com "ESCUTE A
//   DICA" por cima por uns segundos → final com SEGUIR / INFORMAÇÕES / capa /
//   WhatsApp / ❤ LIKE.
//
// Tudo no NAVEGADOR (a Vercel não tem ffmpeg nem aguenta arquivo grande):
// canvas 1080×1920 → WebCodecs (H.264 + AAC) → mp4-muxer. Codifica mais rápido
// que o tempo real e não depende da aba ficar na frente. Só LÊ o Gerador
// (#playerResultado, #inputEpisodio, #selectPrograma) — não mexe nele.
(function (global) {
    'use strict';

    const W = 1080, H = 1920, FPS = 30;
    const DURACAO_FINAL = 13;      // segundos do cartão final (como no Filmora)

    // ── PARTE PURA (testada em Node) ─────────────────────────────────────
    // Camadas do vídeo com início/fim em segundos. Cobre o áudio inteiro, sem
    // buraco; o final nunca encosta na tela do episódio.
    //
    // `cenas` (07/10/2026, Achadinhos): spot em cenas — o título de cada cena
    // aparece por cima da capa na hora dela, no lugar do "ESCUTE A DICA".
    // `finalCurto`: spot sem programa fecha em 6 s (13 s comeria metade de um spot de 40 s).
    function roteiro(duracao, opcoes) {
        const o = opcoes || {};
        const D = Math.max(1, Number(duracao) || 0);
        const semEpisodio = !!o.semEpisodio;
        const cenas = Array.isArray(o.cenas) ? o.cenas : [];
        const capaIni = Math.min(5, D * 0.12);
        const epFim = semEpisodio ? 0 : Math.min(capaIni + 6, D * 0.3);
        const finalIni = Math.max(epFim, D - (o.finalCurto ? Math.min(6, D * 0.2) : DURACAO_FINAL));
        const camadas = [];
        if (semEpisodio) {
            camadas.push({ tipo: 'capa', ini: 0, fim: finalIni });
        } else {
            camadas.push({ tipo: 'capa', ini: 0, fim: capaIni });
            camadas.push({ tipo: 'episodio', ini: capaIni, fim: epFim });
            camadas.push({ tipo: 'capa', ini: epFim, fim: finalIni });
        }
        if (cenas.length) {
            for (const c of cenas) {
                const ini = Math.max(Number(c.ini) || 0, epFim), fim = Math.min(Number(c.fim) || 0, finalIni);
                if (fim - ini >= 0.5 && c.titulo) camadas.push({ tipo: 'cena', ini, fim, texto: String(c.titulo) });
            }
        } else if (!o.finalCurto) {
            // "ESCUTE A DICA" é do PROGRAMA (podcast); spot avulso sem cenas fica só capa + final.
            const base = semEpisodio ? Math.min(11, D * 0.3) : epFim;
            const dicaIni = base + 4, dicaFim = dicaIni + 7;
            if (dicaFim <= finalIni - 1) camadas.push({ tipo: 'dica', ini: dicaIni, fim: dicaFim });
        }
        camadas.push({ tipo: 'final', ini: finalIni, fim: D });
        return camadas.filter(c => c.fim > c.ini);
    }

    // Linhas "Cena 1 · 00:00–00:06 · Chega de Perder" (painel de cenas do Gerador)
    // → [{ini, fim, titulo}]. Linha que não casa é ignorada.
    function cenasDoTexto(linhas) {
        const re = /^Cena\s+\d+\s+·\s+(\d+):(\d+)\s*[–-]\s*(\d+):(\d+)\s+·\s+(.+)$/;
        const out = [];
        for (const l of (linhas || [])) {
            const m = re.exec(String(l || '').trim());
            if (m) out.push({ ini: (+m[1]) * 60 + (+m[2]), fim: (+m[3]) * 60 + (+m[4]), titulo: m[5].trim() });
        }
        return out;
    }

    function camadasEm(rot, t) {
        return rot.filter(c => t >= c.ini && t < c.fim);
    }

    // "85 9 9226- 2297" / "(85) 99226-2297" → "85 9 9226-2297". Sem dígitos
    // suficientes, devolve o texto como veio (ele pode escrever o que quiser).
    function formatarWhatsApp(texto) {
        const bruto = String(texto || '').trim();
        const d = bruto.replace(/\D/g, '');
        if (d.length === 11) return `${d.slice(0, 2)} ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
        return bruto;
    }

    // ── DESENHO DE UM QUADRO ─────────────────────────────────────────────
    function gradienteLaranja(ctx, y0, y1) {
        const g = ctx.createLinearGradient(0, y0, W, y1);
        g.addColorStop(0, '#ff6a00');
        g.addColorStop(0.55, '#ff9a00');
        g.addColorStop(1, '#ffd400');
        return g;
    }

    // Texto centralizado que encolhe até caber na largura útil.
    function texto(ctx, str, y, tam, preenchimento, opc) {
        const o = opc || {};
        let t = tam;
        ctx.font = `${o.peso || '900'} ${t}px Arial, Helvetica, sans-serif`;
        while (ctx.measureText(str).width > W * (o.largura || 0.9) && t > 20) {
            t -= 4;
            ctx.font = `${o.peso || '900'} ${t}px Arial, Helvetica, sans-serif`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (o.sombra !== false) {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillText(str, W / 2 + 8, y + 10);
            ctx.restore();
        }
        ctx.fillStyle = preenchimento;
        ctx.fillText(str, W / 2, y);
    }

    // Título longo cabe melhor em 2 linhas grandes do que em 1 linha minúscula.
    function quebrarEmDuas(ctx, str, tam) {
        ctx.font = `900 ${tam}px Arial, Helvetica, sans-serif`;
        if (ctx.measureText(str).width <= W * 0.9) return [str];
        const p = str.split(' ');
        if (p.length < 2) return [str];
        let melhor = 1, dif = Infinity;
        for (let i = 1; i < p.length; i++) {
            const d = Math.abs(ctx.measureText(p.slice(0, i).join(' ')).width - ctx.measureText(p.slice(i).join(' ')).width);
            if (d < dif) { dif = d; melhor = i; }
        }
        return [p.slice(0, melhor).join(' '), p.slice(melhor).join(' ')];
    }

    function retanguloRedondo(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // Capa "contida" na caixa (sem cortar, sem esticar).
    function capaNaCaixa(ctx, capa, x, y, w, h) {
        if (!capa) return;
        const iw = capa.width || capa.naturalWidth, ih = capa.height || capa.naturalHeight;
        if (!iw || !ih) return;
        const e = Math.min(w / iw, h / ih);
        const dw = iw * e, dh = ih * e;
        ctx.drawImage(capa, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    function coracao(ctx, cx, cy, s) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.35);
        ctx.bezierCurveTo(cx - s * 0.9, cy - s * 0.25, cx - s * 0.45, cy - s * 0.95, cx, cy - s * 0.45);
        ctx.bezierCurveTo(cx + s * 0.45, cy - s * 0.95, cx + s * 0.9, cy - s * 0.25, cx, cy + s * 0.35);
        ctx.closePath();
        ctx.fill();
    }

    function desenharQuadro(ctx, t, rot, capa, dados) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        for (const c of camadasEm(rot, t)) {
            if (c.tipo === 'capa') {
                capaNaCaixa(ctx, capa, 0, 0, W, H);
            } else if (c.tipo === 'episodio') {
                texto(ctx, 'Episódio', H * 0.42, 230, gradienteLaranja(ctx, H * 0.36, H * 0.48));
                texto(ctx, String(dados.episodio || ''), H * 0.57, 260, gradienteLaranja(ctx, H * 0.5, H * 0.64));
            } else if (c.tipo === 'dica') {
                texto(ctx, 'ESCUTE A DICA', H * 0.69, 130, gradienteLaranja(ctx, H * 0.66, H * 0.72));
            } else if (c.tipo === 'cena') {
                // Título da cena: até 2 linhas, em maiúsculas, no terço de baixo.
                const linhas = quebrarEmDuas(ctx, String(c.texto || '').toUpperCase(), 110);
                linhas.forEach((l, i) => texto(ctx, l, H * (0.7 + i * 0.065), 110,
                                               gradienteLaranja(ctx, H * 0.66, H * 0.8)));
            } else if (c.tipo === 'final') {
                // SEGUIR: pílula branca com letra roxa
                ctx.fillStyle = '#ffffff';
                retanguloRedondo(ctx, W * 0.15, H * 0.05, W * 0.7, H * 0.075, H * 0.0375);
                ctx.fill();
                const roxo = ctx.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
                roxo.addColorStop(0, '#a020f0');
                roxo.addColorStop(1, '#6a3df0');
                texto(ctx, 'SEGUIR', H * 0.0875, 120, roxo, { sombra: false, largura: 0.6 });
                texto(ctx, String(dados.chamada || 'INFORMAÇÕES').toUpperCase(), H * 0.2, 130,
                      gradienteLaranja(ctx, H * 0.17, H * 0.23));
                capaNaCaixa(ctx, capa, 0, H * 0.25, W, H * 0.35);
                if (dados.whatsapp) texto(ctx, dados.whatsapp, H * 0.7, 140, gradienteLaranja(ctx, H * 0.67, H * 0.73));
                // ❤ LIKE: botão vermelho
                ctx.fillStyle = '#ef4636';
                retanguloRedondo(ctx, W * 0.15, H * 0.79, W * 0.7, H * 0.105, H * 0.03);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                coracao(ctx, W * 0.31, H * 0.845, 95);
                ctx.font = '900 150px Arial, Helvetica, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('LIKE', W * 0.41, H * 0.845);
            }
        }
    }

    // ── CODIFICAÇÃO (WebCodecs + mp4-muxer) ──────────────────────────────
    const espera = ms => new Promise(r => setTimeout(r, ms));

    async function codecDeVideo() {
        for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
            try {
                const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 4_000_000, framerate: FPS });
                if (s && s.supported) return codec;
            } catch (e) { /* tenta o próximo */ }
        }
        return null;
    }

    // AAC só aceita algumas taxas: o mix do Gerador pode vir em 44,1 ou 48 kHz;
    // qualquer outra é reamostrada pra 48 kHz.
    async function audioPronto(buf) {
        const canais = Math.min(2, buf.numberOfChannels);
        if ((buf.sampleRate === 44100 || buf.sampleRate === 48000) && buf.numberOfChannels <= 2) return buf;
        const ctx = new OfflineAudioContext(canais, Math.ceil(buf.duration * 48000), 48000);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        return ctx.startRendering();
    }

    async function gerarMp4(opc) {
        if (!('VideoEncoder' in global) || !('AudioEncoder' in global)) {
            throw new Error('Este navegador não monta vídeo. Use o Chrome ou o Edge atualizados.');
        }
        if (!global.Mp4Muxer) throw new Error('O empacotador de MP4 não carregou (internet?). Recarregue a página.');
        const audio = await audioPronto(opc.audioBuffer);
        const canais = Math.min(2, audio.numberOfChannels);
        const taxa = audio.sampleRate;
        const codec = await codecDeVideo();
        if (!codec) throw new Error('O codificador H.264 deste navegador não aceitou 1080×1920.');
        const audioCfg = { codec: 'mp4a.40.2', sampleRate: taxa, numberOfChannels: canais, bitrate: 160000 };
        const sa = await AudioEncoder.isConfigSupported(audioCfg);
        if (!sa || !sa.supported) throw new Error('O codificador de áudio AAC deste navegador não está disponível.');

        const dur = audio.duration;
        const rot = roteiro(dur, opc.roteiroOpcoes || { semEpisodio: !opc.episodio });
        const alvo = new Mp4Muxer.ArrayBufferTarget();
        const muxer = new Mp4Muxer.Muxer({
            target: alvo,
            video: { codec: 'avc', width: W, height: H, frameRate: FPS },
            audio: { codec: 'aac', numberOfChannels: canais, sampleRate: taxa },
            fastStart: 'in-memory',
        });
        let erro = null;
        const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { erro = e; } });
        ve.configure({ codec, width: W, height: H, bitrate: 4_000_000, framerate: FPS, avc: { format: 'avc' } });
        const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { erro = e; } });
        ae.configure(audioCfg);

        // Áudio: blocos de 1 s, planar.
        for (let i = 0; i < audio.length; i += taxa) {
            const n = Math.min(taxa, audio.length - i);
            const dados = new Float32Array(n * canais);
            for (let c = 0; c < canais; c++) dados.set(audio.getChannelData(c).subarray(i, i + n), c * n);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: taxa, numberOfFrames: n,
                                       numberOfChannels: canais, timestamp: Math.round(i / taxa * 1e6), data: dados });
            ae.encode(ad);
            ad.close();
        }

        // Vídeo: um quadro por 1/30 s; keyframe a cada 2 s.
        const canvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(W, H)
            : Object.assign(document.createElement('canvas'), { width: W, height: H });
        const ctx = canvas.getContext('2d');
        const total = Math.ceil(dur * FPS);
        for (let f = 0; f < total; f++) {
            if (erro) throw erro;
            const t = f / FPS;
            desenharQuadro(ctx, t, rot, opc.capa, opc);
            const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
            ve.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
            vf.close();
            while (ve.encodeQueueSize > 12) await espera(2);
            if (opc.aoProgresso && f % 15 === 0) opc.aoProgresso(f / total);
        }
        await ve.flush();
        await ae.flush();
        if (erro) throw erro;
        ve.close();
        ae.close();
        muxer.finalize();
        if (opc.aoProgresso) opc.aoProgresso(1);
        return new Blob([alvo.buffer], { type: 'video/mp4' });
    }

    // ── PAINEL NO GERADOR ────────────────────────────────────────────────
    // A capa fica lembrada por programa num IndexedDB PRÓPRIO (não mexe no
    // 'locutores-ia' que a MiniDAW usa pras pastas).
    function abrirBanco() {
        return new Promise((ok, falha) => {
            const r = indexedDB.open('locutores-ia-video', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('capas');
            r.onsuccess = () => ok(r.result);
            r.onerror = () => falha(r.error);
        });
    }
    async function guardarCapa(chave, blob) {
        try {
            const db = await abrirBanco();
            await new Promise((ok, falha) => {
                const tx = db.transaction('capas', 'readwrite');
                tx.objectStore('capas').put(blob, chave);
                tx.oncomplete = ok;
                tx.onerror = () => falha(tx.error);
            });
        } catch (e) { /* sem banco: vale só nesta aba */ }
    }
    async function lerCapa(chave) {
        try {
            const db = await abrirBanco();
            return await new Promise(ok => {
                const r = db.transaction('capas').objectStore('capas').get(chave);
                r.onsuccess = () => ok(r.result || null);
                r.onerror = () => ok(null);
            });
        } catch (e) { return null; }
    }

    function instalarPainel() {
        const $ = id => document.getElementById(id);
        const painel = $('painelVideo');
        if (!painel) return;
        const est = { capa: null, programas: [], mp4: null, url: null };

        // Capa lembrada pelo PROGRAMA; spot sem programa (Achadinhos…) lembra pelo
        // perfil escolhido no seletor do Feed — cada perfil com a sua logo.
        const chavePrograma = () => ($('selectPrograma') && $('selectPrograma').value)
            || ($('selectContaFeed') && $('selectContaFeed').value) || 'spots';
        const programa = () => est.programas.find(p => p.id === (($('selectPrograma') && $('selectPrograma').value) || '')) || null;
        const status = (msg) => { $('videoStatus').textContent = msg || ''; };
        // PROGRAMA ESCOLHIDO = molde do programa (Vida Saudável), SEMPRE. Decide pelo
        // próprio seletor, não pela lista vinda da rede: se /api/gerador/programas
        // falhar, o episódio não vira spot avulso (pergunta dele, 07/10/2026).
        const temPrograma = () => !!($('selectPrograma') && $('selectPrograma').value);
        // Cenas com tempo medido (painel "Cenas com tempo de verdade" do Gerador) —
        // só com o painel VISÍVEL: as de um Achadinhos feito antes na mesma página
        // ficam escondidas no DOM e não podem vazar pro vídeo seguinte.
        const cenasDaTela = () => {
            if ($('painelCenas') && $('painelCenas').style.display === 'none') return [];
            return cenasDoTexto(Array.from(document.querySelectorAll('#listaCenas .cena-cab strong')).map(el => el.textContent));
        };
        const opcoesDoRoteiro = (episodio) => ({ semEpisodio: !episodio, cenas: temPrograma() ? [] : cenasDaTela(),
                                                 finalCurto: !temPrograma() });
        const chaveChamada = () => 'locutores_video_chamada_' + chavePrograma();

        function desenharPrevias() {
            const dados = { episodio: $('videoEpisodio').value.trim(), whatsapp: formatarWhatsApp($('videoWhatsapp').value),
                            chamada: $('videoChamada').value.trim() };
            const dur = ($('playerResultado') && isFinite($('playerResultado').duration) && $('playerResultado').duration) || 116;
            const rot = roteiro(dur, opcoesDoRoteiro(dados.episodio));
            const meio = rot.filter(c => c.tipo === 'episodio' || c.tipo === 'dica' || c.tipo === 'cena');
            const fim = rot.find(c => c.tipo === 'final');
            const tempos = [meio[0] ? (meio[0].ini + meio[0].fim) / 2 : 1,
                            meio[1] ? (meio[1].ini + meio[1].fim) / 2 : dur * 0.4,
                            fim ? (fim.ini + fim.fim) / 2 : dur - 1];
            [['videoPreviaEp', tempos[0]], ['videoPreviaDica', tempos[1]], ['videoPreviaFinal', tempos[2]]].forEach(([id, t]) => {
                const c = $(id);
                if (!c) return;
                const off = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(W, H)
                    : Object.assign(document.createElement('canvas'), { width: W, height: H });
                desenharQuadro(off.getContext('2d'), t, rot, est.capa, dados);
                c.getContext('2d').drawImage(off, 0, 0, c.width, c.height);
            });
        }

        async function usarCapa(blob, guardar) {
            try {
                est.capa = await createImageBitmap(blob);
            } catch (e) {
                status('⚠️ Não consegui abrir essa imagem. Prefira PNG ou JPG.');
                return;
            }
            est.capaChave = chavePrograma();
            if (guardar) await guardarCapa(est.capaChave, blob);
            $('videoCapaNome').textContent = '✅ capa escolhida' + (guardar ? ` (fica lembrada pra "${est.capaChave}")` : '');
            desenharPrevias();
        }

        async function preencher() {
            const p = programa();
            const ep = temPrograma() && $('inputEpisodio') && $('inputEpisodio').value;
            $('videoEpisodio').value = ep || '';
            // WhatsApp: o do programa; sem a lista (rede), o último usado neste programa/perfil.
            let chamada = '', zap = '';
            try {
                chamada = localStorage.getItem(chaveChamada()) || '';
                zap = localStorage.getItem('locutores_video_zap_' + chavePrograma()) || '';
            } catch (e) { /* sem storage */ }
            $('videoWhatsapp').value = (p && p.whatsapp) ? formatarWhatsApp(p.whatsapp) : zap;
            $('videoChamada').value = chamada || (temPrograma() ? 'INFORMAÇÕES' : 'LINK NA DESCRIÇÃO');
            // Trocou de programa/perfil desde a última vez: a capa é outra.
            if (!est.capa || est.capaChave !== chavePrograma()) {
                est.capa = null;
                const blob = await lerCapa(chavePrograma());
                if (blob) await usarCapa(blob, false);
                else $('videoCapaNome').textContent = `nenhuma capa ainda pra "${chavePrograma()}"`;
            }
            desenharPrevias();
        }

        $('btnVideoEpisodio').addEventListener('click', async () => {
            painel.style.display = painel.style.display === 'none' ? '' : 'none';
            if (painel.style.display !== 'none') {
                if (!est.programas.length) {
                    try { est.programas = (await (await fetch('/api/gerador/programas')).json()).programas || []; } catch (e) { /* sem lista */ }
                }
                await preencher();
                painel.scrollIntoView({ behavior: 'smooth' });
            }
        });
        $('btnVideoCapa').addEventListener('click', () => { $('inputVideoCapa').value = ''; $('inputVideoCapa').click(); });
        $('inputVideoCapa').addEventListener('change', () => {
            const f = $('inputVideoCapa').files && $('inputVideoCapa').files[0];
            if (f) usarCapa(f, true);
        });
        $('videoEpisodio').addEventListener('input', desenharPrevias);
        $('videoWhatsapp').addEventListener('input', () => {
            try { localStorage.setItem('locutores_video_zap_' + chavePrograma(), $('videoWhatsapp').value); } catch (e) { /* sem storage */ }
            desenharPrevias();
        });
        $('videoChamada').addEventListener('input', () => {
            try { localStorage.setItem(chaveChamada(), $('videoChamada').value); } catch (e) { /* sem storage */ }
            desenharPrevias();
        });

        $('btnGerarVideo').addEventListener('click', async () => {
            const src = $('playerResultado') && $('playerResultado').src;
            if (!src) { status('⚠️ Gere o áudio do episódio primeiro.'); return; }
            if (!est.capa) { status('⚠️ Escolha a capa do programa primeiro.'); return; }
            const b = $('btnGerarVideo');
            b.disabled = true;
            $('btnBaixarVideo').style.display = 'none';
            $('videoProgresso').style.display = '';
            status('Preparando o áudio…');
            try {
                const bytes = await (await fetch(src)).arrayBuffer();
                const ac = new (global.AudioContext || global.webkitAudioContext)();
                const audioBuffer = await ac.decodeAudioData(bytes);
                ac.close();
                const inicio = performance.now();
                const episodio = $('videoEpisodio').value.trim();
                try { localStorage.setItem('locutores_video_zap_' + chavePrograma(), $('videoWhatsapp').value); } catch (e) { /* sem storage */ }
                const mp4 = await gerarMp4({
                    audioBuffer, capa: est.capa, episodio,
                    whatsapp: formatarWhatsApp($('videoWhatsapp').value),
                    chamada: $('videoChamada').value.trim(),
                    roteiroOpcoes: opcoesDoRoteiro(episodio),
                    aoProgresso: p => { $('videoProgresso').value = p; status(`Montando o vídeo… ${Math.round(p * 100)}%`); },
                });
                if (est.url) URL.revokeObjectURL(est.url);
                est.mp4 = mp4;
                est.url = URL.createObjectURL(mp4);
                $('videoResultado').src = est.url;
                $('videoResultado').style.display = '';
                $('btnBaixarVideo').style.display = '';
                status(`✅ Vídeo pronto: ${Math.round(audioBuffer.duration)} s, ${(mp4.size / 1048576).toFixed(1)} MB, em ${Math.round((performance.now() - inicio) / 1000)} s. Confira e baixe.`);
            } catch (e) {
                status('⚠️ ' + (e && e.message ? e.message : 'Falha ao montar o vídeo.'));
            } finally {
                b.disabled = false;
                $('videoProgresso').style.display = 'none';
            }
        });

        $('btnBaixarVideo').addEventListener('click', () => {
            if (!est.url) return;
            const p = programa();
            const ep = $('videoEpisodio').value.trim();
            const base = (p ? p.nome : 'video-spot').normalize('NFKD').replace(/[̀-ͯ]/g, '')
                .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const a = document.createElement('a');
            a.href = est.url;
            a.download = base + (ep ? '-episodio-' + ep : '') + '.mp4';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    const VideoEpisodio = { W, H, FPS, roteiro, camadasEm, cenasDoTexto, formatarWhatsApp, desenharQuadro, gerarMp4 };
    global.VideoEpisodio = VideoEpisodio;
    if (typeof module !== 'undefined' && module.exports) module.exports = VideoEpisodio;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalarPainel);
        else instalarPainel();
    }
})(typeof window !== 'undefined' ? window : globalThis);
