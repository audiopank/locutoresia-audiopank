/**
 * 🔁 REGERAR TRECHO (05/11/2026, "Modo Especial" dele) — MiniDAW clássica.
 *
 * A IA errou a pronúncia no meio da locução ("Silvestre Arruda")? Marque SÓ
 * aquele trecho com a Tesoura na faixa de VOZ, digite a frase do jeito que
 * deve soar e gere uma fala nova só ali — sem regerar os 30 s inteiros.
 *
 * - A fala nova entra no lugar da marcada, com as MESMAS pausas em volta (o
 *   ritmo fica), volume igualado ao da voz e fade curtinho nas emendas.
 * - Tamanho diferente? O resto da MESMA faixa de voz anda a diferença; trilha
 *   e efeitos não se mexem. Objeto com cadeado não anda: aí nada é aplicado.
 * - Nada passa pelo Supabase: o áudio volta direto na resposta
 *   (`entrega: 'inline'`) e fica no projeto — o Salvar no PC grava junto.
 * - Ctrl+Z desfaz tudo de uma vez.
 *
 * Matemática pura em cima — testada em tests/regerar-trecho.test.mjs.
 */
(function (global) {
    'use strict';

    const CM = () => global.ClipModel;
    const AF = () => global.AlinharFalas;
    const CROSSFADE_S = 0.015;
    const MIN_S = 0.05;

    /** Amostras mono da faixa em [ini, fim) (tempo do projeto), com o volume de cada objeto. */
    function amostrasDaFaixa(clips, ini, fim, sr) {
        const out = new Float32Array(Math.max(0, Math.round((fim - ini) * sr)));
        for (const c of (clips || [])) {
            const buf = c.buffer;
            if (!buf || typeof buf.getChannelData !== 'function') continue;
            const a = Math.max(ini, c.inicio), b = Math.min(fim, c.inicio + c.duracao);
            if (b <= a) continue;
            const d = buf.getChannelData(0), srb = buf.sampleRate;
            const g = Math.pow(10, (Number(c.ganhoDb) || 0) / 20);
            const i1 = Math.min(out.length, Math.round((b - ini) * sr));
            for (let i = Math.round((a - ini) * sr); i < i1; i++) {
                const k = Math.floor((c.offset + (ini + i / sr - c.inicio)) * srb);
                if (k >= 0 && k < d.length) out[i] += d[k] * g;
            }
        }
        return out;
    }

    /** Silêncio que o produtor deixou antes/depois da fala marcada (s) — mantém o ritmo. */
    function pausasDoTrecho(clips, ini, fim, sr) {
        const a = amostrasDaFaixa(clips, ini, fim, sr);
        const b = a.length ? AF().bordasDaFala(a, sr, 0, a.length) : null;
        if (!b) return { antes: 0, depois: 0 };
        return { antes: b.ini / sr, depois: Math.max(0, (fim - ini) - b.fim / sr) };
    }

    /** Onde está a fala dentro do áudio novo (s), com as folgas do 🧲 Alinhar. null = só silêncio. */
    function falaDoBuffer(buffer) {
        const d = buffer.getChannelData(0), sr = buffer.sampleRate;
        const b = AF().bordasDaFala(d, sr, 0, d.length);
        return b ? { ini: b.ini / sr, fim: b.fim / sr } : null;
    }

    /**
     * Troca [ini, fim) da faixa pela fala nova. novo = { buffer, falaIni, falaFim }.
     * → { clips, delta, clipNovo, ganhoDb } ou { erro }. Não muta a lista recebida.
     */
    function costurar(clips, ini, fim, novo, opts) {
        const o = opts || {};
        const cf = typeof o.crossfade === 'number' ? o.crossfade : CROSSFADE_S;
        const pausas = o.pausas || { antes: 0, depois: 0 };
        if (!(fim - ini >= MIN_S)) return { erro: 'trecho-curto' };
        const durFala = novo.falaFim - novo.falaIni;
        if (!(durFala >= MIN_S)) return { erro: 'fala-vazia' };
        const lista = clips || [];
        const travado = (c) => CM().estaTravado(c);
        if (lista.some(c => travado(c) && c.inicio < fim && c.inicio + c.duracao > ini)) return { erro: 'travado' };
        const delta = pausas.antes + durFala + pausas.depois - (fim - ini);
        if (Math.abs(delta) > 1e-6 && lista.some(c => travado(c) && c.inicio >= fim - 1e-6)) return { erro: 'travado-depois' };

        const base = CM().silenciarTrecho(lista, ini, fim, cf);
        const andados = base.map(c => (c.inicio >= fim - 1e-6) ? Object.assign({}, c, { inicio: c.inicio + delta }) : c);
        const borda = Math.min(cf, durFala / 4);
        const clipNovo = {
            id: CM().novoId(), buffer: novo.buffer,
            inicio: ini + pausas.antes, offset: novo.falaIni, duracao: durFala,
            fadeIn: borda, fadeOut: borda
        };
        const resultado = CM().ordenarClips(andados.concat([clipNovo]));
        const ganhoDb = CM().igualarDb(resultado, clipNovo.inicio, clipNovo.inicio + durFala) || 0;
        if (ganhoDb) clipNovo.ganhoDb = ganhoDb;
        return { clips: resultado, delta, clipNovo, ganhoDb };
    }

    /** Frases do roteiro (botõezinhos do painel). Corta em . ! ? … e quebra de linha. */
    function frasesDoRoteiro(texto) {
        return (String(texto || '').match(/[^.!?…\n]+[.!?…]*/g) || [])
            .map(f => f.trim()).filter(f => f.length >= 2);
    }

    /** Voz pelo nome do clip: "Callirrhoe_-_Gemini_179…" → a voz Callirrhoe. */
    function vozDoNome(nome, vozes) {
        const chave = String(nome || '').trim().split(/[\s_\-]+/)[0].toLowerCase();
        if (chave.length < 3) return null;
        return (vozes || []).find(v => String(v.id || '').toLowerCase() === chave
            || String(v.name || '').toLowerCase().split(/[\s_\-]+/)[0] === chave) || null;
    }

    const RegerarTrecho = {
        amostrasDaFaixa, pausasDoTrecho, falaDoBuffer, costurar, frasesDoRoteiro, vozDoNome, CROSSFADE_S
    };
    global.RegerarTrecho = RegerarTrecho;
    if (typeof module !== 'undefined' && module.exports) module.exports = RegerarTrecho;
})(typeof window !== 'undefined' ? window : globalThis);
