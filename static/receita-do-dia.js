// Receita do dia (01/10/2026) — perfil "Receitas Favoritas Grandes Dicas" na NewPost-IA.
// Nada sai sozinho: a tela sugere, a IA prepara, o produtor revisa e publica.
// Dado de fora (título, link, descrição) entra na tela SÓ por textContent —
// nunca por HTML montado em string (lição do escapeHtml que não escapava aspas).
//
// QUEM BUSCA AS RECEITAS É ESTE NAVEGADOR: o Cloudflare da Receiteria barra a
// Vercel (403 no 1º uso), mas a API do WordPress deles libera CORS pro nosso
// domínio e aceita o IP de casa. O servidor só filtra e escreve.
(function () {
    'use strict';
    const PREFIXO = 'https://www.receiteria.com.br/';
    const API_RECEITERIA = 'https://www.receiteria.com.br/wp-json/wp/v2/receita';
    const CAMPOS = 'id,date,link,title,class_list,yoast_head_json.description,'
        + 'acf.tempo,acf.rendimento,acf.ingredientes01,acf.ingredientes02,acf.ingredientes03';
    let totalPaginas = 0;           // vem no cabeçalho X-WP-TotalPages (~1.358 em 01/10/2026)
    const LADO_MAX = 1080;          // foto do post: lado maior, em px
    const QUALIDADE = 0.85;         // JPEG
    const $ = (id) => document.getElementById(id);
    const estado = { item: null, foto: null, promptImagem: '' };   // foto = dataURL JPEG pronta

    function avisar(msg, tipo) {
        const el = $('aviso');
        el.textContent = msg || '';
        el.className = 'aviso ' + (tipo || '');
        el.hidden = !msg;
    }

    async function api(caminho, corpo) {
        const opcoes = corpo
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
            : {};
        let r;
        try {
            r = await fetch(caminho, opcoes);
        } catch (e) {
            return { success: false, error: 'Sem conexão com o servidor.' };
        }
        let d;
        try { d = await r.json(); } catch (e) { d = { success: false, error: 'Resposta ilegível do servidor (' + r.status + ').' }; }
        if (r.status === 401) d.error = 'Sessão expirada — entre de novo.';
        return d;
    }

    function cartao(item) {
        const div = document.createElement('div');
        div.className = 'cartao';
        const h = document.createElement('h3');
        h.textContent = item.titulo;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const data = item.data ? item.data.split('-').reverse().join('/') : '';
        meta.textContent = [(item.categorias || []).slice(0, 5).join(', '), data].filter(Boolean).join(' · ');
        let aviso = null;
        if (item.aviso_epoca) {
            // Época só na etiqueta (ex.: bolo de milho marcado "Festa Junina"): aparece, mas avisa.
            aviso = document.createElement('div');
            aviso.className = 'meta';
            aviso.textContent = '⚠️ O site marca como receita de ' + item.aviso_epoca + ' — veja se combina com hoje.';
        }
        const p = document.createElement('p');
        p.textContent = [item.descricao, item.tempo ? '⏱️ ' + item.tempo : ''].filter(Boolean).join(' ');
        const acoes = document.createElement('div');
        acoes.className = 'acoes';
        if (String(item.link).startsWith(PREFIXO)) {
            const a = document.createElement('a');
            a.href = item.link;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = 'Ver no site';
            acoes.appendChild(a);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.textContent = 'Preparar esta';
        b.addEventListener('click', () => preparar(item));
        acoes.appendChild(b);
        div.append(...[h, meta, aviso, p, acoes].filter(Boolean));
        return div;
    }

    // Uma página (10 receitas) da API da Receiteria, pedida por ESTE navegador.
    async function paginaDaReceiteria(n) {
        const r = await fetch(API_RECEITERIA + '?per_page=10&page=' + n + '&_fields=' + CAMPOS,
                              { credentials: 'omit' });
        if (!r.ok) throw new Error('a Receiteria respondeu ' + r.status);
        const total = parseInt(r.headers.get('X-WP-TotalPages') || '0', 10);
        if (total > 0) totalPaginas = total;
        return r.json();
    }

    // Página sorteada do arquivo (2..total); antes de saber o total, até a 1000.
    function paginaSorteada() {
        return 2 + Math.floor(Math.random() * Math.max(1, (totalPaginas || 1000) - 1));
    }

    async function carregar(outras) {
        const lista = $('listaSugestoes');
        lista.textContent = 'Buscando receitas na Receiteria…';
        $('btnOutras').disabled = true;
        let brutos = [];
        try {
            if (!outras) brutos = brutos.concat(await paginaDaReceiteria(1));   // as mais novas
            brutos = brutos.concat(await paginaDaReceiteria(paginaSorteada()));
        } catch (e) {
            if (!brutos.length) {
                $('btnOutras').disabled = false;
                lista.textContent = '';
                avisar('Seu navegador não conseguiu falar com a Receiteria (' + e.message + '). '
                       + 'Abra receiteria.com.br numa aba, veja se o site carrega e clique em "Outras sugestões".', 'erro');
                return;
            }
        }
        const d = await api('/api/receitas/sugestoes', { itens: brutos });
        $('btnOutras').disabled = false;
        lista.textContent = '';
        if (!d.success) { avisar(d.error || 'Falha ao filtrar as receitas.', 'erro'); return; }
        $('statusConta').textContent = d.conta_ok
            ? '✅ perfil conectado'
            : '⚠️ falta na Vercel: ' + ((d.faltam || []).join(' e ') || 'credenciais da conta "receitas"') + ' — publicar vai falhar';
        avisar(d.aviso || '', 'atencao');
        (d.itens || []).forEach((it) => lista.appendChild(cartao(it)));
        if (!(d.itens || []).length) lista.textContent = 'Nenhuma receita nova nesta rodada — clique em "Outras sugestões".';
        const esc = $('escondidasLista');
        esc.textContent = '';
        (d.escondidas || []).forEach((x) => {
            const li = document.createElement('li');
            li.textContent = x.titulo + ' — ' + x.motivo;
            esc.appendChild(li);
        });
        $('escondidasResumo').textContent = (d.escondidas || []).length + ' escondidas (já publicadas, fora de época ou filtro)';
    }

    async function preparar(item) {
        estado.item = item;
        estado.foto = null;
        mostrarFoto(null);
        $('etapaRevisar').hidden = false;
        $('receitaEscolhida').textContent = item.titulo;
        $('texto').value = 'Preparando o texto…';
        $('texto').disabled = true;
        $('etapaRevisar').scrollIntoView({ behavior: 'smooth' });
        const d = await api('/api/receitas/preparar', item);
        $('texto').disabled = false;
        if (!d.success) { $('texto').value = ''; avisar(d.error || 'Falha ao preparar o texto.', 'erro'); return; }
        $('texto').value = d.texto;
        estado.promptImagem = d.prompt_imagem || item.titulo;
        contar();
        avisar(d.via_ia ? '' : 'A IA não respondeu — o texto veio do próprio trecho da Receiteria. Revise com carinho antes de publicar.', 'atencao');
    }

    function contar() { $('contador').textContent = $('texto').value.length + ' caracteres'; }

    function mostrarFoto(dataUrl) {
        const img = $('previa');
        if (dataUrl) { img.src = dataUrl; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
        $('fotoStatus').textContent = dataUrl ? 'Esta foto vai junto no post.' : 'Sem foto (o post sai só com texto).';
    }

    // Qualquer foto (IA ou computador) vira JPEG de até 1080 px: cabe folgado no
    // limite de ~4,5MB da Vercel, e o servidor só aceita JPEG.
    function paraJpeg(src) {
        return new Promise((ok, falha) => {
            const img = new Image();
            img.onload = () => {
                const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * escala);
                c.height = Math.round(img.height * escala);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                ok(c.toDataURL('image/jpeg', QUALIDADE));
            };
            img.onerror = () => falha(new Error('imagem ilegível'));
            img.src = src;
        });
    }

    async function fotoIA() {
        if (!estado.item) return;
        const b = $('btnFotoIA');
        b.disabled = true;
        $('fotoStatus').textContent = 'Gerando a foto com IA (uns 15 segundos)…';
        const d = await api('/api/receitas/foto-ia', { prompt: estado.promptImagem || estado.item.titulo });
        b.disabled = false;
        if (!d.success) {
            $('fotoStatus').textContent = d.sem_faturamento
                ? '💳 ' + d.error + ' Use uma foto do computador ou publique sem foto.'
                : '⚠️ ' + (d.error || 'Falha ao gerar a foto.');
            return;
        }
        try {
            estado.foto = await paraJpeg('data:' + d.mime + ';base64,' + d.imagem_base64);
            mostrarFoto(estado.foto);
        } catch (e) {
            $('fotoStatus').textContent = '⚠️ Não consegui abrir a foto gerada.';
        }
    }

    async function fotoPC() {
        const f = $('inputFoto').files && $('inputFoto').files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        try {
            estado.foto = await paraJpeg(url);
            mostrarFoto(estado.foto);
        } catch (e) {
            $('fotoStatus').textContent = '⚠️ Não consegui ler essa imagem. Prefira JPG ou PNG.';
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // Resultado do Publicar AO LADO do botão: no 1º uso o erro saiu só no topo da
    // página, longe da vista, e pareceu que o clique não tinha feito nada.
    function mostrarResultado(msg, tipo) {
        const el = $('resultadoPublicar');
        el.textContent = msg || '';
        el.className = 'aviso ' + (tipo || '');
        el.hidden = !msg;
    }

    async function publicar() {
        const texto = $('texto').value.trim();
        mostrarResultado('');
        if (!estado.item || !texto) { mostrarResultado('Escolha uma receita e confira o texto antes.', 'atencao'); return; }
        if (!confirm('Publicar agora no perfil "Receitas Favoritas Grandes Dicas"' + (estado.foto ? ' com a foto?' : ' SEM foto?'))) return;
        const b = $('btnPublicar');
        b.disabled = true;
        b.textContent = 'Publicando…';
        const d = await api('/api/receitas/publicar', { texto, link: estado.item.link, imagem_base64: estado.foto || '' });
        b.disabled = false;
        b.textContent = '📤 Publicar no feed';
        if (d.success) {
            $('etapaRevisar').hidden = true;
            estado.item = null;
            estado.foto = null;
            await carregar(false);
            avisar('✅ Publicado no feed! Confira no perfil Receitas Favoritas em newpostia.app.', 'ok');
            $('aviso').scrollIntoView({ behavior: 'smooth' });
        } else {
            mostrarResultado((d.already ? '🔁 ' : '⚠️ ') + (d.error || 'Falha ao publicar.'), d.already ? 'atencao' : 'erro');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('btnOutras').addEventListener('click', () => carregar(true));
        $('texto').addEventListener('input', contar);
        $('btnFotoIA').addEventListener('click', fotoIA);
        $('btnFotoPC').addEventListener('click', () => { $('inputFoto').value = ''; $('inputFoto').click(); });
        $('inputFoto').addEventListener('change', fotoPC);
        $('btnSemFoto').addEventListener('click', () => { estado.foto = null; mostrarFoto(null); });
        $('btnPublicar').addEventListener('click', publicar);
        carregar(false);
    });
})();
