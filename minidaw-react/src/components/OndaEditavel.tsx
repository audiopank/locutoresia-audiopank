import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scissors, VolumeX, Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { picos, trechoValido, cortarTrecho, silenciarTrecho } from "@/lib/edicaoOnda.js";
import { paraWav } from "@/lib/audioFile.js";

/**
 * Onda REAL da faixa + edição de erro de locução (17/10/2026).
 * Substitui o <audio controls> solto da faixa: desenha o envelope do áudio de
 * verdade, cursor acompanha o play, clique pula pro ponto, arrastar marca um
 * trecho pra Cortar ou Silenciar; Desfazer volta a versão anterior.
 * A edição gera um WAV novo (blob:) e avisa o pai por `onEditado` — Prévia,
 * Exportar, Masterizar e Salvar VIP passam a usar a versão editada.
 * (O TrackWaveform.tsx da Lovable desenhava Math.random — foi apagado.)
 */

interface Props {
  audioUrl: string;
  tipo: "voiceover" | "music";
  onEditado: (url: string, duracao: number) => void;
  // Tempo do Play verde (mix) — null quando parado no começo. Vira cursor VERDE
  // na onda e o contador da faixa mostra ele (pedido dele, 17/10/2026).
  tempoMix?: number | null;
}

const ALTURA = 76;
let ctxCompartilhado: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();   // por URL: Desfazer não decodifica de novo

async function decodificarUrl(url: string): Promise<AudioBuffer> {
  const pronto = cache.get(url);
  if (pronto) return pronto;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!ctxCompartilhado) ctxCompartilhado = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buf = await ctxCompartilhado.decodeAudioData(await r.arrayBuffer());
  cache.set(url, buf);
  return buf;
}

const fmt = (s: number) => s.toFixed(2).replace(".", ",") + " s";
// Contador estilo DAW: m:ss,d
const relogio = (s: number) => {
  const t = Math.max(0, s || 0);
  const m = Math.floor(t / 60);
  const resto = t - m * 60;
  return `${m}:${resto.toFixed(1).padStart(4, "0").replace(".", ",")}`;
};

