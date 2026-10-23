/**
 * GRAVAÇÃO AO VIVO NA FAIXA (24/10/2026, pedido dele: "locutor na cabine,
 * gravar o off do spot do Crato") — botão ● de cada faixa de voz, como no
 * Samplitude. MiniDAW clássica.
 *
 * - Microfone CRU: sem cancelamento de eco, supressão de ruído nem ganho
 *   automático do Chrome (estragam voz de locutor). Entrada escolhida no painel,
 *   com medidor de nível.
 * - Gravar (R ou botão): o projeto toca a partir do cursor (o locutor ouve a
 *   trilha no fone; a faixa armada fica muda) e a voz é capturada em PCM.
 * - O take entra na faixa armada, no tempo certo: desconta o atraso de
 *   entrada+saída do navegador (+ ajuste fino em ms). Se cair em cima de voz
 *   que já existe, NÃO apaga: vai pra uma faixa nova "Take N".
 * - Cópia de segurança: cada take vira WAV 24 bits na pasta "Takes" do PC.
 *
 * Funções puras no topo, testadas em tests/gravacao.test.mjs.
 */
(function (global) {
    'use strict';

    function wav24(canais, sr) {
        const nCh = canais.length, n = canais[0].length;
        const bytes = 44 + n * nCh * 3;
        const v = new DataView(new ArrayBuffer(bytes));
        const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        txt(0, 'RIFF'); v.setUint32(4, bytes - 8, true); txt(8, 'WAVE'); txt(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 3, true);
        v.setUint16(32, nCh * 3, true); v.setUint16(34, 24, true);
        txt(36, 'data'); v.setUint32(40, n * nCh * 3, true);
        let o = 44;
        for (let i = 0; i < n; i++) {
            for (let c = 0; c < nCh; c++) {
                const s = Math.max(-1, Math.min(1, canais[c][i]));
                let x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
                if (x < 0) x += 0x1000000;
                v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff);
                o += 3;
            }
        }
        return v.buffer;
    }

    /** 1ª amostra chegou no instante `tPrim` (relógio do áudio); o 0:00 do projeto
     *  tocou em `base`; `lat` = atraso total (s). → onde o take entra no projeto. */
    function posicionarTake(tPrim, base, lat, sr) {
        const p0 = tPrim - base - lat;
        return p0 >= 0 ? { inicio: p0, descartar: 0 } : { inicio: 0, descartar: Math.round(-p0 * sr) };
    }

    function sobrepoe(clips, ini, fim) {
        return (clips || []).some(c => c.inicio < fim && c.inicio + c.duracao > ini);
    }

    function nomeDoTake(d, faixa, n) {
        const limpa = String(faixa || 'Voz').replace(/[\\/:*?"<>|]+/g, ' - ').replace(/\s+/g, ' ')
            .replace(/( - )+/g, ' - ').replace(/[\s-]+$/, '').trim();
        const z = (x) => String(x).padStart(2, '0');
        return `Take ${n} - ${limpa} - ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}h${z(d.getMinutes())}m${z(d.getSeconds())}s.wav`;
    }

    function picoDb(bloco) {
        let p = 0;
        for (let i = 0; i < bloco.length; i++) { const a = Math.abs(bloco[i]); if (a > p) p = a; }
        return p > 0 ? 20 * Math.log10(p) : -Infinity;
    }

    // 24/10/2026: placa USB manda as DUAS entradas; com o microfone na entrada 2 o
    // take saía mudo (só a 1 era gravada). Agora grava as duas e escolhe no fim.
    // `energias` = RMS de cada entrada no take; `modo` = 'auto' | '0' | '1'.
    function escolherCanal(energias, modo) {
        const n = energias.length;
        if (modo === '0' || modo === '1') return { modo: 'canal', canal: Math.min(n - 1, Number(modo)) };
        if (n < 2) return { modo: 'canal', canal: 0 };
        const [a, b] = energias;
        if (a > b * 4) return { modo: 'canal', canal: 0 };    // 12 dB+ de diferença: só uma tem voz
        if (b > a * 4) return { modo: 'canal', canal: 1 };
        return { modo: 'mistura' };
    }

    function juntarCanais(canais, escolha) {
        if (escolha.modo === 'canal') return Float32Array.from(canais[escolha.canal]);
        const n = canais[0].length, out = new Float32Array(n);
        for (let i = 0; i < n; i++) { let s = 0; for (const c of canais) s += c[i]; out[i] = s / canais.length; }
        return out;
    }

    const Gravacao = { wav24, posicionarTake, sobrepoe, nomeDoTake, picoDb, escolherCanal, juntarCanais };
    global.Gravacao = Gravacao;
    if (typeof module !== 'undefined' && module.exports) { module.exports = Gravacao; return; }
    if (typeof document === 'undefined') return;

    // ── Navegador ────────────────────────────────────────────────────────
    const st = {
        armada: null, stream: null, fonte: null, no: null, deviceId: localStorage.getItem('gravacao_entrada') || '',
        gravando: false, blocos: [], tPrim: null, base: 0, inicioRelogio: 0, picos: [0, 0], picoMax: -Infinity,
        canalModo: localStorage.getItem('gravacao_canal') || 'auto',
        pasta: null, semBackup: false, nTake: 0, mudaAntes: false, raf: 0,
        ajusteMs: parseFloat(localStorage.getItem('gravacao_ajuste_ms') || '0') || 0,
    };
    let ui = null;
    const daw = () => global.minidaw;
    const avisar = (m, t) => { const d = daw(); if (d) d.showNotification(m, t || 'info'); };
    const el = (tag, props, filhos) => { const e = Object.assign(document.createElement(tag), props || {}); for (const f of (filhos || [])) e.append(f); return e; };

    const WORKLET = `
        class CapturaLocutor extends AudioWorkletProcessor {
            constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data; }; }
            process(inputs) {
                const chs = inputs[0];
                if (chs && chs.length) {
                    const picos = chs.map((ch) => { let p = 0; for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; } return p; });
                    this.port.postMessage({ t: currentTime, picos, dados: this.on ? chs.map((ch) => ch.slice(0)) : null });
                }
                return true;
            }
        }
        registerProcessor('captura-locutor', CapturaLocutor);`;

    async function ligarMicrofone() {
        const d = daw();
        const ctx = d.audioContext;
        if (ctx.state === 'suspended') await ctx.resume();
        desligarMicrofone();
        st.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: st.deviceId ? { exact: st.deviceId } : undefined,
                echoCancellation: false, noiseSuppression: false, autoGainControl: false,
                channelCount: { ideal: 2 }, sampleRate: ctx.sampleRate,   // as duas entradas da placa
            },
        });
        if (!ctx._capturaLocutor) {
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            ctx._capturaLocutor = true;
        }
        st.fonte = ctx.createMediaStreamSource(st.stream);
        // 'max' = recebe as entradas como a placa manda (1 ou 2), sem misturar.
        st.no = new AudioWorkletNode(ctx, 'captura-locutor', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max', channelInterpretation: 'discrete' });
        const mudo = ctx.createGain(); mudo.gain.value = 0;   // mantém o nó rodando sem sair no fone
        st.fonte.connect(st.no); st.no.connect(mudo); mudo.connect(ctx.destination);
        st.no.port.onmessage = (e) => {
            const m = e.data;
            m.picos.forEach((p, i) => { st.picos[i] = Math.max(st.picos[i] || 0, p); });
            if (m.dados) {
                if (st.tPrim == null) st.tPrim = m.t;
                st.blocos.push(m.dados);   // [canal][amostras]
                st.picoMax = Math.max(st.picoMax, ...m.picos);
            }
        };
        await listarEntradas();
        if (!st.raf) desenharMedidor();
    }

    function desligarMicrofone() {
        try { st.fonte && st.fonte.disconnect(); st.no && st.no.disconnect(); } catch (e) { /* ok */ }
        if (st.stream) st.stream.getTracks().forEach(t => t.stop());
        st.stream = st.fonte = st.no = null;
    }

    async function listarEntradas() {
        if (!ui) return;
        const lista = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
        const atual = st.stream && st.stream.getAudioTracks()[0] && st.stream.getAudioTracks()[0].getSettings().deviceId;
        ui.entrada.replaceChildren(...lista.map((d, i) => el('option', { value: d.deviceId, textContent: d.label || `Entrada ${i + 1}`, selected: d.deviceId === atual })));
    }

    function desenharMedidor() {
        st.raf = requestAnimationFrame(desenharMedidor);
        if (!ui) return;
        const nCh = st.no ? Math.max(1, Math.min(2, st.picos.length)) : 1;
        for (let c = 0; c < 2; c++) {
            const p = st.picos[c] || 0;
            const db = p > 0 ? 20 * Math.log10(p) : -Infinity;
            const pct = Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
            ui.barras[c].style.width = pct + '%';
            ui.barras[c].style.background = db > -1 ? '#ef4444' : db > -9 ? '#f59e0b' : '#22c55e';
            ui.dbs[c].textContent = Number.isFinite(db) ? db.toFixed(0) + ' dB' : '—';
            ui.linhasMed[c].style.display = c < nCh ? 'flex' : 'none';
        }
        st.picos = st.picos.map(() => 0);
        if (st.gravando) {
            const d = daw();
            const seg = d.audioContext.currentTime - st.inicioRelogio;
            ui.estado.textContent = `● GRAVANDO  ${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, '0')}`;
        }
    }

    function montar() {
        const css = el('style', { textContent: `
            #gravacaoPainel{position:fixed;left:16px;bottom:16px;width:360px;max-width:calc(100vw - 32px);z-index:2001;background:#1a1220;
              color:#f3e8ff;border:1px solid #ef4444;border-radius:14px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);font-size:13px;
              display:flex;flex-direction:column;gap:8px}
            #gravacaoPainel .gv-topo{display:flex;justify-content:space-between;align-items:center}
            #gravacaoPainel button{background:#2a2033;color:#f3e8ff;border:1px solid #4b3a5a;border-radius:8px;padding:5px 10px;cursor:pointer}
            #gravacaoPainel button.gv-rec{background:#dc2626;border-color:#dc2626;color:#fff;font-weight:700;font-size:15px;padding:8px}
            #gravacaoPainel button.gv-rec.on{background:#7f1d1d;animation:gvPisca 1s infinite}
            @keyframes gvPisca{50%{opacity:.6}}
            #gravacaoPainel select,#gravacaoPainel input{background:#120c17;color:#f3e8ff;border:1px solid #4b3a5a;border-radius:6px;padding:3px 6px}
            #gravacaoPainel .gv-med{height:10px;background:#120c17;border-radius:5px;overflow:hidden;flex:1}
            #gravacaoPainel .gv-med div{height:100%;width:0;transition:width .05s}
            #gravacaoPainel .gv-linha{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
            #gravacaoPainel .gv-sub{color:#c4b5d0;font-size:12px}
            .btn-rec-faixa.active{background:#dc2626!important;border-color:#dc2626!important;color:#fff!important}` });
        const entrada = el('select', { title: 'Entrada de áudio (placa/microfone)', onchange: async (e) => {
            st.deviceId = e.target.value; localStorage.setItem('gravacao_entrada', st.deviceId);
            try { await ligarMicrofone(); } catch (err) { avisar('Não consegui abrir essa entrada: ' + err.message, 'error'); }
        } });
        const barras = [el('div'), el('div')];
        const dbs = [el('span', { className: 'gv-sub', textContent: '—' }), el('span', { className: 'gv-sub', textContent: '—' })];
        const linhasMed = [0, 1].map((c) => el('div', { className: 'gv-linha' }, [
            el('span', { className: 'gv-sub', textContent: `Entrada ${c + 1}` }), el('div', { className: 'gv-med' }, [barras[c]]), dbs[c]]));
        const canal = el('select', { title: 'Qual entrada da placa gravar', onchange: (e) => { st.canalModo = e.target.value; localStorage.setItem('gravacao_canal', st.canalModo); } },
            [['auto', 'Automático (a que tiver voz)'], ['0', 'Só a entrada 1'], ['1', 'Só a entrada 2']]
                .map(([v, t]) => el('option', { value: v, textContent: t, selected: st.canalModo === v })));
        const pastaBtn = el('button', { textContent: '📁 Pasta dos takes', onclick: escolherPasta });
        const pastaNome = el('span', { className: 'gv-sub', textContent: 'não escolhida (pergunto no 1º take)' });
        const ajuste = el('input', { type: 'number', step: 1, value: st.ajusteMs, style: 'width:70px',
            title: 'Se a voz cair adiantada/atrasada em relação à trilha: + empurra a voz pra trás, − pra frente',
            onchange: (e) => { st.ajusteMs = parseFloat(e.target.value) || 0; localStorage.setItem('gravacao_ajuste_ms', String(st.ajusteMs)); } });
        const rec = el('button', { className: 'gv-rec', textContent: '● Gravar (R)', onclick: alternarGravacao });
        const estado = el('div', { className: 'gv-sub', textContent: '' });
        const faixa = el('b', { textContent: '' });
        const painel = el('div', { id: 'gravacaoPainel' }, [
            el('div', { className: 'gv-topo' }, [el('span', {}, [el('b', { textContent: '🎙️ Gravação — ' }), faixa]),
                el('button', { textContent: '✕', title: 'Desarmar e fechar', onclick: () => desarmar() })]),
            el('div', { className: 'gv-linha' }, [el('span', { textContent: 'Entrada:' }), entrada]),
            linhasMed[0], linhasMed[1],
            el('div', { className: 'gv-linha' }, [el('span', { textContent: 'Gravar:' }), canal]),
            el('div', { className: 'gv-linha' }, [pastaBtn, pastaNome]),
            el('div', { className: 'gv-linha' }, [el('span', { textContent: 'Ajuste de atraso:' }), ajuste, el('span', { className: 'gv-sub', textContent: 'ms' })]),
            rec, estado,
            el('div', { className: 'gv-sub', textContent: 'O projeto toca a partir do cursor enquanto grava (a faixa armada fica muda). R ou Espaço para. O take nunca apaga voz existente.' }),
        ]);
        document.head.append(css);
        document.body.append(painel);
        ui = { painel, entrada, barras, dbs, linhasMed, pastaNome, rec, estado, faixa };
    }

    async function armar(trackId) {
        const d = daw();
        if (!d) return;
        if (st.armada === trackId) { desarmar(); return; }
        if (st.gravando) { avisar('Pare a gravação antes de trocar de faixa.', 'warning'); return; }
        const anterior = st.armada;
        st.armada = trackId;
        if (!ui) montar();
        ui.painel.style.display = 'flex';
        const t = d.tracks.find(x => x.id === trackId);
        ui.faixa.textContent = t ? t.name : '';
        [anterior, trackId].forEach(id => { const x = d.tracks.find(y => y.id === id); if (x) d.updateTrackUI(x); });
        if (!st.stream) {
            try { await ligarMicrofone(); }
            catch (e) {
                avisar('Microfone bloqueado ou indisponível: ' + (e.message || e) + ' — libere o microfone no cadeado da barra de endereço.', 'error');
                desarmar();
            }
        }
    }

    function desarmar() {
        if (st.gravando) parar();
        const d = daw();
        const id = st.armada;
        st.armada = null;
        desligarMicrofone();
        if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
        if (ui) ui.painel.style.display = 'none';
        const t = d && d.tracks.find(x => x.id === id);
        if (t) d.updateTrackUI(t);
    }

    async function escolherPasta() {
        if (typeof global.showDirectoryPicker !== 'function') { avisar('Este navegador não salva em pasta — use o Chrome.', 'warning'); return false; }
        try {
            st.pasta = await global.showDirectoryPicker({ id: 'takes-locutor', mode: 'readwrite', startIn: 'music' });
            st.semBackup = false;
            if (ui) ui.pastaNome.textContent = st.pasta.name;
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') { st.semBackup = true; if (ui) ui.pastaNome.textContent = 'sem cópia nesta sessão'; }
            return false;
        }
    }

    async function alternarGravacao() { st.gravando ? parar() : gravar(); }

    async function gravar() {
        const d = daw();
        if (!d || !st.armada) { avisar('Arme uma faixa de voz (botão ●) primeiro.', 'warning'); return; }
        if (!st.no) { try { await ligarMicrofone(); } catch (e) { avisar('Microfone indisponível: ' + e.message, 'error'); return; } }
        if (!st.pasta && !st.semBackup) await escolherPasta();   // pergunta UMA vez (no clique: gesto do usuário)
        const t = d.tracks.find(x => x.id === st.armada);
        if (!t) { desarmar(); return; }
        if (d.isPlaying) d.stop();
        st.mudaAntes = !!t.muted;
        t.muted = true;                       // o locutor não se ouve "dobrado" no fone
        st.blocos = []; st.tPrim = null; st.picoMax = -Infinity;
        const temOutras = d.tracks.some(x => x.audioBuffer && x.id !== t.id);
        if (temOutras) {
            d.play();
            st.base = d.playbackBase;
        } else {
            st.base = d.audioContext.currentTime - (d.currentTime || 0);
        }
        st.inicioRelogio = d.audioContext.currentTime;
        st.no.port.postMessage(true);
        st.gravando = true;
        ui.rec.textContent = '■ Parar (R)'; ui.rec.classList.add('on');
    }

    async function parar() {
        const d = daw();
        st.gravando = false;
        if (st.no) st.no.port.postMessage(false);
        ui.rec.textContent = '● Gravar (R)'; ui.rec.classList.remove('on');
        ui.estado.textContent = '';
        const t = d.tracks.find(x => x.id === st.armada);
        if (t) t.muted = st.mudaAntes;
        if (d.isPlaying) d.stop();
        const n = st.blocos.reduce((s, b) => s + b[0].length, 0);
        const ctx = d.audioContext, sr = ctx.sampleRate;
        if (n < sr * 0.3 || st.tPrim == null) { avisar('Take muito curto — descartado.', 'warning'); return; }
        const nCh = Math.max(...st.blocos.map(b => b.length));
        const canais = Array.from({ length: nCh }, () => new Float32Array(n));
        let o = 0;
        for (const b of st.blocos) { for (let c = 0; c < nCh; c++) canais[c].set(b[c] || b[0], o); o += b[0].length; }
        st.blocos = [];
        const energias = canais.map(c => { let e = 0; for (let i = 0; i < c.length; i += 4) e += c[i] * c[i]; return Math.sqrt(e / (c.length / 4)); });
        const escolha = escolherCanal(energias, st.canalModo);
        const tudo = juntarCanais(canais, escolha);
        const qualEntrada = nCh < 2 ? '' : escolha.modo === 'mistura' ? ' (entradas 1+2)' : ` (entrada ${escolha.canal + 1})`;
        const trilhaIn = st.stream && st.stream.getAudioTracks()[0];
        const latIn = (trilhaIn && trilhaIn.getSettings().latency) || 0;
        const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + latIn + st.ajusteMs / 1000;
        const pos = posicionarTake(st.tPrim, st.base, lat, sr);
        const amostras = tudo.subarray(pos.descartar);
        const buf = ctx.createBuffer(1, amostras.length, sr);
        buf.copyToChannel(amostras, 0);
        st.nTake += 1;

        // Faixa de destino: a armada; se o take cair em cima de voz existente, faixa nova "Take N".
        let destino = t;
        const fim = pos.inicio + buf.duration;
        if (t && t.audioBuffer && sobrepoe(d._clipsDaFaixa(t), pos.inicio, fim)) {
            d.addTrack('voice');
            destino = d.tracks[d.tracks.length - 1];
            destino.name = `Take ${st.nTake}`;
            d._copiarEfeitos(t, destino);
        }
        const clips = destino.audioBuffer ? d._clipsDaFaixa(destino) : [];
        const clip = ClipModel.clipInteiro(buf);
        clip.inicio = pos.inicio;
        destino.clips = ClipModel.ordenarClips(clips.concat([clip]));
        d._sincronizarDerivados(destino);
        if (!d.trackNodes.get(destino.id)) d.createTrackNodes(destino);
        d.updateTrackUI(destino);
        d.calculateDuration();
        d.aposMudancaDeClips([destino]);

        const picoTake = picoDb(amostras);
        const picoTxt = Number.isFinite(picoTake) ? ` · pico ${picoTake.toFixed(1)} dB${qualEntrada}` : '';
        const estourou = picoTake >= -0.01;
        const baixo = picoTake < -30;
        let copia = '';
        if (st.pasta) {
            try {
                const nome = nomeDoTake(new Date(), t ? t.name : destino.name, st.nTake);
                const arq = await st.pasta.getFileHandle(nome, { create: true });
                const w = await arq.createWritable();
                await w.write(new Blob([wav24([amostras], sr)], { type: 'audio/wav' }));
                await w.close();
                copia = ` Cópia: ${st.pasta.name}/${nome}`;
            } catch (e) { copia = ' ⚠ Não salvei a cópia no PC: ' + (e.message || e); }
        }
        avisar(`Take ${st.nTake}: ${buf.duration.toFixed(1).replace('.', ',')} s em "${destino.name}", a partir de ${pos.inicio.toFixed(2).replace('.', ',')} s${picoTxt}.` +
            (estourou ? ' ⚠ ESTOUROU (0 dB) — baixe o ganho da placa e grave de novo.' : '')
            + (baixo ? ' ⚠ MUITO BAIXO — confira a entrada da placa (medidor) e o ganho do microfone.' : '') + copia,
            estourou || baixo ? 'warning' : 'success');
    }

    // R = gravar/parar com faixa armada; Espaço durante a gravação = parar.
    // Captura da window: roda antes dos atalhos da MiniDAW.
    global.addEventListener('keydown', (e) => {
        const a = e.target;
        const digitando = a && ((a.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes(a.type)) || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
        if (digitando || e.ctrlKey || e.metaKey || e.altKey || !st.armada) return;
        if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); alternarGravacao(); }
        else if (e.code === 'Space' && st.gravando) { e.preventDefault(); e.stopImmediatePropagation(); parar(); }
    }, true);

    Object.assign(Gravacao, { armar, desarmar, gravar, parar, armada: () => st.armada, gravando: () => st.gravando });
})(typeof window !== 'undefined' ? window : globalThis);
