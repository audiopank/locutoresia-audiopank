/**
 * PRÉ-ESCUTA DE TRILHAS DO PC (23/10/2026, ideia dele) — MiniDAW clássica.
 *
 * W (ou o botão 🎧 Pré-escuta) abre um painel: o produtor abre a pasta de
 * trilhas do PC, clica e ouve — sozinha ou JUNTO com as vozes do spot — e só
 * então "Adicionar à Trilha". Tudo no navegador: nada sobe pro servidor, nada
 * entra no projeto até ele confirmar.
 *
 * - Lista leve: só nomes; o arquivo só é lido quando ele clica (pasta de 300
 *   trilhas abre na hora). Um link temporário por vez, liberado na troca.
 * - "Ouvir junto com a voz": toca o projeto do 0:00 com as TRILHAS que já
 *   existem silenciadas (devolvidas ao parar) + a candidata.
 * - Adicionar: primeira faixa de trilha VAZIA, senão cria uma. Nunca substitui.
 * - Painel aberto: Espaço = play/pausa da pré-escuta, ↑/↓ = trilha anterior/
 *   próxima, Esc = fecha. Fechado: tudo volta a ser da MiniDAW.
 *
 * As funções puras de cima são testadas em tests/pre-escuta.test.mjs.
 */
(function (global) {
    'use strict';

    const EXTENSOES = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i;
    const LIMITE_ARQUIVOS = 2000;
    const PROFUNDIDADE = 3;   // subpastas lidas: Trilhas/Institucional/Calmas/...

    function ehAudio(nome) {
        const n = String(nome || '');
        return !n.startsWith('.') && EXTENSOES.test(n);
    }

    function ordenarNomes(lista) {
        const col = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
        return lista.slice().sort((a, b) => col.compare(a.nome, b.nome));
    }

    /** id da primeira faixa de TRILHA vazia (não voz, não efeito), ou null. */
    function faixaDestino(tracks) {
        const t = (tracks || []).find(x => x.type === 'music' && !x.sfx && !x.audioBuffer);
        return t ? t.id : null;
    }

    function tempo(s) {
        if (!Number.isFinite(s)) return '—';
        s = Math.floor(s);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function picos(canal, n) {
        const out = new Float32Array(n);
        if (!canal || !canal.length) return out;
        const passo = canal.length / n;
        for (let i = 0; i < n; i++) {
            let m = 0;
            const fim = Math.min(canal.length, Math.floor((i + 1) * passo));
            for (let k = Math.floor(i * passo); k < fim; k++) { const v = Math.abs(canal[k]); if (v > m) m = v; }
            out[i] = m;
        }
        return out;
    }

    const PreEscuta = { ehAudio, ordenarNomes, faixaDestino, tempo, picos };
    global.PreEscuta = PreEscuta;
    if (typeof module !== 'undefined' && module.exports) { module.exports = PreEscuta; return; }
    if (typeof document === 'undefined') return;

    // ── Painel (só no navegador) ─────────────────────────────────────────
    const st = {
        aberto: false, itens: [], filtro: '', sel: -1,
        audio: new Audio(), url: null, picos: null, decodSeq: 0,
        junto: false, silenciadas: [], tocandoJunto: false,
    };
    st.audio.preload = 'metadata';
    st.audio.volume = 0.7;
    let ui = null;

    const daw = () => global.minidaw;
    const avisar = (msg, tipo) => { const d = daw(); if (d && d.showNotification) d.showNotification(msg, tipo || 'info'); };
    const el = (tag, props, filhos) => {
        const e = Object.assign(document.createElement(tag), props || {});
        for (const f of (filhos || [])) e.append(f);
        return e;
    };

    function montar() {
        const css = el('style', { textContent: `
            #preEscuta{position:fixed;top:70px;right:16px;width:440px;max-width:calc(100vw - 32px);max-height:calc(100vh - 90px);
              display:none;flex-direction:column;gap:10px;z-index:2000;background:#151b2e;color:#e8eaf6;border:1px solid #6366f1;
              border-radius:14px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);font-size:14px}
            #preEscuta.aberto{display:flex}
            #preEscuta .pe-topo{display:flex;align-items:center;justify-content:space-between}
            #preEscuta .pe-topo b{font-size:16px}
            #preEscuta button{background:#232b45;color:#e8eaf6;border:1px solid #3a4468;border-radius:8px;padding:5px 10px;cursor:pointer}
            #preEscuta button:hover{background:#2e3858}
            #preEscuta button.pe-principal{background:#6366f1;border-color:#6366f1;color:#fff;font-weight:600}
            #preEscuta button:disabled{opacity:.45;cursor:default}
            #preEscuta input[type=search]{width:100%;background:#0d1222;color:#e8eaf6;border:1px solid #3a4468;border-radius:8px;padding:5px 8px}
            #preEscuta .pe-lista{overflow-y:auto;min-height:120px;max-height:38vh;border:1px solid #2a3252;border-radius:8px}
            #preEscuta .pe-item{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #1e2640}
            #preEscuta .pe-item:hover{background:#1e2744}
            #preEscuta .pe-item.sel{background:#3b3f8f}
            #preEscuta .pe-item small{color:#9aa3c7;white-space:nowrap}
            #preEscuta .pe-sub{color:#9aa3c7;font-size:12px}
            #preEscuta canvas{width:100%;height:56px;background:#0d1222;border-radius:8px;cursor:pointer;display:block}
            #preEscuta .pe-linha{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
            #preEscuta .pe-vazio{padding:18px;text-align:center;color:#9aa3c7}
            #preEscuta label.pe-linha{flex-wrap:nowrap;align-items:flex-start;cursor:pointer}
            #preEscuta label.pe-linha input{margin-top:3px;flex:none}` });
        const fechar = el('button', { textContent: '✕', title: 'Fechar (Esc)', onclick: fecharPainel });
        const btnPasta = el('button', { className: 'pe-principal', textContent: '📁 Abrir pasta de trilhas', onclick: abrirPasta });
        const btnArq = el('button', { textContent: 'Escolher arquivos', onclick: () => ui.input.click() });
        const input = el('input', { type: 'file', multiple: true, accept: 'audio/*', hidden: true, onchange: (e) => carregarArquivos(e.target.files) });
        const busca = el('input', { type: 'search', placeholder: 'Procurar pelo nome…', oninput: (e) => { st.filtro = e.target.value; desenharLista(); } });
        const lista = el('div', { className: 'pe-lista' });
        const nome = el('div', { textContent: 'Nenhuma trilha selecionada' });
        const canvas = el('canvas', { width: 820, height: 112, title: 'Clique para pular para esse ponto' });
        canvas.onclick = (e) => {
            const r = canvas.getBoundingClientRect();
            if (st.audio.duration) pular(((e.clientX - r.left) / r.width) * st.audio.duration);
        };
        const tempoEl = el('span', { className: 'pe-sub', textContent: '0:00 / —' });
        const btnPlay = el('button', { textContent: '▶ Play', title: 'Espaço', onclick: alternar });
        const btnStop = el('button', { textContent: '⏹', title: 'Parar e voltar ao começo', onclick: parar });
        const vol = el('input', { type: 'range', min: 0, max: 100, value: 70, title: 'Volume da pré-escuta', oninput: (e) => { st.audio.volume = e.target.value / 100; } });
        const junto = el('input', { type: 'checkbox', id: 'peJunto', onchange: (e) => { const tocando = !st.audio.paused; parar(); st.junto = e.target.checked; if (tocando) tocar(); } });
        const btnAdd = el('button', { className: 'pe-principal', textContent: '➕ Adicionar à Trilha', disabled: true, onclick: adicionar });
        const painel = el('div', { id: 'preEscuta' }, [
            el('div', { className: 'pe-topo' }, [el('b', { textContent: '🎧 Pré-escuta de trilhas' }), fechar]),
            el('div', { className: 'pe-linha' }, [btnPasta, btnArq, input]),
            el('div', { className: 'pe-sub', textContent: 'Toca daqui do seu PC — nada sobe pro servidor e nada entra no projeto até você clicar em Adicionar. ↑/↓ troca de trilha, Espaço toca/pausa.' }),
            busca, lista, nome, canvas,
            el('div', { className: 'pe-linha' }, [btnPlay, btnStop, tempoEl, el('span', { className: 'pe-sub', textContent: '🔊' }), vol]),
            el('label', { className: 'pe-linha', htmlFor: 'peJunto' }, [junto, el('span', { textContent: 'Ouvir junto com a voz do spot (do 0:00; as trilhas do projeto ficam mudas)' })]),
            btnAdd,
        ]);
        document.head.append(css);
        document.body.append(painel);
        ui = { painel, input, busca, lista, nome, canvas, tempoEl, btnPlay, btnAdd, btnPasta };
        if (typeof global.showDirectoryPicker !== 'function') {
            btnPasta.disabled = true;
            btnPasta.title = 'Abrir pasta inteira só no Chrome/Edge — use "Escolher arquivos"';
        }
        st.audio.addEventListener('timeupdate', atualizarTempo);
        st.audio.addEventListener('loadedmetadata', () => {
            const it = st.itens[st.sel];
            if (it) { it.duracao = st.audio.duration; desenharLista(); }
            atualizarTempo();
        });
        st.audio.addEventListener('ended', parar);
        st.audio.addEventListener('play', () => { ui.btnPlay.textContent = '⏸ Pausa'; });
        st.audio.addEventListener('pause', () => { ui.btnPlay.textContent = '▶ Play'; });
        desenharLista();
    }

    function abrir() {
        if (!ui) montar();
        st.aberto = true;
        ui.painel.classList.add('aberto');
    }
    function fecharPainel() {
        parar();
        st.aberto = false;
        if (ui) ui.painel.classList.remove('aberto');
    }
    function alternarPainel() { st.aberto ? fecharPainel() : abrir(); }

    async function abrirPasta() {
        let pasta;
        try {
            pasta = await global.showDirectoryPicker({ id: 'trilhas-pc', mode: 'read', startIn: 'music' });
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            avisar('Não consegui abrir a pasta: ' + (e.message || e), 'error');
            return;
        }
        const itens = [];
        async function ler(dir, caminho, nivel) {
            for await (const [nome, h] of dir.entries()) {
                if (itens.length >= LIMITE_ARQUIVOS) return;
                if (h.kind === 'file' && ehAudio(nome)) itens.push({ nome, caminho, handle: h });
                else if (h.kind === 'directory' && nivel < PROFUNDIDADE && !nome.startsWith('.')) await ler(h, caminho ? caminho + '/' + nome : nome, nivel + 1);
            }
        }
        await ler(pasta, '', 0);
        definirItens(itens, pasta.name);
    }

    function carregarArquivos(files) {
        const itens = Array.from(files || []).filter(f => ehAudio(f.name)).map(f => ({ nome: f.name, caminho: '', arquivo: f }));
        ui.input.value = '';
        definirItens(itens, null);
    }

    function definirItens(itens, nomePasta) {
        parar();
        liberar();
        st.itens = ordenarNomes(itens);
        st.sel = -1;
        ui.nome.textContent = 'Nenhuma trilha selecionada';
        ui.btnAdd.disabled = true;
        desenharOnda();
        desenharLista();
        if (!itens.length) avisar('Nenhum arquivo de áudio encontrado aí.', 'warning');
        else avisar(`${itens.length} trilha(s)${nomePasta ? ` em "${nomePasta}"` : ''} — clique pra ouvir.`, 'success');
    }

    function visiveis() {
        const f = st.filtro.trim().toLocaleLowerCase('pt-BR');
        return st.itens.map((it, i) => ({ it, i }))
            .filter(({ it }) => !f || (it.caminho + '/' + it.nome).toLocaleLowerCase('pt-BR').includes(f));
    }

    function desenharLista() {
        if (!ui) return;
        ui.lista.replaceChildren();
        const vis = visiveis();
        if (!vis.length) {
            ui.lista.append(el('div', { className: 'pe-vazio', textContent: st.itens.length ? 'Nada com esse nome.' : 'Abra a pasta de trilhas do seu PC.' }));
            return;
        }
        for (const { it, i } of vis) {
            const linha = el('div', { className: 'pe-item' + (i === st.sel ? ' sel' : ''), title: it.caminho ? it.caminho + '/' + it.nome : it.nome }, [
                el('span', {}, [el('div', { textContent: it.nome }), it.caminho ? el('div', { className: 'pe-sub', textContent: it.caminho }) : '']),
                el('small', { textContent: it.duracao ? tempo(it.duracao) : '' }),
            ]);
            linha.onclick = () => selecionar(i, true);
            ui.lista.append(linha);
            if (i === st.sel) setTimeout(() => linha.scrollIntoView({ block: 'nearest' }), 0);
        }
    }

    async function arquivoDo(it) { return it.arquivo || (it.arquivo = await it.handle.getFile()); }

    function liberar() {
        st.audio.pause();
        st.audio.removeAttribute('src');
        if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
        st.picos = null;
    }

    async function selecionar(i, tocarJa) {
        if (i < 0 || i >= st.itens.length) return;
        const continuarTocando = tocarJa || !st.audio.paused;
        parar();
        liberar();
        st.sel = i;
        const it = st.itens[i];
        ui.nome.textContent = it.nome;
        ui.btnAdd.disabled = false;
        desenharLista();
        desenharOnda();
        let arquivo;
        try { arquivo = await arquivoDo(it); } catch (e) { avisar('Não consegui ler esse arquivo: ' + (e.message || e), 'error'); return; }
        if (st.sel !== i) return;   // ele já clicou em outra
        st.url = URL.createObjectURL(arquivo);
        st.audio.src = st.url;
        if (continuarTocando) tocar();
        // Onda: decodifica só a selecionada, sem travar o play.
        const seq = ++st.decodSeq;
        try {
            const ctx = (daw() && daw().audioContext) || new (global.AudioContext || global.webkitAudioContext)();
            const buf = await ctx.decodeAudioData(await arquivo.arrayBuffer());
            if (seq !== st.decodSeq) return;
            st.picos = picos(buf.getChannelData(0), ui.canvas.width / 2);
            it.duracao = buf.duration;
            desenharLista();
            desenharOnda();
        } catch (e) {
            if (seq === st.decodSeq) avisar('Esse arquivo não abriu no navegador (formato incompatível?).', 'warning');
        }
    }

    function desenharOnda() {
        if (!ui) return;
        const c = ui.canvas, g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        if (!st.picos) return;
        const meio = c.height / 2, prog = st.audio.duration ? st.audio.currentTime / st.audio.duration : 0;
        for (let i = 0; i < st.picos.length; i++) {
            const h = Math.max(1, st.picos[i] * meio * 0.95);
            g.fillStyle = i / st.picos.length < prog ? '#a5b4fc' : '#4f5a8f';
            g.fillRect(i * 2, meio - h, 1.5, h * 2);
        }
    }

    function atualizarTempo() {
        if (!ui) return;
        ui.tempoEl.textContent = `${tempo(st.audio.currentTime || 0)} / ${tempo(st.audio.duration)}`;
        desenharOnda();
    }

    // ── Tocar sozinha ou junto com a voz ─────────────────────────────────
    function silenciarTrilhasDoProjeto() {
        const d = daw();
        st.silenciadas = d ? d.tracks.filter(t => t.type === 'music' && !t.sfx && t.audioBuffer && !t.muted) : [];
        for (const t of st.silenciadas) t.muted = true;
    }
    function devolverTrilhasDoProjeto() {
        for (const t of st.silenciadas) t.muted = false;
        st.silenciadas = [];
    }

    function tocar() {
        if (st.sel < 0 || !st.audio.src) return;
        const d = daw();
        if (st.junto && d && d.tracks.some(t => t.audioBuffer && t.type === 'voice')) {
            if (d.isPlaying) d.stop();
            silenciarTrilhasDoProjeto();
            d.currentTime = st.audio.currentTime || 0;
            d.play();
            st.tocandoJunto = true;
        } else if (d && d.isPlaying) {
            d.stop();   // a pré-escuta não toca por cima do projeto
        }
        st.audio.play().catch(() => {});
    }

    function pausar() {
        st.audio.pause();
        if (st.tocandoJunto) {
            const d = daw();
            if (d && d.isPlaying) d.stop();
            devolverTrilhasDoProjeto();
            st.tocandoJunto = false;
        }
    }

    function parar() {
        pausar();
        try { st.audio.currentTime = 0; } catch (e) { /* sem src */ }
        if (st.junto) { const d = daw(); if (d && d.stopPlayback) d.stopPlayback(); }
        atualizarTempo();
    }

    function alternar() { st.audio.paused ? tocar() : pausar(); }

    function pular(t) {
        const tocando = !st.audio.paused;
        pausar();
        st.audio.currentTime = t;
        if (tocando) tocar(); else atualizarTempo();
    }

    // ── Adicionar ao projeto ─────────────────────────────────────────────
    async function adicionar() {
        const d = daw();
        const it = st.itens[st.sel];
        if (!d || !it) return;
        parar();
        let arquivo;
        try { arquivo = await arquivoDo(it); } catch (e) { avisar('Não consegui ler esse arquivo.', 'error'); return; }
        let destino = faixaDestino(d.tracks);
        if (!destino) {
            d.addTrack('music');
            destino = d.tracks[d.tracks.length - 1].id;
        }
        await d.loadAudioFile(arquivo, destino);
        const faixa = d.tracks.find(t => t.id === destino);
        avisar(`"${it.nome}" entrou em "${faixa ? faixa.name : 'Trilha'}". As vozes não mudaram.`, 'success');
        fecharPainel();
        const card = document.getElementById(`track_${destino}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── Teclado ──────────────────────────────────────────────────────────
    // Na fase de CAPTURA da window: roda antes dos atalhos da MiniDAW, que
    // escutam no document — com o painel aberto, Espaço/↑/↓ são da pré-escuta.
    global.addEventListener('keydown', (e) => {
        const alvo = e.target;
        const digitando = alvo && (alvo.tagName === 'INPUT' && !['checkbox', 'range', 'button', 'file'].includes(alvo.type)
            || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable);
        if (digitando || e.ctrlKey || e.metaKey || e.altKey) return;
        let tratou = true;
        if (e.code === 'KeyW') alternarPainel();
        else if (!st.aberto) tratou = false;
        else if (e.code === 'Space') { if (!e.repeat) alternar(); }
        else if (e.code === 'Escape') fecharPainel();
        else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
            const vis = visiveis();
            if (vis.length) {
                const pos = vis.findIndex(v => v.i === st.sel);
                const prox = e.code === 'ArrowDown' ? Math.min(vis.length - 1, pos + 1) : Math.max(0, pos < 0 ? 0 : pos - 1);
                selecionar(vis[prox].i, false);
            }
        } else tratou = false;
        if (tratou) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    // Página fechando com a pré-escuta "junto": não deixa trilha do projeto muda.
    global.addEventListener('pagehide', devolverTrilhasDoProjeto);

    Object.assign(PreEscuta, { abrir, fechar: fecharPainel, alternar: alternarPainel });
})(typeof window !== 'undefined' ? window : globalThis);
