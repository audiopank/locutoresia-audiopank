// minidaw-react/src/lib/projetoNoPC.js
/**
 * Salvar/Abrir projeto NO COMPUTADOR na MiniDAW React (17/10/2026).
 * Com o Supabase bloqueado o Salvar VIP não funciona; o projeto vira uma PASTA,
 * no mesmo modelo da MiniDAW clássica (Samplitude: "Copy file to project directory"):
 *   <pasta>/projeto.minidaw-react.json  +  <pasta>/Audio/<faixa> - <marca>.<wav|mp3>
 * Arquivo de projeto com NOME e FORMATO próprios: a clássica usa
 * projeto.locutores-ia.json com outro formato de faixa — uma não abre a da outra.
 * Regras herdadas da clássica: nunca substitui outro projeto (pasta com outro
 * projeto vira pasta-mãe → subpasta "nome", "nome (2)"...), nunca apaga áudio,
 * cada áudio é gravado uma vez por pasta e o .json vai POR ÚLTIMO.
 * As funções recebem a pasta (FileSystemDirectoryHandle) e quem lê/cria URLs —
 * testadas no Node com um disco falso (tests/projeto-no-pc-react.test.mjs).
 */

export const ARQUIVO = 'projeto.minidaw-react.json';
export const FORMATO = 'locutores-ia-minidaw-react';

/** Tira do nome o que o Windows não aceita em arquivo/pasta. */
export function nomeLimpo(texto, max, reserva) {
    return String(texto || '').replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max) || reserva;
}

export async function lerProjeto(pasta) {
    try {
        const fh = await pasta.getFileHandle(ARQUIVO);
        const proj = JSON.parse(await (await fh.getFile()).text());
        return proj && proj.formato === FORMATO ? proj : null;
    } catch (e) {
        return null;
    }
}

async function subpastaDoProjeto(pai, nome) {
    const base = nomeLimpo(nome, 60, 'Projeto');
    for (let n = 1; n <= 50; n++) {
        const sub = await pai.getDirectoryHandle(n === 1 ? base : `${base} (${n})`, { create: true });
        const dentro = await lerProjeto(sub);
        if (!dentro || String(dentro.name || '').trim() === String(nome).trim()) return sub;
    }
    throw new Error('Não achei nome livre pra subpasta do projeto');
}

