// minidaw-react/src/components/MasterizarPanel.tsx
import { useCallback, useState } from "react";
import { Upload, Loader2, Activity } from "lucide-react";
import { decodificar } from "@/lib/audioFile.js";
import { medir } from "@/lib/mastering.js";

type Medicao = {
  lufs: number; picoDb: number; faixaDinamica: number;
  balanco: number[]; duracao: number; sampleRate: number; canais: number;
};

/** Um número medido, ou um traço quando não há o que mostrar. */
function Numero({ rotulo, valor, unidade }: { rotulo: string; valor: number; unidade: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-semibold tabular-nums">
        {Number.isFinite(valor) ? valor.toFixed(1) : "—"}
        <span className="text-sm text-white/50 ml-1">{unidade}</span>
      </div>
      <div className="text-xs text-white/50 mt-1">{rotulo}</div>
    </div>
  );
}

export default function MasterizarPanel() {
  const [nome, setNome] = useState<string>("");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [medicao, setMedicao] = useState<Medicao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string>("");

  const carregar = useCallback(async (file: File) => {
    setCarregando(true); setErro("");
    try {
      const buf = await decodificar(file);
      setBuffer(buf);
      setNome(file.name);
      setMedicao(medir(buf));
    } catch (e: any) {
      setErro(`Não consegui ler "${file.name}". ${e?.message || ""}`);
      setBuffer(null); setMedicao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) carregar(f);
        }}
        className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center"
      >
        <Upload className="w-12 h-12 mx-auto mb-3 text-white/40" />
        <h3 className="text-lg font-semibold mb-1">Arraste o áudio para masterizar</h3>
        <p className="text-sm text-white/60 mb-4">
          Mix desta MiniDAW, da clássica, do seu teclado ou de terceiros. MP3, WAV, OGG, M4A.
        </p>
        <label className="inline-block px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
          Escolher arquivo
          <input
            type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) carregar(f); }}
          />
        </label>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" /> Lendo e medindo…
        </div>
      )}
      {erro && <div className="text-red-300 text-sm">{erro}</div>}

      {medicao && (
        <div className="rounded-xl bg-black/30 border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="font-medium">{nome}</span>
            <span className="text-xs text-white/50">
              {medicao.duracao.toFixed(1)}s · {medicao.sampleRate} Hz · {medicao.canais === 1 ? "mono" : "estéreo"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Numero rotulo="Volume medido" valor={medicao.lufs} unidade="LUFS" />
            <Numero rotulo="Pico real" valor={medicao.picoDb} unidade="dB" />
            <Numero rotulo="Faixa dinâmica" valor={medicao.faixaDinamica} unidade="dB" />
          </div>
        </div>
      )}
    </div>
  );
}
