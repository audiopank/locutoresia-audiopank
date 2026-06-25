import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sliders, Waves, Gauge, Activity, ChevronDown, ChevronUp } from "lucide-react";
import type { TrackEffects } from "@/lib/audioEffects";

interface TrackEffectsPanelProps {
  effects: TrackEffects;
  onChange: (fx: TrackEffects) => void;
}

const EqBand = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-white/60 w-12">{label}</span>
    <Slider value={[value]} min={-12} max={12} step={1} onValueChange={([v]) => onChange(v)} className="flex-1" />
    <span className="text-xs text-white/70 w-12 text-right">{value > 0 ? `+${value}` : value} dB</span>
  </div>
);

export const TrackEffectsPanel = ({ effects, onChange }: TrackEffectsPanelProps) => {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TrackEffects>) => onChange({ ...effects, ...patch });
  const setEq = (patch: Partial<TrackEffects["eq"]>) => onChange({ ...effects, eq: { ...effects.eq, ...patch } });

  const activeCount =
    (effects.compressor ? 1 : 0) + (effects.normalize ? 1 : 0) + (effects.reverb > 0 ? 1 : 0) +
    (effects.eq.low || effects.eq.mid || effects.eq.high ? 1 : 0);

  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="flex items-center justify-between p-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm text-white/80 hover:text-white">
          <Sliders className="w-4 h-4 text-purple-400" />
          Efeitos
          {effects.enabled && activeCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200">{activeCount} ativo(s)</span>
          )}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">Ativar</span>
          <Switch checked={effects.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </div>
      </div>

      {open && (
        <div className={`p-4 pt-0 space-y-4 ${effects.enabled ? "" : "opacity-50 pointer-events-none"}`}>
          {/* Toggles rápidos */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-2 p-2 rounded-md bg-white/5">
              <span className="flex items-center gap-2 text-sm text-white/80"><Gauge className="w-4 h-4 text-blue-400" /> Compressor</span>
              <Switch checked={effects.compressor} onCheckedChange={(v) => set({ compressor: v })} />
            </label>
            <label className="flex items-center justify-between gap-2 p-2 rounded-md bg-white/5">
              <span className="flex items-center gap-2 text-sm text-white/80"><Activity className="w-4 h-4 text-green-400" /> Nivelar voz</span>
              <Switch checked={effects.normalize} onCheckedChange={(v) => set({ normalize: v })} />
            </label>
          </div>

          {/* Reverb */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-white/80 w-28"><Waves className="w-4 h-4 text-cyan-400" /> Reverb</span>
            <Slider value={[Math.round(effects.reverb * 100)]} min={0} max={100} step={1} onValueChange={([v]) => set({ reverb: v / 100 })} className="flex-1" />
            <span className="text-xs text-white/70 w-10 text-right">{Math.round(effects.reverb * 100)}%</span>
          </div>

          {/* Equalizador */}
          <div className="space-y-2">
            <span className="text-sm text-white/80">Equalizador</span>
            <EqBand label="Graves" value={effects.eq.low} onChange={(v) => setEq({ low: v })} />
            <EqBand label="Médios" value={effects.eq.mid} onChange={(v) => setEq({ mid: v })} />
            <EqBand label="Agudos" value={effects.eq.high} onChange={(v) => setEq({ high: v })} />
          </div>

          <p className="text-xs text-white/40">Os efeitos são aplicados no mix final (Exportar/Mix Rápido).</p>
        </div>
      )}
    </div>
  );
};

export default TrackEffectsPanel;