async function extensao(blob) {
    const t = String(blob.type || '').toLowerCase();
    if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
    if (t.includes('wav') || t.includes('wave')) return 'wav';
    if (t.includes('ogg')) return 'ogg';
    if (t.includes('webm')) return 'webm';
    if (t.includes('mp4') || t.includes('aac') || t.includes('m4a')) return 'm4a';
    const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const txt = String.fromCharCode(...b);
    if (txt === 'RIFF') return 'wav';
    if (txt.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
    if (txt === 'OggS') return 'ogg';
    return 'wav';
}

let seq = 0;

/**
 * Salva o projeto na pasta. `arquivos` (Map audioUrl → "Audio/x") lembra o que já
 * está gravado NESTA pasta — quem chama zera o Map ao trocar de pasta.
 * Devolve { pasta, pastaMae, ondeSalvou, novos }.
 */
export async function salvarNaPasta(pasta, { nome, roteiro, tracks }, arquivos, lerAudio) {
    let destino = pasta;
    let pastaMae = null;
    let ondeSalvou = pasta.name;
    const existente = await lerProjeto(pasta);
    if (existente && String(existente.name || '').trim() !== String(nome).trim()) {
        pastaMae = pasta;
        destino = await subpastaDoProjeto(pasta, nome);
        ondeSalvou = `${pasta.name}/${destino.name}`;
        arquivos.clear();
    }
    const dirAudio = await destino.getDirectoryHandle('Audio', { create: true });
    let novos = 0;
    const faixas = [];
    for (const t of tracks) {
        if (!t.audioUrl) continue;
        let arquivo = arquivos.get(t.audioUrl);
        if (!arquivo) {
            const blob = await lerAudio(t.audioUrl);
            const nomeArq = `${nomeLimpo(t.name, 40, 'faixa')} - ${Date.now().toString(36)}${++seq}.${await extensao(blob)}`;
            const fh = await dirAudio.getFileHandle(nomeArq, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            arquivo = `Audio/${nomeArq}`;
            arquivos.set(t.audioUrl, arquivo);
            novos++;
        }
        // Só o que descreve a faixa: links da nuvem/sessão (audioUrl, audio_path…) não vão.
        const { audioUrl, audio_path, audio_url_direct, audio_url, ...resto } = t;
        faixas.push({ ...resto, arquivo });
    }
    const pacote = { formato: FORMATO, versao: 1, name: nome, salvo_em: new Date().toISOString(), roteiro: roteiro || '', tracks: faixas };
    const fj = await destino.getFileHandle(ARQUIVO, { create: true });
    const wj = await fj.createWritable();
    await wj.write(JSON.stringify(pacote, null, 2));
    await wj.close();
    return { pasta: destino, pastaMae, ondeSalvou, novos };
}

/** Projetos da pasta: o da raiz (se houver) + um por subpasta. Mais recente primeiro. */
export async function projetosNaPasta(pasta) {
    const lista = [];
    const raiz = await lerProjeto(pasta);
    if (raiz) lista.push({ proj: raiz, pasta, rotulo: pasta.name, naRaiz: true });
    let vistas = 0;
    for await (const [nome, h] of pasta.entries()) {
        if (h.kind !== 'directory' || nome === 'Audio') continue;
        if (++vistas > 300) break;
        const proj = await lerProjeto(h);
        if (proj) lista.push({ proj, pasta: h, rotulo: nome, naRaiz: false });
    }
    lista.sort((a, b) => String(b.proj.salvo_em || '').localeCompare(String(a.proj.salvo_em || '')));
    return lista;
}

/**
 * Lê os áudios de Audio/ e devolve { nome, roteiro, tracks, arquivos, faltando }.
 * `criarUrl(blob)` vira a audioUrl da faixa (URL.createObjectURL no navegador).
 */
export async function abrirDaPasta(pasta, proj, criarUrl) {
    const tracks = [];
    const faltando = [];
    const arquivos = new Map();
    let dir = null;
    try { dir = await pasta.getDirectoryHandle('Audio'); } catch (e) { dir = null; }
    for (const t of proj.tracks || []) {
        const ok = typeof t.arquivo === 'string' && /^Audio\/[^/\\]+$/.test(t.arquivo) && !t.arquivo.includes('..');
        let blob = null;
        if (ok && dir) {
            try { blob = await (await dir.getFileHandle(t.arquivo.slice('Audio/'.length))).getFile(); } catch (e) { blob = null; }
        }
        if (!blob) { faltando.push(t.name || t.arquivo || 'faixa'); continue; }
        const audioUrl = criarUrl(blob);
        arquivos.set(audioUrl, t.arquivo);
        const { arquivo, ...resto } = t;
        tracks.push({ ...resto, audioUrl });
    }
    return { nome: proj.name, roteiro: proj.roteiro || '', tracks, arquivos, faltando };
}

// ── pasta geral lembrada (mesmo IndexedDB da clássica: as duas MiniDAWs moram
//    no mesmo site e dividem a pasta "SPOTS ... TODOS") ─────────────────────
function banco() {
    return new Promise((ok, erro) => {
        const req = indexedDB.open('locutores-ia', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('pastas');
        req.onsuccess = () => ok(req.result);
        req.onerror = () => erro(req.error);
    });
}

export async function carregarPastaGeral() {
    try {
        const db = await banco();
        const p = await new Promise((ok, erro) => {
            const r = db.transaction('pastas').objectStore('pastas').get('pastaGeral');
            r.onsuccess = () => ok(r.result || null);
            r.onerror = () => erro(r.error);
        });
        db.close();
        return p;
    } catch (e) {
        return null;
    }
}

export async function lembrarPastaGeral(pasta) {
    try {
        const db = await banco();
        await new Promise((ok, erro) => {
            const tx = db.transaction('pastas', 'readwrite');
            if (pasta) tx.objectStore('pastas').put(pasta, 'pastaGeral');
            else tx.objectStore('pastas').delete('pastaGeral');
            tx.oncomplete = () => ok();
            tx.onerror = () => erro(tx.error);
        });
        db.close();
    } catch (e) { /* sem IndexedDB: vale só nesta sessão */ }
}

export async function permissao(pasta) {
    const op = { mode: 'readwrite' };
    if ((await pasta.queryPermission(op)) === 'granted') return true;
    return (await pasta.requestPermission(op)) === 'granted';
}

export const suporta = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
