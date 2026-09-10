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
        trilhaCliente: null, // trilha subida NESTA aba: {id, name, file_url, buffer}
        roteiroMontado: false, // programa: o texto do comercial veio do "Montar roteiro"
        rascunhoMeta: null,    // spot reaberto dos guardados: {nome, conta, episodio, ...}
        duracaoMix: 0          // duração do último mix (vai no .txt gêmeo do rascunho)
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
                r.effects || {},
                // Gate de respiração (mesmo silenciador da MiniDAW). Entra DEPOIS
                // da receita de propósito: a chave da tela manda, não a IA — e a
                // receita nem conhece 'gate'. Só na voz; trilha não respira.
                { gate: tipo === 'voice' && gateLigado() }
            )
        };
    }

    function gateLigado() {
        const chk = document.getElementById('chkGate');
        return chk ? chk.checked : true;
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
    function slugAscii(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    }

    // Tudo que a bancada tem além do texto. É o que faz um spot guardado virar
    // "preset do cliente": mês que vem, reabrir, trocar o texto, gerar — sem
    // redescobrir a voz que ficou boa (pedido do produtor, 10/09/2026, Crato).
    function metaDaBancada(extra) {
        const g = id => { const el = document.getElementById(id); return el ? (el.value || '') : ''; };
        const txt = id => {
            const el = document.getElementById(id);
            return (el && el.options && el.selectedIndex >= 0) ? el.options[el.selectedIndex].text : '';
        };
        const prog = programaAtual();
        const selTrilha = g('selectTrilha');
        return Object.assign({
            v: 2,
            nome: g('inputNome').trim(),
            conta: g('selectContaFeed'),
            programa: prog ? prog.id : null,
            episodio: prog ? (parseInt(g('inputEpisodio'), 10) || null) : null,
            tema: prog ? g('inputTema').trim() : '',
            patrocinador: prog ? g('inputPatrocinador').trim() : '',
            miolo: prog ? g('textoMiolo').trim() : '',
            formato: g('selectFormato'), modo: g('selectModo'),
            voz: g('selectVoz'), voz_nome: txt('selectVoz'),
            voz2: duasVozes() ? g('selectVoz2') : null,
            estilo: g('selectEstilo'), direcao: g('direcaoLocucao').trim(),
            plano: g('selectPlano'),
            trilha_sel: selTrilha,
            trilha: estado.trilha ? estado.trilha.name
                : (['auto', 'nenhuma', 'upload', ''].includes(selTrilha) ? null : txt('selectTrilha')),
            gate: !!(document.getElementById('chkGate') || {}).checked,
            texto_pronto: !!(document.getElementById('checkTextoPronto') || {}).checked,
            pedido: g('selectPedido') || null,
            gerado_em: new Date().toISOString()
        }, extra || {});
    }

    // Guarda texto + ajustes SEM gerar áudio. Vira um item de texto nos Spots
    // guardados, com o mesmo Reabrir dos spots.
    async function guardarBancada() {
        const btn = document.getElementById('btnGuardarBancada');
        const sugestao = (document.getElementById('inputNome').value || '').trim() || 'bancada';
        const nome = (window.prompt('Nome pra guardar esta bancada (texto + voz, estilo, direção, plano, trilha):', sugestao) || '').trim();
        if (!nome) return;
        if (btn) btn.disabled = true;
        try {
            const meta = metaDaBancada({ tipo: 'bancada' });
            if (!meta.nome) meta.nome = nome;
            const corpo = JSON.stringify(meta) + '\n\n' + (document.getElementById('textoComercial').value || '');
            const ru = await fetch('/api/client-deliveries/upload-url', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: (slugAscii(nome) || 'bancada') + '.txt', kind: 'rascunho' })
            });
            const u = await ru.json();
            if (!u.success) throw new Error(u.error || 'sem URL de upload');
            const fd = new FormData();
            fd.append('file', new Blob([corpo], { type: 'text/plain' }), 'bancada.txt');
            const up = await fetch(u.upload_url, {
                method: 'PUT', headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` }, body: fd
            });
            if (!up.ok) throw new Error('falha no envio pro Storage');
            avisar(`💾 Bancada "${nome}" guardada (texto + ajustes, sem áudio). Está nos Spots guardados, com Reabrir.`, 'ok');
            carregarRascunhos();
        } catch (e) {
            avisar('Não consegui guardar a bancada: ' + e.message, 'atencao');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // Devolve à bancada os ajustes guardados no .txt (v2). Voz e trilha por
    // id, com aviso quando o catálogo carregado não tem mais; tudo guardado.
    async function aplicarBancada(meta) {
        if (!meta || typeof meta !== 'object') return;
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
        const selProg = document.getElementById('selectPrograma');
        if (meta.programa && selProg) {
            selProg.value = meta.programa;
            await aplicarPrograma();
            set('inputTema', meta.tema);
            if (meta.episodio) set('inputEpisodio', meta.episodio);
            set('inputPatrocinador', meta.patrocinador);
            set('textoMiolo', meta.miolo);
            atualizarContadorMiolo();
        } else if (selProg && meta.v >= 2) {
            selProg.value = '';
            const campos = document.getElementById('camposPrograma');
            if (campos) campos.style.display = 'none';
        }
        if (meta.formato) {
            set('selectFormato', meta.formato);
            document.getElementById('selectFormato').dispatchEvent(new Event('change'));
        }
        if (meta.modo) { set('selectModo', meta.modo); aplicarFiltroDeVozes(); }
        if (meta.voz) {
            const sv = document.getElementById('selectVoz');
            sv.value = meta.voz;
            if (sv.value !== meta.voz) {
                const nomeVoz = String(meta.voz_nome || '').replace(/\s*[♀♂]\s*$/, '');
                if (!(nomeVoz && selecionarVozPorNome(nomeVoz))) {
                    avisar(`A voz guardada (${meta.voz_nome || meta.voz}) não está no catálogo — escolha na mão.`, 'atencao');
                }
            }
        }
        if (meta.voz2 && duasVozes()) set('selectVoz2', meta.voz2);
        if (meta.estilo) set('selectEstilo', meta.estilo);
        if (meta.direcao != null) document.getElementById('direcaoLocucao').value = meta.direcao;
        if (meta.plano) set('selectPlano', meta.plano);
        if (meta.trilha_sel) {
            const st = document.getElementById('selectTrilha');
            st.value = meta.trilha_sel;
            if (st.value !== meta.trilha_sel) {
                avisar(`A trilha guardada (${meta.trilha || meta.trilha_sel}) não está no catálogo — escolha na mão.`, 'atencao');
            }
        }
        if (meta.gate != null) document.getElementById('chkGate').checked = !!meta.gate;
        if (meta.texto_pronto != null) document.getElementById('checkTextoPronto').checked = !!meta.texto_pronto;
        if (meta.conta) set('selectContaFeed', meta.conta);
    }

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

            // O roteiro e o "quem/qual episódio" vão num .txt de mesmo nome:
            // é o que deixa "Reabrir" publicar amanhã o que foi gerado hoje
            // (um episódio por dia, às 10h — regra do produtor). Só o áudio
            // não bastava: o texto do post e a conta se perdiam com a aba.
            // Melhor esforço: falhar aqui não desfaz o áudio guardado.
            try {
                const meta = metaDaBancada({ duracao: Math.round((estado.duracaoMix || 0) * 10) / 10 });
                const corpo = JSON.stringify(meta) + '\n\n' + (estado.roteiro || document.getElementById('textoComercial').value || '');
                const rt = await fetch('/api/client-deliveries/upload-url', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: nome.replace(/\.(mp3|wav)$/i, '') + '.txt', kind: 'rascunho', twin_of: u.path })
                });
                const ut = await rt.json();
                if (!ut.success) throw new Error(ut.error || 'sem URL pro roteiro');
                const fdt = new FormData();
                fdt.append('file', new Blob([corpo], { type: 'text/plain' }), 'roteiro.txt');
                const upt = await fetch(ut.upload_url, {
                    method: 'PUT', headers: { 'apikey': ut.apikey, 'Authorization': `Bearer ${ut.apikey}` }, body: fdt
                });
                if (!upt.ok) throw new Error('falha ao guardar o roteiro');
            } catch (e) {
                avisar('O áudio ficou guardado, mas o roteiro não (' + e.message + '): ao reabrir, cole o texto na mão.', 'atencao');
            }

            avisar('💾 Spot guardado — some da tela, mas não do Storage.', 'ok');
            carregarRascunhos();
        } catch (e) {
            avisar('Não consegui guardar a cópia deste spot (' + e.message +
                   '). Use o Download pra não perder.', 'atencao');
        }
    }

    // Lista os spots já produzidos, pra achar o de ontem sem depender da aba
    // continuar aberta.
    // Traz um spot guardado de volta pra bancada: áudio no player (Feed,
    // Enviar, Download funcionam), roteiro no texto, nome e conta do .txt
    // gêmeo. Não restaura voz/trilha separadas — pra isso é gerar de novo.
    // Traz um item guardado de volta pra bancada. Com áudio: player (Feed,
    // Enviar, Download funcionam). Com ou sem áudio: roteiro, nome, conta e —
    // desde o .txt v2 — voz, estilo, direção, plano, trilha e gate.
    async function reabrirRascunho(x) {
        limparAvisos();
        passo(0, 0, `Reabrindo "${x.titulo}"...`);
        try {
            let meta = null;
            let roteiro = '';
            if (x.texto_url) {
                try {
                    const rt = await fetch(x.texto_url);
                    if (rt.ok) {
                        const txt = await rt.text();
                        const quebra = txt.indexOf('\n');
                        try { meta = JSON.parse(quebra >= 0 ? txt.slice(0, quebra) : txt); } catch (e) { meta = null; }
                        roteiro = quebra >= 0 ? txt.slice(quebra).trim() : '';
                    }
                } catch (e) { meta = null; }
            }

            const temAudio = !!x.url;
            let bytes = null;
            if (temAudio) {
                const ra = await fetch(x.url);
                if (!ra.ok) throw new Error('não consegui baixar o áudio guardado');
                bytes = await ra.arrayBuffer();
                const ehWav = /\.wav$/i.test(x.arquivo || '');
                estado.mixBlob = new Blob([bytes], { type: ehWav ? 'audio/wav' : 'audio/mpeg' });
                estado.vozBuffer = null;
                estado.trilhaBuffer = null;
                estado.receita = null;
            }
            estado.rascunhoMeta = null;

            await aplicarBancada(meta);
            document.getElementById('inputNome').value = (meta && meta.nome) || x.titulo;
            if (roteiro) {
                document.getElementById('textoComercial').value = roteiro;
                estado.roteiro = roteiro;
                atualizarContador();
            }
            if (temAudio) document.getElementById('checkTextoPronto').checked = true;   // o texto é o que foi gravado
            estado.trilha = (meta && meta.trilha) ? { name: meta.trilha } : null;
            estado.rascunhoMeta = meta;

            if (temAudio) {
                let duracao = 0;
                try {
                    const buf = await ctx.decodeAudioData(bytes.slice(0));
                    duracao = buf.duration;
                } catch (e) {
                    duracao = (meta && meta.duracao) || 0;
                }
                mostrarResultado(duracao);
            }

            const rot = { locutores: 'LOCUTORES IA', principal: 'NewPost-IA ✓', futuro: 'Futuro em Pauta', vida: 'Vida Saudável' };
            const ep = (meta && meta.episodio) ? ` — episódio ${meta.episodio}` : '';
            const conta = (meta && meta.conta) ? `, conta do Feed: ${rot[meta.conta] || meta.conta}` : '';
            const ajustes = (meta && meta.v >= 2) ? ' Voz, estilo, direção, plano e trilha voltaram como estavam.' : '';
            if (temAudio) {
                avisar(`📂 Spot reaberto${ep}${conta}. ` + (roteiro ? 'Roteiro e nome restaurados.' : 'Guardado sem roteiro: confira o nome e cole o texto.')
                       + ajustes + ' Ouça e use Feed, Enviar ou Download. Pra mexer na voz ou na trilha, gere de novo.', 'ok');
                passo(0, 0, '✅ Spot reaberto — ouça antes de publicar.');
            } else {
                avisar(`📝 Bancada "${(meta && meta.nome) || x.titulo}" reaberta: texto e ajustes de volta.${ajustes} Revise e clique em Gerar anúncio.`, 'ok');
                passo(0, 0, '✅ Bancada reaberta — pronta pra gerar.');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            passo(0, 0, '❌ ' + e.message);
        }
    }

    async function carregarRascunhos() {
        const box = document.getElementById('listaRascunhos');
        if (!box) return;
        try {
            const r = await fetch('/api/gerador/rascunhos?limite=12');
            const d = await r.json();
            const itens = (d.rascunhos || []).filter(x => x.url || x.tipo === 'texto');
            if (!itens.length) {
                box.innerHTML = '<div class="hint">Nada guardado ainda — o primeiro spot que você gerar aparece aqui.</div>';
                return;
            }
            box.innerHTML = itens.map((x, i) => `
                <div class="rascunho-item">
                    <div class="rascunho-nome">
                        ${esc(x.titulo)}
                        <span class="hint ms-2">${esc(x.quando)}</span>
                    </div>
                    ${x.url
                        ? `<audio controls preload="none" src="${esc(x.url)}"></audio>`
                        : `<span class="hint" style="flex: 1 1 260px;"><i class="fas fa-file-lines me-1"></i>bancada guardada: texto + ajustes, sem áudio</span>`}
                    <button class="btn btn-sm btn-outline-info" data-reabrir="${i}"
                            title="${x.url ? 'Reabrir na bancada: publicar no Feed, enviar ou baixar sem gerar de novo' : 'Reabrir: texto, voz, estilo, direção, plano e trilha de volta na bancada'}"><i class="fas fa-folder-open me-1"></i>Reabrir</button>
                    ${x.url ? `<a class="btn btn-sm btn-outline-light" download="${esc(x.titulo)}.mp3"
                       href="${esc(x.url)}"><i class="fas fa-download"></i></a>` : ''}
                    <button class="btn btn-sm btn-outline-danger" data-excluir="${esc(x.path)}"
                            title="Excluir esta versão"><i class="fas fa-trash"></i></button>
                </div>`).join('');

            box.querySelectorAll('[data-reabrir]').forEach(btn => {
                btn.onclick = () => reabrirRascunho(itens[Number(btn.dataset.reabrir)]);
            });

            // Versão errada na lista é risco de mandar o arquivo trocado pro
            // cliente — daí o botão. Some do Storage de verdade, sem volta.
            box.querySelectorAll('[data-excluir]').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('Excluir este item guardado? Não dá pra desfazer.')) return;
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
        estado.duracaoMix = duracao;
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

    // ── Programa (preset de rádio) ───────────────────────────────────────
    // Vinheta + miolo + aviso + fecho: as partes fixas moram no backend
    // (core/programas.py). A tela só trava os ajustes e monta o roteiro.
    let programas = [];

    function programaAtual() {
        const sel = document.getElementById('selectPrograma');
        if (!sel) return null;
        return programas.find(p => p.id === sel.value) || null;
    }

    async function carregarProgramas() {
        const sel = document.getElementById('selectPrograma');
        if (!sel) return;
        try {
            const r = await fetch('/api/gerador/programas');
            const d = await r.json();
            programas = d.programas || [];
        } catch (e) {
            programas = [];
        }
        sel.innerHTML = '<option value="">— nenhum (spot avulso) —</option>' +
            programas.map(p => `<option value="${esc(p.id)}">${esc(p.nome)} · ${esc(p.descricao)}</option>`).join('');
    }

    // Acha a voz pelo pedaço do nome ("Charon"): o id muda entre catálogos, o
    // nome não. Devolve false se o catálogo não tem a voz.
    function selecionarVozPorNome(trecho) {
        const sel = document.getElementById('selectVoz');
        const alvo = String(trecho || '').toLowerCase();
        for (const o of sel.options) {
            if (o.text.toLowerCase().includes(alvo)) { sel.value = o.value; return true; }
        }
        return false;
    }

    function atualizarContadorMiolo() {
        const p = programaAtual();
        const el = document.getElementById('contadorMiolo');
        if (!p || !el) return;
        const n = document.getElementById('textoMiolo').value.trim().split(/\s+/).filter(Boolean).length;
        const [lo, hi] = p.miolo_palavras || [0, 0];
        el.textContent = n
            ? `miolo: ${n} palavras (alvo ${lo}–${hi})`
            : `miolo vazio — a IA escreve a partir do tema (alvo ${lo}–${hi} palavras)`;
    }

    // Escolher o programa trava os ajustes do produtor (decisão de 04/09/2026:
    // Charon Informative, Modo Padrão, direção de rádio da manhã, gate ligado)
    // e lê no feed qual é o próximo episódio da série.
    async function aplicarPrograma() {
        const p = programaAtual();
        document.getElementById('camposPrograma').style.display = p ? '' : 'none';
        estado.roteiroMontado = false;
        if (!p) return;
        const a = p.ajustes || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        set('selectFormato', a.formato);
        set('selectModo', a.modo);
        aplicarFiltroDeVozes();
        if (a.voz_contem && !selecionarVozPorNome(a.voz_contem)) {
            avisar(`A voz "${a.voz_contem}" do programa não está no catálogo — escolha a voz na mão.`, 'atencao');
        }
        set('selectEstilo', a.estilo);
        set('direcaoLocucao', a.direcao);
        set('selectPlano', a.plano);
        if (a.gate != null) document.getElementById('chkGate').checked = !!a.gate;
        set('selectContaFeed', p.conta_feed);
        document.getElementById('checkTextoPronto').checked = true;
        document.getElementById('selectFormato').dispatchEvent(new Event('change'));
        avisar(`📻 Programa "${p.nome}": vinheta, aviso e fecho já vêm prontos; voz, direção, gate e conta do Feed travados. Escreva o tema (ou cole o miolo) e monte o roteiro.`, 'info');

        const info = document.getElementById('infoEpisodio');
        info.textContent = 'Lendo a série no feed...';
        try {
            const r = await fetch(`/api/gerador/programa/${encodeURIComponent(p.id)}/proximo-episodio`);
            const d = await r.json();
            if (d.episodio) {
                document.getElementById('inputEpisodio').value = d.episodio;
                info.textContent = `próximo pela série do feed: episódio ${d.episodio}`;
            } else {
                info.textContent = d.aviso || 'Informe o número do episódio.';
            }
        } catch (e) {
            info.textContent = 'Não li a série no feed — informe o número do episódio.';
        }
        atualizarContadorMiolo();
    }

    // Monta vinheta + miolo + aviso + fecho no backend e joga no texto do
    // comercial como TEXTO PRONTO. Devolve true quando montou.
    async function montarRoteiro() {
        const p = programaAtual();
        if (!p) return false;
        const btn = document.getElementById('btnMontarRoteiro');
        btn.disabled = true;
        try {
            const episodio = parseInt(document.getElementById('inputEpisodio').value, 10) || 0;
            if (episodio < 1) throw new Error('Informe o número do episódio.');
            const tema = document.getElementById('inputTema').value.trim();
            const miolo = document.getElementById('textoMiolo').value.trim();
            if (!tema && !miolo) throw new Error('Escreva o tema do episódio, ou cole o miolo pronto.');
            passo(0, 0, miolo ? 'Montando o roteiro...' : 'A IA está escrevendo o miolo...');
            const r = await fetch('/api/gerador/programa/roteiro', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    programa: p.id, tema, episodio, miolo,
                    patrocinador: document.getElementById('inputPatrocinador').value.trim()
                })
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'Não consegui montar o roteiro.');
            document.getElementById('textoMiolo').value = d.miolo;
            document.getElementById('textoComercial').value = d.roteiro;
            estado.roteiro = d.roteiro;
            document.getElementById('inputNome').value = d.nome_spot;
            document.getElementById('checkTextoPronto').checked = true;
            document.getElementById('selectContaFeed').value = d.conta_feed;
            estado.roteiroMontado = true;
            atualizarContador();
            atualizarContadorMiolo();
            (d.avisos || []).forEach(a => avisar('⚠️ ' + a, 'atencao'));
            avisar(`📻 Roteiro do episódio ${d.episodio} montado (${d.fonte === 'ia' ? 'miolo escrito pela IA' : 'miolo como você colou'}): `
                   + `${d.palavras_total} palavras, ~${Math.round(d.tempo_leitura_estimado)}s de fala. Revise o texto e clique em Gerar anúncio.`, 'ok');
            passo(0, 0, '');
            return true;
        } catch (e) {
            passo(0, 0, '❌ ' + e.message);
            return false;
        } finally {
            btn.disabled = false;
        }
    }

    // ── VoxCraft: o que a tela mostra, e o que o chat manda preencher ────
    // O widget (static/voxcraft-widget.js) chama voxcraftContexto() a cada
    // mensagem; o backend calcula o diagnóstico (duração x grade, frase legal,
    // miolo) e a IA critica com número. aplicarPrefillVoxcraft() recebe o que
    // uma ferramenta do chat montou (episódio, roteiro, trilha) e preenche a
    // bancada — gerar, enviar e publicar continuam sendo cliques do produtor.
    window.voxcraftContexto = function () {
        const g = id => { const el = document.getElementById(id); return el ? (el.value || '') : ''; };
        const txt = id => {
            const el = document.getElementById(id);
            return (el && el.options && el.selectedIndex >= 0) ? el.options[el.selectedIndex].text : g(id);
        };
        const chk = id => { const el = document.getElementById(id); return !!(el && el.checked); };
        const p = programaAtual();
        return {
            tela: '/gerador',
            pedido: txt('selectPedido'),
            programa: p ? p.id : '', tema: p ? g('inputTema') : '', episodio: p ? g('inputEpisodio') : '',
            patrocinador: p ? g('inputPatrocinador') : '', miolo: p ? g('textoMiolo') : '',
            formato: g('selectFormato'), modo: g('selectModo'), voz: txt('selectVoz'), estilo: txt('selectEstilo'),
            direcao: g('direcaoLocucao'), plano: g('selectPlano'), trilha: txt('selectTrilha'),
            nome: g('inputNome'), conta_feed: txt('selectContaFeed'),
            gate: chk('chkGate'), texto_pronto: chk('checkTextoPronto'),
            roteiro: g('textoComercial'), duracao_mix: estado.duracaoMix || 0
        };
    };

    window.aplicarPrefillVoxcraft = async function (c) {
        c = c || {};
        limparAvisos();
        try {
            if (c.programa) {
                document.getElementById('selectPrograma').value = c.programa;
                await aplicarPrograma();
                if (c.tema != null) document.getElementById('inputTema').value = c.tema;
                if (c.episodio) document.getElementById('inputEpisodio').value = c.episodio;
                if (c.patrocinador != null) document.getElementById('inputPatrocinador').value = c.patrocinador;
                if (c.miolo) document.getElementById('textoMiolo').value = c.miolo;
                atualizarContadorMiolo();
                if (c.roteiro) estado.roteiroMontado = true;
            }
            if (c.plano) document.getElementById('selectPlano').value = c.plano;
            if (c.formato) {
                document.getElementById('selectFormato').value = c.formato;
                document.getElementById('selectFormato').dispatchEvent(new Event('change'));
            }
            if (c.roteiro) {
                document.getElementById('textoComercial').value = c.roteiro;
                estado.roteiro = c.roteiro;
                atualizarContador();
            }
            if (c.texto_pronto) document.getElementById('checkTextoPronto').checked = true;
            if (c.nome) document.getElementById('inputNome').value = c.nome;
            if (c.conta_feed) document.getElementById('selectContaFeed').value = c.conta_feed;
            if (c.trilha_id != null) {
                const st = document.getElementById('selectTrilha');
                st.value = String(c.trilha_id);
                if (st.value !== String(c.trilha_id)) {
                    avisar(`Trilha "${c.trilha_nome || c.trilha_id}" não está no catálogo carregado — escolha na mão.`, 'atencao');
                }
            }
            const oque = c.programa ? `o episódio ${c.episodio || ''} do programa` : (c.roteiro ? 'o roteiro' : 'os campos');
            avisar(`🤖 VoxCraft preencheu a bancada com ${oque}${c.trilha_nome ? ` e a trilha "${c.trilha_nome}"` : ''}. Revise e clique em Gerar anúncio.`, 'ok');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            avisar('Não consegui aplicar o que o VoxCraft mandou: ' + e.message, 'atencao');
        }
    };

    async function gerarAnuncio() {
        const btn = document.getElementById('btnGerar');
        btn.disabled = true;
        limparAvisos();
        estado.rascunhoMeta = null;   // spot novo não herda episódio de um reaberto
        document.getElementById('infoMix').style.display = 'none';
        const TOTAL = 6;

        try {
            // Programa escolhido e roteiro ainda não montado: monta antes. O
            // texto do episódio vai como "texto pronto" — a IA já fez sua parte.
            if (programaAtual() && !document.getElementById('textoComercial').value.trim()) {
                if (!(await montarRoteiro())) throw new Error('Monte o roteiro do episódio antes de gerar.');
            }

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
        // Tira o acento ANTES de trocar por hífen: "Saudável" virava "Saud-vel"
        // e o título do spot guardado saía picado (achado do produtor, 09/09).
        const base = (document.getElementById('inputNome').value || 'spot').trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') || 'spot';
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

        // Programa (preset de rádio) — tudo guardado: sem os elementos, nada quebra.
        try {
            carregarProgramas();
            document.getElementById('selectPrograma').addEventListener('change', aplicarPrograma);
            document.getElementById('textoMiolo').addEventListener('input', atualizarContadorMiolo);
            document.getElementById('btnMontarRoteiro').onclick = montarRoteiro;
            // Patrocinador ou número do episódio mudou DEPOIS de montar: remonta
            // na hora. O miolo já está no campo, então não gasta IA — só troca
            // o fecho / a vinheta. (Achado no teste do ep.4: ele digitou o
            // patrocinador depois e o fecho continuou "esse espaço pode ser seu".)
            const remontar = () => {
                if (estado.roteiroMontado && document.getElementById('textoMiolo').value.trim()) montarRoteiro();
            };
            document.getElementById('inputPatrocinador').addEventListener('change', remontar);
            document.getElementById('inputEpisodio').addEventListener('change', remontar);
        } catch (e) {
            console.warn('programa: fiação falhou', e);
        }

        document.getElementById('btnGerar').onclick = gerarAnuncio;
        const btnBancada = document.getElementById('btnGuardarBancada');
        if (btnBancada) btnBancada.onclick = guardarBancada;
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
                        // Com programa, o número do episódio vai explícito (o
                        // nome do spot não tem mais "#N" — o badge da série mostra).
                        episodio: programaAtual()
                            ? (parseInt(document.getElementById('inputEpisodio').value, 10) || undefined)
                            : ((estado.rascunhoMeta && estado.rascunhoMeta.episodio) || undefined),
                        audio_base64: b64
                    })
                });
                const d = await resp.json();
                if (d.success) {
                    // Série/episódio e tags vêm do backend (por conta) — o produtor
                    // confere na hora se o podcast saiu como episódio numerado.
                    const serie = d.serie ? `\nSérie "${d.serie}"${d.episodio ? ` · Ep. ${d.episodio}` : ''}` : '';
                    const tags = (d.tags || []).length ? `\nTags: ${d.tags.map(t => '#' + t).join(' ')}` : '';
                    alert(`📡 Spot no ar no feed da NewPost-IA, assinado por ${rotulos[conta]}!${serie}${tags}\nConfira em www.newpostia.app`);
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

        // Veio de outra tela com algo montado pelo VoxCraft? Aplica e limpa.
        try {
            const raw = sessionStorage.getItem('voxcraft_prefill');
            if (raw) {
                sessionStorage.removeItem('voxcraft_prefill');
                await carregarProgramas();
                await window.aplicarPrefillVoxcraft(JSON.parse(raw));
            }
        } catch (e) {
            console.warn('prefill do VoxCraft', e);
        }
    });
})();
