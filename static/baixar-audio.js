// Baixa a locução gerada sem bater no limite de 4,5 MB da Vercel (17/10/2026).
// Quando o Storage está fora, o /api/generate-audio devolve /api/download/<arquivo>,
// que sai pela função da Vercel: resposta acima de 4,5 MB vira HTTP 500 (WAV do
// Gemini = 48 KB/s → locução de mais de ~98 s). Aqui o /api/download desce em
// pedaços (Range) e é montado no navegador. URL assinada do Storage desce direto.
// Mesmo método do Gerador (static/gerador.js, baixarEDecodificar).
(function () {
    'use strict';

    const PEDACO_DOWNLOAD = 4 * 1000 * 1000;

    function conferirSom(r) {
        const tipo = (r.headers.get('Content-Type') || '').toLowerCase();
        if (tipo.includes('json') || tipo.includes('text/html')) throw new Error('O endereço do áudio devolveu erro em vez de som.');
        return tipo;
    }

    // Devolve um Blob com o áudio inteiro; erro claro se o servidor recusar.
    window.baixarAudioEmPartes = async function (url) {
        if (!url.startsWith('/api/download/')) {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`Falha ao buscar o áudio gerado (HTTP ${r.status})`);
            const tipo = conferirSom(r);
            return new Blob([await r.arrayBuffer()], { type: tipo || 'audio/wav' });
        }
        const partes = [];
        let inicio = 0, total = Infinity, tipo = 'audio/wav';
        while (inicio < total) {
            const r = await fetch(url, { headers: { 'Range': `bytes=${inicio}-${inicio + PEDACO_DOWNLOAD - 1}` } });
            if (!r.ok) throw new Error(`Falha ao buscar o áudio gerado (HTTP ${r.status})`);
            tipo = conferirSom(r) || tipo;
            const parte = new Uint8Array(await r.arrayBuffer());
            if (r.status !== 206) {             // servidor mandou o arquivo inteiro
                partes.length = 0;
                partes.push(parte);
                break;
            }
            const faixa = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
            total = faixa ? Number(faixa[1]) : inicio + parte.length;
            if (!parte.length) break;
            partes.push(parte);
            inicio += parte.length;
        }
        return new Blob(partes, { type: tipo });
    };
})();
