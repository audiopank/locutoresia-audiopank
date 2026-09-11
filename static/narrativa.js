/**
 * Estúdio de Narrativa — várias vozes, uma por parágrafo (11/09/2026).
 *
 * Página nova de propósito: não mexe em Gerador, MiniDAW nem tts_generator.
 * O que ela reusa:
 *   - /api/voices (catálogo), /api/generate-audio (1 chamada por bloco),
 *   - /api/narrativa/dividir (parágrafo → bloco, "Nome: fala" → personagem),
 *   - MixEngine.masterizarBuffer + bufferToMp3 (o mesmo export do Gerador),
 *   - o handoff localStorage.minidaw_projeto_gerador (a MiniDAW já recebe),
 *   - o upload de rascunho (MP3 + .txt v2): a narrativa pronta cai nos
 *     "Spots guardados" do Gerador, e de lá "Reabrir" dá Feed/Enviar/Download.
 *
 * Cota: cada bloco = 1 locução. No free do Gemini são ~10 por dia — a tela conta.
 */
(function () {
    'use strict';

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const RITMO = 2.35;   // pal/s, o mesmo miolo da estimativa do Gerador

    const estado = {
        nome: '', arquivo: null, pausa: 0.6,
        vozes: {},            // personagem → {voz, direcao}
        blocos: [],           // {id, personagem, direcao, texto, buffer, chaveGerada, gerando}
        catalogo: [],
        mixBuffer: null, mixBlob: null, duracao: 0,
        chaveMontada: null,   // com quais blocos/pausa o mixBlob foi montado (ver montagemAtual)
        lote: false           // "Gerar e montar" rodando: "Gerar este" espera
    };
    function ocupado() {
        if (estado.lote || estado.blocos.some(x => x.gerando)) {
            avisar('Ainda estou gravando um bloco — espere terminar antes de mandar outro (o Gemini grátis só aceita 3 por minuto).', 'atencao');
            return true;
        }
        return false;
    }

    // ── utilidades de tela ─────────────────────────────────────────────
    function avisar(texto, tipo) {
        const el = document.createElement('div');
        el.className = 'aviso aviso-' + (tipo || 'info');
        el.textContent = texto;
        $('avisos').appendChild(el);
    }
    function limparAvisos() { $('avisos').innerHTML = ''; }
    function passo(t) { $('progresso').textContent = t || ''; }
    function palavras(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
    function slugAscii(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'narrativa';
    }

    // ── catálogo de vozes ──────────────────────────────────────────────
    async function carregarVozes() {
        try {
            const r = await fetch('/api/voices');
            const d = await r.json();
            estado.catalogo = d.voices || [];
        } catch (e) {
            estado.catalogo = [];
        }
    }
    function providerDaVoz(id) {
        const v = estado.catalogo.find(x => String(x.id) === String(id));
        const p = v ? v.provider : 'gemini';
        return p === 'gemini' ? 'google' : p;
    }
    function nomeDaVoz(id) {
        const v = estado.catalogo.find(x => String(x.id) === String(id));
        return v ? v.name : String(id || '');
    }
    function opcoesDeVoz(selecionada) {
        const rot = v => esc(v.name) + (v.gender === 'female' ? ' ♀' : v.gender === 'male' ? ' ♂' : '');
        const grupo = (prov, titulo) => {
            const lista = estado.catalogo.filter(v => v.provider === prov);
            if (!lista.length) return '';
            return `<optgroup label="${titulo}">` + lista.map(v =>
                `<option value="${esc(v.id)}"${String(v.id) === String(selecionada) ? ' selected' : ''}>${rot(v)}</option>`).join('') + '</optgroup>';
        };
        return grupo('gemini', 'Google / Gemini (entende direção entre colchetes)') + grupo('elevenlabs', 'ElevenLabs (Expressivo, consome crédito)');
    }
    function vozPadraoPara(personagem) {
        const gem = estado.catalogo.filter(v => v.provider === 'gemini');
        if (!gem.length) return estado.catalogo[0] ? estado.catalogo[0].id : '';
        if (/narrador/i.test(personagem)) {
            const c = gem.find(v => /charon/i.test(v.name));
            if (c) return c.id;
        }
        // Personagens novos ganham vozes diferentes, na ordem do catálogo.
        const usadas = new Set(Object.values(estado.vozes).map(v => String(v.voz)));
        const livre = gem.find(v => !usadas.has(String(v.id)));
        return (livre || gem[0]).id;
    }

    // ── blocos ─────────────────────────────────────────────────────────
    function chaveGeracao(b) {
        const v = estado.vozes[b.personagem] || {};
        return JSON.stringify([b.texto.trim(), (b.direcao || v.direcao || '').trim(), String(v.voz || '')]);
    }
    function statusBloco(b) {
        if (b.gerando) return 'gerando';
        if (!b.buffer) return 'pendente';
        return b.chaveGerada === chaveGeracao(b) ? 'gerado' : 'desatualizado';
    }
    function personagens() {
        const vistos = [];
        estado.blocos.forEach(b => { if (!vistos.includes(b.personagem)) vistos.push(b.personagem); });
        return vistos;
    }
    function garantirVozes() {
        personagens().forEach(p => {
            if (!estado.vozes[p]) estado.vozes[p] = { voz: vozPadraoPara(p), direcao: '' };
        });
    }

    async function dividir() {
        const texto = $('roteiroBruto').value;
        if (!texto.trim()) { alert('Cole o roteiro primeiro.'); return; }
        const r = await fetch('/api/narrativa/dividir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto })
        });
        const d = await r.json();
        if (!d.success) { alert(d.error || 'Não consegui dividir.'); return; }
        // Mantém o áudio de blocos que não mudaram (mesmo personagem + mesmo texto, na mesma posição).
        const antigos = estado.blocos;
        estado.blocos = d.blocos.map((b, i) => {
            const a = antigos[i];
            const igual = a && a.personagem === b.personagem && a.texto.trim() === b.texto.trim();
            return {
                id: 'b' + Date.now() + '_' + i,
                personagem: b.personagem, texto: b.texto,
                direcao: igual ? a.direcao : '',
                buffer: igual ? a.buffer : null,
                chaveGerada: igual ? a.chaveGerada : null,
                geracao: igual ? (a.geracao || 0) : 0,
                gerando: false
            };
        });
        garantirVozes();
        limparAvisos();
        render();
        avisar(`${estado.blocos.length} bloco(s), ${d.personagens.length} personagem(ns): ${d.personagens.join(', ')}. Confira as vozes e clique em "Gerar e montar".`, 'info');
    }

    // ── render ─────────────────────────────────────────────────────────
    function render() {
        renderVozes();
        renderBlocos();
        atualizarContador();
        salvarLocal();
    }
    function renderVozes() {
        const card = $('cardVozes');
        const ps = personagens();
        card.style.display = ps.length ? '' : 'none';
        $('listaVozes').innerHTML = ps.map(p => {
            const v = estado.vozes[p] || {};
            return `<div class="voz-linha">
                <span class="voz-nome">${esc(p)}</span>
                <select class="form-select form-select-sm" data-voz="${esc(p)}">${opcoesDeVoz(v.voz)}</select>
                <input type="text" class="form-control form-control-sm" data-direcao="${esc(p)}" maxlength="120"
                       placeholder="direção padrão (ex.: calmo, tom de suspense)" value="${esc(v.direcao || '')}">
            </div>`;
        }).join('');
        $('listaVozes').querySelectorAll('[data-voz]').forEach(sel => sel.onchange = () => {
            estado.vozes[sel.dataset.voz].voz = sel.value;
            renderBlocos(); atualizarContador(); salvarLocal();
        });
        $('listaVozes').querySelectorAll('[data-direcao]').forEach(inp => inp.oninput = () => {
            estado.vozes[inp.dataset.direcao].direcao = inp.value;
            renderStatus(); salvarLocal();
        });
    }
    function renderBlocos() {
        const card = $('cardBlocos');
        card.style.display = estado.blocos.length ? '' : 'none';
        $('listaBlocos').innerHTML = estado.blocos.map((b, i) => `
            <div class="bloco" data-id="${b.id}">
                <div class="bloco-cab">
                    <span class="bloco-num">${i + 1}.</span>
                    <input type="text" class="form-control form-control-sm personagem" data-campo="personagem" value="${esc(b.personagem)}" maxlength="30" title="Personagem (a voz vem da lista acima)">
                    <input type="text" class="form-control form-control-sm direcao" data-campo="direcao" value="${esc(b.direcao || '')}" maxlength="120"
                           placeholder="direção só deste bloco (ex.: sussurrando)">
                    <span class="status" data-status></span>
                </div>
                <textarea class="form-control form-control-sm" data-campo="texto" maxlength="5000">${esc(b.texto)}</textarea>
                <div class="bloco-rodape">
                    <button class="btn btn-sm btn-outline-info" data-acao="gerar"><i class="fas fa-microphone me-1"></i>Gerar este</button>
                    <button class="btn btn-sm btn-outline-light" data-acao="ouvir"><i class="fas fa-play me-1"></i>Ouvir</button>
                    <span class="hint" data-info></span>
                    <button class="btn btn-sm btn-outline-danger ms-auto" data-acao="remover" title="Remover bloco"><i class="fas fa-trash"></i></button>
                </div>
            </div>`).join('');
        $('listaBlocos').querySelectorAll('.bloco').forEach(el => {
            const b = estado.blocos.find(x => x.id === el.dataset.id);
            el.querySelectorAll('[data-campo]').forEach(inp => inp.oninput = () => {
                const campo = inp.dataset.campo;
                const antes = b.personagem;
                b[campo] = inp.value;
                if (campo === 'personagem') {
                    b.personagem = inp.value.trim() || 'Narrador';
                    if (b.personagem !== antes) { garantirVozes(); renderVozes(); }
                }
                renderStatus(); atualizarContador(); salvarLocal();
            });
            el.querySelector('[data-acao="gerar"]').onclick = async () => {
                if (ocupado()) return;
                limparAvisos();
                try {
                    await gerarBloco(b);
                    passo('Montando a narrativa...');
                    await exportar();
                    passo(mensagemMontagem());
                } catch (e) { avisar(`Bloco ${estado.blocos.indexOf(b) + 1}: ${e.message}`, 'erro'); passo(''); }
                render();
            };
            el.querySelector('[data-acao="ouvir"]').onclick = () => ouvirBloco(b);
            el.querySelector('[data-acao="remover"]').onclick = () => {
                if (!confirm('Remover este bloco?')) return;
                estado.blocos = estado.blocos.filter(x => x !== b);
                render();
            };
        });
        renderStatus();
    }
    function renderStatus() {
        $('listaBlocos').querySelectorAll('.bloco').forEach(el => {
            const b = estado.blocos.find(x => x.id === el.dataset.id);
            if (!b) return;
            const st = statusBloco(b);
            const badge = el.querySelector('[data-status]');
            badge.className = 'status status-' + st;
            badge.textContent = { pendente: 'pendente', gerado: 'gerado', desatualizado: 'mudou — gerar de novo', gerando: 'gerando...' }[st];
            const v = estado.vozes[b.personagem] || {};
            el.querySelector('[data-info]').textContent =
                `${palavras(b.texto)} palavras · ${nomeDaVoz(v.voz)}` + (b.buffer ? ` · ${b.buffer.duration.toFixed(1)} s` : '');
            el.querySelector('[data-acao="ouvir"]').disabled = !b.buffer;
        });
    }
    function atualizarContador() {
        const n = estado.blocos.length;
        const pend = estado.blocos.filter(b => statusBloco(b) !== 'gerado').length;
        const pal = estado.blocos.reduce((s, b) => s + palavras(b.texto), 0);
        const est = pal / RITMO + Math.max(0, n - 1) * estado.pausa;
        $('spanContador').textContent = n
            ? `${n} blocos · ${pal} palavras · ~${Math.round(est)} s · ${pend} locução(ões) a gerar (Gemini grátis: 3 por minuto, e a cota do dia é curta)`
            : '';
    }

    // ── geração ────────────────────────────────────────────────────────
    // O 429 do Gemini grátis vem de DOIS limites: por MINUTO (3 locuções/min,
    // "Please retry in 40s" — visto no teste de 11/09/2026, bloco 6 de 11) e por
    // DIA. O primeiro se resolve esperando; o segundo, não.
    // Qual 429 é: 'dia' (parar, não adianta esperar), 'minuto' (esperar e tentar
    // de novo) ou null (não é 429). O Google manda "retry in 26s" nos DOIS casos,
    // então quem decide é o nome da cota (quotaId ...PerDay... / ...PerMinute...).
    function tipoDe429(msg) {
        if (!/429|RESOURCE_EXHAUSTED/i.test(msg)) return null;
        if (/PerDay/i.test(msg)) return 'dia';
        if (/PerMinute/i.test(msg)) return 'minuto';
        const seg = segundosParaTentarDeNovo(msg);
        return (seg != null && seg <= 120) ? 'minuto' : 'dia';
    }
    function segundosParaTentarDeNovo(msg) {
        const m = /retry in ([\d.]+)\s*s/i.exec(msg) || /retryDelay'?\s*:\s*'?(\d+)s/i.exec(msg);
        return m ? Math.ceil(parseFloat(m[1])) : null;
    }
    function resumirErro(msg, tipo) {
        if (tipo === 'dia') return 'cota do DIA do Gemini TTS esgotada (429 PerDay) — não adianta esperar: volta por volta das 4h da manhã (Brasil). Hoje: vozes do ElevenLabs nos personagens, ou continue amanhã (os blocos gerados ficam).';
        if (tipo === 'minuto') return 'limite por minuto do Gemini (3 locuções/min) — 429 mesmo depois de esperar 3 vezes; aguarde 1 minuto e clique "Gerar este".';
        return String(msg).slice(0, 300);
    }
    async function esperar(seg, rotulo) {
        for (let r = seg; r > 0; r--) {
            passo(`${rotulo} — o Gemini grátis aceita 3 locuções por minuto; tento de novo em ${r} s...`);
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    async function gerarBloco(b) {
        const v = estado.vozes[b.personagem];
        if (!v || !v.voz) throw new Error(`escolha a voz de "${b.personagem}"`);
        const prov = providerDaVoz(v.voz);
        const dir = (b.direcao || v.direcao || '').trim().replace(/^\[|\]$/g, '');
        if (dir && prov !== 'google') avisar(`"${b.personagem}": direção só funciona no Google — no ElevenLabs ela foi ignorada.`, 'atencao');
        const texto = (dir && prov === 'google') ? `[${dir}]\n${b.texto.trim()}` : b.texto.trim();
        if (!texto) throw new Error('bloco vazio');
        b.gerando = true; renderStatus();
        passo(`Gravando bloco ${estado.blocos.indexOf(b) + 1} (${b.personagem}, ${nomeDaVoz(v.voz)})...`);
        try {
            let d;
            for (let tentativa = 1; ; tentativa++) {
                const r = await fetch('/api/generate-audio', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: texto, voice: v.voz, api: prov, style: 'normal', language: 'pt-BR' })
                });
                d = await r.json().catch(() => ({}));
                if (d.success) break;
                const msg = d.error || `falha na locução (HTTP ${r.status})`;
                const tipo = tipoDe429(msg);
                if (tipo !== 'minuto' || tentativa >= 3) throw new Error(resumirErro(msg, tipo));
                const seg = Math.min(segundosParaTentarDeNovo(msg) || 30, 120);
                await esperar(seg + 2, `Bloco ${estado.blocos.indexOf(b) + 1} (${b.personagem}) bateu no limite por minuto`);
                passo(`Gravando bloco ${estado.blocos.indexOf(b) + 1} (${b.personagem}, ${nomeDaVoz(v.voz)})... tentativa ${tentativa + 1}`);
            }
            const ab = await (await fetch(d.download_url)).arrayBuffer();   // /tmp da Vercel é efêmero: buscar já
            b.buffer = await ctx.decodeAudioData(ab);
            b.chaveGerada = chaveGeracao(b);
            b.geracao = (b.geracao || 0) + 1;     // regravar o mesmo texto muda o áudio: a montagem tem que saber
        } finally {
            b.gerando = false;
        }
    }
    function ouvirBloco(b) {
        if (!b.buffer) return;
        const src = ctx.createBufferSource();
        src.buffer = b.buffer;
        src.connect(ctx.destination);
        src.start();
    }
    async function gerarTudo() {
        const btn = $('btnGerarTudo');
        const pend = estado.blocos.filter(b => statusBloco(b) !== 'gerado');
        if (!estado.blocos.length) { alert('Divida o roteiro em blocos primeiro.'); return; }
        if (ocupado()) return;
        if (pend.length && !confirm(`Vou gravar ${pend.length} locução(ões), uma por bloco. O Gemini grátis aceita 3 por minuto: quando bater no limite eu espero e sigo sozinho (uns ${Math.ceil(pend.length / 3)} min no total). Continuar?`)) return;
        btn.disabled = true; estado.lote = true;
        limparAvisos();
        let falhou = 0;
        try {
            for (const b of pend) {
                try { await gerarBloco(b); }
                catch (e) { falhou++; avisar(`Bloco ${estado.blocos.indexOf(b) + 1} (${b.personagem}): ${e.message}`, 'erro'); if (/cota|429|quota/i.test(e.message)) break; }
                renderStatus(); atualizarContador();
            }
            const prontos = estado.blocos.filter(b => b.buffer);
            if (!prontos.length) { passo('❌ Nenhum bloco gerado.'); return; }
            passo('Montando a narrativa...');
            await exportar();
            passo(mensagemMontagem() + (falhou ? ` ${falhou} falharam — clique "Gerar este" neles.` : ''));
        } catch (e) {
            passo('❌ ' + e.message);
        } finally {
            btn.disabled = false; estado.lote = false;
            render();
        }
    }

    // ── montagem e export ──────────────────────────────────────────────
    function chaveMontagem() {
        return JSON.stringify([estado.pausa, estado.blocos.filter(b => b.buffer).map(b => `${b.id}|${b.geracao || 0}`)]);
    }
    function mensagemMontagem() {
        const prontos = estado.blocos.filter(b => b.buffer).length, n = estado.blocos.length;
        return prontos === n
            ? '✅ Narrativa montada com todos os blocos — ouça na barra de baixo.'
            : `✅ Montado com ${prontos} de ${n} blocos — os pendentes ficam de fora até serem gerados.`;
    }
    // Exportar, Guardar nos Spots e MiniDAW saem SEMPRE da montagem atual: se um
    // bloco foi gerado, regravado ou removido (ou a pausa mudou) depois da última
    // montagem, remonta antes. Foi o que travou em 5 de 11 blocos em 11/09/2026.
    async function montagemAtual() {
        if (!estado.blocos.some(b => b.buffer)) throw new Error('Gere pelo menos um bloco.');
        if (!estado.mixBlob || estado.chaveMontada !== chaveMontagem()) {
            passo('Remontando a narrativa com os blocos atuais...');
            await exportar();
            passo(mensagemMontagem());
        }
        return estado.mixBlob;
    }
    function montar() {
        const prontos = estado.blocos.filter(b => b.buffer);
        if (!prontos.length) return null;
        const sr = ctx.sampleRate;
        const total = prontos.reduce((s, b) => s + b.buffer.duration, 0) + Math.max(0, prontos.length - 1) * estado.pausa + 0.25;
        const out = ctx.createBuffer(2, Math.ceil(total * sr), sr);
        let pos = 0;
        for (const b of prontos) {
            const buf = b.buffer;
            for (let ch = 0; ch < 2; ch++) {
                out.getChannelData(ch).set(buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)), Math.round(pos * sr));
            }
            pos += buf.duration + estado.pausa;
        }
        return out;
    }
    async function exportar() {
        const buf = montar();
        if (!buf) { alert('Gere pelo menos um bloco.'); return; }
        // Mesmo preset do Gerador e do "Otimizar e Exportar" (-15, aprovado de ouvido).
        MixEngine.masterizarBuffer(buf, -15);
        estado.mixBuffer = buf;
        estado.mixBlob = await MixEngine.bufferToMp3(buf, 192);
        estado.chaveMontada = chaveMontagem();
        estado.duracao = buf.duration;
        $('playerResultado').src = URL.createObjectURL(estado.mixBlob);
        $('barraResultado').style.display = 'flex';
        const min = Math.floor(buf.duration / 60), seg = Math.round(buf.duration % 60);
        $('resultadoInfo').textContent = `${min}:${String(seg).padStart(2, '0')} · MP3 · ${estado.blocos.filter(b => b.buffer).length} blocos · pausa ${estado.pausa}s`;
    }
    function nomeArquivo() { return slugAscii($('inputNome').value || 'narrativa') + '.mp3'; }
    function roteiroPlano() {
        return estado.blocos.map(b => `${b.personagem}: ${b.texto.trim()}`).filter(l => !/:\s*$/.test(l)).join('\n\n');
    }

    // Vai pros "Spots guardados" do Gerador (mesmo caminho do guardarRascunho de lá):
    // MP3 + .txt v2. Lá, "Reabrir" dá Feed, Enviar e Download.
    async function guardarNosSpots() {
        try { await montagemAtual(); } catch (e) { alert(e.message); return; }
        const btn = $('btnGuardarSpot');
        btn.disabled = true;
        try {
            const nome = nomeArquivo();
            const ru = await fetch('/api/client-deliveries/upload-url', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: nome, kind: 'rascunho' })
            });
            const u = await ru.json();
            if (!u.success) throw new Error(u.error || 'sem URL de upload');
            const fd = new FormData();
            fd.append('file', estado.mixBlob, nome);
            const up = await fetch(u.upload_url, { method: 'PUT', headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` }, body: fd });
            if (!up.ok) throw new Error('falha no envio pro Storage');
            try {
                const meta = {
                    v: 2, tipo: 'narrativa',
                    nome: ($('inputNome').value || '').trim() || 'Narrativa',
                    conta: 'locutores', texto_pronto: true, direcao: '', trilha: null,
                    duracao: Math.round(estado.duracao * 10) / 10,
                    personagens: Object.keys(estado.vozes).map(p => ({ personagem: p, voz: estado.vozes[p].voz, voz_nome: nomeDaVoz(estado.vozes[p].voz) })),
                    gerado_em: new Date().toISOString()
                };
                const rt = await fetch('/api/client-deliveries/upload-url', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: nome.replace(/\.mp3$/i, '') + '.txt', kind: 'rascunho', twin_of: u.path })
                });
                const ut = await rt.json();
                if (!ut.success) throw new Error(ut.error || 'sem URL pro roteiro');
                const fdt = new FormData();
                fdt.append('file', new Blob([JSON.stringify(meta) + '\n\n' + roteiroPlano()], { type: 'text/plain' }), 'roteiro.txt');
                const upt = await fetch(ut.upload_url, { method: 'PUT', headers: { 'apikey': ut.apikey, 'Authorization': `Bearer ${ut.apikey}` }, body: fdt });
                if (!upt.ok) throw new Error('falha ao guardar o roteiro');
            } catch (e) {
                avisar('O áudio foi guardado, mas o roteiro não (' + e.message + ').', 'atencao');
            }
            avisar('💾 Narrativa guardada nos Spots guardados do Gerador. Lá, "Reabrir" dá Feed, Enviar e Download.', 'ok');
        } catch (e) {
            avisar('Não consegui guardar: ' + e.message, 'erro');
        } finally {
            btn.disabled = false;
        }
    }

    // MiniDAW: a narração montada entra como UMA faixa de voz; trilha e efeitos
    // ele coloca lá. Mesmo handoff do Gerador (a MiniDAW já sabe receber).
    async function abrirNaMiniDAW() {
        if (!estado.blocos.some(b => b.buffer)) { alert('Gere pelo menos um bloco.'); return; }
        const aba = window.open('about:blank', '_blank');   // dentro do gesto do clique
        try { await montagemAtual(); } catch (e) { if (aba) aba.close(); alert(e.message); return; }
        const fr = new FileReader();
        fr.onloadend = () => {
            try {
                localStorage.setItem('minidaw_projeto_gerador', JSON.stringify({
                    voz: { base64: fr.result, nome: nomeArquivo().replace(/\.mp3$/i, '') + '-narracao.mp3' },
                    trilha: null, receita: null, roteiro: roteiroPlano().slice(0, 900)
                }));
                if (aba) { aba.location = '/minidaw'; } else { window.open('/minidaw', '_blank'); }
            } catch (e) {
                if (aba) aba.close();
                alert('A narração ficou grande demais pra passar por aqui. Use "Exportar MP3" e arraste o arquivo dentro da MiniDAW.');
            }
        };
        fr.readAsDataURL(estado.mixBlob);
    }
    async function exportarDownload() {
        try { await montagemAtual(); } catch (e) { alert(e.message); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(estado.mixBlob);
        a.download = nomeArquivo();
        a.click();
    }

    // ── guardar / abrir narrativa (texto + vozes, sem áudio) ───────────
    function dadosParaGuardar() {
        return {
            pausa: estado.pausa, vozes: estado.vozes,
            blocos: estado.blocos.map(b => ({ personagem: b.personagem, direcao: b.direcao || '', texto: b.texto })),
            roteiro_bruto: $('roteiroBruto').value
        };
    }
    function salvarLocal() {
        try {
            localStorage.setItem('narrativa_rascunho', JSON.stringify({ nome: $('inputNome').value, arquivo: estado.arquivo, ...dadosParaGuardar() }));
        } catch (e) { /* sem espaço: segue */ }
    }
    function carregarDados(nome, dados, arquivo) {
        estado.nome = nome || '';
        estado.arquivo = arquivo || null;
        estado.pausa = Number(dados.pausa) || 0.6;
        estado.vozes = dados.vozes || {};
        estado.blocos = (dados.blocos || []).map((b, i) => ({
            id: 'b' + Date.now() + '_' + i, personagem: b.personagem || 'Narrador', direcao: b.direcao || '',
            texto: b.texto || '', buffer: null, chaveGerada: null, gerando: false
        }));
        estado.mixBlob = null; estado.mixBuffer = null; estado.chaveMontada = null;
        $('barraResultado').style.display = 'none';
        $('inputNome').value = estado.nome;
        $('inputPausa').value = estado.pausa;
        $('roteiroBruto').value = dados.roteiro_bruto || roteiroPlano();
        garantirVozes();
        render();
    }
    async function guardarNarrativa() {
        const nome = ($('inputNome').value || '').trim();
        if (!nome) { alert('Dê um nome à narrativa.'); return; }
        if (!estado.blocos.length) { alert('Divida o roteiro em blocos antes de guardar.'); return; }
        const r = await fetch('/api/narrativas', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, dados: dadosParaGuardar(), arquivo: estado.arquivo })
        });
        const d = await r.json();
        if (!d.success) { alert(d.error || 'Não consegui guardar.'); return; }
        estado.arquivo = d.arquivo;
        salvarLocal();
        limparAvisos();
        avisar(`💾 Narrativa "${nome}" guardada (texto, vozes e direções). O áudio não vai junto: gere de novo ao reabrir, ou guarde o MP3 nos Spots.`, 'ok');
    }
    async function listarNarrativas() {
        const box = $('listaNarrativas');
        box.style.display = '';
        box.innerHTML = '<div class="hint">Carregando...</div>';
        try {
            const r = await fetch('/api/narrativas');
            const d = await r.json();
            const itens = d.narrativas || [];
            if (!itens.length) { box.innerHTML = '<div class="hint">Nenhuma narrativa guardada ainda.</div>'; return; }
            box.innerHTML = itens.map(i => `
                <div class="narrativa-item">
                    <span class="narrativa-nome">${esc(i.titulo)} <span class="hint ms-2">${esc(i.quando)}</span></span>
                    <button class="btn btn-sm btn-outline-info" data-abrir="${esc(i.arquivo)}"><i class="fas fa-folder-open me-1"></i>Abrir</button>
                    <button class="btn btn-sm btn-outline-danger" data-apagar="${esc(i.arquivo)}"><i class="fas fa-trash"></i></button>
                </div>`).join('') + '<button class="btn btn-sm btn-outline-secondary mt-1" id="btnFecharLista">Fechar</button>';
            $('btnFecharLista').onclick = () => { box.style.display = 'none'; };
            box.querySelectorAll('[data-abrir]').forEach(b => b.onclick = async () => {
                const r2 = await fetch('/api/narrativas/' + encodeURIComponent(b.dataset.abrir));
                const d2 = await r2.json();
                if (!d2.success) { alert(d2.error || 'Não achei.'); return; }
                carregarDados(d2.nome, d2.dados || {}, b.dataset.abrir);
                box.style.display = 'none';
                limparAvisos();
                avisar(`📂 "${d2.nome}" aberta: ${estado.blocos.length} blocos. Clique em "Gerar e montar" pra gravar.`, 'ok');
            });
            box.querySelectorAll('[data-apagar]').forEach(b => b.onclick = async () => {
                if (!confirm('Apagar esta narrativa guardada? Não dá pra desfazer.')) return;
                await fetch('/api/narrativas', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivo: b.dataset.apagar }) });
                listarNarrativas();
            });
        } catch (e) {
            box.innerHTML = '<div class="hint">Não consegui listar.</div>';
        }
    }
    function nova() {
        if (estado.blocos.length && !confirm('Começar uma narrativa nova? O que está na tela some (o que foi guardado continua no Storage).')) return;
        estado.arquivo = null; estado.blocos = []; estado.vozes = {}; estado.mixBlob = null; estado.mixBuffer = null; estado.chaveMontada = null;
        $('inputNome').value = ''; $('roteiroBruto').value = ''; $('barraResultado').style.display = 'none';
        limparAvisos(); passo('');
        render();
    }

    // ── VoxCraft: o que a tela mostra ──────────────────────────────────
    window.voxcraftContexto = function () {
        return {
            tela: '/narrativa',
            nome: $('inputNome').value,
            personagens: personagens().map(p => `${p} → ${nomeDaVoz((estado.vozes[p] || {}).voz)}`).join('; '),
            blocos: estado.blocos.length,
            pendentes: estado.blocos.filter(b => statusBloco(b) !== 'gerado').length,
            roteiro: roteiroPlano(),
            plano: 'outro',
            duracao_mix: estado.duracao || 0
        };
    };

    // ── init ───────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        await carregarVozes();
        $('btnDividir').onclick = dividir;
        $('btnGerarTudo').onclick = gerarTudo;
        $('btnExportar').onclick = exportarDownload;
        $('btnGuardarSpot').onclick = guardarNosSpots;
        $('btnAbrirMiniDAW').onclick = abrirNaMiniDAW;
        $('btnGuardar').onclick = guardarNarrativa;
        $('btnAbrir').onclick = listarNarrativas;
        $('btnNova').onclick = nova;
        $('inputPausa').onchange = () => { estado.pausa = Math.max(0, Number($('inputPausa').value) || 0); atualizarContador(); salvarLocal(); };
        $('inputNome').oninput = salvarLocal;
        try {
            const raw = localStorage.getItem('narrativa_rascunho');
            if (raw) {
                const s = JSON.parse(raw);
                if (s && (s.blocos || []).length) carregarDados(s.nome, s, s.arquivo);
            }
        } catch (e) { /* rascunho local corrompido: começa vazio */ }
    });
})();
