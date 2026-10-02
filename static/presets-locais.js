// presets-locais.js — Presets da MiniDAW guardados NO NAVEGADOR (02/10/2026).
//
// Com o Supabase bloqueado (402), "Meus presets" do master sumiu e não guardava:
// o servidor respondia "lista vazia" e a tela apagava a cópia local. Agora a
// fonte da verdade é o navegador; a nuvem (/api/master-presets) é só bônus
// quando volta — o que vem de lá é MESCLADO (o salvo mais novo vence; nome
// apagado aqui não ressuscita com cópia velha da nuvem).
//
// Dois tipos: 'master' (o master inteiro: EQ, MultiMax, de-esser, estéreo,
// limiter) e 'faixa' (a cadeia de efeitos de uma voz ou trilha, com
// `tipoFaixa`). Exportar/Importar = arquivo .json pra backup e outra máquina.
(function (global) {
    'use strict';

    const CHAVE = 'locutores_presets_v1';
    const CHAVE_ANTIGA_MASTER = 'minidaw_master_presets';
    const FORMATO = 'locutores-ia-presets';
    const TIPOS = ['master', 'faixa'];
    const MAXIMO = 60;

    function vazio() {
        return { master: [], faixa: [], apagados: { master: {}, faixa: {} } };
    }

    function chaveNome(nome) {
        return String(nome || '').trim().toLowerCase();
    }

    function tempo(iso) {
        const t = Date.parse(iso || '');
        return isNaN(t) ? 0 : t;
    }

    function porNome(a, b) {
        return chaveNome(a.nome).localeCompare(chaveNome(b.nome), 'pt-BR');
    }

    function valido(p) {
        return p && typeof p === 'object' && String(p.nome || '').trim();
    }

    function normalizar(banco) {
        const b = vazio();
        if (!banco || typeof banco !== 'object') return b;
        for (const tipo of TIPOS) {
            b[tipo] = (Array.isArray(banco[tipo]) ? banco[tipo] : []).filter(valido);
            const ap = banco.apagados && banco.apagados[tipo];
            b.apagados[tipo] = (ap && typeof ap === 'object') ? Object.assign({}, ap) : {};
        }
        return b;
    }

    // Lista do tipo, em ordem de nome; `tipoFaixa` filtra voz ('voice') x trilha ('music').
    function lista(banco, tipo, tipoFaixa) {
        const l = (normalizar(banco)[tipo] || []).slice();
        return (tipoFaixa ? l.filter(p => p.tipoFaixa === tipoFaixa) : l).sort(porNome);
    }

    function guardar(banco, tipo, preset, agora) {
        const b = normalizar(banco);
        const nome = String((preset && preset.nome) || '').trim().slice(0, 40);
        if (!nome) throw new Error('Dê um nome ao preset');
        const k = chaveNome(nome);
        const antes = b[tipo].length;
        b[tipo] = b[tipo].filter(p => chaveNome(p.nome) !== k);
        const substituiu = b[tipo].length !== antes;
        if (!substituiu && b[tipo].length >= MAXIMO) throw new Error(`Limite de ${MAXIMO} presets — apague algum`);
        b[tipo].push(Object.assign({}, preset, { nome, salvo_em: agora || new Date().toISOString() }));
        delete b.apagados[tipo][k];
        b[tipo].sort(porNome);
        return { banco: b, substituiu };
    }

    function apagar(banco, tipo, nome, agora) {
        const b = normalizar(banco);
        const k = chaveNome(nome);
        b[tipo] = b[tipo].filter(p => chaveNome(p.nome) !== k);
        b.apagados[tipo][k] = agora || new Date().toISOString();
        return b;
    }

    // Une os locais com os de fora (nuvem ou arquivo): por nome, o salvo_em
    // mais novo vence; nome apagado localmente só volta se o de fora for mais
    // novo que a exclusão. Devolve a LISTA resultante (o banco não muda).
    function mesclar(banco, tipo, externos) {
        const b = normalizar(banco);
        const mapa = new Map(b[tipo].map(p => [chaveNome(p.nome), p]));
        for (const p of (Array.isArray(externos) ? externos : [])) {
            if (!valido(p)) continue;
            const k = chaveNome(p.nome);
            const apagadoEm = b.apagados[tipo][k];
            if (apagadoEm && tempo(apagadoEm) >= tempo(p.salvo_em)) continue;
            const atual = mapa.get(k);
            if (!atual || tempo(p.salvo_em) > tempo(atual.salvo_em)) mapa.set(k, p);
        }
        return Array.from(mapa.values()).sort(porNome);
    }

    function ler(storage) {
        let b = vazio();
        try {
            const bruto = storage.getItem(CHAVE);
            if (bruto) b = normalizar(JSON.parse(bruto));
            // Migração: a cópia que o master guardava antes (só lista de master).
            const antigo = storage.getItem(CHAVE_ANTIGA_MASTER);
            if (antigo) b.master = mesclar(b, 'master', JSON.parse(antigo));
        } catch (e) {
            return vazio();
        }
        return b;
    }

    function gravar(storage, banco) {
        try {
            storage.setItem(CHAVE, JSON.stringify(normalizar(banco)));
            return true;
        } catch (e) {
            return false;
        }
    }

    function exportar(banco) {
        const b = normalizar(banco);
        return JSON.stringify({ formato: FORMATO, versao: 1, exportado_em: new Date().toISOString(),
                                master: b.master, faixa: b.faixa }, null, 1);
    }

    function importar(banco, texto) {
        let obj;
        try { obj = JSON.parse(texto); } catch (e) { obj = null; }
        if (!obj || obj.formato !== FORMATO) throw new Error('Esse arquivo não é um arquivo de presets da Locutores IA');
        const b = normalizar(banco);
        let novos = 0, atualizados = 0;
        for (const tipo of TIPOS) {
            const antes = new Map(b[tipo].map(p => [chaveNome(p.nome), p.salvo_em]));
            const externos = (Array.isArray(obj[tipo]) ? obj[tipo] : []).filter(valido);
            // Importar é decisão explícita: o que vem do arquivo desfaz exclusões antigas.
            for (const p of externos) delete b.apagados[tipo][chaveNome(p.nome)];
            b[tipo] = mesclar(b, tipo, externos);
            for (const p of b[tipo]) {
                const k = chaveNome(p.nome);
                if (!antes.has(k)) novos++;
                else if (antes.get(k) !== p.salvo_em) atualizados++;
            }
        }
        return { banco: b, novos, atualizados };
    }

    const PresetsLocais = { CHAVE, CHAVE_ANTIGA_MASTER, vazio, lista, guardar, apagar, mesclar, ler, gravar,
                            exportar, importar };
    global.PresetsLocais = PresetsLocais;
    if (typeof module !== 'undefined' && module.exports) module.exports = PresetsLocais;
})(typeof window !== 'undefined' ? window : globalThis);
