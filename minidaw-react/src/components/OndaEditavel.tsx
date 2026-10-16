import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scissors, VolumeX, Undo2, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  trechoValido, cortarTrecho, silenciarTrecho, janelaVisivel, rolagemParaAncora, picosDaJanela,
} from "@/lib/edicaoOnda.js";
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
  // Arrastar o trecho marcado pra OUTRA faixa (pedido dele, 17/10/2026: separar a
  // assinatura cantada do jingle num track próprio). Devolve true se a faixa de
  // destino aceitou — aí o trecho SAI desta (mover; o Desfazer daqui traz de volta).
  faixaId?: string;
  onSoltarTrecho?: (destinoId: string, trecho: { url: string; duracao: number; inicio: number }) => boolean;
}

const ALTURA = 76;
const ZOOM_MAX = 64;   // 64× numa faixa de 30 s ≈ meio segundo na tela: dá pra pegar uma sílaba
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

export function OndaEditavel({ audioUrl, tipo, onEditado, tempoMix = null, faixaId, onSoltarTrecho }: Props) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [erro, setErro] = useState("");
  const [largura, setLargura] = useState(0);
  const [tempo, setTempo] = useState(0);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [arrasto, setArrasto] = useState<[number, number] | null>(null);
  const [editando, setEditando] = useState(false);
  const [pilha, setPilha] = useState<{ url: string; duracao: number }[]>([]);
  // Zoom + rolagem da faixa (pedido dele, 17/10/2026): cada faixa tem o seu.
  const [zoom, setZoom] = useState(1);
  const [rolagem, setRolagem] = useState(0);
  const barraRef = useRef<HTMLDivElement>(null);
  // Arrasto do trecho marcado: posição do "fantasma" que segue o mouse.
  const [levando, setLevando] = useState<{ x: number; y: number } | null>(null);
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

  const dur = buffer?.duration || 0;
  const [t0, t1] = largura && dur ? janelaVisivel(dur, largura, zoom, rolagem) : [0, dur];
  const envelope = useMemo(
    () => (buffer && largura ? picosDaJanela(buffer.getChannelData(0), buffer.sampleRate, t0, t1, largura) : []),
    [buffer, largura, t0, t1]
  );

  // A barra nativa manda na rolagem; mudar a rolagem por código acerta a barra.
  const rolarPara = useCallback((px: number) => {
    setRolagem(px);
    if (barraRef.current && Math.abs(barraRef.current.scrollLeft - px) > 1) barraRef.current.scrollLeft = px;
  }, []);

  // Zoom mantendo no lugar o cursor (se estiver na tela) ou o meio da tela.
  const mudarZoom = (novo: number) => {
    if (!dur || !largura) return;
    const z = Math.max(1, Math.min(ZOOM_MAX, novo));
    const ref = tempoMix != null ? tempoMix : tempo;
    const naTela = ref >= t0 && ref <= t1;
    const ancora = naTela ? ref : (t0 + t1) / 2;
    const xTela = ((ancora - t0) / (t1 - t0 || 1)) * largura;
    setZoom(z);
    // A barra só ganha o tamanho novo depois do render: rola no próximo quadro.
    const alvo = rolagemParaAncora(ancora, xTela, dur, largura, z);
    setRolagem(alvo);
    requestAnimationFrame(() => { if (barraRef.current) barraRef.current.scrollLeft = alvo; });
  };

  // Tocando com zoom: a onda rola sozinha pra acompanhar o cursor.
  useEffect(() => {
    if (zoom <= 1 || !dur || !largura) return;
    const t = tempoMix != null ? tempoMix : tempo;
    const tocando = tempoMix != null || (audioRef.current && !audioRef.current.paused);
    if (!tocando || t > dur) return;
    if (t < t0 || t > t1) rolarPara(rolagemParaAncora(t, largura * 0.1, dur, largura, zoom));
  }, [tempo, tempoMix, zoom, dur, largura, t0, t1, rolarPara]);

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
    const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * largura : 0);
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
    if (dur && tempo >= t0 && tempo <= t1) {
      g.fillStyle = "#f87171";
      g.fillRect(Math.min(largura - 2, x(tempo)), 0, 2, ALTURA);
    }
    // Cursor do Play verde (mix), igual em todas as faixas.
    if (dur && tempoMix != null && tempoMix <= dur && tempoMix >= t0 && tempoMix <= t1) {
      g.fillStyle = "#4ade80";
      g.fillRect(Math.min(largura - 2, x(tempoMix)), 0, 2, ALTURA);
    }
  }, [envelope, largura, sel, arrasto, tempo, buffer, tipo, tempoMix, t0, t1, dur]);

  const tempoDoPonteiro = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return t0 + frac * (t1 - t0);
  };

  const dentroDoTrecho = (t: number) => !!sel && t >= sel[0] && t <= sel[1];

  const onDown = (e: React.PointerEvent) => {
    if (!buffer) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const t = tempoDoPonteiro(e);
    // Clicou DENTRO do trecho laranja: começa a levar o trecho pra outra faixa.
    if (onSoltarTrecho && dentroDoTrecho(t)) {
      setLevando({ x: e.clientX, y: e.clientY });
      return;
    }
    setArrasto([t, t]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (levando) { setLevando({ x: e.clientX, y: e.clientY }); return; }
    if (arrasto) setArrasto([arrasto[0], tempoDoPonteiro(e)]);
  };
  const soltarTrecho = (e: React.PointerEvent) => {
    setLevando(null);
    if (!buffer || !sel || !onSoltarTrecho) return;
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-faixa-id]") as HTMLElement | null;
    const destino = alvo?.dataset.faixaId;
    if (!destino || destino === faixaId) return;   // soltou fora ou na própria faixa: nada muda
    try {
      const i0 = Math.round(sel[0] * buffer.sampleRate);
      const i1 = Math.round(sel[1] * buffer.sampleRate);
      const pedaco = new AudioBuffer({ length: i1 - i0, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      for (let c = 0; c < buffer.numberOfChannels; c++) pedaco.copyToChannel(buffer.getChannelData(c).slice(i0, i1), c);
      const url = URL.createObjectURL(paraWav(pedaco));
      cache.set(url, pedaco);
      if (onSoltarTrecho(destino, { url, duracao: pedaco.duration, inicio: sel[0] })) aplicar(cortarTrecho);
    } catch (err: any) {
      setErro(err.message);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (levando) return soltarTrecho(e);
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
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={!buffer || zoom <= 1} onClick={() => mudarZoom(zoom / 2)}
            className="h-7 px-2 bg-white/5 border-white/20 text-white hover:bg-white/10" title="Zoom − (afastar a onda)">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="font-mono text-xs text-white/60 w-9 text-center tabular-nums" title="Zoom da faixa">{zoom}×</span>
          <Button size="sm" variant="outline" disabled={!buffer || zoom >= ZOOM_MAX} onClick={() => mudarZoom(zoom * 2)}
            className="h-7 px-2 bg-white/5 border-white/20 text-white hover:bg-white/10" title="Zoom + (aproximar a onda)">
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div ref={caixaRef} className="relative w-full rounded-lg bg-black/30 border border-white/10 overflow-hidden" style={{ height: ALTURA }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: ALTURA, cursor: levando ? "grabbing" : buffer ? "text" : "default", touchAction: "none" }}
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
      {/* Barra de rolagem da faixa (aparece com zoom): esquerda/direita no conteúdo ampliado. */}
      <div
        ref={barraRef}
        className="w-full overflow-x-scroll overflow-y-hidden rounded bg-white/10 [&::-webkit-scrollbar]:h-3.5 [&::-webkit-scrollbar-track]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sky-400/70 hover:[&::-webkit-scrollbar-thumb]:bg-sky-300"
        style={{ height: 14, display: zoom > 1 ? "block" : "none", colorScheme: "dark" }}
        onScroll={(e) => setRolagem(e.currentTarget.scrollLeft)}
        aria-label="Rolagem da onda"
      >
        <div style={{ width: largura * zoom, height: 1 }} />
      </div>
      <audio ref={audioRef} src={audioUrl} controls className="w-full" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-white/60 mr-1">
          {sel
            ? `Trecho: ${fmt(sel[0])} → ${fmt(sel[1])} (${fmt(sel[1] - sel[0])})${onSoltarTrecho ? " · arraste o laranja pra outra faixa" : ""}`
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
      {levando && sel && (
        <div className="fixed z-[200] pointer-events-none rounded-md bg-amber-500 text-black text-xs font-semibold px-2 py-1 shadow-lg"
          style={{ left: levando.x + 14, top: levando.y + 10 }}>
          ⤵ {fmt(sel[1] - sel[0])} — solte numa faixa
        </div>
      )}
    </div>
  );
}
