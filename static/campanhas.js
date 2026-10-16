// Página /campanhas (16/10/2026): lista, pausa, edita e apaga as campanhas agendadas;
// cria campanha sem áudio. Campanha com áudio nasce no Gerador (📅 Agendar).
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const NOMES = Object.fromEntries(window.CampanhaForm.PERFIS);
    const DIAS = window.CampanhaForm.DIAS;
    let campanhas = [];
    let form = null;
    let editando = null;   // campanha em edição (null = nova)

    function avisar(msg, tipo) {
        const a = $('aviso');
        a.textContent = msg;
        a.className = 'aviso ' + (tipo || '');
        a.hidden = !msg;
    }

    function dataBR(iso) {
        const [a, m, d] = String(iso).slice(0, 10).split('-');
        const dia = new Date(Number(a), Number(m) - 1, Number(d));
        return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dia.getDay()] + ` ${d}/${m}`;
    }

    function regraTexto(c) {
        const hora = String(c.horario).padStart(2, '0') + 'h';
        if (c.regra === 'semana') return `toda ${(c.dias_semana || []).map(i => DIAS[i]).join(', ')} às ${hora}`;
        return `a cada ${c.intervalo_dias} dia${c.intervalo_dias > 1 ? 's' : ''} às ${hora}`;
    }

    function el(tag, attrs, filhos) {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'texto') e.textContent = v;
            else if (k === 'onclick') e.onclick = v;
            else if (v !== undefined && v !== null) e.setAttribute(k, v);
        });
        (filhos || []).forEach(f => e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f));
        return e;
    }

    async function api(metodo, url, corpo) {
        const r = await fetch(url, {
            method: metodo, headers: { 'Content-Type': 'application/json' },
            body: corpo ? JSON.stringify(corpo) : undefined
        });
        let d = {};
        try { d = await r.json(); } catch (e) { d = { error: `HTTP ${r.status}` }; }
        if (!d.success) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
    }

    function desenhar() {
        $('nTotal').textContent = campanhas.length;
        $('nAtivas').textContent = campanhas.filter(c => c.ativa).length;
        $('nPausadas').textContent = campanhas.filter(c => !c.ativa).length;
        $('nVezes').textContent = campanhas.reduce((s, c) => s + (c.vezes || 0), 0);
        const lista = $('lista');
        lista.innerHTML = '';
        if (!campanhas.length) {
            lista.appendChild(el('div', { class: 'vazio', texto: 'Nenhuma campanha ainda. Crie no Gerador (📅 Agendar) ou aqui (sem áudio).' }));
            return;
        }
        campanhas.forEach(c => {
            const corpo = el('div', { class: 'corpo' }, [
                el('h3', {}, [c.titulo || '(sem título)',
                    el('span', { class: 'selo' + (c.ativa ? '' : ' pausada'), texto: c.ativa ? 'ativa' : 'pausada' }),
                    el('span', { class: 'selo', texto: NOMES[c.conta] || c.conta })]),
                el('div', { class: 'meta', texto:
                    `${regraTexto(c)} · próxima: ${c.ativa ? dataBR(c.proxima_em) + ', ' + String(c.horario).padStart(2, '0') + 'h' : 'pausada'}` +
                    ` · saiu ${c.vezes || 0}x` + (c.audio_url ? ' · 🔊 com áudio' : '') }),
                el('div', { class: 'legenda', texto: c.legenda || '' })
            ]);
            if (c.ultimo_post_id) {
                corpo.appendChild(el('div', { class: 'meta' }, [el('a', {
                    href: 'https://www.newpostia.app/post/' + encodeURIComponent(c.ultimo_post_id),
                    target: '_blank', rel: 'noopener', texto: 'ver o último post no feed ↗' })]));
            }
            if (c.ultimo_erro) corpo.appendChild(el('div', { class: 'erro', texto: '⚠️ Última tentativa falhou — ' + c.ultimo_erro }));
            corpo.appendChild(el('div', { class: 'acoes' }, [
                el('button', { type: 'button', class: 'btn sec', texto: c.ativa ? '⏸ Pausar' : '▶ Retomar', onclick: () => pausar(c) }),
                el('button', { type: 'button', class: 'btn sec', texto: '✏️ Editar', onclick: () => abrirForm(c) }),
                el('button', { type: 'button', class: 'btn perigo', texto: '🗑 Apagar', onclick: () => apagar(c) })
            ]));
            const filhos = [];
            if (c.imagem_url) filhos.push(el('img', { src: c.imagem_url, alt: '' }));
            filhos.push(corpo);
            lista.appendChild(el('div', { class: 'cartao' + (c.ativa ? '' : ' pausada') }, filhos));
        });
    }

    async function carregar() {
        try {
            const d = await api('GET', '/api/campanhas');
            campanhas = d.campanhas || [];
            $('selTeto').value = String(d.teto_diario || 1);
            desenhar();
            if ((d.erros || []).length) avisar('Não consegui ler tudo:\n' + d.erros.join('\n'), 'erro');
        } catch (e) {
            $('lista').innerHTML = '';
            avisar('Erro ao carregar as campanhas: ' + e.message, 'erro');
        }
    }

    async function pausar(c) {
        try {
            await api('PATCH', '/api/campanhas/' + encodeURIComponent(c.id), { conta: c.conta, ativa: !c.ativa });
            avisar(c.ativa ? `"${c.titulo}" pausada.` : `"${c.titulo}" de volta na fila.`, 'ok');
            carregar();
        } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
    }

    async function apagar(c) {
        if (!confirm(`Apagar a campanha "${c.titulo}"? Os posts que já saíram continuam no feed.`)) return;
        try {
            await api('DELETE', '/api/campanhas/' + encodeURIComponent(c.id) + '?conta=' + encodeURIComponent(c.conta));
            avisar(`"${c.titulo}" apagada.`, 'ok');
            carregar();
        } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
    }

    function abrirForm(c) {
        editando = c || null;
        $('tituloForm').textContent = c ? 'Editar campanha' : 'Nova campanha sem áudio';
        $('btnSalvar').innerHTML = c ? '<i class="fas fa-save"></i> Salvar' : '<i class="fas fa-calendar-check"></i> Agendar';
        form = window.CampanhaForm.montar($('formCampanha'), { edicao: !!c, valores: c || {} });
        $('painelForm').hidden = false;
        $('painelForm').scrollIntoView({ behavior: 'smooth' });
    }

    function fecharForm() {
        $('painelForm').hidden = true;
        editando = null;
        form = null;
    }

    async function salvar() {
        if (!form) return;
        const btn = $('btnSalvar');
        btn.disabled = true;
        form.erro('');
        try {
            if (editando) {
                const v = form.ler();
                await api('PATCH', '/api/campanhas/' + encodeURIComponent(editando.id), {
                    conta: editando.conta, titulo: v.titulo, legenda: v.legenda, tags: v.tags, regra: v.regra,
                    intervalo_dias: v.intervalo_dias, dias_semana: v.dias_semana, horario: v.horario,
                    proxima_em: v.proxima_em });
                avisar('Campanha atualizada.', 'ok');
            } else {
                const nova = await window.CampanhaForm.criar(form);
                avisar(`📅 Agendada! Primeira saída: ${dataBR(nova.proxima_em)}, ${String(nova.horario).padStart(2, '0')}h (se o teto do dia deixar).`, 'ok');
            }
            fecharForm();
            carregar();
        } catch (e) {
            form.erro(e.message);
        } finally {
            btn.disabled = false;
        }
    }

    $('btnNova').onclick = () => abrirForm(null);
    $('btnCancelar').onclick = fecharForm;
    $('btnSalvar').onclick = salvar;
    $('selTeto').onchange = async () => {
        try {
            await api('POST', '/api/campanhas/config', { teto_diario: parseInt($('selTeto').value, 10) });
            avisar(`Teto salvo: no máximo ${$('selTeto').value} campanha(s) por dia.`, 'ok');
        } catch (e) { avisar('Erro ao salvar o teto: ' + e.message, 'erro'); }
    };
    carregar();
})();
