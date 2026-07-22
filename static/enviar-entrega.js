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
                status.textContent = 'Enviando o áudio...';
                const nome = nomeArquivo || `locucao-${Date.now()}.mp3`;

                const ru = await fetch('/api/client-deliveries/upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: nome, kind: 'entrega' })
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

                status.textContent = 'Cadastrando a entrega...';
                const rc = await fetch('/api/client-deliveries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_name: cliente,
                        client_contact: document.getElementById('eeContato').value.trim(),
                        request_description: document.getElementById('eeDescricao').value.trim(),
                        storage_path: u.path,
                        file_size: blob.size,
                        mime_type: blob.type || 'audio/mpeg',
                        pedido_id: sel.value || ''
                    })
                });
                const c = await rc.json();
                if (!c.success) throw new Error(c.error || 'Falha ao cadastrar a entrega');

                status.style.color = '#4ade80';
                status.textContent = '✅ Entrega criada! Abrindo o painel...';
                setTimeout(() => { window.location.href = '/entregas-clientes'; }, 900);
            } catch (e) {
                status.style.color = '#f87171';
                status.textContent = '❌ ' + e.message;
                btn.disabled = false;
            }
        };
    };
})();
