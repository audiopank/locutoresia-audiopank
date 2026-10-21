import { Mp3Encoder } from "@breezystack/lamejs";
import { buildEffectChain, hasActiveEffects, type TrackEffects } from "./audioEffects";
import { detectarTrechos, aplicarGate } from "./gate.js";
import { linhaDoTempo, envelopeGanho } from "./linhaDoTempo.js";
import { limparRuidoBuffer } from "./limparRuido.js";

export type MixFormat = "mp3" | "wav";
export type MixQuality = "low" | "medium" | "high" | "ultra";

export interface MixTrack {
  audioUrl: string;
  type: "voiceover" | "music";
  volume: number; // 0-100
  effects?: TrackEffects;
  // 17/10/2026 (assinatura cantada do jingle no fim): onde a faixa entra e como a trilha desce.
  inicio?: number;                      // segundos; padrão 0
  fade?: "voz" | "fim" | "nenhum";      // só trilha; padrão "voz" (ver lib/linhaDoTempo.js)
  fadeIn?: number;                      // alças do objeto (s) — 17/10/2026
  fadeOut?: number;
}

export interface MixOptions {
  // Segundos após o fim da locução para a trilha baixar até o silêncio total
  musicFadeAfterVoice?: number;
  format?: MixFormat;
  quality?: MixQuality;
  onProgress?: (percent: number) => void;
}

const QUALITY: Record<MixQuality, { bitrate: number }> = {
  low: { bitrate: 128 },
  medium: { bitrate: 192 },
  high: { bitrate: 256 },
  ultra: { bitrate: 320 },
};

const TARGET_SAMPLE_RATE = 44100;

async function fetchAudioBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao carregar áudio (${res.status})`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeMp3(buffer: AudioBuffer, kbps: number, onProgress?: (p: number) => void): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const encoder = new Mp3Encoder(channels, buffer.sampleRate, kbps);

  const left = floatTo16(buffer.getChannelData(0));
  const right = channels > 1 ? floatTo16(buffer.getChannelData(1)) : left;

  const blockSize = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right.subarray(i, i + blockSize);
    const mp3buf = channels > 1 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
    if (onProgress && i % (blockSize * 64) === 0) onProgress(Math.min(99, (i / left.length) * 100));
  }
  const end = encoder.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  onProgress?.(100);
  return new Blob(chunks as BlobPart[], { type: "audio/mp3" });
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const data = new ArrayBuffer(44 + length * numChannels * bytesPerSample);
  const view = new DataView(data);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * numChannels * bytesPerSample, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * numChannels * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([data], { type: "audio/wav" });
}

/**
 * Mixa as faixas (voz + trilha) num único áudio com fade-out automático:
 * a trilha mantém o volume até o fim da locução e baixa até o silêncio total
 * ao longo de `musicFadeAfterVoice` segundos (padrão 1.1s). Um limiter no master
 * evita clipping ao somar as faixas. Retorna o áudio final (MP3 por padrão).
 */
export async function mixTracks(tracks: MixTrack[], opts: MixOptions = {}): Promise<Blob> {
  const fadeAfter = opts.musicFadeAfterVoice ?? 1.1;
  const format = opts.format ?? "mp3";
  const quality = opts.quality ?? "high";

  const playable = tracks.filter((t) => t.audioUrl);
  if (playable.length === 0) throw new Error("Nenhuma faixa com áudio para mixar.");

  const TmpCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const tmpCtx = new TmpCtx();
  const decoded = await Promise.all(
    playable.map(async (t) => ({ ...t, buffer: await fetchAudioBuffer(tmpCtx, t.audioUrl) }))
  );
  await tmpCtx.close();

  // Linha do tempo (lib/linhaDoTempo.js): onde cada faixa entra, quando cada trilha
  // desce e quanto dura o mix. Padrão igual ao de antes: trilha desce no fim da voz e
  // o mix acaba voz + fade (voz 30 s + trilha 120 s => ~31,1 s); sem voz, a faixa
  // mais longa. Com a assinatura cantada no fim, o mix vai até o fim dela.
  const tempo = linhaDoTempo(
    decoded.map((d) => ({ type: d.type, duracao: d.buffer.duration, inicio: d.inicio, fade: d.fade })),
    fadeAfter
  );
  const duration = Math.max(0.1, tempo.duracao);

  const frameCount = Math.ceil(duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, frameCount, TARGET_SAMPLE_RATE);

  // Limiter no master (evita estouro ao somar voz + trilha)
  const limiter = offline.createDynamicsCompressor();
  limiter.threshold.value = -1.0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  limiter.connect(offline.destination);

  for (const [indice, d] of decoded.entries()) {
    const { inicio, fadeEm } = tempo.faixas[indice];
    // 🧹 Limpar ruído (RNNoise) ANTES do gate e dos efeitos: é conserto do som cru.
    // Roda na cópia decodificada — o arquivo da faixa não muda.
    if (d.effects?.limparRuido) d.buffer = await limparRuidoBuffer(d.buffer);
    // Gate de respiração: roda ANTES da cadeia de efeitos (EQ/Compressor/etc),
    // direto no buffer decodificado — é conserto na voz crua, não estilo.
    // Independente de `hasActiveEffects`/`effects.enabled`: por isso é
    // checado aqui, fora do bloco que decide se builda a cadeia de nós.
    if (d.type === "voiceover" && d.effects?.gate?.ativo) {
      const trechos = detectarTrechos(d.buffer.getChannelData(0), d.buffer.sampleRate, d.effects.gate.sensibilidade);
      for (let ch = 0; ch < d.buffer.numberOfChannels; ch++) {
        aplicarGate(d.buffer.getChannelData(ch), d.buffer.sampleRate, trechos);
      }
    }

    const src = offline.createBufferSource();
    src.buffer = d.buffer;

    const gain = offline.createGain();
    const vol = Math.max(0, (d.volume ?? 100) / 100);
    // Envoltória: alças de fade-in/out do objeto + fade automático da trilha (o mais baixo vence).
    const pontos = envelopeGanho({
      volume: vol, inicio, duracao: d.buffer.duration, fadeIn: d.fadeIn, fadeOut: d.fadeOut,
      fadeEm, fadeDepois: fadeAfter,
    });
    gain.gain.setValueAtTime(pontos[0][1], 0);
    gain.gain.setValueAtTime(pontos[0][1], pontos[0][0]);
    for (const [t, v] of pontos.slice(1)) gain.gain.linearRampToValueAtTime(v, t);

    // Cadeia de efeitos por faixa (EQ + Compressor + Reverb + Nivelar) bakeada no mix
    if (hasActiveEffects(d.effects)) {
      const chain = buildEffectChain(offline, d.effects as TrackEffects);
      src.connect(chain.input);
      chain.output.connect(gain).connect(limiter);
    } else {
      src.connect(gain).connect(limiter);
    }
    src.start(inicio);
  }

  const rendered = await offline.startRendering();
  return format === "wav" ? encodeWav(rendered) : encodeMp3(rendered, QUALITY[quality].bitrate, opts.onProgress);
}

// Compat: nome anterior
export const mixToMp3 = mixTracks;

/** Estimativa de tamanho do MP3 final */
export function getEstimatedMp3Size(durationSeconds: number, quality: MixQuality = "high"): string {
  const bytes = (QUALITY[quality].bitrate * 1000 * durationSeconds) / 8;
  return bytes > 1024 * 1024 ? `~${(bytes / (1024 * 1024)).toFixed(1)} MB` : `~${(bytes / 1024).toFixed(0)} KB`;
}

/** Dispara o download de um Blob no navegador */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
