/**
 * Cadeia de efeitos por faixa (mastering): Equalizador + Compressor + Reverb + Nivelar voz.
 * Baseado no AudioEffectsService do Studio original, adaptado para:
 *  - ser aplicado por faixa,
 *  - incluir Reverb (ConvolverNode com IR sintética),
 *  - poder ser "bakeado" no mix offline (OfflineAudioContext).
 */

export interface TrackEffects {
  enabled: boolean;
  eq: { low: number; mid: number; high: number }; // dB, -12..+12
  compressor: boolean;     // dá consistência/peso à voz
  reverb: number;          // 0..1 (quantidade de wet)
  normalize: boolean;      // "nivelar voz" — limiter + makeup
}

export const defaultEffects = (): TrackEffects => ({
  enabled: false,
  eq: { low: 0, mid: 0, high: 0 },
  compressor: false,
  reverb: 0,
  normalize: false,
});

export const hasActiveEffects = (fx?: TrackEffects): boolean =>
  !!fx && fx.enabled && (
    fx.compressor || fx.normalize || fx.reverb > 0 ||
    fx.eq.low !== 0 || fx.eq.mid !== 0 || fx.eq.high !== 0
  );

/** Impulse response sintética para reverb (ruído decaindo) — não precisa de arquivo */
export function generateReverbIR(ctx: BaseAudioContext, seconds = 2.2, decay = 2.5): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

/**
 * Monta a cadeia de efeitos no contexto dado e retorna os nós de entrada/saída.
 * Conecte: source → input ... output → (gain/destino).
 */
export function buildEffectChain(ctx: BaseAudioContext, fx: TrackEffects): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain();
  let node: AudioNode = input;

  // Equalizador (3 bandas)
  if (fx.eq.low !== 0 || fx.eq.mid !== 0 || fx.eq.high !== 0) {
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf"; low.frequency.value = 250; low.gain.value = fx.eq.low;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking"; mid.frequency.value = 2500; mid.Q.value = 1; mid.gain.value = fx.eq.mid;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf"; high.frequency.value = 8000; high.gain.value = fx.eq.high;
    node.connect(low); low.connect(mid); mid.connect(high);
    node = high;
  }

  // Compressor (consistência)
  if (fx.compressor) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25; comp.knee.value = 24;
    node.connect(comp);
    node = comp;
  }

  // Reverb (wet/dry em paralelo)
  let output: AudioNode = node;
  if (fx.reverb > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = generateReverbIR(ctx);
    const wet = ctx.createGain(); wet.gain.value = fx.reverb;
    const dry = ctx.createGain(); dry.gain.value = 1 - fx.reverb * 0.5;
    const merge = ctx.createGain();
    node.connect(dry); dry.connect(merge);
    node.connect(conv); conv.connect(wet); wet.connect(merge);
    output = merge;
  }

  // Nivelar voz (limiter + makeup gain)
  if (fx.normalize) {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.ratio.value = 20;
    lim.attack.value = 0.001; lim.release.value = 0.1; lim.knee.value = 0;
    const makeup = ctx.createGain(); makeup.gain.value = 1.4;
    output.connect(lim); lim.connect(makeup);
    output = makeup;
  }

  return { input, output };
}
