/**
 * 🎬 VÍDEO DO CLIENTE NA MINIDAW CLÁSSICA (03/11/2026, pedido dele): o cliente
 * manda um vídeo de 30 s; a produtora faz a voz, mixa com trilha + efeitos
 * OLHANDO as imagens e exporta UM MP4 pronto pra mandar no WhatsApp/Drive.
 *
 * - "🎬 Vídeo do cliente" abre o arquivo (MP4/MOV do celular). Uma janelinha
 *   toca o vídeo JUNTO com o cursor da MiniDAW (mudo — o som vai por faixa).
 * - O som que veio no vídeo vira a faixa "Som do vídeo" (efeito sonoro: sem
 *   ducking nem fade de trilha) — mudo, baixinho por baixo ou cortado, você decide.
 * - "⬇ Exportar MP4": o MESMO mix final do Exportar (com master) + as imagens
 *   do cliente COPIADAS, sem regravar (H.264, HEVC do iPhone, VP9, AV1), com a
 *   rotação original. Tudo no navegador; nada sobe pro servidor/Supabase.
 * - Mix mais longo que o vídeo é cortado no fim do vídeo (com fade curto).
 *
 * As contas puras estão no topo e são testadas em tests/video-cliente.test.mjs.
 */
(function (global) {
    'use strict';

    function codecMuxer(codec) {
        const c = String(codec || '').toLowerCase();
        if (/^avc[13]/.test(c)) return 'avc';
        if (/^(hvc1|hev1)/.test(c)) return 'hevc';
        if (/^vp09/.test(c)) return 'vp9';
        if (/^av01/.test(c)) return 'av1';
        return null;
    }

    /** Matriz do tkhd (inteiros 16.16 e 2.30) → números reais, como o mp4-muxer quer. */
    function matrizDoMp4box(m) {
        if (!m || m.length < 9) return 0;
        return Array.from(m).slice(0, 9).map((v, i) => (i === 2 || i === 5 || i === 8) ? v / 1073741824 : v / 65536);
    }

    /** Amostras do mp4box → pedaços pro empacotador (µs, ordem de decodificação). */
    function chunksDasAmostras(amostras) {
        return amostras.map(s => ({
            data: s.data,
            key: !!s.is_sync,
            pts: Math.round(s.cts * 1e6 / s.timescale),
            dur: Math.round(s.duration * 1e6 / s.timescale),
            cto: Math.round((s.cts - s.dts) * 1e6 / s.timescale),
        }));
    }

    /** Deixa o mix com a duração do vídeo: corta (fade de 30 ms) ou completa com silêncio. */
    function ajustarAoVideo(canais, sr, duracaoVideo) {
        const n = Math.round(duracaoVideo * sr);
        const out = canais.map(c => {
            const a = new Float32Array(n);
            a.set(c.subarray(0, Math.min(n, c.length)));
            return a;
        });
        // Só conta como "cortado" o SOM de verdade: o mix sempre termina com um rabo
        // de silêncio, e isso passar do vídeo não é problema (−50 dB = silêncio).
        let ultimoSom = -1;
        for (const c of canais) for (let i = c.length - 1; i > ultimoSom; i--) if (Math.abs(c[i]) > 0.003) { ultimoSom = i; break; }
        const cortouS = ultimoSom >= n ? Math.round((ultimoSom + 1 - n) / sr * 100) / 100 : 0;
        if (cortouS > 0) {
            const F = Math.min(n, Math.round(0.03 * sr));
            for (const a of out) for (let k = 0; k < F; k++) a[n - F + k] *= (F - 1 - k) / Math.max(1, F - 1);
        }
        return { canais: out, cortouS };
    }

    function nomeDoArquivo(original) {
        const base = String(original || '').replace(/\.[^.]+$/, '').trim() || 'video';
        return `${base} - com locução.mp4`;
    }

    const VideoCliente = { codecMuxer, matrizDoMp4box, chunksDasAmostras, ajustarAoVideo, nomeDoArquivo };
    global.VideoCliente = VideoCliente;
    if (typeof module !== 'undefined' && module.exports) { module.exports = VideoCliente; return; }
    if (typeof document === 'undefined') return;

    // ── Navegador ────────────────────────────────────────────────────────
    const LIBS = [
        ['MP4Box', 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js'],
        ['Mp4Muxer', 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js'],
    ];
    const st = { video: null, url: null, nome: '', ui: null, raf: 0, faixaSom: null };
    const daw = () => global.minidaw;
    const avisar = (m, t) => { const d = daw(); if (d) d.showNotification(m, t || 'info'); };
    const el = (tag, props, filhos) => { const e = Object.assign(document.createElement(tag), props || {}); for (const f of (filhos || [])) e.append(f); return e; };

    function carregarLibs() {
        return Promise.all(LIBS.map(([nome, url]) => global[nome] ? null : new Promise((ok, falha) => {
            const s = el('script', { src: url, onload: ok, onerror: () => falha(new Error('Não carreguei ' + nome + ' (internet?)')) });
            document.head.append(s);
        })));
    }

    /** Lê o MP4/MOV: pista de vídeo (pedaços já codificados), codec, tamanho, rotação. */
    function lerVideo(arrayBuffer) {
        return new Promise((ok, falha) => {
            const f = global.MP4Box.createFile();
            let info = null, trilha = null, feito = false;
            const amostras = [];
            const fim = () => {
                if (feito) return;
                feito = true;
                const trak = f.getTrackById(trilha.id);
                const entrada = trak.mdia.minf.stbl.stsd.entries[0];
                const caixa = entrada.avcC || entrada.hvcC || entrada.vpcC || entrada.av1C;
                let descricao;
                if (caixa) {
                    const DS = global.MP4Box.DataStream || global.DataStream;   // o mp4box 0.5 expõe DataStream solto
                    const ds = new DS(undefined, 0, DS.BIG_ENDIAN);
                    caixa.write(ds);
                    descricao = new Uint8Array(ds.buffer).slice(8);   // sem o cabeçalho da caixa
                }
                ok({
                    codec: trilha.codec, mux: codecMuxer(trilha.codec),
                    largura: trilha.video.width, altura: trilha.video.height,
                    matriz: matrizDoMp4box(trilha.matrix),
                    duracao: (trilha.duration / trilha.timescale) || (info.duration / info.timescale),
                    descricao, chunks: chunksDasAmostras(amostras), temAudio: info.audioTracks.length > 0,
                });
            };
            f.onError = (e) => falha(new Error('Não consegui ler esse vídeo: ' + e));
            f.onReady = (i) => {
                info = i;
                trilha = i.videoTracks[0];
                if (!trilha) { feito = true; falha(new Error('Esse arquivo não tem imagem de vídeo.')); return; }
                f.setExtractionOptions(trilha.id, null, { nbSamples: 1e9 });
                f.start();
            };
            f.onSamples = (id, u, s) => { amostras.push(...s); if (amostras.length >= trilha.nb_samples) fim(); };
            const b = arrayBuffer.slice(0);
            b.fileStart = 0;
            f.appendBuffer(b);
            f.flush();
            setTimeout(() => {
                if (feito) return;
                if (trilha && amostras.length) fim();
                else { feito = true; falha(new Error('Esse arquivo não é um MP4/MOV que eu consiga abrir.')); }
            }, 0);
        });
    }

    /** Imagens do cliente (copiadas) + mix em AAC → Blob MP4. */
    async function montarMp4(v, audio) {
        if (!('AudioEncoder' in global)) throw new Error('Este navegador não codifica áudio pro MP4. Use o Chrome ou o Edge atualizados.');
        const canais = Math.min(2, audio.numberOfChannels), taxa = audio.sampleRate;
        const audioCfg = { codec: 'mp4a.40.2', sampleRate: taxa, numberOfChannels: canais, bitrate: 192000 };
        const sup = await AudioEncoder.isConfigSupported(audioCfg);
        if (!sup || !sup.supported) throw new Error('O codificador AAC deste navegador não está disponível.');
        const alvo = new global.Mp4Muxer.ArrayBufferTarget();
        const muxer = new global.Mp4Muxer.Muxer({
            target: alvo,
            video: { codec: v.mux, width: v.largura, height: v.altura, rotation: v.matriz || 0 },
            audio: { codec: 'aac', numberOfChannels: canais, sampleRate: taxa },
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
        });
        const meta = { decoderConfig: { codec: v.codec, codedWidth: v.largura, codedHeight: v.altura, description: v.descricao } };
        v.chunks.forEach((c, i) => muxer.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', c.pts, c.dur, i === 0 ? meta : undefined, c.cto));
        let erro = null;
        const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { erro = e; } });
        ae.configure(audioCfg);
        for (let i = 0; i < audio.length; i += taxa) {
            const n = Math.min(taxa, audio.length - i);
            const dados = new Float32Array(n * canais);
            for (let c = 0; c < canais; c++) dados.set(audio.getChannelData(c).subarray(i, i + n), c * n);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: taxa, numberOfFrames: n,
                                       numberOfChannels: canais, timestamp: Math.round(i / taxa * 1e6), data: dados });
            ae.encode(ad);
            ad.close();
        }
        await ae.flush();
        if (erro) throw erro;
        ae.close();
        muxer.finalize();
        return new Blob([alvo.buffer], { type: 'video/mp4' });
    }

    // ── Painel + sincronia com o cursor ──────────────────────────────────
    function montarPainel() {
        const css = el('style', { textContent: `
            #videoCliente{position:fixed;right:16px;bottom:96px;z-index:1999;background:#0e1424;color:#e6e8f0;border:1px solid #6366f1;
              border-radius:12px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.55);display:none;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
            #videoCliente video{max-height:45vh;max-width:100%;border-radius:8px;background:#000;display:block;margin:0 auto}
            #videoCliente .vc-topo{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
            #videoCliente button{background:#232b45;color:#e6e8f0;border:1px solid #3a4468;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:13px}
            #videoCliente button.vc-exp{background:#6366f1;border-color:#6366f1;color:#fff;font-weight:600}
            #videoCliente .vc-sub{color:#9aa3c7;font-size:12px}` });
        const titulo = el('b', { textContent: '🎬 Vídeo do cliente' });
        const sub = el('div', { className: 'vc-sub' });
        const video = el('video', { muted: true, playsInline: true, preload: 'auto' });
        video.muted = true;
        const exp = el('button', { className: 'vc-exp', textContent: '⬇ Exportar MP4 com o mix', onclick: exportar });
        const trocar = el('button', { textContent: 'Trocar vídeo', onclick: abrir });
        const fechar = el('button', { textContent: '✕', title: 'Fechar (o vídeo sai da sessão; o projeto não muda)', onclick: fecharPainel });
        const painel = el('div', { id: 'videoCliente' }, [
            el('div', { className: 'vc-topo' }, [titulo, fechar]), sub, video,
            el('div', { className: 'vc-topo' }, [exp, trocar]),
            el('div', { className: 'vc-sub', textContent: 'Toca junto com o cursor. O MP4 sai com o mesmo mix do Exportar e as imagens do cliente sem regravar — salvo no seu PC.' }),
        ]);
        document.head.append(css);
        document.body.append(painel);
        st.ui = { painel, video, sub, titulo };
    }

    function tempoDoProjeto(d) {
        return d.isPlaying && d.playbackBase != null ? d.audioContext.currentTime - d.playbackBase : (d.currentTime || 0);
    }

    function sincronizar() {
        st.raf = requestAnimationFrame(sincronizar);
        const d = daw(), v = st.ui && st.ui.video;
        if (!d || !v || !st.video || !v.readyState) return;
        const t = tempoDoProjeto(d);
        const dentro = t >= 0 && t < st.video.duracao - 0.04;
        if (d.isPlaying && dentro) {
            if (Math.abs(v.currentTime - t) > 0.15) v.currentTime = t;
            if (v.paused) v.play().catch(() => {});
        } else {
            if (!v.paused) v.pause();
            const alvo = Math.max(0, Math.min(t, st.video.duracao - 0.04));
            if (Math.abs(v.currentTime - alvo) > 0.05) v.currentTime = alvo;
        }
    }

    function abrir() {
        const input = el('input', { type: 'file', accept: 'video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v' });
        input.onchange = () => { if (input.files[0]) carregar(input.files[0]); };
        input.click();
    }

    async function carregar(arquivo) {
        const d = daw();
        if (!d) return;
        try {
            avisar(`Abrindo "${arquivo.name}"…`, 'info');
            await carregarLibs();
            const v = await lerVideo(await arquivo.arrayBuffer());
            if (!v.mux) throw new Error(`O vídeo está em "${v.codec}", que eu não consigo juntar sem regravar. Peça o arquivo em MP4 (H.264).`);
            if (!st.ui) montarPainel();
            if (st.url) URL.revokeObjectURL(st.url);
            st.url = URL.createObjectURL(arquivo);
            st.video = v;
            st.nome = arquivo.name;
            st.ui.video.src = st.url;
            st.ui.titulo.textContent = '🎬 ' + arquivo.name;
            // Celular grava deitado e marca a rotação: mostra o tamanho COMO APARECE na tela.
            const girado = Array.isArray(v.matriz) && Math.abs(v.matriz[0]) < 0.5;
            const [lw, lh] = girado ? [v.altura, v.largura] : [v.largura, v.altura];
            st.ui.sub.textContent = `${v.duracao.toFixed(1).replace('.', ',')} s · ${lw}×${lh}${lh > lw ? ' (em pé)' : ''} · ${v.codec.split('.')[0]}` +
                (v.temAudio ? ' · com som' : ' · sem som');
            st.ui.painel.style.display = 'flex';
            if (!st.raf) sincronizar();
            if (v.temAudio) {
                d.addTrack('sfx');
                const faixa = d.tracks[d.tracks.length - 1];
                faixa.name = 'Som do vídeo';
                try {
                    await d.loadAudioFile(arquivo, faixa.id);
                    st.faixaSom = faixa.id;
                    d.updateTrackUI(faixa);
                } catch (e) {
                    avisar('Não consegui tirar o som do vídeo — a faixa ficou vazia (o MP4 sai só com o mix).', 'warning');
                }
            }
            avisar(`🎬 Vídeo do cliente aberto (${v.duracao.toFixed(1).replace('.', ',')} s)` +
                (v.temAudio ? ' — o som dele está na faixa "Som do vídeo".' : '.'), 'success');
        } catch (e) {
            avisar(e.message || String(e), 'error');
        }
    }

    function fecharPainel() {
        if (st.ui) { st.ui.video.pause(); st.ui.video.removeAttribute('src'); st.ui.painel.style.display = 'none'; }
        if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
        st.video = null;
        if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    }

    async function exportar() {
        const d = daw();
        if (!d || !st.video) return;
        const { audiveis } = d._faixasParaExportar();
        if (!audiveis.length) { avisar('Nenhuma faixa com áudio pra mixar (ou estão todas mudas).', 'warning'); return; }
        d.showMixingStatus(true);
        d.updateMixingProgress(0, 'Mixando pro vídeo...');
        try {
            await carregarLibs();
            const { buffer } = await d._renderizarMixFinal(audiveis);
            const canais = [];
            for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) canais.push(buffer.getChannelData(c));
            const aj = ajustarAoVideo(canais, buffer.sampleRate, st.video.duracao);
            const audio = new AudioBuffer({ length: aj.canais[0].length, numberOfChannels: aj.canais.length, sampleRate: buffer.sampleRate });
            aj.canais.forEach((c, i) => audio.copyToChannel(c, i));
            d.updateMixingProgress(96, 'Juntando com as imagens do cliente...');
            const blob = await montarMp4(st.video, audio);
            d.updateMixingProgress(100, 'Concluído!');
            d.downloadBlob(blob, nomeDoArquivo(st.nome));
            setTimeout(() => d.showMixingStatus(false), 800);
            avisar(`🎬 MP4 pronto (${(blob.size / 1048576).toFixed(1).replace('.', ',')} MB, ${st.video.duracao.toFixed(1).replace('.', ',')} s)` +
                (aj.cortouS >= 0.1 ? ` — o mix passava ${aj.cortouS.toFixed(1).replace('.', ',')} s do vídeo e foi cortado no fim dele.` : '.'),
                aj.cortouS > 0.5 ? 'warning' : 'success');
        } catch (e) {
            console.error('Exportar MP4:', e);
            d.showMixingStatus(false);
            avisar('Não consegui montar o MP4: ' + (e.message || e), 'error');
        }
    }

    Object.assign(VideoCliente, { abrir, carregar, exportar, fechar: fecharPainel, _estado: st, lerVideo, montarMp4, carregarLibs });
})(typeof window !== 'undefined' ? window : globalThis);