export function OndaEditavel({ audioUrl, tipo, onEditado, tempoMix = null }: Props) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [erro, setErro] = useState("");
  const [largura, setLargura] = useState(0);
  const [tempo, setTempo] = useState(0);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [arrasto, setArrasto] = useState<[number, number] | null>(null);
  const [editando, setEditando] = useState(false);
  const [pilha, setPilha] = useState<{ url: string; duracao: number }[]>([]);
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Decodifica o áudio da faixa (de novo a cada edição/desfazer — com cache).
  useEffect(() => {
    let vivo = true;
    setErro("");
    setSel(null);
    decodificarUrl(audioUrl)
      .then((b) => vivo && setBuffer(b))
      .catch((e) => vivo && setErro(`Não consegui desenhar a onda deste áudio (${e.message}).`));
    return () => { vivo = false; };
  }, [audioUrl]);

  // Largura real do espaço (a onda acompanha o tamanho da tela).
  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cursor acompanha o player enquanto toca.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const passo = () => { setTempo(a.currentTime); raf = requestAnimationFrame(passo); };
    const tocar = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(passo); };
    const parar = () => { cancelAnimationFrame(raf); setTempo(a.currentTime); };
    a.addEventListener("play", tocar);
    a.addEventListener("pause", parar);
    a.addEventListener("seeked", parar);
    a.addEventListener("ended", parar);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("play", tocar);
      a.removeEventListener("pause", parar);
      a.removeEventListener("seeked", parar);
      a.removeEventListener("ended", parar);
    };
  }, []);

  const envelope = useMemo(
    () => (buffer && largura ? picos(buffer.getChannelData(0), largura) : []),
    [buffer, largura]
  );

  // Desenho: onda, trecho marcado, cursor.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !largura) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = largura * dpr;
    cv.height = ALTURA * dpr;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, largura, ALTURA);
    const dur = buffer?.duration || 0;
    const x = (t: number) => (dur ? (t / dur) * largura : 0);
    const meio = ALTURA / 2;
    g.fillStyle = tipo === "voiceover" ? "rgba(96, 165, 250, 0.9)" : "rgba(192, 132, 252, 0.9)";
    envelope.forEach(([mn, mx], px) => {
      const y1 = meio - mx * meio;
      const y2 = meio - mn * meio;
      g.fillRect(px, y1, 1, Math.max(1, y2 - y1));
    });
    // Trecho marcado POR CIMA da onda (atrás dela some quando a voz é alta).
    const marcado = arrasto || sel;
    if (marcado && dur) {
      const [a, b] = [Math.min(...marcado), Math.max(...marcado)];
      g.fillStyle = "rgba(250, 204, 21, 0.38)";
      g.fillRect(x(a), 0, Math.max(1, x(b) - x(a)), ALTURA);
      g.fillStyle = "#facc15";
      g.fillRect(x(a), 0, 1, ALTURA);
      g.fillRect(Math.max(0, x(b) - 1), 0, 1, ALTURA);
    }
    if (dur) {
      g.fillStyle = "#f87171";
      g.fillRect(Math.min(largura - 2, x(tempo)), 0, 2, ALTURA);
    }
    // Cursor do Play verde (mix), igual em todas as faixas.
    if (dur && tempoMix != null && tempoMix <= dur) {
      g.fillStyle = "#4ade80";
      g.fillRect(Math.min(largura - 2, x(tempoMix)), 0, 2, ALTURA);
    }
  }, [envelope, largura, sel, arrasto, tempo, buffer, tipo, tempoMix]);

  const tempoDoPonteiro = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return frac * (buffer?.duration || 0);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!buffer) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const t = tempoDoPonteiro(e);
    setArrasto([t, t]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (arrasto) setArrasto([arrasto[0], tempoDoPonteiro(e)]);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!arrasto || !buffer) return;
    const t = tempoDoPonteiro(e);
    const trecho = trechoValido(arrasto[0], t, buffer.duration);
    setArrasto(null);
    if (trecho) {
      setSel(trecho);
    } else {
      setSel(null);   // clique sem arrastar: pula pro ponto
      if (audioRef.current) audioRef.current.currentTime = t;
      setTempo(t);
    }
  };

  const aplicar = useCallback(
    (fn: typeof cortarTrecho) => {
      if (!buffer || !sel) return;
      setEditando(true);
      setErro("");
      try {
        audioRef.current?.pause();
        const canais = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const novos = fn(canais, buffer.sampleRate, sel[0], sel[1], 10);
        const novo = new AudioBuffer({ length: novos[0].length, numberOfChannels: novos.length, sampleRate: buffer.sampleRate });
        novos.forEach((c, i) => novo.copyToChannel(c, i));
        const url = URL.createObjectURL(paraWav(novo));
        cache.set(url, novo);
        setPilha((p) => [...p, { url: audioUrl, duracao: buffer.duration }]);
        setSel(null);
        onEditado(url, novo.duration);
      } catch (e: any) {
        setErro(e.message);
      } finally {
        setEditando(false);
      }
    },
    [buffer, sel, audioUrl, onEditado]
  );

  const desfazer = () => {
    const ultimo = pilha[pilha.length - 1];
    if (!ultimo) return;
    audioRef.current?.pause();
    setPilha((p) => p.slice(0, -1));
    onEditado(ultimo.url, ultimo.duracao);
  };

  const doMix = tempoMix != null;
  return (
    <div className="space-y-2">
      {/* Contador da faixa: posição do cursor (vermelho) ou do Play verde (mix). */}
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-xl tabular-nums ${doMix ? "text-green-400" : "text-white"}`}>
          ⏱ {relogio(doMix ? tempoMix! : tempo)}
        </span>
        <span className="font-mono text-sm text-white/50 tabular-nums">/ {relogio(buffer?.duration || 0)}</span>
        <span className="text-xs text-white/40">{doMix ? "tempo do mix (Play verde)" : "cursor da faixa"}</span>
      </div>
      <div ref={caixaRef} className="relative w-full rounded-lg bg-black/30 border border-white/10 overflow-hidden" style={{ height: ALTURA }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: ALTURA, cursor: buffer ? "text" : "default", touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          aria-label="Onda do áudio: clique para posicionar, arraste para marcar um trecho"
        />
        {!buffer && !erro && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> desenhando a onda…
          </div>
        )}
      </div>
      <audio ref={audioRef} src={audioUrl} controls className="w-full" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-white/60 mr-1">
          {sel
            ? `Trecho: ${fmt(sel[0])} → ${fmt(sel[1])} (${fmt(sel[1] - sel[0])})`
            : "Som original da faixa (sem efeitos) · arraste na onda para marcar o erro · clique para pular"}
        </span>
        <Button size="sm" variant="outline" disabled={!sel || editando} onClick={() => aplicar(cortarTrecho)}
          className="bg-white/5 border-white/20 text-white hover:bg-white/10" title="Remove o trecho e junta as pontas (micro-fade, sem estalo)">
          <Scissors className="w-4 h-4 mr-1" /> Cortar trecho
        </Button>
        <Button size="sm" variant="outline" disabled={!sel || editando} onClick={() => aplicar(silenciarTrecho)}
          className="bg-white/5 border-white/20 text-white hover:bg-white/10" title="Zera o som do trecho mantendo o tempo (respiração, ruído)">
          <VolumeX className="w-4 h-4 mr-1" /> Silenciar trecho
        </Button>
        <Button size="sm" variant="outline" disabled={!pilha.length || editando} onClick={desfazer}
          className="bg-white/5 border-white/20 text-white hover:bg-white/10" title="Volta a versão anterior da faixa">
          <Undo2 className="w-4 h-4 mr-1" /> Desfazer{pilha.length ? ` (${pilha.length})` : ""}
        </Button>
      </div>
      {erro && <div className="text-xs text-red-300">{erro}</div>}
    </div>
  );
}
