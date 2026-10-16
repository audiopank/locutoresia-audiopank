// Salvar/Abrir no PC da MiniDAW React (17/10/2026) — com o Supabase bloqueado o
// Salvar VIP não funciona; o projeto vira PASTA no computador, como na clássica.
// Rodar: node --test tests/projeto-no-pc-react.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../minidaw-react/src/lib/projetoNoPC.js';

// ── disco falso (imita FileSystemDirectoryHandle) ──────────────────────────
class Arquivo {
    constructor(nome) { this.kind = 'file'; this.name = nome; this.dados = null; this.escritas = 0; }
    async createWritable() {
        const eu = this;
        let partes = [];
        return { async write(d) { partes.push(d); }, async close() { eu.dados = new Blob(partes); eu.escritas++; } };
    }
    async getFile() {
        if (!this.dados) throw new Error('vazio');
        return this.dados;
    }
}
class Pasta {
    constructor(nome) { this.kind = 'directory'; this.name = nome; this.filhos = new Map(); }
    async getDirectoryHandle(nome, op = {}) {
        let h = this.filhos.get(nome);
        if (!h) {
            if (!op.create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' });
            h = new Pasta(nome);
            this.filhos.set(nome, h);
        }
        if (h.kind !== 'directory') throw new Error('não é pasta');
        return h;
    }
    async getFileHandle(nome, op = {}) {
        let h = this.filhos.get(nome);
        if (!h) {
            if (!op.create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' });
            h = new Arquivo(nome);
            this.filhos.set(nome, h);
        }
        return h;
    }
    async *entries() { yield* this.filhos.entries(); }
    async isSameEntry(outra) { return outra === this; }
}

const audios = { 'blob:voz': new Blob(['VOZ-WAV'], { type: 'audio/wav' }), 'blob:trilha': new Blob(['TRILHA-MP3'], { type: 'audio/mpeg' }) };
const lerAudio = async (url) => {
    if (!audios[url]) throw new Error('sumiu ' + url);
    return audios[url];
};
const faixas = () => [
    { id: '1', name: 'Locução 1', type: 'voiceover', audioUrl: 'blob:voz', volume: 100, color: 'azul', duration: 22.1,
      effects: { enabled: true, reverb: 0.69 }, audio_path: 'velho/nao-vai.mp3' },
    { id: '2', name: 'Trilha: épica/2', type: 'music', audioUrl: 'blob:trilha', volume: 19, color: 'roxo', duration: 53.4,
      effects: { enabled: true, reverb: 0.34 } },
];

test('nomeLimpo tira o que o Windows não aceita', () => {
    assert.equal(P.nomeLimpo('Trilha: épica/2?', 40, 'x'), 'Trilha épica 2');
    assert.equal(P.nomeLimpo('   ', 40, 'reserva'), 'reserva');
});

test('salvar grava Audio/ + projeto.minidaw-react.json; abrir devolve as faixas com efeitos', async () => {
    const pasta = new Pasta('Spot Agências');
    const arquivos = new Map();
    const r = await P.salvarNaPasta(pasta, { nome: 'Spot Agências', roteiro: 'texto', tracks: faixas() }, arquivos, lerAudio);
    assert.equal(r.novos, 2);
    assert.equal(r.ondeSalvou, 'Spot Agências');
    const audio = pasta.filhos.get('Audio');
    const nomes = [...audio.filhos.keys()];
    assert.ok(nomes.some((n) => n.startsWith('Locução 1 - ') && n.endsWith('.wav')), nomes);
    assert.ok(nomes.some((n) => n.startsWith('Trilha épica 2 - ') && n.endsWith('.mp3')), nomes);

    const proj = await P.lerProjeto(pasta);
    assert.equal(proj.formato, P.FORMATO);
    assert.equal(proj.name, 'Spot Agências');
    assert.equal(proj.tracks.length, 2);
    assert.equal(proj.tracks[0].audio_path, undefined, 'link da nuvem não vai pro arquivo do PC');
    assert.equal(proj.tracks[0].audioUrl, undefined);

    const urls = [];
    const aberto = await P.abrirDaPasta(pasta, proj, (blob) => { urls.push(blob); return 'blob:novo' + urls.length; });
    assert.equal(aberto.nome, 'Spot Agências');
    assert.equal(aberto.roteiro, 'texto');
    assert.equal(aberto.tracks[1].volume, 19);
    assert.equal(aberto.tracks[1].effects.reverb, 0.34);
    assert.equal(aberto.tracks[0].audioUrl, 'blob:novo1');
    assert.equal(await urls[0].text(), 'VOZ-WAV');
    assert.equal(aberto.faltando.length, 0);
    // Reabrir e salvar na mesma pasta: não regrava os áudios.
    const r2 = await P.salvarNaPasta(pasta, { nome: 'Spot Agências', roteiro: 'texto', tracks: aberto.tracks }, aberto.arquivos, async (u) => audios[u === 'blob:novo1' ? 'blob:voz' : 'blob:trilha']);
    assert.equal(r2.novos, 0);
    assert.equal(audio.filhos.size, 2);
});

test('salvar de novo só grava o áudio que mudou (ex.: voz cortada)', async () => {
    const pasta = new Pasta('P');
    const arquivos = new Map();
    await P.salvarNaPasta(pasta, { nome: 'P', roteiro: '', tracks: faixas() }, arquivos, lerAudio);
    audios['blob:cortada'] = new Blob(['VOZ-CORTADA'], { type: 'audio/wav' });
    const t = faixas();
    t[0].audioUrl = 'blob:cortada';
    const r = await P.salvarNaPasta(pasta, { nome: 'P', roteiro: '', tracks: t }, arquivos, lerAudio);
    assert.equal(r.novos, 1);
    assert.equal(pasta.filhos.get('Audio').filhos.size, 3, 'o áudio antigo fica (nunca apaga nada)');
});

test('pasta com OUTRO projeto vira pasta-mãe: cria subpasta, nunca substitui', async () => {
    const geral = new Pasta('SPOTS TODOS');
    await P.salvarNaPasta(geral, { nome: 'Spot A', roteiro: '', tracks: faixas() }, new Map(), lerAudio);
    const r = await P.salvarNaPasta(geral, { nome: 'Spot B', roteiro: '', tracks: faixas() }, new Map(), lerAudio);
    assert.equal(r.ondeSalvou, 'SPOTS TODOS/Spot B');
    assert.equal(r.pastaMae, geral);
    assert.equal((await P.lerProjeto(geral)).name, 'Spot A', 'o projeto da raiz continua intacto');
    // Outro "Spot B" diferente? Não: mesmo nome reaproveita a subpasta dele.
    const r3 = await P.salvarNaPasta(geral, { nome: 'Spot B', roteiro: '', tracks: faixas() }, new Map(), lerAudio);
    assert.equal(r3.ondeSalvou, 'SPOTS TODOS/Spot B');

    const lista = await P.projetosNaPasta(geral);
    assert.deepEqual(lista.map((x) => x.proj.name).sort(), ['Spot A', 'Spot B']);
});

test('projeto da MiniDAW clássica na mesma pasta é ignorado (formato diferente)', async () => {
    const geral = new Pasta('SPOTS');
    const cl = await geral.getDirectoryHandle('Spot clássica', { create: true });
    const fh = await cl.getFileHandle('projeto.locutores-ia.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ formato: 'locutores-ia-projeto', name: 'Spot clássica', tracks: [] }));
    await w.close();
    assert.deepEqual(await P.projetosNaPasta(geral), []);
});

test('abrir com áudio faltando na pasta avisa quais faltam e abre o resto', async () => {
    const pasta = new Pasta('P');
    await P.salvarNaPasta(pasta, { nome: 'P', roteiro: '', tracks: faixas() }, new Map(), lerAudio);
    const proj = await P.lerProjeto(pasta);
    const audioDir = pasta.filhos.get('Audio');
    audioDir.filhos.delete(proj.tracks[1].arquivo.slice('Audio/'.length));
    const aberto = await P.abrirDaPasta(pasta, proj, () => 'blob:x');
    assert.equal(aberto.tracks.length, 1);
    assert.deepEqual(aberto.faltando, ['Trilha: épica/2']);
});

test('abrir recusa caminho fora da pasta Audio (arquivo .json adulterado)', async () => {
    const pasta = new Pasta('P');
    const proj = { formato: P.FORMATO, name: 'P', tracks: [{ name: 'x', type: 'voiceover', arquivo: '../segredo.wav' }] };
    const aberto = await P.abrirDaPasta(pasta, proj, () => 'blob:x');
    assert.equal(aberto.tracks.length, 0);
    assert.deepEqual(aberto.faltando, ['x']);
});
