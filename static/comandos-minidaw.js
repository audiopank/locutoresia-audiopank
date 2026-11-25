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
    const VERBOS = 'deixa|deixe|deixar|coloca|coloque|colocar|poe|põe|bota|adiciona|adicione|tira|tire|remove|remova|' +
        'silencia|silencie|muta|desmuta|dessilencia|aumenta|aumente|sobe|diminui|diminua|abaixa|abaixe|baixa|reduz|' +
        'renomeia|renomeie|muda|mude|troca|troque|pinta|pinte|liga|ligue|desliga|desligue|ativa|ative|desativa|' +
        'aplica|aplique|faz|faça|fade|mixa|mixar|exporta|normaliza|normalize|toca|solo|acelera|volta';

    const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6,
        sete: 7, oito: 8, nove: 9, dez: 10, meio: 0.5 };

    const EXEMPLOS = 'Tente: "aumenta a voz em 3 dB", "silencia a trilha", "coloca reverb na voz", ' +
        '"fade out de 2 segundos na trilha", "deixa mais lento" ou "mixar tudo".';

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

    function dividir(frase) {
        const re = new RegExp('\\s*(?:,\\s*|\\s)e\\s+(?=(?:' + VERBOS + ')\\b)', 'i');
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
        const n = semAcento(original);
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

        // Fade in / out.
        const fade = n.match(/\bfade\s*-?\s*(in|out|de entrada|de saida)\b/) ||
            (/\b(entrada|saida)\b/.test(n) && /\bfade\b/.test(n) ? n.match(/\b(entrada|saida)\b/) : null);
        if (fade) {
            const campo = /in|entrada/.test(fade[1]) ? 'fadeIn' : 'fadeOut';
            let s = numero(n.replace(/faixa\s*\d+/, ''), 's\\b|seg|segundo');
            if (/\b(sem|tira|remove)\b/.test(n)) s = 0;
            if (s == null) s = 2;
            s = Math.max(0, Math.min(5, s));
            if (!porFaixa(id => ({ tipo: 'fade', faixa: id, campo, segundos: s }))) return semFaixa;
        }

        // Efeitos (liga por padrão; "tira/sem/desliga" desliga).
        for (const [re, chave, rotulo] of EFEITOS) {
            if (!re.test(n)) continue;
            const liga = !/\b(tira|tire|remove|remova|desliga|desligue|desativa|sem)\b/.test(n);
            if (!porFaixa(id => ({ tipo: 'efeito', faixa: id, efeito: chave, rotulo, valor: liga }))) return semFaixa;
        }

        // Mudo / solo.
        if (/\b(dessilencia\w*|desmut\w*|tira\w* o mudo|volta\w* o som|liga\w* o som|desmudo)\b/.test(n)) {
            if (!porFaixa(id => ({ tipo: 'mudo', faixa: id, valor: false }))) return semFaixa;
        } else if (/\b(silencia\w*|muta\w*|mudo|cala\w*|sem som|desliga\w* o som)\b/.test(n)) {
            if (!porFaixa(id => ({ tipo: 'mudo', faixa: id, valor: true }))) return semFaixa;
        }
        if (/\bsolo\b/.test(n)) {
            const liga = !/\b(tira|tire|remove|sem|desliga)\b/.test(n);
            if (!porFaixa(id => ({ tipo: 'solo', faixa: id, valor: liga }))) return semFaixa;
        }

        // Volume: "+3 dB", "abaixa 2 dB", "em 80%".
        const sobe = /\b(aumenta\w*|sobe|subir|levanta\w*|mais alt[oa]|mais forte)\b/.test(n);
        const desce = /\b(diminui\w*|abaixa\w*|baixa\w*|reduz\w*|mais baix[oa]|mais fraca|mais fraco)\b/.test(n);
        const pct = n.match(/(\d+(?:[.,]\d+)?)\s*(%|por ?cento)/);
        if (pct && (/\bvolume\b/.test(n) || sobe || desce || /\bdeixa\b/.test(n))) {
            const v = Math.max(0, Math.min(150, Math.round(parseFloat(pct[1].replace(',', '.')))));
            if (!porFaixa(id => ({ tipo: 'volume', faixa: id, pct: v }))) return semFaixa;
        } else if (sobe || desce || (/\bvolume\b/.test(n) && /\bdb\b/.test(n))) {
            let db = numero(n.replace(/faixa\s*\d+/, ''), 'db|decibe');
            if (db == null) db = 3;
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
        let herdadas = null;
        for (const oracao of dividir(frase)) {
            const r = interpretarOracao(oracao, faixas, herdadas);
            if (r.erro) return { erro: r.erro };
            acoes.push(...r.acoes);
            if (r.faixas && r.faixas.length) herdadas = r.faixas;
        }
        return { acoes };
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
