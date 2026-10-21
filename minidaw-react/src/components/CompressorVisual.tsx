import { useEffect, useRef } from "react";
import { Gauge } from "lucide-react";
import { PRESETS, LIMITES, curva } from "@/lib/compressorMaster.js";

/**
 * Compressor do Masterizar — visual no padrão "Dynamics" da Acon (21/10/2026):
 * botões giratórios com o número embaixo, curva de transferência ao vivo e,
 * depois de masterizar, a redução de ganho em vermelho ao longo do áudio.
 * Lógica em lib/compressorMaster.js.
 */

export type ParamsComp = {
  ativo: boolean; preset: string;
  gainIn: number; threshold: number; ratio: number; knee: number;
  attack: number; release: number; makeup: number; mix: number;
};
export type ReducaoComp = { reducaoDb: Float32Array; blocoS: number; maxReducaoDb: number } | null;

type Chave = "gainIn" | "threshold" | "ratio" | "knee" | "attack" | "release" | "makeup" | "mix";
const BOTOES: { chave: Chave; rotulo: string; unid: string; log?: boolean; passo: number }[] = [
  { chave: "gainIn", rotulo: "Gain in", unid: "dB", passo: 0.1 },
  { chave: "threshold", rotulo: "Threshold", unid: "dB", passo: 0.1 },
  { chave: "ratio", rotulo: "Ratio", unid: ":1", log: true, passo: 0.05 },
  { chave: "knee", rotulo: "Knee", unid: "dB", passo: 0.1 },
  { chave: "attack", rotulo: "Attack", unid: "ms", log: true, passo: 0.1 },
  { chave: "release", rotulo: "Release", unid: "ms", log: true, passo: 1 },
  { chave: "makeup", rotulo: "Make-up", unid: "dB", passo: 0.1 },
  { chave: "mix", rotulo: "Mix", unid: "%", passo: 1 },
];

const arred = (v: number, passo: number) => Math.round(v / passo) * passo;
const fmt = (v: number, passo: number) => (passo >= 1 ? v.toFixed(0) : passo >= 0.1 ? v.toFixed(1) : v.toFixed(2));

/** Botão giratório: arrastar pra cima/baixo, rodinha do mouse, duplo clique volta ao preset. */
function Botao({ valor, min, max, log, passo, rotulo, unid, padrao, desligado, onChange }: {
  valor: number; min: number; max: number; log?: boolean; passo: number; rotulo: string; unid: string;
  padrao: number; desligado: boolean; onChange: (v: number) => void;
}) {
  const paraFrac = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const deFrac = (f: number) => {
    const ff = Math.max(0, Math.min(1, f));
    return arred(log ? min * Math.pow(max / min, ff) : min + ff * (max - min), passo);
  };
  const frac = Math.max(0, Math.min(1, paraFrac(valor)));
  const ang = -135 + frac * 270;
  const arco = (a0: number, a1: number) => {
    const r = 20, cx = 26, cy = 26;
    const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const arrasto = useRef<{ y: number; f: number } | null>(null);
  return (
    <div className={`flex flex-col items-center gap-1 select-none ${desligado ? "opacity-50" : ""}`}>
      <span className="text-[11px] text-white/70">{rotulo} ({unid})</span>
      <svg width={52} height={52} style={{ cursor: "ns-resize", touchAction: "none" }}
        role="slider" aria-label={rotulo} aria-valuenow={valor} aria-valuemin={min} aria-valuemax={max}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); arrasto.current = { y: e.clientY, f: frac }; }}
        onPointerMove={(e) => { if (arrasto.current) onChange(deFrac(arrasto.current.f + (arrasto.current.y - e.clientY) / (e.shiftKey ? 600 : 160))); }}
        onPointerUp={() => { arrasto.current = null; }}
        onDoubleClick={() => onChange(padrao)}
        onWheel={(e) => { onChange(deFrac(frac + (e.deltaY < 0 ? 1 : -1) * 0.02)); }}>
        <path d={arco(-135, 135)} stroke="rgba(255,255,255,0.15)" strokeWidth={4} fill="none" strokeLinecap="round" />
        {frac > 0.003 && <path d={arco(-135, ang)} stroke="#f59e0b" strokeWidth={4} fill="none" strokeLinecap="round" />}
        <circle cx={26} cy={26} r={14} fill="#e5e7eb" />
        <line x1={26} y1={26} x2={26 + 11 * Math.sin((ang * Math.PI) / 180)} y2={26 - 11 * Math.cos((ang * Math.PI) / 180)}
          stroke="#111827" strokeWidth={3} strokeLinecap="round" />
      </svg>
      <input type="number" value={fmt(valor, passo)} step={passo} min={min} max={max}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }}
        className="w-16 text-center text-xs bg-black/50 border border-white/15 rounded px-1 py-0.5 tabular-nums" />
    </div>
  );
}

