// static/comandos-minidaw.js — 🗣️ Comando por texto ou voz na MiniDAW clássica (25/11/2026).
//
// Tradutor PURO de frase em português -> lista de ações. Sem IA, sem rede, sem cota:
// regras simples e previsíveis. Quem aplica as ações é a MiniDAW (minidaw.js,
// executarComando), pelos MESMOS métodos dos botões — por isso o Ctrl+Z desfaz.
// Testado em node: tests/comandos-minidaw.test.mjs.
(function (global) {
    'use strict';

    const CORES = {
        vermelho: '#ef4444', azul: '#3b82f6', verde: '#22c55e',
        amarelo: '#eab308', roxo: '#a855f7', laranja: '#f97316'
    };
    const RE_COR = /\b(vermelh[oa]|azul|verde|amarel[oa]|rox[oa]|laranja)\b/;

    // Efeito falado -> chave em track.effects.
    const EFEITOS = [
        [/\b(reverb|reverber\w*)\b/, 'reverb', 'Reverb'],
        [/\b(eco|delay)\b/, 'delay', 'Eco'],
        [/\b(compressor|compress\w*)\b/, 'compressor', 'Compressor'],
        [/\b(equalizador|equaliza\w*|eq)\b/, 'eq', 'Equalizador'],
        // Só os nomes do efeito: "tira o chiado"/"tira a respiração" querem LIGAR o
        // efeito, e o "tira" leria como desligar — melhor não entender do que inverter.
        [/\b(de-?esser|deesser)\b/, 'deesser', 'De-esser'],
        [/\bgate\b/, 'gate', 'Gate'],
        [/\b(limitador|limiter)\b/, 'limiter', 'Limitador']
    ];

    // Verbos que começam um comando novo: só quebra a frase em " e " antes deles
    // (assim um nome como "Pão e Leite" não é partido no meio).
    // RADICAIS (+ qualquer terminação): "aumenta/aumente/aumentar/aumentando" — no teste
    // real (25/11) ele escreveu "AUMENTE ... E ELEMINE ..." e o tradutor só conhecia "aumenta".
    const VERBOS = 'deix|coloc|colo?qu|p[oõ]e|bot|adicion|tir|remov|silenci|mut|desmut|dessilenci|aument|sob|sub|' +
        'diminu|abaix|baix|reduz|renome|mud|troc|pint|lig|deslig|ativ|desativ|aplic|faz|fa[cç]|fade|mix|export|' +
        'normaliz|toc|solo|aceler|volt|el[ei]min|encurt|cort|limp';
    const SOBE = /\b(aument\w*|sob[ea]|sub[ai]\w*|levant\w*|mais alt[oa]|mais forte|mais presente)\b/;   // "sob[ea]" sem \w*: "sobre" não é subir
    const DESCE = /\b(diminu\w*|abaix\w*|baix[ae]\w*|reduz\w*|mais baix[oa]|mais frac[oa])\b/;
    const TIRA = /\b(tir[aeo]\w*|remov\w*|deslig\w*|desativ\w*|el[ei]min\w*|cort[aeo]\w*|sem)\b/;

    const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6,
        sete: 7, oito: 8, nove: 9, dez: 10, meio: 0.5 };

    const EXEMPLOS = 'Tente: "aumenta a voz em 6 dB", "abaixa a trilha", "coloca reverb na voz", ' +
        '"tira as pausas da voz", "tira a respiração", "fade out de 2 segundos na trilha", "edita a trilha em três partes", ' +
        '"deixa mais lento" ou "mixar tudo".';

    function semAcento(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    // Número da frase. Com `unidade`, prefere o colado nela ("3 dB", "2 segundos"):
    // em "aumenta a voz 2 em 3 dB" o 2 é o nome da faixa, não o valor.
    function numero(txt, unidade) {
        if (unidade) {
            const u = txt.match(new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(?:' + unidade + ')'));
            if (u) return parseFloat(u[1].replace(',', '.'));
            const w = txt.match(new RegExp('\\b([a-z]+)\\s+(?:' + unidade + ')'));
            if (w && NUMEROS[w[1]] != null) return NUMEROS[w[1]];
        }
        const m = txt.match(/(\d+(?:[.,]\d+)?)/);
        if (m) return parseFloat(m[1].replace(',', '.'));
        for (const [p, v] of Object.entries(NUMEROS)) {
            if (new RegExp('\\b' + semAcento(p) + '\\b').test(txt)) return v;
        }
        return null;
    }

    // Quebra em " e <verbo>" ou ", <verbo>" (assim "Pão e Leite" não parte no meio).
    function dividir(frase) {
        const re = new RegExp('\\s*(?:,?\\s+e|,)\\s+(?=(?:' + VERBOS + ')\\S*)', 'i');
        return frase.split(re).map(s => s.trim()).filter(Boolean);
    }

    // Quais faixas a oração cita. null = não citou nenhuma.
    function faixasCitadas(n, faixas) {
        const num = n.match(/\b(?:faixa|track|pista|canal)\s*(\d+)/);
        if (num) {
            const f = faixas[parseInt(num[1], 10) - 1];
            return f ? [f.id] : [];          // [] = citou faixa que não existe
        }
        // Nome da faixa escrito por extenso (o mais comprido primeiro).
        const porNome = faixas.filter(f => semAcento(f.name).trim().length >= 3)
            .sort((a, b) => b.name.length - a.name.length)
            .find(f => n.includes(semAcento(f.name).trim()));
        if (porNome) return [porNome.id];
        if (/\b(voz|vozes|locucao|locutor|locutora|narracao|fala)\b/.test(n)) {
            return faixas.filter(f => f.type === 'voice').map(f => f.id);
        }
        if (/\b(trilha|trilhas|musica|fundo|bg|beat)\b/.test(n)) {
            return faixas.filter(f => f.type === 'music' && !f.sfx).map(f => f.id);
        }
        if (/\b(efeito sonoro|efeitos sonoros|sfx)\b/.test(n)) {
            return faixas.filter(f => f.sfx).map(f => f.id);
        }
        return null;
    }

    // Uma oração -> ações. `herdadas` = faixas da oração anterior ("... e deixa vermelha").
    function interpretarOracao(original, faixas, herdadas) {
        // "aumenta avoz", "na trilha" grudado ("natrilha"): separa antes de procurar a faixa.
        const n = semAcento(original).replace(/\b(n?[ad]|pra)(voz|vozes|trilha|trilhas|musica|locucao)\b/g, '$1 $2');
        const citadas = faixasCitadas(n, faixas);
        if (citadas && !citadas.length) return { erro: 'Essa faixa não existe. Você tem ' + faixas.length + ' faixa(s).' };
        const alvo = citadas || herdadas;
        const acoes = [];
        const porFaixa = (fazer) => {
            if (!alvo || !alvo.length) return false;
            alvo.forEach(id => acoes.push(fazer(id)));
            return true;
        };
        const semFaixa = { erro: 'Em qual faixa? Diga "na voz", "na trilha" ou "na faixa 2".' };

        // Renomear é exclusivo: o resto da oração é o NOME, não comando.
        const ren = original.match(/(?:renomei[ae]r?|renomear|(?:muda|mude|troca|troque)r?\s+o\s+nome)\b.*?\s(?:pra|para|como)\s+["“']?(.+?)["”']?\s*[.!]?$/i);
        if (ren) {
            if (!alvo || alvo.length !== 1) return { erro: 'Renomear qual faixa? Ex: "renomeia a faixa 1 pra Locução Principal".' };
            return { acoes: [{ tipo: 'renomear', faixa: alvo[0], nome: ren[1].trim().slice(0, 60) }], faixas: alvo };
        }

        if (/\b(mixa|mixar|mixe|exporta|exportar)\b/.test(n) && /\b(tudo|todas|final|mix|faixas)\b|^\s*(mixa|mixar|exporta|exportar)\s*[.!]?\s*$/.test(n)) {
            return { acoes: [{ tipo: 'mixar' }], faixas: alvo };
        }
        if (/\bnormaliz/.test(n)) return { acoes: [{ tipo: 'normalizar' }], faixas: alvo };

        // Saída geral (Suíte Master): "liga o EQ master", "desliga o multimax", "liga o limiter do master".
        const modulo = /\bmultimax|multi-?banda|compressor de 3 bandas/.test(n) ? 'multimax'
            : (/\bmaster\b|\bmasteriza|\bsaida geral\b/.test(n)
                ? (/\b(eq|equaliza\w*|equalizador)\b/.test(n) ? 'eq' : /\b(limiter|limitador)\b/.test(n) ? 'limiter' : null)
                : null);
        if (modulo) {
            const rotulo = { eq: 'EQ master', multimax: 'MultiMax', limiter: 'Limiter do master' }[modulo];
            return { acoes: [{ tipo: 'master', modulo, rotulo, valor: !TIRA.test(n) }], faixas: alvo };
        }
        if (/^\s*(toca|tocar|play|ouvir|escutar)\b/.test(n)) return { acoes: [{ tipo: 'play' }], faixas: alvo };
        if (/^\s*(para|parar|pausa|pausar|stop)\s*[.!]?\s*$/.test(n)) return { acoes: [{ tipo: 'parar' }], faixas: alvo };

        // Andamento = Time Stretch com o nome que o povo entende. Sem faixa citada: as vozes.
        let andamento = null;
        if (/\b(mais devagar|devagar|mais lent[oa]|lent[oa])\b/.test(n)) andamento = 'lento';
        else if (/\b(mais rapid[oa]|rapid[oa]|acelera|mais ligeir[oa])\b/.test(n)) andamento = 'rapido';
        else if (/\b(andamento|velocidade)\s+normal\b|\bvolta\w*\s+(ao|pro|para o)\s+normal\b|\bnormal de novo\b/.test(n)) andamento = 'normal';
        if (andamento) {
            const ids = (alvo && alvo.length) ? alvo : faixas.filter(f => f.type === 'voice').map(f => f.id);
            if (!ids.length) return { erro: 'Não achei faixa de voz pra mudar o andamento.' };
            return { acoes: [{ tipo: 'andamento', faixas: ids, estado: andamento }], faixas: ids };
        }

        const vozes = faixas.filter(f => f.type === 'voice').map(f => f.id);
        const trilhas = faixas.filter(f => f.type === 'music' && !f.sfx).map(f => f.id);

        // 🎼 "edita a trilha em três partes (início + meio + final) quando terminar a voz" (26/11):
        // começo da música + o FINAL dela entrando no fim da voz. Antes do ducking ("quando ... voz ... trilha").
        const ehFade = /\bfade\b/.test(n);
        if (!ehFade && (/\b(\d|tres)\s+(partes|pedacos)\b/.test(n) ||
            (/\b(edit\w*|mont\w*|encaix\w*|fech\w*)\b/.test(n) && /\b(final|fim|termin\w*|partes|pedacos)\b/.test(n)))) {
            const citouTrilha = (alvo || []).filter(id => trilhas.includes(id));   // "quando terminar a voz" cita a voz
            const ids = citouTrilha.length ? citouTrilha : trilhas;
            if (!ids.length) return { erro: 'Não achei trilha pra editar.' };
            const seg = n.match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|seg)/);
            const finalSeg = seg ? Math.max(2, Math.min(15, parseFloat(seg[1].replace(',', '.')))) : null;
            return { acoes: [{ tipo: 'trilhaFinal', faixas: ids, finalSeg }], faixas: ids };
        }

        // Pausas / espaços / silêncios entre os trechos -> botão "Encurtar" (vale pra todas as vozes).
        const pausas = /\b(espac\w*|pausas?|silencios?|buracos?|vazios?)\b/.test(n) &&   // "espaçoes" (digitado assim) também
            (TIRA.test(n) || /\b(encurt\w*|diminu\w*|reduz\w*|junt\w*)\b/.test(n));
        if (pausas) {
            if (!vozes.length) return { erro: 'Não achei faixa de voz pra encurtar as pausas.' };
            acoes.push({ tipo: 'pausas', faixas: vozes, max: numero(n, 's\\b|seg|segundo') });
        }

        // Respiração e chiado: "tira/tirando/sem" = LIGAR o gate/de-esser; "volta/devolve" = desligar.
        const devolve = /\b(volt\w*|devolv\w*|mant[eé]\w*)\b/.test(n);
        const alvoVoz = (alvo && alvo.length) ? alvo : vozes;   // sem faixa citada: as vozes
        for (const [re, efeito, rotulo] of [[/\brespira\w*/, 'gate', 'Gate (respiração)'],
                                            [/\b(chiado|sibilancia|sss+)\b/, 'deesser', 'De-esser (chiado)']]) {
            if (!re.test(n)) continue;
            if (!alvoVoz.length) return semFaixa;
            alvoVoz.forEach(id => acoes.push({ tipo: 'efeito', faixa: id, efeito, rotulo, valor: !devolve }));
        }

        // Ducking: "abaixa mais a trilha quando a voz entra", "ducking de 12 dB".
        if (/\bducking\b/.test(n) || (/\b(quando|enquanto|embaixo|debaixo)\b/.test(n) && /\bvoz\b/.test(n) && /\btrilha\b/.test(n))) {
            if (!trilhas.length) return { erro: 'Não achei trilha pra ajustar o ducking.' };
            let db = numero(n, 'db|decibe');
            if (db == null) db = 12;
            db = Math.max(0, Math.min(20, db));
            trilhas.forEach(id => acoes.push({ tipo: 'ducking', faixa: id, db }));
            return { acoes, faixas: trilhas };
        }

        // Fade in / out.
        const fade = n.match(/\bfade\s*-?\s*(in|out|de entrada|de saida)\b/) ||
            (/\b(entrada|saida)\b/.test(n) && /\bfade\b/.test(n) ? n.match(/\b(entrada|saida)\b/) : null);
        if (fade) {
            const campo = /in|entrada/.test(fade[1]) ? 'fadeIn' : 'fadeOut';
            let s = numero(n.replace(/faixa\s*\d+/, ''), 's\\b|seg|segundo');
            if (TIRA.test(n)) s = 0;
            if (s == null) s = 2;
            s = Math.max(0, Math.min(5, s));
            if (!porFaixa(id => ({ tipo: 'fade', faixa: id, campo, segundos: s }))) return semFaixa;
        }

        // Efeitos (liga por padrão; "tira/sem/desliga" desliga). Reverb e eco aceitam
        // QUANTIDADE: "reverb na voz em 25%", "mais reverb", "menos eco" — e aí o
        // "aumenta/abaixa" da oração é do efeito, não do volume da faixa.
        let quantidadeTratada = false;
        for (const [re, chave, rotulo] of EFEITOS) {
            if (!re.test(n)) continue;
            const pctQ = n.match(/(\d+(?:[.,]\d+)?)\s*(%|por ?cento)/);
            const menos = DESCE.test(n) || /\bmenos\b/.test(n);
            if ((chave === 'reverb' || chave === 'delay') && !TIRA.test(n) && (pctQ || menos || SOBE.test(n) || /\bmais\b/.test(n))) {
                const pct = pctQ ? Math.max(0, Math.min(100, Math.round(parseFloat(pctQ[1].replace(',', '.'))))) : null;
                if (!porFaixa(id => ({ tipo: 'quantidade', faixa: id, efeito: chave, rotulo, pct, passo: pct == null ? (menos ? -10 : 10) : null }))) return semFaixa;
                quantidadeTratada = true;
                continue;
            }
            const liga = !TIRA.test(n);
            if (!porFaixa(id => ({ tipo: 'efeito', faixa: id, efeito: chave, rotulo, valor: liga }))) return semFaixa;
        }

        // Mudo / solo. ("tira os silêncios" é pausa, não mudo.)
        if (pausas) {
            // já tratado acima
        } else if (/\b(dessilenci\w*|desmut\w*|tir\w* o mudo|volt\w* o som|lig\w* o som|desmudo)\b/.test(n)) {
            if (!porFaixa(id => ({ tipo: 'mudo', faixa: id, valor: false }))) return semFaixa;
        } else if (/\b(silenci\w*|mut[ae]\w*|mudo|cal[ae]\w*|sem som|deslig\w* o som)\b/.test(n)) {
            if (!porFaixa(id => ({ tipo: 'mudo', faixa: id, valor: true }))) return semFaixa;
        }
        if (/\bsolo\b/.test(n)) {
            const liga = !TIRA.test(n);
            if (!porFaixa(id => ({ tipo: 'solo', faixa: id, valor: liga }))) return semFaixa;
        }

        // Volume: "+6 dB", "abaixa 2 dB", "em 80%". Sem número: 6 dB (3 era pouco, pedido dele 25/11).
        const sobe = SOBE.test(n) && !pausas && !quantidadeTratada;
        const desce = DESCE.test(n) && !pausas && !quantidadeTratada;
        const pct = quantidadeTratada ? null : n.match(/(\d+(?:[.,]\d+)?)\s*(%|por ?cento)/);
        if (pct && (/\bvolume\b/.test(n) || sobe || desce || /\bdeix\w*\b/.test(n))) {
            const v = Math.max(0, Math.min(150, Math.round(parseFloat(pct[1].replace(',', '.')))));
            if (!porFaixa(id => ({ tipo: 'volume', faixa: id, pct: v }))) return semFaixa;
        } else if (sobe || desce || (/\bvolume\b/.test(n) && /\bdb\b/.test(n))) {
            let db = numero(n.replace(/faixa\s*\d+/, ''), 'db|decibe');
            if (db == null) db = 6;
            db = Math.min(24, Math.abs(db)) * (desce ? -1 : 1);
            if (!porFaixa(id => ({ tipo: 'volume', faixa: id, db }))) return semFaixa;
        }

        // Cor (pode vir junto: "deixa a trilha em solo e vermelha" não parte em " e vermelha").
        const cor = n.match(RE_COR);
        if (cor) {
            const nome = cor[1].replace(/a$/, 'o').replace(/^azuo$/, 'azul').replace(/^verdo$/, 'verde').replace(/^laranjo$/, 'laranja');
            const hex = CORES[nome];
            if (hex && !porFaixa(id => ({ tipo: 'cor', faixa: id, cor: hex, nomeCor: nome }))) return semFaixa;
        }

        if (!acoes.length) return { erro: 'Não entendi "' + original.trim() + '". ' + EXEMPLOS };
        return { acoes, faixas: alvo };
    }

    // frase -> { acoes: [...] } ou { erro: 'mensagem pro produtor' }.
    // faixas: [{ id, name, type: 'voice'|'music'|'effect', sfx }] na ordem da tela.
    function interpretar(frase, faixas) {
        frase = String(frase || '').trim();
        if (!frase) return { erro: 'Digite ou fale um comando. ' + EXEMPLOS };
        faixas = faixas || [];
        const acoes = [];
        const naoEntendi = [];
        let herdadas = null;
        for (const oracao of dividir(frase)) {
            const r = interpretarOracao(oracao, faixas, herdadas);
            if (r.erro) { naoEntendi.push({ oracao, erro: r.erro }); continue; }
            acoes.push(...r.acoes);
            if (r.faixas && r.faixas.length) herdadas = r.faixas;
        }
        // Frase longa: faz o que entendeu e conta o que não entendeu (antes recusava tudo).
        if (!acoes.length) return { erro: naoEntendi.length === 1 ? naoEntendi[0].erro : 'Não entendi "' + frase + '". ' + EXEMPLOS };
        return { acoes, naoEntendi: naoEntendi.map(x => x.oracao) };
    }

    // Andamento exibido na tela a partir do fator do Time Stretch das vozes.
    const FATOR_ANDAMENTO = { lento: 1.10, normal: 1, rapido: 0.90 };
    function rotuloAndamento(fator) {
        if (fator == null || Math.abs(fator - 1) < 0.01) return 'Normal';
        if (Math.abs(fator - FATOR_ANDAMENTO.lento) < 0.01) return 'Mais Lento';
        if (Math.abs(fator - FATOR_ANDAMENTO.rapido) < 0.01) return 'Mais Rápido';
        return 'Personalizado (' + fator.toFixed(2).replace('.', ',') + '×)';
    }

    const ComandosMiniDAW = { interpretar, dividir, rotuloAndamento, FATOR_ANDAMENTO, CORES, EXEMPLOS };
    global.ComandosMiniDAW = ComandosMiniDAW;
    if (typeof module !== 'undefined' && module.exports) module.exports = ComandosMiniDAW;
})(typeof window !== 'undefined' ? window : globalThis);
