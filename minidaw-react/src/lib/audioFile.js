// minidaw-react/src/lib/audioFile.js
/**
 * Entrada e saída de arquivo da aba Masterizar. Isolado do resto para a
 * masterização não saber nada de File nem de Blob.
 */
import { Mp3Encoder } from '@breezystack/lamejs';
import { quantizar16 } from './dither.js';

/** Decodifica qualquer arquivo suportado pelo navegador num AudioBuffer. */
export async function decodificar(file) {
    const bytes = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
        return await ctx.decodeAudioData(bytes);
    } finally {
        ctx.close();
    }
}

/** AudioBuffer → WAV 16 bits. `dither` ('tpdf' | 'tpdf_shaped') só na exportação final do Masterizar. */
export function paraWav(buffer, { dither = null } = {}) {
    const nCh = buffer.numberOfChannels;
    const n = buffer.length;
    const sr = buffer.sampleRate;
    const bytes = 44 + n * nCh * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const texto = (pos, s) => { for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i)); };

    texto(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    texto(8, 'WAVE');
    texto(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, nCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * nCh * 2, true);
    view.setUint16(32, nCh * 2, true);
    view.setUint16(34, 16, true);
    texto(36, 'data');
    view.setUint32(40, n * nCh * 2, true);

    let pos = 44;
    const canais = [];
    for (let c = 0; c < nCh; c++) canais.push(quantizar16(buffer.getChannelData(c), dither));
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < nCh; c++) {
            view.setInt16(pos, canais[c][i], true);
            pos += 2;
        }
    }
    return new Blob([view], { type: 'audio/wav' });
}

/** AudioBuffer → MP3. Bitrate alto: é entrega para cliente, não streaming. */
export function paraMp3(buffer, kbps = 192, { dither = null } = {}) {
    const nCh = Math.min(2, buffer.numberOfChannels);
    const enc = new Mp3Encoder(nCh, buffer.sampleRate, kbps);
    const paraInt16 = (f32) => quantizar16(f32, dither);
    const esq = paraInt16(buffer.getChannelData(0));
    const dir = nCh > 1 ? paraInt16(buffer.getChannelData(1)) : esq;

    const partes = [];
    const bloco = 1152;
    for (let i = 0; i < esq.length; i += bloco) {
        const buf = nCh > 1
            ? enc.encodeBuffer(esq.subarray(i, i + bloco), dir.subarray(i, i + bloco))
            : enc.encodeBuffer(esq.subarray(i, i + bloco));
        if (buf.length) partes.push(buf);
    }
    const fim = enc.flush();
    if (fim.length) partes.push(fim);
    return new Blob(partes, { type: 'audio/mpeg' });
}

/** Dispara o download de um Blob com o nome dado. */
export function baixar(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