export function CompressorVisual({ params, onChange, reducao }: {
  params: ParamsComp; onChange: (p: ParamsComp) => void; reducao: ReducaoComp;
}) {
  const curvaRef = useRef<HTMLCanvasElement>(null);
  const grRef = useRef<HTMLCanvasElement>(null);
  const preset = PRESETS.find((p) => p.id === params.preset) || PRESETS[0];

  // Curva de transferência ao vivo (−60 a 0 dB nos dois eixos).
  useEffect(() => {
    const cv = curvaRef.current;
    if (!cv) return;
    const W = 220, H = 220, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#1f2937"; g.fillRect(0, 0, W, H);
    const px = (db: number) => ((db + 60) / 60) * W;
    const py = (db: number) => H - ((db + 60) / 60) * H;
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
    for (let d = -50; d < 0; d += 10) {
      g.beginPath(); g.moveTo(px(d), 0); g.lineTo(px(d), H); g.stroke();
      g.beginPath(); g.moveTo(0, py(d)); g.lineTo(W, py(d)); g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.45)"; g.font = "10px sans-serif";
    for (let d = -50; d < 0; d += 10) g.fillText(String(d), px(d) + 2, H - 3);
    // threshold (laranja), como na Acon
    g.strokeStyle = "#f59e0b"; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(px(params.threshold), 0); g.lineTo(px(params.threshold), H); g.stroke();
    g.beginPath(); g.moveTo(0, py(params.threshold)); g.lineTo(W, py(params.threshold)); g.stroke();
    g.setLineDash([]);
    // curva (branca), com o gain in e o make-up
    g.strokeStyle = params.ativo ? "#ffffff" : "rgba(255,255,255,0.35)"; g.lineWidth = 2;
    g.beginPath();
    for (let x = -60; x <= 0; x += 0.5) {
      const y = curva(x + params.gainIn, params) + params.makeup;
      const yy = Math.max(-60, Math.min(0, y));
      if (x === -60) g.moveTo(px(x), py(yy)); else g.lineTo(px(x), py(yy));
    }
    g.stroke();
  }, [params]);

  // Redução de ganho (vermelho de cima pra baixo), da última masterização.
  useEffect(() => {
    const cv = grRef.current;
    if (!cv) return;
    const W = cv.clientWidth || 600, H = 90, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#111827"; g.fillRect(0, 0, W, H);
    const maxDb = 12;
    g.strokeStyle = "rgba(255,255,255,0.08)";
    for (let d = 3; d <= maxDb; d += 3) { const y = (d / maxDb) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = "rgba(255,255,255,0.4)"; g.font = "10px sans-serif";
    for (let d = 3; d <= maxDb; d += 3) g.fillText(`-${d}`, 3, (d / maxDb) * H - 2);
    if (!reducao || !reducao.reducaoDb.length) return;
    const n = reducao.reducaoDb.length;
    g.fillStyle = "#dc2626";
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((x / W) * n), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * n));
      let m = 0;
      for (let i = i0; i < i1 && i < n; i++) if (reducao.reducaoDb[i] > m) m = reducao.reducaoDb[i];
      g.fillRect(x, 0, 1, (Math.min(m, maxDb) / maxDb) * H);
    }
  }, [reducao]);

  const set = (patch: Partial<ParamsComp>) => onChange({ ...params, ...patch });
  const aplicarPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const { id: _id, nome: _n, ...valores } = p;
    onChange({ ...params, ...valores, preset: id });
  };

  return (
    <div className="mt-4 pt-3 border-t border-white/10">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={params.ativo} onChange={(e) => set({ ativo: e.target.checked })}
            aria-label="Ligar compressor do master" className="w-4 h-4 accent-amber-500" />
          <Gauge className="w-4 h-4 text-amber-400" /> Compressor (cola do master)
        </label>
        <label className="text-sm flex items-center gap-2">
          <span className="text-white/60">Preset</span>
          <select value={params.preset} onChange={(e) => aplicarPreset(e.target.value)} aria-label="Preset do compressor"
            className="bg-black/40 border border-white/15 rounded-lg px-2 py-1">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-white/40 mb-3">
        Entra entre o acabamento de tom e o limitador; o volume final continua batendo o LUFS do destino.
        Desligado, o Masterizar fica exatamente como era. Arraste os botões pra cima/baixo (Shift = ajuste fino),
        rodinha do mouse, ou digite o número; duplo clique volta ao valor do preset.
      </p>
      <div className={`flex flex-wrap gap-4 items-start ${params.ativo ? "" : "opacity-60"}`}>
        <div>
          <canvas ref={curvaRef} style={{ width: 220, height: 220 }} className="rounded-lg border border-white/10"
            aria-label="Curva do compressor" />
          <div className="text-[11px] text-white/40 text-center mt-1">entrada (dB) → saída</div>
        </div>
        <div className="grid grid-cols-4 gap-x-4 gap-y-3">
          {BOTOES.map((b) => {
            const [mn, mx] = (LIMITES as any)[b.chave] as [number, number];
            return (
              <Botao key={b.chave} valor={params[b.chave]} min={mn} max={mx} log={b.log} passo={b.passo}
                rotulo={b.rotulo} unid={b.unid} padrao={(preset as any)[b.chave]} desligado={!params.ativo}
                onChange={(v) => set({ [b.chave]: v } as Partial<ParamsComp>)} />
            );
          })}
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-white/50 mb-1">
          <span>Redução de ganho na última masterização (vermelho = quanto ele segurou)</span>
          <span className="tabular-nums">{reducao ? `máx. −${reducao.maxReducaoDb.toFixed(1)} dB` : "masterize com o compressor ligado pra ver"}</span>
        </div>
        <canvas ref={grRef} style={{ width: "100%", height: 90 }} className="rounded-lg border border-white/10"
          aria-label="Redução de ganho" />
      </div>
    </div>
  );
}
