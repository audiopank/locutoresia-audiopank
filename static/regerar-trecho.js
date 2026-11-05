/**
 * 🔁 REGERAR TRECHO (05/11/2026, "Modo Especial" dele) — MiniDAW clássica.
 *
 * A IA errou a pronúncia no meio da locução ("Silvestre Arruda")? Marque SÓ
 * aquele trecho com a Tesoura na faixa de VOZ, digite a frase do jeito que
 * deve soar e gere uma fala nova só ali — sem regerar os 30 s inteiros.
 *
 * - A fala nova entra no lugar da marcada, com as MESMAS pausas em volta (o
 *   ritmo fica), volume igualado ao da voz e fade curtinho nas emendas.
 * - Tamanho diferente? O resto da MESMA faixa de voz anda a diferença; trilha
 *   e efeitos não se mexem. Objeto com cadeado não anda: aí nada é aplicado.
 * - Nada passa pelo Supabase: o áudio volta direto na resposta
 *   (`entrega: 'inline'`) e fica no projeto — o Salvar no PC grava junto.
 * - Ctrl+Z desfaz tudo de uma vez.
 *
 * Matemática pura em cima — testada em tests/regerar-trecho.test.mjs.
 */
(function (global) {
    'use strict';

    const CM = () => global.ClipModel;
    const AF = () => global.AlinharFalas;
    const CROSSFADE_S = 0.015;
    const MIN_S = 0.05;

    /** Amostras mono da faixa em [ini, fim) (tempo do projeto), com o volume de cada objeto. */
    function amostrasDaFaixa(clips, ini, fim, sr) {
        const out = new Float32Array(Math.max(0, Math.round((fim - ini) * sr)));
        for (const c of (clips || [])) {
            const buf = c.buffer;
            if (!buf || typeof buf.getChannelData !== 'function') continue;
            const a = Math.max(ini, c.inicio), b = Math.min(fim, c.inicio + c.duracao);
            if (b <= a) continue;
            const d = buf.getChannelData(0), srb = buf.sampleRate;
            const g = Math.pow(10, (Number(c.ganhoDb) || 0) / 20);
            const i1 = Math.min(out.length, Math.round((b - ini) * sr));
            for (let i = Math.round((a - ini) * sr); i < i1; i++) {
                const k = Math.floor((c.offset + (ini + i / sr - c.inicio)) * srb);
                if (k >= 0 && k < d.length) out[i] += d[k] * g;
            }
        }
        return out;
    }

    /** Silêncio que o produtor deixou antes/depois da fala marcada (s) — mantém o ritmo. */
    function pausasDoTrecho(clips, ini, fim, sr) {
        const a = amostrasDaFaixa(clips, ini, fim, sr);
        const b = a.length ? AF().bordasDaFala(a, sr, 0, a.length) : null;
        if (!b) return { antes: 0, depois: 0 };
        return { antes: b.ini / sr, depois: Math.max(0, (fim - ini) - b.fim / sr) };
    }

    /** Onde está a fala dentro do áudio novo (s), com as folgas do 🧲 Alinhar. null = só silêncio. */
    function falaDoBuffer(buffer) {
        const d = buffer.getChannelData(0), sr = buffer.sampleRate;
        const b = AF().bordasDaFala(d, sr, 0, d.length);
        return b ? { ini: b.ini / sr, fim: b.fim / sr } : null;
    }

    /**
     * Troca [ini, fim) da faixa pela fala nova. novo = { buffer, falaIni, falaFim }.
     * → { clips, delta, clipNovo, ganhoDb } ou { erro }. Não muta a lista recebida.
     */
    function costurar(clips, ini, fim, novo, opts) {
        const o = opts || {};
        const cf = typeof o.crossfade === 'number' ? o.crossfade : CROSSFADE_S;
        const pausas = o.pausas || { antes: 0, depois: 0 };
        if (!(fim - ini >= MIN_S)) return { erro: 'trecho-curto' };
        const durFala = novo.falaFim - novo.falaIni;
        if (!(durFala >= MIN_S)) return { erro: 'fala-vazia' };
        const lista = clips || [];
        const travado = (c) => CM().estaTravado(c);
        if (lista.some(c => travado(c) && c.inicio < fim && c.inicio + c.duracao > ini)) return { erro: 'travado' };
        const delta = pausas.antes + durFala + pausas.depois - (fim - ini);
        if (Math.abs(delta) > 1e-6 && lista.some(c => travado(c) && c.inicio >= fim - 1e-6)) return { erro: 'travado-depois' };

        const base = CM().silenciarTrecho(lista, ini, fim, cf);
        const andados = base.map(c => (c.inicio >= fim - 1e-6) ? Object.assign({}, c, { inicio: c.inicio + delta }) : c);
        const borda = Math.min(cf, durFala / 4);
        const clipNovo = {
            id: CM().novoId(), buffer: novo.buffer,
            inicio: ini + pausas.antes, offset: novo.falaIni, duracao: durFala,
            fadeIn: borda, fadeOut: borda
        };
        const resultado = CM().ordenarClips(andados.concat([clipNovo]));
        const ganhoDb = CM().igualarDb(resultado, clipNovo.inicio, clipNovo.inicio + durFala) || 0;
        if (ganhoDb) clipNovo.ganhoDb = ganhoDb;
        return { clips: resultado, delta, clipNovo, ganhoDb };
    }

    /** Frases do roteiro (botõezinhos do painel). Corta em . ! ? … e quebra de linha. */
    function frasesDoRoteiro(texto) {
        return (String(texto || '').match(/[^.!?…\n]+[.!?…]*/g) || [])
            .map(f => f.trim()).filter(f => f.length >= 2);
    }

    /** Voz pelo nome do clip: "Callirrhoe_-_Gemini_179…" → a voz Callirrhoe. */
    function vozDoNome(nome, vozes) {
        const chave = String(nome || '').trim().split(/[\s_\-]+/)[0].toLowerCase();
        if (chave.length < 3) return null;
        return (vozes || []).find(v => String(v.id || '').toLowerCase() === chave
            || String(v.name || '').toLowerCase().split(/[\s_\-]+/)[0] === chave) || null;
    }

    const RegerarTrecho = {
        amostrasDaFaixa, pausasDoTrecho, falaDoBuffer, costurar, frasesDoRoteiro, vozDoNome, CROSSFADE_S
    };

    // ── Tela (só no navegador) ───────────────────────────────────────────
    if (typeof document !== 'undefined') {
        const daw = () => global.minidaw;
        const avisar = (m, t) => { const d = daw(); if (d) d.showNotification(m, t || 'info'); };
        const el = (tag, props, filhos) => { const e = Object.assign(document.createElement(tag), props || {}); for (const f of (filhos || [])) e.append(f); return e; };
        const seg = (s) => s.toFixed(2).replace('.', ',');
        const ESTILOS = [['normal', 'Normal'], ['excited', 'Animado (varejo/promoção)'], ['cheerful', 'Alegre / festivo'],
            ['calm', 'Calmo'], ['professional', 'Profissional'], ['serious', 'Sério / formal'], ['fast', 'Rápido'], ['slow', 'Lento / pausado']];
        const ERROS = {
            'trecho-curto': 'Trecho curto demais — marque a frase inteira, de uma pausa à outra.',
            'fala-vazia': 'A fala nova veio muda — tente de novo.',
            'travado': 'Tem objeto com cadeado 🔒 no trecho — destrave antes de regerar.',
            'travado-depois': 'Tem objeto com cadeado 🔒 depois do trecho, e a fala nova muda o tempo — destrave pra voz poder andar.',
        };
        const st = { ui: null, trackId: null, ini: 0, fim: 0, vozes: null, novo: null, prev: null, fontes: [] };

        const faixa = () => { const d = daw(); return d && d.tracks.find(t => t.id === st.trackId); };
        const lerJson = (chave) => { try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (_) { return null; } };
        const lerTexto = (chave) => { try { return localStorage.getItem(chave) || ''; } catch (_) { return ''; } };

        async function carregarVozes() {
            if (st.vozes && st.vozes.length) return st.vozes;
            try { st.vozes = ((await (await fetch('/api/voices')).json()).voices || []); } catch (_) { st.vozes = []; }
            return st.vozes;
        }

        function montarPainel() {
            const css = el('style', { textContent: `
                #regerarTrecho{position:fixed;right:16px;bottom:96px;z-index:2000;background:#0e1424;color:#e6e8f0;border:1px solid #f59e0b;
                  border-radius:12px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);display:none;flex-direction:column;gap:8px;width:min(460px,calc(100vw - 32px))}
                #regerarTrecho .rt-topo{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px}
                #regerarTrecho .rt-linha{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
                #regerarTrecho textarea,#regerarTrecho select{background:#0b1020;color:#e6e8f0;border:1px solid #3a4468;border-radius:8px;padding:6px 8px;font-size:13px}
                #regerarTrecho textarea{width:100%;min-height:64px;resize:vertical}
                #regerarTrecho select{flex:1;min-width:140px}
                #regerarTrecho button{background:#232b45;color:#e6e8f0;border:1px solid #3a4468;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:13px}
                #regerarTrecho button:disabled{opacity:.45;cursor:default}
                #regerarTrecho button.rt-gerar{background:#f59e0b;border-color:#f59e0b;color:#111;font-weight:700}
                #regerarTrecho button.rt-aplicar{background:#22c55e;border-color:#22c55e;color:#06210f;font-weight:700}
                #regerarTrecho .rt-frases{display:flex;gap:4px;flex-wrap:wrap;max-height:84px;overflow:auto}
                #regerarTrecho .rt-frases button{font-size:11px;padding:2px 7px;border-radius:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                #regerarTrecho .rt-sub{color:#9aa3c7;font-size:12px}
                #regerarTrecho .rt-info{font-size:12px;color:#fcd34d;min-height:16px}` });
            const ui = {};
            ui.sub = el('div', { className: 'rt-sub' });
            ui.frase = el('textarea', { placeholder: 'Digite a frase do jeito que deve soar — ex.: "Sil-vés-tre Ar-rú-da". [Direção] entre colchetes vale.' });
            ui.frases = el('div', { className: 'rt-frases' });
            ui.voz = el('select', { title: 'Voz da fala nova (a mesma da locução, pra casar)' });
            ui.estilo = el('select', { title: 'Estilo de fala (o mesmo da locução, pra casar)' });
            for (const [v, n] of ESTILOS) ui.estilo.append(el('option', { value: v, textContent: n }));
            ui.gerar = el('button', { className: 'rt-gerar', textContent: '🔁 Gerar', onclick: gerar });
            ui.antes = el('button', { textContent: '▶ Ouvir antes', title: 'O trecho como está, com 2 s de cada lado', onclick: () => ouvir(false) });
            ui.depois = el('button', { textContent: '▶ Ouvir depois', title: 'Com a fala nova no lugar, com 2 s de cada lado', onclick: () => ouvir(true), disabled: true });
            ui.aplicar = el('button', { className: 'rt-aplicar', textContent: '✔ Aplicar', onclick: aplicar, disabled: true });
            ui.parar = el('button', { textContent: '■', title: 'Parar a escuta', onclick: pararPrevia });
            ui.info = el('div', { className: 'rt-info' });
            const fechar = el('button', { textContent: '✕', title: 'Fechar sem mudar nada', onclick: fecharPainel });
            ui.painel = el('div', { id: 'regerarTrecho' }, [
                el('div', { className: 'rt-topo' }, [el('b', { textContent: '🔁 Regerar trecho' }), fechar]),
                ui.sub, ui.frase, ui.frases,
                el('div', { className: 'rt-linha' }, [ui.voz, ui.estilo]),
                el('div', { className: 'rt-linha' }, [ui.gerar, ui.antes, ui.depois, ui.parar, ui.aplicar]),
                ui.info,
                el('div', { className: 'rt-sub', textContent: 'A fala nova entra com as mesmas pausas e o volume igualado; o resto da voz anda a diferença (trilha e efeitos ficam). Cada Gerar gasta 1 voz da cota. Nada sobe pro Supabase — o Salvar no PC guarda junto. Ctrl+Z desfaz.' }),
            ]);
            document.head.append(css);
            document.body.append(ui.painel);
            st.ui = ui;
        }

        async function abrir(trackId) {
            const d = daw();
            if (!d) return;
            const track = d.tracks.find(t => t.id === trackId);
            const s = (d.selecoes || {})[trackId];
            if (!track || track.type !== 'voice') { avisar('Regerar trecho é só pra faixa de VOZ', 'warning'); return; }
            if (((d.selecoesExtras || {})[trackId] || []).length) {
                avisar('Com vários trechos marcados não dá pra regerar — marque só a frase errada.', 'warning');
                return;
            }
            if (!s || !(s.fim - s.ini >= MIN_S)) { avisar('Arraste sobre a onda (Tesoura) pra marcar a frase errada primeiro', 'warning'); return; }
            if (!st.ui) montarPainel();
            pararPrevia();
            Object.assign(st, { trackId, ini: s.ini, fim: s.fim, novo: null, prev: null });
            const ui = st.ui;
            ui.sub.textContent = `Faixa "${track.name}" · trecho ${seg(s.ini)} → ${seg(s.fim)} s (${seg(s.fim - s.ini)} s)`;
            ui.info.textContent = '';
            ui.gerar.textContent = '🔁 Gerar';
            ui.depois.disabled = ui.aplicar.disabled = true;
            ui.frases.replaceChildren(...frasesDoRoteiro(lerTexto('minidaw_pending_roteiro')).map(f =>
                el('button', { textContent: f, title: 'Usar esta frase do roteiro', onclick: () => { ui.frase.value = f; ui.frase.focus(); } })));
            ui.painel.style.display = 'flex';
            ui.frase.focus();

            const vozes = await carregarVozes();
            const ultima = lerJson('minidaw_ultima_geracao') || {};
            const doNome = vozDoNome(track.name, vozes);
            let i = doNome ? vozes.indexOf(doNome) : vozes.findIndex(v => String(v.model || v.id) === String(ultima.voice));
            ui.voz.replaceChildren(el('option', { value: '', textContent: vozes.length ? '— escolha a voz —' : 'não consegui carregar as vozes' }),
                ...vozes.map((v, k) => el('option', { value: String(k), textContent: v.name || v.id })));
            ui.voz.value = i >= 0 ? String(i) : '';
            const mesmaVoz = i >= 0 && String(vozes[i].model || vozes[i].id) === String(ultima.voice);
            ui.estilo.value = (mesmaVoz && ESTILOS.some(e => e[0] === ultima.style)) ? ultima.style : 'normal';
        }

        function travar(sim, rotulo) {
            const ui = st.ui;
            ui.gerar.disabled = sim;
            if (rotulo) ui.info.textContent = rotulo;
        }

        async function gerar() {
            const d = daw(), ui = st.ui, track = faixa();
            if (!d || !track) return;
            const texto = ui.frase.value.trim();
            if (!texto) { avisar('Digite a frase do jeito que deve soar', 'warning'); ui.frase.focus(); return; }
            const v = (st.vozes || [])[+ui.voz.value];
            if (ui.voz.value === '' || !v) { avisar('Escolha a voz da fala nova', 'warning'); return; }
            pararPrevia();
            travar(true, 'Gerando a fala nova…');
            try {
                const r = await fetch('/api/generate-audio', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: texto, voice: v.model || v.id, style: ui.estilo.value, language: v.language || 'pt-BR',
                        provider: v.provider === 'cloned' ? 'lmnt' : (v.provider || 'auto'), entrega: 'inline'
                    })
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j.audio_base64) throw new Error(j.error || `HTTP ${r.status}`);
                const bytes = Uint8Array.from(atob(j.audio_base64), ch => ch.charCodeAt(0));
                const buffer = await d.audioContext.decodeAudioData(bytes.buffer);
                const fala = falaDoBuffer(buffer);
                if (!fala) throw new Error(ERROS['fala-vazia']);
                st.novo = { buffer, falaIni: fala.ini, falaFim: fala.fim };
                const prev = costuraAtual();
                if (prev.erro) throw new Error(ERROS[prev.erro] || prev.erro);
                st.prev = prev;
                ui.depois.disabled = ui.aplicar.disabled = false;
                ui.gerar.textContent = '🔁 Tentar de novo';
                ui.info.textContent = `Fala nova: ${seg(fala.fim - fala.ini)} s · ${textoDelta(prev.delta)}` +
                    (prev.ganhoDb ? ` · volume ${prev.ganhoDb > 0 ? '+' : ''}${String(prev.ganhoDb).replace('.', ',')} dB pra casar` : '') +
                    ' — ouça o depois e Aplique.';
            } catch (e) {
                const msg = /429|quota|RESOURCE_EXHAUSTED/i.test(e.message || '')
                    ? 'A cota de vozes da IA acabou por agora (429). Nada foi mudado — tente mais tarde.'
                    : 'Não consegui gerar: ' + (e.message || e);
                ui.info.textContent = msg;
                avisar(msg, 'error');
            } finally {
                travar(false);
            }
        }

        // Costura com a faixa COMO ESTÁ AGORA (o produtor pode ter mexido depois do Gerar).
        function costuraAtual() {
            const d = daw(), track = faixa();
            const clips = d._clipsDaFaixa(track);
            const sr = st.novo.buffer.sampleRate;
            const pausas = pausasDoTrecho(clips, st.ini, st.fim, sr);
            return costurar(clips, st.ini, st.fim, st.novo, { pausas });
        }

        function textoDelta(delta) {
            if (Math.abs(delta) < 0.01) return 'mesmo tempo';
            return `o resto da voz anda ${delta > 0 ? '+' : '−'}${seg(Math.abs(delta))} s`;
        }

        function pararPrevia() {
            for (const f of st.fontes) { try { f.stop(); } catch (_) {} }
            st.fontes = [];
        }

        // Escuta SECA (sem os efeitos da faixa) da janela [t0, t1] — só pra comparar a emenda.
        function tocarJanela(clips, t0, t1) {
            pararPrevia();
            const d = daw(), ctx = d.audioContext, track = faixa();
            if (ctx.state === 'suspended') ctx.resume();
            if (d.isPlaying) d.stop();
            const volFaixa = (track && track.volume != null ? track.volume : 100) / 100;
            const agora = ctx.currentTime + 0.05;
            for (const c of clips) {
                const a = Math.max(t0, c.inicio), b = Math.min(t1, c.inicio + c.duracao);
                if (b - a < 0.005 || !c.buffer) continue;
                const src = ctx.createBufferSource();
                src.buffer = c.buffer;
                const g = ctx.createGain();
                const nivel = Math.pow(10, (Number(c.ganhoDb) || 0) / 20) * volFaixa;
                const ini = agora + (a - t0), fim = agora + (b - t0);
                g.gain.setValueAtTime(nivel, ini);
                if (a === c.inicio && c.fadeIn > 0) { g.gain.setValueAtTime(0, ini); g.gain.linearRampToValueAtTime(nivel, ini + c.fadeIn); }
                if (b === c.inicio + c.duracao && c.fadeOut > 0) { g.gain.setValueAtTime(nivel, fim - c.fadeOut); g.gain.linearRampToValueAtTime(0, fim); }
                src.connect(g).connect(ctx.destination);
                src.start(ini, c.offset + (a - c.inicio), b - a);
                st.fontes.push(src);
            }
        }

        function ouvir(depois) {
            const d = daw(), track = faixa();
            if (!d || !track) return;
            if (depois) {
                if (!st.novo) return;
                const prev = costuraAtual();
                if (prev.erro) { avisar(ERROS[prev.erro] || prev.erro, 'warning'); return; }
                tocarJanela(prev.clips, st.ini - 2, st.fim + prev.delta + 2);
            } else {
                tocarJanela(d._clipsDaFaixa(track), st.ini - 2, st.fim + 2);
            }
        }

        function aplicar() {
            const d = daw(), track = faixa();
            if (!d || !track || !st.novo) return;
            pararPrevia();
            const snap = d._snapshotClips();
            const r = costuraAtual();
            if (r.erro) { avisar(ERROS[r.erro] || r.erro, 'warning'); return; }
            d._guardarUndo(snap);
            track.clips = r.clips;
            d._sincronizarDerivados(track);
            d.cancelarSelecao(track.id);
            d.aposMudancaDeClips([track]);
            fecharPainel();
            avisar(`🔁 Trecho regerado — ${textoDelta(r.delta)}. Ctrl+Z desfaz.`, 'success');
        }

        function fecharPainel() {
            pararPrevia();
            if (st.ui) st.ui.painel.style.display = 'none';
            st.novo = st.prev = null;
        }

        Object.assign(RegerarTrecho, { abrir, fechar: fecharPainel, _estado: st });
    }
    global.RegerarTrecho = RegerarTrecho;
    if (typeof module !== 'undefined' && module.exports) module.exports = RegerarTrecho;
})(typeof window !== 'undefined' ? window : globalThis);
