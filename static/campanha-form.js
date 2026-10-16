// Formulário de CAMPANHA AGENDADA (16/10/2026) — usado em /campanhas e na janela
// "📅 Agendar" do Gerador. Só monta os campos, lê os valores e sobe mídia;
// quem chama decide o que fazer. Regras do servidor em core/campanhas.py.
(function () {
    'use strict';

    const PERFIS = [
        ['locutores', 'LOCUTORES IA'], ['principal', 'NewPost-IA ✓'], ['futuro', 'Futuro em Pauta'],
        ['vida', 'Vida Saudável'], ['achadinhos', 'Achadinhos']
    ];
    const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];   // índice = weekday do Python

    const CSS = `
    .cf { display: grid; gap: 10px; font-size: .92rem; color: #f1f5f9; }
    .cf label { display: block; color: #94a3b8; font-size: .8rem; margin-bottom: 3px; }
    .cf input[type=text], .cf input[type=date], .cf input[type=number], .cf select, .cf textarea {
        width: 100%; background: #0f172a; color: #f1f5f9; border: 1px solid #334155;
        border-radius: 8px; padding: 8px 10px; font: inherit; }
    .cf textarea { min-height: 130px; }
    .cf .linha { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    .cf .linha > div { flex: 1; min-width: 140px; }
    .cf .dias { display: flex; gap: 6px; flex-wrap: wrap; }
    .cf .dias label, .cf .radio label { display: inline-flex; gap: 4px; align-items: center; color: #f1f5f9; font-size: .88rem; margin: 0; }
    .cf .dica { color: #94a3b8; font-size: .78rem; }
    .cf img.previa { max-height: 120px; border-radius: 8px; display: block; margin-top: 6px; }
    .cf .erro { color: #fca5a5; font-size: .85rem; }`;

    function injetarCss() {
        if (document.getElementById('cf-css')) return;
        const s = document.createElement('style');
        s.id = 'cf-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function el(tag, attrs, filhos) {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'texto') e.textContent = v;
            else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
        });
        (filhos || []).forEach(f => e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f));
        return e;
    }

    function hojeBR() {
        const d = new Date(Date.now() - 3 * 3600 * 1000);   // Brasília (UTC-3)
        return d.toISOString().slice(0, 10);
    }

    // opts: { edicao: bool, comAudio: bool (mostra "levar o áudio?"), valores: {...} }
    function montar(container, opts) {
        injetarCss();
        opts = opts || {};
        const v = opts.valores || {};
        container.innerHTML = '';
        const f = el('div', { class: 'cf' });

        const selPerfil = el('select', { disabled: opts.edicao || undefined },
            PERFIS.map(([id, nome]) => el('option', { value: id, texto: nome })));
        selPerfil.value = v.conta || 'locutores';
        const inTitulo = el('input', { type: 'text', maxlength: '120', placeholder: 'Ex.: Locutores IA — spots com 20% às sextas' });
        inTitulo.value = v.titulo || '';
        f.appendChild(el('div', { class: 'linha' }, [
            el('div', {}, [el('label', { texto: 'Perfil que publica' }), selPerfil]),
            el('div', {}, [el('label', { texto: 'Título (só aparece aqui no painel)' }), inTitulo])
        ]));

        const txLegenda = el('textarea', { spellcheck: 'true' });
        txLegenda.value = v.legenda || '';
        const inTags = el('input', { type: 'text', placeholder: '#LocutoresIA #spots' });
        inTags.value = (v.tags || []).map(t => '#' + t).join(' ');
        const avisoAchadinhos = el('div', { class: 'dica', texto: 'Achadinhos: nunca com preço (R$ ou "reais") — quem divulga preço é o admin da NewPost-IA.' });
        f.appendChild(el('div', {}, [el('label', { texto: 'Legenda do post' }), txLegenda, avisoAchadinhos]));
        f.appendChild(el('div', {}, [el('label', { texto: 'Hashtags' }), inTags]));

        let chkAudio = null;
        if (opts.comAudio) {
            chkAudio = el('input', { type: 'checkbox', checked: true });
            f.appendChild(el('div', { class: 'radio' }, [el('label', {}, [chkAudio, ' Levar o áudio do spot no post'])]));
        }

        // Imagem: só na criação (para trocar, agenda de novo).
        let imagem = null;   // { dataUrl, mime }
        const inFoto = el('input', { type: 'file', accept: 'image/*' });
        const previa = el('img', { class: 'previa', alt: 'Prévia da imagem', hidden: true });
        if (!opts.edicao) {
            f.appendChild(el('div', {}, [el('label', { texto: 'Imagem (logo ou arte) — opcional' }), inFoto, previa]));
            inFoto.onchange = async () => {
                imagem = null;
                previa.hidden = true;
                const arq = inFoto.files && inFoto.files[0];
                if (!arq) return;
                imagem = await comprimirImagem(arq);
                previa.src = imagem.dataUrl;
                previa.hidden = false;
            };
        }

        const grupo = 'cfRegra' + Math.random().toString(36).slice(2, 8);
        const regraIntervalo = el('input', { type: 'radio', name: grupo, value: 'intervalo' });
        const regraSemana = el('input', { type: 'radio', name: grupo, value: 'semana' });
        const inIntervalo = el('input', { type: 'number', min: '1', max: '30', style: 'width:70px' });
        inIntervalo.value = v.intervalo_dias || 2;
        const chkDias = DIAS.map((d, i) => el('input', { type: 'checkbox', value: String(i), checked: (v.dias_semana || []).includes(i) || undefined }));
        (v.regra === 'semana' ? regraSemana : regraIntervalo).checked = true;
        f.appendChild(el('div', {}, [
            el('label', { texto: 'Repetição' }),
            el('div', { class: 'radio linha' }, [el('label', {}, [regraIntervalo, ' A cada ', inIntervalo, ' dias'])]),
            el('div', { class: 'radio linha' }, [el('label', {}, [regraSemana, ' Nos dias:']),
                el('div', { class: 'dias' }, chkDias.map((c, i) => el('label', {}, [c, DIAS[i]])))])
        ]));

        const selHora = el('select', {}, [9, 15, 21].map(h => el('option', { value: String(h), texto: String(h).padStart(2, '0') + 'h' })));
        selHora.value = String(v.horario || 9);
        const inData = el('input', { type: 'date' });
        inData.value = v.proxima_em || hojeBR();
        f.appendChild(el('div', { class: 'linha' }, [
            el('div', {}, [el('label', { texto: 'Horário' }), selHora]),
            el('div', {}, [el('label', { texto: opts.edicao ? 'Próxima saída' : 'Começa em' }), inData])
        ]));
        f.appendChild(el('div', { class: 'dica', texto: 'Sai no máximo 1 campanha por horário e no máximo o teto do dia (painel Campanhas). As outras esperam a vez. O horário pode atrasar até ~1h.' }));

        const erro = el('div', { class: 'erro', hidden: true });
        f.appendChild(erro);
        container.appendChild(f);

        return {
            ler() {
                const regra = regraSemana.checked ? 'semana' : 'intervalo';
                return {
                    conta: selPerfil.value,
                    titulo: inTitulo.value.trim(),
                    legenda: txLegenda.value.trim(),
                    tags: inTags.value,
                    regra,
                    intervalo_dias: parseInt(inIntervalo.value, 10) || 0,
                    dias_semana: chkDias.filter(c => c.checked).map(c => parseInt(c.value, 10)),
                    horario: parseInt(selHora.value, 10),
                    comeca_em: inData.value,
                    proxima_em: inData.value,
                    levarAudio: chkAudio ? chkAudio.checked : false
                };
            },
            imagem() { return imagem; },
            erro(msg) { erro.textContent = msg || ''; erro.hidden = !msg; }
        };
    }

    // Logo/arte vira JPEG de até 1080 px (fundo branco, cabe folgado no limite da Vercel).
    function comprimirImagem(arq) {
        return new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, 1080 / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * escala);
                c.height = Math.round(img.height * escala);
                const g = c.getContext('2d');
                g.fillStyle = '#ffffff';
                g.fillRect(0, 0, c.width, c.height);
                g.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(img.src);
                res({ dataUrl: c.toDataURL('image/jpeg', 0.88), mime: 'image/jpeg' });
            };
            img.onerror = () => rej(new Error('não consegui ler a imagem'));
            img.src = URL.createObjectURL(arq);
        });
    }

    function blobParaDataUrl(blob) {
        return new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result);
            fr.onerror = () => rej(new Error('falha ao ler o arquivo'));
            fr.readAsDataURL(blob);
        });
    }

    async function subirMidia(conta, tipo, nome, dataUrl, mime) {
        const r = await fetch('/api/campanhas/midia', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conta, tipo, nome, mime, base64: dataUrl })
        });
        let d = {};
        try { d = await r.json(); } catch (e) { d = { error: `HTTP ${r.status}` }; }
        if (!d.success) throw new Error(d.error || 'falha ao subir ' + tipo);
        return d.url;
    }

    // Sobe a imagem (se houver) e cria a campanha. extras: { audio_url, transcricao }.
    async function criar(form, extras) {
        const dados = Object.assign(form.ler(), extras || {});
        // Achadinhos sem preço: barra ANTES de subir a imagem (o servidor confere de novo).
        const preco = dados.conta === 'achadinhos' &&
            /R\$\s*\d[\d.,]*|\b\d[\d.]*(?:,\d{1,2})?\s*reais\b/i.exec(dados.legenda + ' ' + (dados.transcricao || ''));
        if (preco) throw new Error(`Achadinhos não leva preço. Tire este trecho: "${preco[0]}".`);
        const img = form.imagem();
        if (img) dados.imagem_url = await subirMidia(dados.conta, 'imagem', dados.titulo || 'campanha', img.dataUrl, img.mime);
        const r = await fetch('/api/campanhas', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'falha ao agendar');
        return d.campanha;
    }

    window.CampanhaForm = { montar, criar, subirMidia, blobParaDataUrl, PERFIS, DIAS };
})();
