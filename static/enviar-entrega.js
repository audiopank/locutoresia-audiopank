/**
 * Enviar para Entrega — ponte entre a produção (Studio / MiniDAW) e o cadastro
 * de entrega do cliente.
 *
 * ANTES: gerava a locução, BAIXAVA o arquivo, ia em /entregas-clientes e fazia
 * UPLOAD do mesmo arquivo. Vaivém manual em todo pedido, com risco de mandar o
 * arquivo errado.
 *
 * O áudio sobe direto do navegador pro Supabase Storage via signed URL — mesmo
 * padrão do cadastro de entrega. Isso contorna o limite de ~4.5MB de corpo da
 * função no Vercel E evita depender de /tmp: lá o áudio gerado vive no disco
 * efêmero da invocação, então buscá-lo numa requisição posterior é frágil.
 * Aqui trabalhamos com o Blob que o navegador já tem em mãos.
 *
 * Uso:  enviarParaEntrega(blob, 'spot-padaria.mp3')
 */
(function () {
    const ID_MODAL = 'modalEnviarEntrega';

    function esc(s) {
        // Escapa aspas também: este texto vai para dentro de atributo HTML.
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function montarModal() {
        if (document.getElementById(ID_MODAL)) return document.getElementById(ID_MODAL);
        const el = document.createElement('div');
        el.id = ID_MODAL;
        el.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;' +
            'background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:1rem;';
        el.innerHTML = `
            <div style="background:#141a2e;color:#e6e8f0;border:1px solid #2a3350;border-radius:14px;
                        max-width:520px;width:100%;padding:1.25rem;font-family:inherit;
                        max-height:90vh;overflow:auto;">
                <h5 style="margin:0 0 .25rem;">Enviar para entrega</h5>
                <p style="font-size:.85rem;opacity:.7;margin:0 0 1rem;">
                    O áudio vai direto pro cadastro do cliente — sem baixar e subir de novo.
                </p>

                <label style="font-size:.85rem;display:block;margin-bottom:.25rem;">Pedido (opcional)</label>
                <select id="eeSelectPedido" style="width:100%;padding:.5rem;border-radius:8px;
                        background:#0e1424;color:#e6e8f0;border:1px solid #2a3350;margin-bottom:.25rem;">
                    <option value="">Carregando pedidos...</option>
                </select>
                <div style="font-size:.78rem;opacity:.65;margin-bottom:.9rem;">
                    Vincular ao pedido é o que libera o download do arquivo definitivo
                    depois do pagamento. Sem pedido, a entrega funciona mas o cliente
                    não recebe o botão de baixar.
                </div>

                <label style="font-size:.85rem;display:block;margin-bottom:.25rem;">Cliente *</label>
                <input id="eeCliente" type="text" placeholder="Ex: Padaria do Zé"
                       style="width:100%;padding:.5rem;border-radius:8px;background:#0e1424;
                              color:#e6e8f0;border:1px solid #2a3350;margin-bottom:.75rem;">

                <label style="font-size:.85rem;display:block;margin-bottom:.25rem;">Contato</label>
                <input id="eeContato" type="text" placeholder="WhatsApp ou e-mail"
                       style="width:100%;padding:.5rem;border-radius:8px;background:#0e1424;
                              color:#e6e8f0;border:1px solid #2a3350;margin-bottom:.75rem;">

                <label style="font-size:.85rem;display:block;margin-bottom:.25rem;">Descrição</label>
                <input id="eeDescricao" type="text" placeholder="Ex: Spot 30s, tom energético"
                       style="width:100%;padding:.5rem;border-radius:8px;background:#0e1424;
                              color:#e6e8f0;border:1px solid #2a3350;margin-bottom:1rem;">

                <div id="eeStatus" style="font-size:.85rem;margin-bottom:.75rem;min-height:1.2em;"></div>

                <div style="display:flex;gap:.5rem;justify-content:flex-end;">
                    <button id="eeCancelar" style="padding:.5rem 1rem;border-radius:8px;
                            background:#2a3350;color:#e6e8f0;border:none;cursor:pointer;">Cancelar</button>
                    <button id="eeConfirmar" style="padding:.5rem 1rem;border-radius:8px;
                            background:#22c55e;color:#052e16;border:none;font-weight:600;cursor:pointer;">
                        Enviar
                    </button>
                </div>
            </div>`;
        document.body.appendChild(el);
        return el;
    }

    async function carregarPedidos() {
        const sel = document.getElementById('eeSelectPedido');
        try {
            const r = await fetch('/api/pedidos');
            const d = await r.json();
            const lista = (d && d.pedidos) ? d.pedidos : [];
            // Só os que ainda não viraram entrega — os demais só poluiriam a lista.
            const abertos = lista.filter(p => !p.entrega_id);
            sel.innerHTML = '<option value="">— sem pedido vinculado —</option>' +
                abertos.map(p =>
                    `<option value="${esc(p.id)}" data-nome="${esc(p.cliente_nome)}" ` +
                    `data-contato="${esc(p.whatsapp || p.email || '')}" ` +
                    `data-desc="${esc(p.tipo || '')}">` +
                    `${esc(p.cliente_nome)} — ${esc(p.plano || p.tipo || 'pedido')}</option>`
                ).join('');
        } catch (e) {
            sel.innerHTML = '<option value="">— não foi possível carregar os pedidos —</option>';
        }
    }

    // ── CARIMBO NA PRÉVIA ────────────────────────────────────────────────
    // O produtor gravava o spot DUAS vezes: uma limpa e uma com a voz de
    // "amostra" por cima. E ainda precisava lembrar de anexar a limpa depois
    // do pagamento — se esquecesse, o arquivo bom não ficava em lugar nenhum.
    //
    // Agora ele produz só a limpa. Aqui a gente sobrepõe a voz de carimbo
    // (gravada uma vez, guardada no Storage) e sobe as duas: a carimbada como
    // prévia e a limpa como definitiva, que o backend já mantém travada até o
    // pedido constar como pago.
    const CARIMBO_INTERVALO = 8;    // segundos entre as marcações
    const CARIMBO_VOLUME = 0.55;    // audível sem cobrir a locução
    const CARIMBO_INICIO = 2.5;     // deixa o spot abrir limpo antes da 1a marca

    async function buscarVozDeCarimbo(ctx) {
        const r = await fetch('/api/carimbo');
        const d = await r.json();
        if (!d.success || !d.tem_carimbo || !d.url) return null;
        const resp = await fetch(d.url);
        if (!resp.ok) return null;
        return await ctx.decodeAudioData(await resp.arrayBuffer());
    }

    // Devolve um Blob WAV do spot com a voz de carimbo repetida por cima.
    async function carimbar(blobLimpo) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        try {
            const spot = await ctx.decodeAudioData(await blobLimpo.arrayBuffer());
            const carimbo = await buscarVozDeCarimbo(ctx);
            if (!carimbo) return null;   // sem voz gravada: quem chama decide

            const off = new OfflineAudioContext(
                Math.min(2, spot.numberOfChannels) || 2,
                spot.length, spot.sampleRate);

            const fonteSpot = off.createBufferSource();
            fonteSpot.buffer = spot;
            fonteSpot.connect(off.destination);
            fonteSpot.start(0);

            // Onde começa a primeira marca. O normal é deixar o spot abrir
            // limpo por 2,5s — MAS num teaser de 5s a frase de ~4s não cabe
            // depois disso e a prévia sairia sem marcação nenhuma. Nesses
            // casos a marca começa em 0: teaser curto é justamente o que mais
            // se perde se for usado sem pagar.
            const cabeComFolga = CARIMBO_INICIO + carimbo.duration <= spot.duration;
            const inicio = cabeComFolga ? CARIMBO_INICIO : 0;

            let marcas = 0;
            for (let t = inicio; t + carimbo.duration <= spot.duration;
                 t += CARIMBO_INTERVALO + carimbo.duration) {
                const src = off.createBufferSource();
                src.buffer = carimbo;
                const g = off.createGain();
                g.gain.value = CARIMBO_VOLUME;
                src.connect(g);
                g.connect(off.destination);
                src.start(t);
                marcas++;
            }

            // Carimbo mais longo que o próprio spot: não dá pra marcar sem
            // cortar a frase no meio. Devolve null pra quem chama avisar, em
            // vez de mandar uma "prévia" idêntica ao arquivo pago.
            if (marcas === 0) return null;

            const renderizado = await off.startRendering();
            return bufferParaWav(renderizado);
        } finally {
            if (ctx.close) ctx.close();
        }
    }

    // WAV de 16 bits — mesmo formato do bufferToWav do mix-engine, repetido
    // aqui porque este arquivo é carregado em telas que não têm o motor.
    function bufferParaWav(buffer) {
        const nch = buffer.numberOfChannels;
        const tamanho = buffer.length * nch * 2;
        const ab = new ArrayBuffer(44 + tamanho);
        const view = new DataView(ab);
        let pos = 0;
        const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
        const u32 = (v) => { view.setUint32(pos, v, true); pos += 4; };
        u32(0x46464952); u32(36 + tamanho); u32(0x45564157); u32(0x20746d66);
        u32(16); u16(1); u16(nch); u32(buffer.sampleRate);
        u32(buffer.sampleRate * nch * 2); u16(nch * 2); u16(16);
        u32(0x61746164); u32(tamanho);
        const canais = [];
        for (let i = 0; i < nch; i++) canais.push(buffer.getChannelData(i));
        for (let i = 0; i < buffer.length; i++) {
            for (let c = 0; c < nch; c++) {
                let s = Math.max(-1, Math.min(1, canais[c][i]));
                view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                pos += 2;
            }
        }
        return new Blob([ab], { type: 'audio/wav' });
    }

    // Exposto porque o formulário manual de /entregas-clientes usa a MESMA
    // lógica. Sem isso, cadastrar pelo formulário mandaria o arquivo limpo
    // como prévia — o cliente receberia o spot sem carimbo antes de pagar.
    // Devolve null quando não há voz de carimbo gravada ou quando o spot é
    // curto demais pra caber a frase.
    window.carimbarPrevia = carimbar;

    // Sobe um blob e devolve o caminho no Storage.
    async function subirArquivo(blob, nome, kind) {
        const ru = await fetch('/api/client-deliveries/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: nome, kind: kind })
        });
        const u = await ru.json();
        if (!u.success) throw new Error(u.error || 'Falha ao preparar o envio');

        const fd = new FormData();
        fd.append('file', blob, nome);
        const up = await fetch(u.upload_url, {
            method: 'PUT',
            headers: { 'apikey': u.apikey, 'Authorization': `Bearer ${u.apikey}` },
            body: fd
        });
        if (!up.ok) throw new Error('Falha ao enviar o áudio para o armazenamento');
        return u.path;
    }

    window.enviarParaEntrega = function (blob, nomeArquivo) {
        if (!blob) { alert('Nenhum áudio para enviar. Gere ou exporte primeiro.'); return; }

        const modal = montarModal();
        modal.style.display = 'flex';
        const status = document.getElementById('eeStatus');
        status.textContent = '';
        carregarPedidos();

        // Escolher o pedido pré-preenche os campos — menos digitação e menos
        // chance de cadastrar o cliente com o nome escrito diferente.
        const sel = document.getElementById('eeSelectPedido');
        sel.onchange = function () {
            const opt = sel.options[sel.selectedIndex];
            if (!opt || !opt.value) return;
            document.getElementById('eeCliente').value = opt.dataset.nome || '';
            document.getElementById('eeContato').value = opt.dataset.contato || '';
            if (!document.getElementById('eeDescricao').value) {
                document.getElementById('eeDescricao').value = opt.dataset.desc || '';
            }
        };

        const fechar = () => { modal.style.display = 'none'; };
        document.getElementById('eeCancelar').onclick = fechar;

        document.getElementById('eeConfirmar').onclick = async function () {
            const btn = this;
            const cliente = document.getElementById('eeCliente').value.trim();
            if (!cliente) { status.style.color = '#f87171'; status.textContent = 'Informe o nome do cliente.'; return; }

            btn.disabled = true;
            status.style.color = '#93c5fd';
            try {
                const nome = nomeArquivo || `locucao-${Date.now()}.mp3`;

                // O áudio que chega aqui é o LIMPO. Tenta gerar a versão
                // carimbada; se não houver voz de carimbo gravada, segue como
                // era antes (a prévia vai limpa e o produtor decide o que fazer).
                status.textContent = 'Aplicando o carimbo na prévia...';
                let carimbado = null;
                try {
                    carimbado = await carimbar(blob);
                } catch (e) {
                    console.warn('[carimbo] não consegui carimbar:', e);
                }

                let caminhoPrevia, caminhoFinal = '';
                if (carimbado) {
                    // Limpo vai como DEFINITIVO — travado até o pedido ser pago.
                    status.textContent = 'Guardando o arquivo definitivo...';
                    caminhoFinal = await subirArquivo(
                        blob, nome.replace(/(\.\w+)?$/, '-final$1'), 'final');

                    status.textContent = 'Enviando a prévia carimbada...';
                    caminhoPrevia = await subirArquivo(
                        carimbado, nome.replace(/(\.\w+)?$/, '-previa.wav'), 'entrega');
                } else {
                    // Sem voz de carimbo gravada, ou spot curto demais pra
                    // caber a frase. Segue como antes — mas AVISA, senão o
                    // produtor manda uma "prévia" que é o arquivo pago.
                    status.style.color = '#fbbf24';
                    status.textContent = '⚠️ Prévia vai SEM carimbo (sem voz gravada ' +
                        'ou spot curto demais). Enviando...';
                    caminhoPrevia = await subirArquivo(blob, nome, 'entrega');
                    status.style.color = '#93c5fd';
                }
                const u = { path: caminhoPrevia };

                status.textContent = 'Cadastrando a entrega...';
                const rc = await fetch('/api/client-deliveries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_name: cliente,
                        client_contact: document.getElementById('eeContato').value.trim(),
                        request_description: document.getElementById('eeDescricao').value.trim(),
                        storage_path: u.path,
                        final_path: caminhoFinal,
                        file_size: blob.size,
                        mime_type: blob.type || 'audio/mpeg',
                        pedido_id: sel.value || ''
                    })
                });
                const c = await rc.json();
                if (!c.success) throw new Error(c.error || 'Falha ao cadastrar a entrega');

                status.style.color = '#4ade80';
                status.textContent = caminhoFinal
                    ? '✅ Entrega criada — prévia carimbada e definitivo já guardado. Abrindo o painel...'
                    : '✅ Entrega criada! Abrindo o painel...';
                setTimeout(() => { window.location.href = '/entregas-clientes'; }, 900);
            } catch (e) {
                status.style.color = '#f87171';
                status.textContent = '❌ ' + e.message;
                btn.disabled = false;
            }
        };
    };
})();
