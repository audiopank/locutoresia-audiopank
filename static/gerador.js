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

    // Espelho de backend/app.py — mudou la, muda aqui.
    //
    // O Gemini nao tem um ritmo, tem uma FAIXA: 4 takes do mesmo roteiro em
    // 03/09/2026 deram 2,57 / 2,40 / 2,31 / 2,16 pal/s. Por isso a tela mostra
    // um INTERVALO, e nao um numero unico que seria mentira metade das vezes —
    // foi exatamente assim que um "~43,2s" virou um arquivo de 49,9s.
    // A cauda e o fade da trilha que toda mixagem acrescenta depois da ultima
    // palavra: o que se mostra e o ARQUIVO, que e o que a emissora recebe e a
    // checagem mede.
    const RITMO_RAPIDO = 2.55;
    const RITMO_LENTO = 2.15;
    const CAUDA_TRILHA = 3.05;

    const estado = {
        pedido: null,       // pedido escolhido
        pedidos: [],        // lista carregada
        vozes: [],          // catálogo de vozes (tem provider)
        roteiro: '',        // roteiro em uso
        vozBuffer: null,    // AudioBuffer da locução
        trilha: null,       // {name, file_url, ...}
        trilhaBuffer: null,
        receita: null,      // resposta do mix-recipe
        mixBlob: null,      // resultado final
        trilhaCliente: null // trilha subida NESTA aba: {id, name, file_url, buffer}
    };

    // Valor do select quando a trilha do cliente decodificou mas NÃO ficou
    // guardada (Storage/catálogo falhou): vive só nesta aba, sem file_url.
    const TRILHA_LOCAL = 'local';

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
            // O plano VENDIDO manda na grade de duração: plano sem grade
            // (jingle etc.) cai em "Livre" — não inventar alvo não comprado.
            const selPlano = document.getElementById('selectPlano');
            const plano = String(estado.pedido.plano || '');
            selPlano.value = selPlano.querySelector('option[value="' + plano + '"]') ? plano : 'outro';
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
    // O sexo no rótulo é o guia de escalação do diálogo: foi de ouvido que se
    // descobriu o catálogo com sexo trocado (Leo saiu com voz feminina).
    function rotuloVoz(v) {
        const sexo = v.gender === 'female' ? ' ♀' : v.gender === 'male' ? ' ♂' : '';
        return esc(v.name) + sexo;
    }

    function aplicarFiltroDeVozes() {
        const modo = document.getElementById('selectModo').value;
        const alvo = modo === 'expressivo' ? 'elevenlabs' : 'gemini';
        const sel = document.getElementById('selectVoz');
        const filtradas = estado.vozes.filter(v => v.provider === alvo);

        if (!filtradas.length) {
            sel.innerHTML = '<option value="">— nenhuma voz deste modo —</option>';
        } else {
            sel.innerHTML = filtradas.map((v, i) =>
                `<option value="${esc(v.id)}"${i === 0 ? ' selected' : ''}>${rotuloVoz(v)}</option>`
            ).join('');
        }

        // Voz 2 (diálogo) é SEMPRE do Gemini — o multi-speaker é dele. Começa
        // na segunda voz da lista pro diálogo não nascer com voz repetida.
        const sel2 = document.getElementById('selectVoz2');
        const gemini = estado.vozes.filter(v => v.provider === 'gemini');
        sel2.innerHTML = gemini.length
            ? gemini.map((v, i) =>
                `<option value="${esc(v.id)}"${i === Math.min(1, gemini.length - 1) ? ' selected' : ''}>${rotuloVoz(v)}</option>`
              ).join('')
            : '<option value="">— catálogo de vozes vazio —</option>';
    }

    function formatoAtual() {
        const v = document.getElementById('selectFormato').value;
        return (v === 'dialogo' || v === 'narracao') ? v : 'unico';
    }

    // Os dois formatos de 2 vozes usam o MESMO motor multi-speaker; muda só
    // como o texto chega nele (rótulos do roteiro x revezamento por parágrafo).
    function duasVozes() {
        return formatoAtual() !== 'unico';
    }

    // Provider real da voz selecionada. 'gemini' vira 'google' porque é isso
    // que o /api/generate-audio espera (ele mesmo faz esse de-para).
    function providerDaVoz() {
        const id = document.getElementById('selectVoz').value;
        const v = estado.vozes.find(x => String(x.id) === id);
        const prov = v ? v.provider : 'gemini';
        return prov === 'gemini' ? 'google' : prov;
    }

    async function carregarTrilhas(selecionarId) {
        const sel = document.getElementById('selectTrilha');
        let lista = [];
        try {
            const r = await fetch('/api/tracks');
            const d = await r.json();
            lista = d.tracks || [];
        } catch (e) { /* segue sem catálogo: dá pra usar 'auto' ou 'nenhuma' */ }

        // Trilhas de clientes ficam num grupo próprio: o produtor acha o jingle
        // do cliente na hora, e ninguém confunde acervo com material de cliente.
        const doCliente = lista.filter(t => t.genre === 'trilha_cliente');
        const doAcervo = lista.filter(t => t.genre !== 'trilha_cliente');
        const opt = t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;

        sel.innerHTML =
            '<option value="auto" selected>Deixar a IA escolher</option>' +
            '<option value="nenhuma">Sem trilha (locução seca)</option>' +
            '<option value="upload">📤 Subir trilha do cliente...</option>' +
            (doAcervo.length
                ? `<optgroup label="Acervo">${doAcervo.map(opt).join('')}</optgroup>` : '') +
            (doCliente.length
                ? `<optgroup label="Trilhas de clientes">${doCliente.map(opt).join('')}</optgroup>` : '');

        // Depois de um upload, o catálogo recarrega e a trilha nova já fica ativa.
        if (selecionarId != null) sel.value = String(selecionarId);
    }

    // ── Trilha do cliente (upload) ───────────────────────────────────────

    // Sobe o arquivo pro Storage (signed URL — o corpo NÃO passa pela função
    // da Vercel, que rejeita >4.5MB) e cataloga na music_tracks com
    // genre='trilha_cliente'. Esse marcador é o que esconde a trilha da IA do
    // "Deixar a IA escolher" (recommend-tracks filtra): jingle do cliente A
    // jamais no anúncio do cliente B. O buffer já vem decodificado de fora.
    async function subirTrilhaCliente(file, nome, buffer) {
        const ru = await fetch('/api/tracks/upload-url', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name || (nome + '.mp3') })
        });
        const u = await ru.json();
        if (!u.success) throw new Error(u.error || 'sem URL de upload');

        const fd = new FormData();
        fd.append('file', file, file.name || nome);
        const up = await fetch(u.upload_url, {
            method: 'PUT',
            headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
            body: fd
        });
        if (!up.ok) throw new Error('falha no envio pro Storage');

        const rm = await fetch('/api/tracks/upload-metadata', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nome,
                genre: 'trilha_cliente',
                mood: 'cliente',
                description: 'Trilha enviada pelo cliente',
                duration: Math.round(buffer.duration),
                file_url: u.public_url,
                file_size: file.size,
                mime_type: file.type || 'audio/mpeg'
            })
        });
        const m = await rm.json();
        if (!m.success || !m.track) throw new Error(m.error || 'falha ao catalogar a trilha');

        return { id: m.track.id, name: nome, file_url: u.public_url, buffer: buffer };
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

    // ── Checagem de duracao e frase legal ────────────────────────────────
    // Vive fora do fluxo principal porque "Regerar so a voz" TAMBEM precisa
    // dela: a locucao nova quase nunca tem a duracao da anterior. Sem isto um
    // spot de 48s passava calado numa grade vendida de 30-45s (achado no teste
    // real de 03/09, logo depois de regerar a voz). So avisa, nunca bloqueia.
    async function checarQualidade(duracaoSegundos) {
        try {
            const rQ = await fetch('/api/qualidade/checar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roteiro: estado.roteiro,
                    // Mesma fonte do roteiro: confere contra a MESMA grade que
                    // a IA recebeu como alvo.
                    plano: document.getElementById('selectPlano').value,
                    duracao_segundos: duracaoSegundos
                })
            });
            const dQ = await rQ.json();
            (dQ.avisos || []).forEach(a => {
                avisar((a.titulo || '') + (a.detalhe ? ': ' + a.detalhe : ''), a.nivel);
            });
        } catch (e) {
            avisar('Não deu pra rodar a checagem de qualidade — confira na mão.', 'atencao');
        }
    }

    // ── Direcao de locucao ───────────────────────────────────────────────
    // A instrucao do produtor ("fale rindo, cresca na assinatura") vai COLADA
    // no texto so na hora de locutar. Nunca entra em estado.roteiro: se
    // entrasse, a IA do roteiro a reescreveria, a checagem de duracao a
    // contaria como fala e ela apareceria no texto entregue ao cliente.
    // O Gemini so obedece ordem entre colchetes — o colchete entra aqui.
    function comDirecao(texto) {
        const el = document.getElementById('direcaoLocucao');
        let d = (el ? el.value : '').trim();
        if (!d) return texto;
        // Uma linha so: o backend le a PRIMEIRA linha como a ordem de tom.
        d = d.split('\n').join(' ').split(String.fromCharCode(13)).join(' ').trim();
        while (d.startsWith('[')) d = d.slice(1).trim();
        while (d.endsWith(']')) d = d.slice(0, -1).trim();
        if (!d) return texto;
        if ((texto || '').trimStart().startsWith('[')) {
            avisar('O roteiro ja comeca com uma direcao entre colchetes — mantive a do texto e ignorei o campo Direcao de locucao.', 'atencao');
            return texto;
        }
        if (providerDaVoz() !== 'google') {
            avisar('A "Direcao de locucao" so vale no Modo Padrao (Google) — no Expressivo ela e ignorada.', 'atencao');
            return texto;
        }
        return '[' + d + ']' + '\n' + texto;
    }
    async function gerarVoz(texto) {
        const r = await fetch('/api/generate-audio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: comDirecao(texto),
                voice: document.getElementById('selectVoz').value,
                api: providerDaVoz(),
                // Estilo = interpretação (o "Pacing/Smile in voice" que faltava
                // aqui e já existia no Studio). No Gemini vira instrução de tom
                // no prompt; no edge/eleven, parâmetros do provider.
                style: document.getElementById('selectEstilo').value,
                language: 'pt-BR',
                // Os dois formatos de 2 vozes entram pelo mesmo caminho
                // (dialogo=true); `modo_dialogo` diz ao backend se os
                // personagens vêm do texto ou se ele reveza por parágrafo.
                // No formato único, os campos nem vão.
                dialogo: duasVozes(),
                modo_dialogo: duasVozes() ? formatoAtual() : undefined,
                voice2: duasVozes()
                    ? document.getElementById('selectVoz2').value : undefined
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
            duration: estado.vozBuffer.duration + 3.05,   // mesma folga do motor
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
                    <button class="btn btn-sm btn-outline-danger" data-excluir="${esc(x.path)}"
                            title="Excluir esta versão"><i class="fas fa-trash"></i></button>
                </div>`).join('');

            // Versão errada na lista é risco de mandar o arquivo trocado pro
            // cliente — daí o botão. Some do Storage de verdade, sem volta.
            box.querySelectorAll('[data-excluir]').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('Excluir esta versão do spot? Não dá pra desfazer.')) return;
                    btn.disabled = true;
                    try {
                        const rd = await fetch('/api/gerador/rascunhos', {
                            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: btn.dataset.excluir })
                        });
                        const dd = await rd.json();
                        if (!dd.success) throw new Error(dd.error || 'falha ao excluir');
                        carregarRascunhos();
                    } catch (e) {
                        btn.disabled = false;
                        alert('Não consegui excluir: ' + e.message);
                    }
                };
            });
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
            // Diálogo só existe no Gemini (multi-speaker): barrar ANTES de
            // gastar roteiro/TTS. O backend valida de novo (fonte da verdade).
            if (duasVozes() && providerDaVoz() !== 'google') {
                avisar('Os formatos de 2 vozes por enquanto são só no Modo Padrão (Google). Troque o Modo ou o Formato.', 'atencao');
                throw new Error('2 vozes é só no Modo Padrão por enquanto.');
            }

            // [1] ROTEIRO — falha aqui não interrompe: cai no briefing do cliente.
            passo(1, TOTAL, 'Escrevendo o roteiro...');
            const briefing = document.getElementById('textoComercial').value.trim()
                || (estado.pedido && estado.pedido.roteiro) || '';
            if (!briefing) throw new Error('Escolha um pedido ou escreva o briefing antes de gerar.');

            if (document.getElementById('checkTextoPronto').checked) {
                // Roteiro aprovado pelo cliente é sagrado: locuta como está,
                // sem IA no meio. A checagem de duração do passo [6] segue
                // valendo — avisar que estourou a grade continua sendo dever.
                estado.roteiro = briefing;
                avisar('📝 Texto do cliente usado como está — a IA não mexeu em nada.', 'info');
            } else {
                const rRot = await fetch('/api/gerador/roteiro', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        briefing: briefing,
                        // O select é a fonte do plano: ele já foi sincronizado com o
                        // pedido (quando há um) e cobre o briefing escrito na mão.
                        plano: document.getElementById('selectPlano').value,
                        formato: formatoAtual(),
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
            }

            // [2] VOZ — sem locução não há spot: o único passo que interrompe.
            passo(2, TOTAL, 'Gravando a locução...');
            if (formatoAtual() === 'dialogo') {
                // A escalação é decisão do produtor — a IA não escolhe voz.
                // Mostrar o mapa personagem→voz na cara pega sexo trocado
                // ANTES de ouvir (pedido do produtor no primeiro teste real,
                // quando o Leo saiu com voz feminina).
                const nomes = [];
                const re = /^[ \t]*([^:\n]{1,30}):[ \t]+\S/gm;
                let m;
                while ((m = re.exec(estado.roteiro)) !== null) {
                    const n = m[1].trim();
                    if (n && !nomes.includes(n)) nomes.push(n);
                }
                const txt = sel => sel.options[sel.selectedIndex]
                    ? sel.options[sel.selectedIndex].text : '?';
                if (nomes.length >= 2) {
                    avisar('🎭 Escalação: ' + nomes[0] + ' → ' + txt(document.getElementById('selectVoz'))
                           + '  |  ' + nomes[1] + ' → ' + txt(document.getElementById('selectVoz2'))
                           + '. Sexo trocado? Ajuste as vozes e clique "Regerar só a voz".', 'info');
                }
            } else if (formatoAtual() === 'narracao') {
                const txt = sel => sel.options[sel.selectedIndex]
                    ? sel.options[sel.selectedIndex].text : '?';
                avisar('🎙️ Narração revezada: as vozes ' + txt(document.getElementById('selectVoz'))
                       + ' e ' + txt(document.getElementById('selectVoz2'))
                       + ' se alternam a cada parágrafo. Sem personagens no texto.', 'info');
            }
            estado.vozBuffer = await gerarVoz(estado.roteiro);

            // [3] TRILHA — falha aqui NÃO interrompe: locução seca é entregável.
            passo(3, TOTAL, 'Escolhendo a trilha...');
            estado.trilha = null;
            estado.trilhaBuffer = null;
            const escolha = document.getElementById('selectTrilha').value;
            try {
                if (escolha === 'nenhuma') {
                    avisar('Sem trilha, por escolha sua.', 'info');
                } else if (escolha === 'upload') {
                    // Abriu o seletor de arquivo mas nenhum upload se concluiu.
                    avisar('Nenhuma trilha foi subida — seguindo com locução seca. Suba o arquivo antes de gerar.', 'atencao');
                } else if (estado.trilhaCliente && String(estado.trilhaCliente.id) === escolha) {
                    // Trilha do cliente subida NESTA aba: o buffer já está em
                    // mãos — não baixa de volta do Storage. Cobre também a
                    // TRILHA_LOCAL (upload falhou, buffer só na memória).
                    estado.trilha = {
                        id: estado.trilhaCliente.id,
                        name: estado.trilhaCliente.name,
                        file_url: estado.trilhaCliente.file_url
                    };
                    estado.trilhaBuffer = estado.trilhaCliente.buffer;
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
                if (estado.trilha && !estado.trilhaBuffer) {
                    estado.trilhaBuffer = await baixarEDecodificar(estado.trilha.file_url);
                }
                // Jingle de cliente em spot de OUTRO cliente é desastre de
                // marca. A IA já é cega a essas trilhas; a seleção manual é
                // livre de propósito (o produtor é o guardião) — mas ganha um
                // lembrete na cara toda vez (pedido do produtor no teste real).
                if (estado.trilha && (estado.trilha.genre === 'trilha_cliente'
                        || (estado.trilhaCliente && String(estado.trilhaCliente.id) === escolha))) {
                    avisar('⚠️ "' + estado.trilha.name + '" é trilha de CLIENTE — use só em spots pedidos por esse cliente.', 'atencao');
                }
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
            await checarQualidade(r.duracao);

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
            await checarQualidade(r.duracao);
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
        // No diálogo, os rótulos "Nome:" não são falados — descontar da
        // estimativa (espelho do texto_falado_do_dialogo do backend; sem
        // isto a tela inflava ~4s num spot de 30s e furava a grade).
        const texto = formatoAtual() === 'dialogo'
            ? ta.value.replace(/^\s*[^:\n]{1,30}:[ \t]+/gm, '')
            : ta.value;
        const palavras = texto.trim().split(/\s+/).filter(Boolean).length;
        document.getElementById('tempoEstimado').textContent =
            palavras
                ? `~${(palavras / RITMO_RAPIDO + CAUDA_TRILHA).toFixed(0)} a ${(palavras / RITMO_LENTO + CAUDA_TRILHA).toFixed(0)}s de spot (arquivo)`
                : '';
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

        // Spot no FEED da NewPost-IA — a conta do seletor assina; sempre por
        // clique consciente (feed é PÚBLICO). Vai o mix final SEM carimbo:
        // aqui é vitrine da produtora, não prévia de cliente.
        document.getElementById('btnPublicarFeed').onclick = async () => {
            if (!exigeAudio()) return;
            const conta = document.getElementById('selectContaFeed').value;
            const rotulos = { locutores: 'LOCUTORES IA', principal: 'NewPost-IA ✓', futuro: 'Futuro em Pauta', vida: 'Vida Saudável' };
            if (!confirm(`Publicar este spot no FEED PÚBLICO da NewPost-IA assinando como ${rotulos[conta]}?`)) return;
            const btn = document.getElementById('btnPublicarFeed');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Publicando...';
            try {
                const b64 = await new Promise((res, rej) => {
                    const fr = new FileReader();
                    fr.onloadend = () => res(fr.result);
                    fr.onerror = () => rej(new Error('falha ao ler o áudio'));
                    fr.readAsDataURL(estado.mixBlob);
                });
                const resp = await fetch('/api/gerador/publicar-feed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conta,
                        nome: (document.getElementById('inputNome').value || 'Spot').trim(),
                        texto: document.getElementById('textoComercial').value || '',
                        audio_base64: b64
                    })
                });
                const d = await resp.json();
                if (d.success) {
                    alert(`📡 Spot no ar no feed da NewPost-IA, assinado por ${rotulos[conta]}!\nConfira em www.newpostia.app`);
                } else {
                    alert('O feed recusou: ' + (d.error || 'falha desconhecida'));
                }
            } catch (e) {
                alert('Erro ao publicar no feed: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-broadcast-tower me-1"></i>Feed';
            }
        };

        // Escape hatch: ajuste fino manual na MiniDAW completa.
        //
        // Manda as faixas SEPARADAS (voz + trilha + receita), não o mix pronto.
        // Mix renderizado é arquivo achatado: não dá pra mexer no volume da
        // trilha, trocar efeito nem salvar projeto de verdade — e é exatamente
        // pra isso que se abre a MiniDAW.
        document.getElementById('btnAbrirMiniDAW').onclick = async () => {
            if (!estado.vozBuffer) { alert('Gere o anúncio primeiro.'); return; }

            // A aba abre JÁ, dentro do gesto do clique: codificar o MP3 de uma
            // locução longa passa dos ~5s de ativação que o Chrome exige pro
            // window.open — depois disso o popup é bloqueado em silêncio.
            const aba = window.open('about:blank', '_blank');

            // A voz vai como MP3 192kbps (mesmo encoder do arquivo final): em
            // WAV cru, locução a partir de ~40s estourava o teto de ~5MB do
            // localStorage e o produtor caía no aviso de "grande demais". A
            // trilha segue como URL pelo mesmo motivo de tamanho.
            const vozBlob = await MixEngine.bufferToMp3(estado.vozBuffer, 192);
            const base = (document.getElementById('inputNome').value || 'spot').trim()
                .replace(/[^\w\-]+/g, '-') || 'spot';

            const fr = new FileReader();
            fr.onloadend = () => {
                try {
                    localStorage.setItem('minidaw_projeto_gerador', JSON.stringify({
                        voz: { base64: fr.result, nome: base + '-voz.mp3' },
                        // Trilha local (upload que falhou) não tem URL — mandar
                        // url:null faria a MiniDAW tentar baixar 'null'.
                        trilha: (estado.trilha && estado.trilha.file_url)
                            ? { url: estado.trilha.file_url, nome: estado.trilha.name }
                            : null,
                        receita: estado.receita || null,
                        roteiro: (estado.roteiro || '').slice(0, 900)
                    }));
                    if (aba) { aba.location = '/minidaw'; } else { window.open('/minidaw', '_blank'); }
                } catch (e) {
                    if (aba) aba.close();
                    // QuotaExceededError: locução longa demais pro localStorage.
                    alert('A locução ficou grande demais pra passar por aqui. '
                        + 'Use o Download e arraste o arquivo dentro da MiniDAW.');
                }
            };
            fr.readAsDataURL(vozBlob);
        };

        // ── Upload de trilha do cliente ──────────────────────────────────
        const selTrilha = document.getElementById('selectTrilha');
        const inputTrilha = document.getElementById('inputTrilhaCliente');
        let trilhaAnterior = selTrilha.value;   // pra voltar se cancelar o seletor

        selTrilha.addEventListener('change', () => {
            if (selTrilha.value !== 'upload') { trilhaAnterior = selTrilha.value; return; }
            inputTrilha.value = '';   // permite escolher o MESMO arquivo de novo
            inputTrilha.click();
        });

        // Chrome dispara 'cancel' (não 'change') quando o produtor fecha o
        // seletor sem escolher arquivo. Sem isto, o select ficava travado em
        // "upload" e re-selecionar a opção não reabria o diálogo.
        inputTrilha.addEventListener('cancel', () => {
            selTrilha.value = trilhaAnterior;
        });

        inputTrilha.addEventListener('change', async () => {
            const file = inputTrilha.files && inputTrilha.files[0];
            // Cinto de segurança pra navegador que dispare 'change' vazio.
            if (!file) { selTrilha.value = trilhaAnterior; return; }

            // Decodifica ANTES de subir: áudio que não toca não vai pro Storage.
            let buffer;
            try {
                buffer = await ctx.decodeAudioData(await file.arrayBuffer());
            } catch (e) {
                avisar('Não consegui ler esse áudio — confira se o arquivo toca no seu computador. Prefira MP3 ou WAV.', 'atencao');
                selTrilha.value = trilhaAnterior;
                return;
            }

            if (file.size > 25 * 1024 * 1024) {
                avisar('Arquivo grande (' + Math.round(file.size / 1024 / 1024)
                       + 'MB) — funciona, mas em MP3 pesaria bem menos e soaria igual no spot.', 'atencao');
            }

            const sugestao = (file.name || 'trilha-do-cliente').replace(/\.[^.]+$/, '');
            const nome = ((window.prompt(
                'Nome da trilha (inclua o cliente, ex.: "Jingle Padaria do Zé"):',
                sugestao) || sugestao).trim()) || sugestao;

            avisar('⬆️ Subindo "' + nome + '" pro Storage...', 'info');
            try {
                estado.trilhaCliente = await subirTrilhaCliente(file, nome, buffer);
                await carregarTrilhas(estado.trilhaCliente.id);
                if (selTrilha.selectedIndex === -1) {
                    // O recarregamento do catálogo falhou (rede): sem isto o
                    // select ficaria em branco e a trilha recém-subida seria
                    // ignorada em silêncio. O buffer está em mãos de qualquer
                    // jeito — garante uma opção visível apontando pra ela.
                    const o = document.createElement('option');
                    o.value = String(estado.trilhaCliente.id);
                    o.textContent = estado.trilhaCliente.name;
                    selTrilha.appendChild(o);
                    selTrilha.value = String(estado.trilhaCliente.id);
                }
                trilhaAnterior = String(estado.trilhaCliente.id);
                avisar('✅ Trilha "' + nome + '" guardada e selecionada. Pode gerar o anúncio.', 'ok');
            } catch (e) {
                // O áudio decodificou mas não ficou guardado: o spot da VEZ ainda
                // sai com ele — só não existe amanhã nem no "Abrir na MiniDAW".
                estado.trilhaCliente = { id: TRILHA_LOCAL, name: nome, file_url: null, buffer: buffer };
                let o = selTrilha.querySelector('option[value="' + TRILHA_LOCAL + '"]');
                if (!o) {
                    o = document.createElement('option');
                    o.value = TRILHA_LOCAL;
                    selTrilha.appendChild(o);
                }
                o.textContent = '⚠️ ' + nome + ' (só nesta aba)';
                selTrilha.value = TRILHA_LOCAL;
                trilhaAnterior = TRILHA_LOCAL;
                avisar('⚠️ A trilha NÃO ficou guardada (' + e.message + '). Dá pra gerar o spot '
                       + 'agora mesmo assim, mas ela some ao fechar a aba e não vai junto '
                       + 'no "Abrir na MiniDAW".', 'atencao');
            }
        });

        // ── Formato: único / diálogo com personagens / narração revezada ──
        const selFormato = document.getElementById('selectFormato');
        const sincronizarFormato = () => {
            // Voz 2 aparece nos DOIS formatos de 2 vozes.
            document.getElementById('grupoVoz2').style.display =
                duasVozes() ? '' : 'none';
            atualizarContador();   // a estimativa desconta rótulos no diálogo
        };
        selFormato.addEventListener('change', sincronizarFormato);
        sincronizarFormato();   // navegador pode restaurar o select num reload

        document.getElementById('textoComercial').addEventListener('input', atualizarContador);
        atualizarContador();
    });
})();
