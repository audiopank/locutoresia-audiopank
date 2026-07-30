/**
 * Gerador de Anúncios — o orquestrador.
 *
 * Encadeia o que já existia solto atrás de cliques em telas diferentes:
 * roteiro -> voz -> trilha -> receita de mix -> mixagem. Não tem lógica de
 * áudio própria: quem mixa é o MixEngine, quem envia é o enviarParaEntrega.
 *
 * Princípio de erro: degradar com o que já se tem. Perder o TTS já gerado
 * porque a trilha falhou seria queimar crédito à toa.
 */
(function () {
    'use strict';

    const estado = {
        pedido: null,       // pedido escolhido
        pedidos: [],        // lista carregada
        vozes: [],          // catálogo de vozes (tem provider)
        roteiro: '',        // roteiro em uso
        vozBuffer: null,    // AudioBuffer da locução
        trilha: null,       // {name, file_url, ...}
        trilhaBuffer: null,
        receita: null,      // resposta do mix-recipe
        mixBlob: null       // resultado final
    };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Escapa aspas também: este texto vai parar dentro de atributo HTML.
    // Sem isso, um cliente chamado O'Brien quebra a página (bug recorrente aqui).
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function passo(n, total, texto) {
        document.getElementById('progresso').textContent =
            n ? `[${n}/${total}] ${texto}` : texto;
    }

    function avisar(texto, tipo) {
        const el = document.createElement('div');
        el.className = 'aviso aviso-' + (tipo || 'info');
        el.textContent = texto;
        document.getElementById('avisos').appendChild(el);
    }

    function limparAvisos() {
        document.getElementById('avisos').innerHTML = '';
    }

    // ── Carregamento inicial ─────────────────────────────────────────────

    async function carregarPedidos() {
        const sel = document.getElementById('selectPedido');
        try {
            const r = await fetch('/api/pedidos');
            const d = await r.json();
            // Só os que ainda não viraram entrega — os demais só poluiriam a lista.
            estado.pedidos = (d.pedidos || []).filter(p => !p.entrega_id);
            sel.innerHTML = '<option value="">— sem pedido (escrevo o briefing na mão) —</option>' +
                estado.pedidos.map(p =>
                    `<option value="${esc(p.id)}">${esc(p.cliente_nome)} — ${esc(p.plano || p.tipo || 'pedido')}</option>`
                ).join('');
        } catch (e) {
            sel.innerHTML = '<option value="">— não consegui carregar os pedidos —</option>';
        }

        sel.onchange = () => {
            estado.pedido = estado.pedidos.find(p => String(p.id) === sel.value) || null;
            if (!estado.pedido) return;
            document.getElementById('textoComercial').value = estado.pedido.roteiro || '';
            document.getElementById('inputNome').value =
                'spot-' + String(estado.pedido.cliente_nome || 'cliente')
                    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
            atualizarContador();
        };
    }

    async function carregarVozes() {
        try {
            const r = await fetch('/api/voices');
            const d = await r.json();
            estado.vozes = d.voices || [];
        } catch (e) {
            estado.vozes = [];
        }
        aplicarFiltroDeVozes();
    }

    // O modo NÃO sobrescreve o provider: cada voz pertence a um provider
    // específico (30 do gemini, 21 do elevenlabs). Mandar uma voz do
    // ElevenLabs com api='google' faria ela cair fora dos mapas e ser
    // roteada pra outro provider em silêncio. Então o modo FILTRA a lista,
    // e o provider sai da voz escolhida.
    function aplicarFiltroDeVozes() {
        const modo = document.getElementById('selectModo').value;
        const alvo = modo === 'expressivo' ? 'elevenlabs' : 'gemini';
        const sel = document.getElementById('selectVoz');
        const filtradas = estado.vozes.filter(v => v.provider === alvo);

        if (!filtradas.length) {
            sel.innerHTML = '<option value="">— nenhuma voz deste modo —</option>';
            return;
        }
        sel.innerHTML = filtradas.map((v, i) =>
            `<option value="${esc(v.id)}"${i === 0 ? ' selected' : ''}>${esc(v.name)}</option>`
        ).join('');
    }

    // Provider real da voz selecionada. 'gemini' vira 'google' porque é isso
    // que o /api/generate-audio espera (ele mesmo faz esse de-para).
    function providerDaVoz() {
        const id = document.getElementById('selectVoz').value;
        const v = estado.vozes.find(x => String(x.id) === id);
        const prov = v ? v.provider : 'gemini';
        return prov === 'gemini' ? 'google' : prov;
    }

    async function carregarTrilhas() {
        const sel = document.getElementById('selectTrilha');
        let lista = [];
        try {
            const r = await fetch('/api/tracks');
            const d = await r.json();
            lista = d.tracks || [];
        } catch (e) { /* segue sem catálogo: dá pra usar 'auto' ou 'nenhuma' */ }
        sel.innerHTML =
            '<option value="auto" selected>Deixar a IA escolher</option>' +
            '<option value="nenhuma">Sem trilha (locução seca)</option>' +
            lista.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    }

    // ── Helpers de áudio ─────────────────────────────────────────────────

    async function baixarEDecodificar(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Falha ao buscar o áudio (HTTP ${r.status})`);
        const arr = await r.arrayBuffer();
        return await ctx.decodeAudioData(arr);
    }

    // Monta uma faixa no formato que o MixEngine espera (espelha minidaw.js).
    function montarTrack(id, nome, tipo, audioBuffer, receitaPapel) {
        const r = receitaPapel || {};
        return {
            id: id, name: nome, type: tipo,
            audioBuffer: audioBuffer,
            duration: audioBuffer.duration,
            volume: r.volume != null ? r.volume : 100,
            pan: r.pan != null ? r.pan : 0,
            fadeIn: r.fade_in != null ? r.fade_in : 0,
            fadeOut: r.fade_out != null ? r.fade_out : 0,
            muted: false, solo: false,
            effects: Object.assign(
                { reverb: false, delay: false, compressor: false, eq: false,
                  hpf: tipo === 'voice', presence: false, limiter: true },
                r.effects || {}
            )
        };
    }

    async function gerarVoz(texto) {
        const r = await fetch('/api/generate-audio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: texto,
                voice: document.getElementById('selectVoz').value,
                api: providerDaVoz(),
                language: 'pt-BR'
            })
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Falha ao gerar a locução');
        // Buscar JÁ — o arquivo vive em /tmp, que é efêmero na Vercel.
        return await baixarEDecodificar(d.download_url);
    }

    // Mixa voz (+ trilha, se houver) com a receita em mãos e devolve o Blob.
    async function mixar(aoProgredir) {
        const tracks = [montarTrack('voz', 'Locução', 'voice', estado.vozBuffer,
                                    estado.receita && estado.receita.voz)];
        if (estado.trilhaBuffer) {
            tracks.push(montarTrack('trilha', estado.trilha.name, 'music', estado.trilhaBuffer,
                                    estado.receita && estado.receita.trilha));
        }
        const buffer = await MixEngine.renderizarMix({
            tracks: tracks, todasAsTracks: tracks,
            duration: estado.vozBuffer.duration + 1.05,   // mesma folga do motor
            sampleRate: ctx.sampleRate,
            aoProgredir: aoProgredir
        });
        // -15 é o preset 'streaming' da MiniDAW — o mesmo do botão "Otimizar e
        // Exportar", já aprovado de ouvido. Não inventar outro valor.
        MixEngine.masterizarBuffer(buffer, -15);
        const blob = await MixEngine.bufferToMp3(buffer, 192);
        return { blob: blob, duracao: buffer.duration };
    }

    // Guarda o spot no Storage assim que ele fica pronto, ANTES de qualquer
    // decisão de enviar. O áudio nascia só na memória do navegador: fechar a
    // aba jogava fora o spot e o TTS já gasto nele.
    //
    // Falha aqui NUNCA interrompe — o produtor tem o áudio tocando na tela e o
    // botão de Download. Só avisa que a cópia de segurança não subiu.
    async function guardarRascunho() {
        if (!estado.mixBlob) return;
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
            const up = await fetch(u.upload_url, {
                method: 'PUT',
                headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
                body: fd
            });
            if (!up.ok) throw new Error('falha no envio pro Storage');

            avisar('💾 Spot guardado — some da tela, mas não do Storage.', 'ok');
            carregarRascunhos();
        } catch (e) {
            avisar('Não consegui guardar a cópia deste spot (' + e.message +
                   '). Use o Download pra não perder.', 'atencao');
        }
    }

    // Lista os spots já produzidos, pra achar o de ontem sem depender da aba
    // continuar aberta.
    async function carregarRascunhos() {
        const box = document.getElementById('listaRascunhos');
        if (!box) return;
        try {
            const r = await fetch('/api/gerador/rascunhos?limite=12');
            const d = await r.json();
            const itens = (d.rascunhos || []).filter(x => x.url);
            if (!itens.length) {
                box.innerHTML = '<div class="hint">Nada guardado ainda — o primeiro spot que você gerar aparece aqui.</div>';
                return;
            }
            box.innerHTML = itens.map(x => `
                <div class="rascunho-item">
                    <div class="rascunho-nome">
                        ${esc(x.titulo)}
                        <span class="hint ms-2">${esc(x.quando)}</span>
                    </div>
                    <audio controls preload="none" src="${esc(x.url)}"></audio>
                    <a class="btn btn-sm btn-outline-light" download="${esc(x.titulo)}.mp3"
                       href="${esc(x.url)}"><i class="fas fa-download"></i></a>
                </div>`).join('');
        } catch (e) {
            box.innerHTML = '<div class="hint">Não consegui carregar os spots guardados.</div>';
        }
    }

    function mostrarResultado(duracao) {
        document.getElementById('playerResultado').src = URL.createObjectURL(estado.mixBlob);
        document.getElementById('barraResultado').style.display = 'flex';
        const min = Math.floor(duracao / 60);
        const seg = Math.round(duracao % 60);
        const tipo = estado.mixBlob.type === 'audio/mpeg' ? 'MP3' : 'WAV';
        document.getElementById('resultadoInfo').textContent =
            `${min}:${String(seg).padStart(2, '0')} · ${tipo} · ` +
            (estado.trilha ? `trilha: ${estado.trilha.name}` : 'sem trilha');
    }

    // ── O pipeline ───────────────────────────────────────────────────────

    async function gerarAnuncio() {
        const btn = document.getElementById('btnGerar');
        btn.disabled = true;
        limparAvisos();
        document.getElementById('infoMix').style.display = 'none';
        const TOTAL = 6;

        try {
            // [1] ROTEIRO — falha aqui não interrompe: cai no briefing do cliente.
            passo(1, TOTAL, 'Escrevendo o roteiro...');
            const briefing = document.getElementById('textoComercial').value.trim()
                || (estado.pedido && estado.pedido.roteiro) || '';
            if (!briefing) throw new Error('Escolha um pedido ou escreva o briefing antes de gerar.');

            const rRot = await fetch('/api/gerador/roteiro', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    briefing: briefing,
                    plano: (estado.pedido && estado.pedido.plano) || 'outro',
                    tipo: (estado.pedido && estado.pedido.tipo) || '',
                    estilo_voz: (estado.pedido && estado.pedido.estilo_voz) || ''
                })
            });
            const dRot = await rRot.json();
            if (!dRot.success) throw new Error(dRot.error || 'Falha ao escrever o roteiro');
            estado.roteiro = dRot.roteiro;
            document.getElementById('textoComercial').value = estado.roteiro;
            atualizarContador();
            if (dRot.fonte === 'base') {
                // O motivo vem junto: sem ele não dá pra distinguir cota estourada
                // de resposta malformada, e os dois pedem reação diferente.
                avisar('⚙️ Roteiro veio do briefing do cliente — a IA não respondeu agora. Revise o texto.'
                       + (dRot.erro_ia ? ' (motivo: ' + dRot.erro_ia + ')' : ''), 'atencao');
            }

            // [2] VOZ — sem locução não há spot: o único passo que interrompe.
            passo(2, TOTAL, 'Gravando a locução...');
            estado.vozBuffer = await gerarVoz(estado.roteiro);

            // [3] TRILHA — falha aqui NÃO interrompe: locução seca é entregável.
            passo(3, TOTAL, 'Escolhendo a trilha...');
            estado.trilha = null;
            estado.trilhaBuffer = null;
            const escolha = document.getElementById('selectTrilha').value;
            try {
                if (escolha === 'nenhuma') {
                    avisar('Sem trilha, por escolha sua.', 'info');
                } else if (escolha === 'auto') {
                    const rTr = await fetch('/api/voxcraft/recommend-tracks', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ descricao: estado.roteiro })
                    });
                    const dTr = await rTr.json();
                    // ATENÇÃO: 'sem_trilhas' vem com success=true e sem tracks.
                    if (dTr.status === 'sem_trilhas') {
                        avisar('Biblioteca de trilhas vazia — seguindo com locução seca.', 'atencao');
                    } else if (dTr.success && dTr.tracks && dTr.tracks.length) {
                        estado.trilha = dTr.tracks[0];
                        // fonte 'base' = veio do acervo por ordem, não escolhida
                        // pela IA. O spot sai com trilha do mesmo jeito, mas o
                        // produtor precisa saber que a escolha não foi pensada.
                        if (dTr.fonte === 'base') {
                            avisar('⚙️ ' + (dTr.resumo || 'Trilha tirada do acervo, sem escolha da IA.')
                                   + ' Confira se combina com o spot.', 'atencao');
                        }
                    } else {
                        avisar('Não veio trilha nenhuma desta vez — seguindo com locução seca.', 'atencao');
                    }
                } else {
                    const rT = await fetch('/api/tracks');
                    const dT = await rT.json();
                    estado.trilha = (dT.tracks || []).find(t => String(t.id) === escolha) || null;
                }
                if (estado.trilha) estado.trilhaBuffer = await baixarEDecodificar(estado.trilha.file_url);
            } catch (e) {
                avisar('Não consegui carregar a trilha (' + e.message + ') — seguindo com locução seca.', 'atencao');
                estado.trilha = null;
                estado.trilhaBuffer = null;
            }

            // [4] RECEITA — falha cai na receita-base que o próprio endpoint devolve.
            passo(4, TOTAL, 'Definindo a mixagem...');
            const tracksInfo = [{ type: 'voice', name: 'locucao', duration: estado.vozBuffer.duration }];
            if (estado.trilhaBuffer) {
                tracksInfo.push({ type: 'music', name: estado.trilha.name, duration: estado.trilhaBuffer.duration });
            }
            try {
                const rRec = await fetch('/api/voxcraft/mix-recipe', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tracks: tracksInfo,
                        contexto: 'Roteiro da locução: ' + estado.roteiro.slice(0, 700)
                    })
                });
                estado.receita = await rRec.json();
            } catch (e) {
                estado.receita = null;
            }
            if (!estado.receita || !estado.receita.success) {
                // O endpoint caiu de vez. Não interrompe: montarTrack aplica os
                // defaults e o spot sai — só sem o ajuste fino da IA.
                avisar('Não consegui montar a receita — mixando com os valores padrão.', 'atencao');
                estado.receita = null;
            } else if (estado.receita.fonte === 'base') {
                avisar('⚙️ Mixagem com a receita padrão — a IA não respondeu agora.', 'atencao');
            }
            if (estado.receita && estado.receita.resumo) {
                const info = document.getElementById('infoMix');
                info.textContent = '🎚️ ' + estado.receita.resumo;
                info.style.display = 'block';
            }

            // [5] MIXAGEM
            passo(5, TOTAL, 'Mixando...');
            const r = await mixar((p, t) => passo(5, TOTAL, `Mixando... ${Math.round(p)}% ${t || ''}`));
            estado.mixBlob = r.blob;

            // [6] CHECAGEM — só avisa, nunca bloqueia.
            passo(6, TOTAL, 'Conferindo duração e frase legal...');
            try {
                const rQ = await fetch('/api/qualidade/checar', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roteiro: estado.roteiro,
                        plano: (estado.pedido && estado.pedido.plano) || 'outro',
                        duracao_segundos: r.duracao
                    })
                });
                const dQ = await rQ.json();
                (dQ.avisos || []).forEach(a => {
                    avisar((a.titulo || '') + (a.detalhe ? ': ' + a.detalhe : ''), a.nivel);
                });
            } catch (e) {
                avisar('Não deu pra rodar a checagem de qualidade — confira na mão.', 'atencao');
            }

            mostrarResultado(r.duracao);
            passo(0, TOTAL, '✅ Pronto — ouça antes de enviar.');
            guardarRascunho();   // copia de seguranca, sem travar a tela

        } catch (e) {
            passo(0, TOTAL, '❌ ' + e.message);
            // Não perde o TTS já gasto: se a voz existe, avisa que ela sobreviveu.
            if (estado.vozBuffer && !estado.mixBlob) {
                avisar('A locução chegou a ser gerada — só a mixagem falhou. Tente "Gerar anúncio" de novo.', 'atencao');
            }
        } finally {
            btn.disabled = false;
        }
    }

    // Regerar só a voz: reaproveita trilha e receita já escolhidas. Evita gastar
    // o pipeline inteiro quando o problema era só o texto.
    async function regerarVoz() {
        const btn = document.getElementById('btnRegerarVoz');
        btn.disabled = true;
        limparAvisos();
        try {
            estado.roteiro = document.getElementById('textoComercial').value.trim();
            if (!estado.roteiro) throw new Error('O texto está vazio.');

            passo(1, 2, 'Regravando a locução...');
            estado.vozBuffer = await gerarVoz(estado.roteiro);

            passo(2, 2, 'Remixando...');
            const r = await mixar(null);
            estado.mixBlob = r.blob;
            mostrarResultado(r.duracao);
            passo(0, 2, '✅ Locução trocada.');
            guardarRascunho();
        } catch (e) {
            passo(0, 2, '❌ ' + e.message);
        } finally {
            btn.disabled = false;
        }
    }

    function nomeArquivo() {
        const base = (document.getElementById('inputNome').value || 'spot').trim()
            .replace(/[^\w\-]+/g, '-') || 'spot';
        const ext = (estado.mixBlob && estado.mixBlob.type === 'audio/wav') ? '.wav' : '.mp3';
        return base + ext;
    }

    function exigeAudio() {
        if (!estado.mixBlob) {
            alert('Gere o anúncio primeiro.');
            return false;
        }
        return true;
    }

    function atualizarContador() {
        const ta = document.getElementById('textoComercial');
        document.getElementById('contadorChars').textContent =
            (5000 - ta.value.length) + ' caracteres restantes';
        const palavras = ta.value.trim().split(/\s+/).filter(Boolean).length;
        document.getElementById('tempoEstimado').textContent =
            palavras ? `~${(palavras / 2.5).toFixed(1)}s de locução` : '';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        document.getElementById('selectModo').addEventListener('change', aplicarFiltroDeVozes);

        await Promise.all([carregarPedidos(), carregarVozes(), carregarTrilhas()]);
        carregarRascunhos();

        document.getElementById('btnGerar').onclick = gerarAnuncio;
        document.getElementById('btnRegerarVoz').onclick = regerarVoz;

        document.getElementById('btnDownload').onclick = () => {
            if (!exigeAudio()) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(estado.mixBlob);
            a.download = nomeArquivo();
            a.click();
        };

        // Reusa o que já existe — não reimplementar o envio.
        document.getElementById('btnEnviar').onclick = () => {
            if (!exigeAudio()) return;
            window.enviarParaEntrega(estado.mixBlob, nomeArquivo());
        };

        // Escape hatch: ajuste fino manual na MiniDAW completa.
        //
        // Manda as faixas SEPARADAS (voz + trilha + receita), não o mix pronto.
        // Mix renderizado é arquivo achatado: não dá pra mexer no volume da
        // trilha, trocar efeito nem salvar projeto de verdade — e é exatamente
        // pra isso que se abre a MiniDAW.
        document.getElementById('btnAbrirMiniDAW').onclick = () => {
            if (!estado.vozBuffer) { alert('Gere o anúncio primeiro.'); return; }

            // A voz vai como WAV (é o AudioBuffer que temos em mãos); a trilha
            // vai como URL, porque o localStorage tem teto de ~5MB e trilha
            // inteira em base64 estoura fácil.
            const vozBlob = MixEngine.bufferToWav(estado.vozBuffer);
            const base = (document.getElementById('inputNome').value || 'spot').trim()
                .replace(/[^\w\-]+/g, '-') || 'spot';

            const fr = new FileReader();
            fr.onloadend = () => {
                try {
                    localStorage.setItem('minidaw_projeto_gerador', JSON.stringify({
                        voz: { base64: fr.result, nome: base + '-voz.wav' },
                        trilha: estado.trilha
                            ? { url: estado.trilha.file_url, nome: estado.trilha.name }
                            : null,
                        receita: estado.receita || null,
                        roteiro: (estado.roteiro || '').slice(0, 900)
                    }));
                    window.open('/minidaw', '_blank');
                } catch (e) {
                    // QuotaExceededError: locução longa demais pro localStorage.
                    alert('A locução ficou grande demais pra passar por aqui. '
                        + 'Use o Download e arraste o arquivo dentro da MiniDAW.');
                }
            };
            fr.readAsDataURL(vozBlob);
        };

        document.getElementById('textoComercial').addEventListener('input', atualizarContador);
        atualizarContador();
    });
})();
