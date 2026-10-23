import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scissors, VolumeX, Undo2, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  trechoValido, cortarTrecho, silenciarTrecho, picosDaFaixa, imantar,
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
 *
 * LINHA DO TEMPO COMUM (17/10/2026, pedido dele): todas as faixas na mesma régua —
 * o áudio aparece a partir do "Entra em"; zoom e rolagem são da linha toda (vêm do
 * pai), então as faixas ficam alinhadas. A ALÇA no topo do objeto arrasta ele pra
 * esquerda/direita, com ÍMÃ nos marcadores (fim da locução, início/fim das outras
 * faixas) — é assim que a assinatura cantada do jingle encaixa no fim da voz.
 */

export interface LinhaComum {
  total: number;                                       // segundos da régua
  zoom: number;
  g0: number;                                          // segundo no começo da tela
  mudarZoom: (zoom: number, ancora: number, fracTela: number) => void;
  rolarPara: (g0: number) => void;
}
export interface Marcador { t: number; cor: string; rotulo: string }

interface Props {
  audioUrl: string;
  tipo: "voiceover" | "music";
  onEditado: (url: string, duracao: number) => void;
  // CURSOR ÚNICO da linha do tempo (pedido dele, 17/10/2026): o mesmo segundo em
  // todas as faixas. Clicar numa onda move o cursor de todas; o Play verde toca a
  // partir dele. Verde enquanto o mix toca, vermelho parado.
  cursor: number;
  tocandoMix: boolean;
  onCursor: (g: number) => void;
  // Arrastar o trecho marcado pra OUTRA faixa (pedido dele, 17/10/2026: separar a
  // assinatura cantada do jingle num track próprio). Devolve true se a faixa de
  // destino aceitou — aí o trecho SAI desta (mover; o Desfazer daqui traz de volta).
  faixaId?: string;
  onSoltarTrecho?: (destinoId: string, trecho: { url: string; duracao: number; inicio: number }) => boolean;
  inicio: number;                                      // "Entra em" desta faixa
  linha: LinhaComum;
  marcadores: Marcador[];                              // das OUTRAS faixas (ímã)
  onMover: (novoInicio: number) => void;
  // Alças de fade-in / fade-out (quadradinhos nos cantos de cima do objeto).
  fadeIn: number;
  fadeOut: number;
  onFades: (fadeIn: number, fadeOut: number) => void;
  // Altura da onda em px (Alt+1 engorda / Alt+2 emagrece — 23/10/2026). Padrão 76.
  altura?: number;
}

const ALTURA_PADRAO = 76;
const ALCA = 14;       // faixa de cima do objeto: arrastar aqui MOVE o objeto
export const ZOOM_MAX = 64;
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

export function OndaEditavel({
  audioUrl, tipo, onEditado, cursor, tocandoMix, onCursor, faixaId, onSoltarTrecho, inicio, linha, marcadores, onMover,
  fadeIn, fadeOut, onFades, altura,
}: Props) {
  const ALTURA = altura ?? ALTURA_PADRAO;
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [erro, setErro] = useState("");
  const [largura, setLargura] = useState(0);
  const [tocandoFaixa, setTocandoFaixa] = useState(false);     // o player "som original" desta faixa
  const [sel, setSel] = useState<[number, number] | null>(null);   // trecho em tempo LOCAL
  const [arrasto, setArrasto] = useState<[number, number] | null>(null);
  const [editando, setEditando] = useState(false);
  const [pilha, setPilha] = useState<{ url: string; duracao: number }[]>([]);
  const [levando, setLevando] = useState<{ x: number; y: number } | null>(null);   // trecho → outra faixa
  const [movendo, setMovendo] = useState<{ gIni: number; inicioIni: number; novo: number } | null>(null);
  const [puxandoFade, setPuxandoFade] = useState<{ lado: "in" | "out"; fi: number; fo: number } | null>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ajusteRef = useRef(0);                // quantos "seeked" ainda são posicionamento por código

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
    const passo = () => { onCursorRef.current(inicioRef.current + a.currentTime); raf = requestAnimationFrame(passo); };
    const tocar = () => { setTocandoFaixa(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(passo); };
    // Só o que o PRODUTOR fez no player desta faixa move o cursor da linha. Quando
    // o player é posicionado por código (cursor veio de fora), o "seeked" é ignorado —
    // senão uma faixa curta "puxava" o cursor pro fim dela (bug visto no teste).
    const parar = () => {
      cancelAnimationFrame(raf);
      if (!a.paused) return;
      setTocandoFaixa((estava) => {
        if (estava) onCursorRef.current(inicioRef.current + a.currentTime);
        return false;
      });
    };
    const procurou = () => {
      if (ajusteRef.current > 0) { ajusteRef.current--; return; }
      if (a.paused) onCursorRef.current(inicioRef.current + a.currentTime);
    };
    a.addEventListener("play", tocar);
    a.addEventListener("pause", parar);
    a.addEventListener("seeked", procurou);
    a.addEventListener("ended", parar);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("play", tocar);
      a.removeEventListener("pause", parar);
      a.removeEventListener("seeked", procurou);
      a.removeEventListener("ended", parar);
    };
  }, []);

  const dur = buffer?.duration || 0;
  const ini = movendo ? movendo.novo : inicio;
  const fi = puxandoFade ? puxandoFade.fi : Math.max(0, fadeIn || 0);
  const fo = puxandoFade ? puxandoFade.fo : Math.max(0, fadeOut || 0);
  // Refs pros ouvintes do <audio> (montados uma vez) enxergarem os valores atuais.
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const inicioRef = useRef(inicio);
  inicioRef.current = inicio;
  // Cursor movido por fora (outra faixa, régua, Play verde): o player desta faixa
  // fica pronto no mesmo ponto — o "som original" toca de onde está o cursor.
  useEffect(() => {
    const a = audioRef.current;
    // Com o mix tocando o player da faixa fica quieto (reposicionar a cada quadro
    // gerava "seeked" atrasado que puxava o cursor). Ajusta quando o mix parar.
    if (!a || !a.paused || !dur || tocandoMix) return;
    const local = Math.min(dur, Math.max(0, cursor - inicio));
    if (Math.abs(a.currentTime - local) > 0.05) { ajusteRef.current++; a.currentTime = local; }
  }, [cursor, inicio, dur, tocandoMix]);                  // durante o arrasto, a posição nova
  // Janela global na tela (régua comum).
  const span = linha.total / linha.zoom;
  const g0 = Math.max(0, Math.min(linha.total - span, linha.g0));
  const g1 = g0 + span;

  const envelope = useMemo(
    () => (buffer && largura ? picosDaFaixa(buffer.getChannelData(0), buffer.sampleRate, ini, g0, g1, largura) : []),
    [buffer, largura, ini, g0, g1]
  );

  // A barra de rolagem acompanha a linha comum (outra faixa pode ter rolado).
  useEffect(() => {
    const b = barraRef.current;
    if (!b || !largura) return;
    const alvo = (g0 / linha.total) * largura * linha.zoom;
    if (Math.abs(b.scrollLeft - alvo) > 1) b.scrollLeft = alvo;
  }, [g0, linha.total, linha.zoom, largura]);

  // Tocando: a linha rola sozinha pra acompanhar o cursor.
  useEffect(() => {
    if (linha.zoom <= 1 || !largura) return;
    if (!tocandoMix && !tocandoFaixa) return;
    if (cursor > linha.total) return;
    if (cursor < g0 || cursor > g1) linha.rolarPara(Math.max(0, cursor - span * 0.1));
  }, [cursor, tocandoMix, tocandoFaixa, linha, largura, g0, g1, span]);

  // Desenho: fundo do objeto + alça, onda, marcadores, trecho, cursores.
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
    const x = (t: number) => ((t - g0) / span) * largura;
    const azul = tipo === "voiceover";
    if (dur) {
      const xa = x(ini), xb = x(ini + dur);
      g.fillStyle = azul ? "rgba(59, 130, 246, 0.10)" : "rgba(168, 85, 247, 0.10)";
      g.fillRect(xa, 0, xb - xa, ALTURA);
      g.fillStyle = movendo ? "#f59e0b" : azul ? "rgba(59, 130, 246, 0.55)" : "rgba(168, 85, 247, 0.55)";
      g.fillRect(xa, 0, xb - xa, ALCA);
      if (xb - xa > 70) {
        g.fillStyle = "#fff";
        g.font = "10px sans-serif";
        g.fillText(movendo ? `entra em ${movendo.novo.toFixed(2)} s` : "⇔ arraste aqui para mover", Math.max(xa, 0) + 6, 10);
      }
    }
    const meio = ALCA + (ALTURA - ALCA) / 2;
    const meiaAltura = (ALTURA - ALCA) / 2;
    g.fillStyle = azul ? "rgba(96, 165, 250, 0.9)" : "rgba(192, 132, 252, 0.9)";
    envelope.forEach((p, px) => {
      if (!p) return;
      const [mn, mx] = p;
      const y1 = meio - mx * meiaAltura;
      const y2 = meio - mn * meiaAltura;
      g.fillRect(px, y1, 1, Math.max(1, y2 - y1));
    });
    // Rampas das alças de fade (sombra por cima da onda + linha) e os quadradinhos.
    if (dur) {
      const xa = x(ini), xb = x(ini + dur);
      g.fillStyle = "rgba(0, 0, 0, 0.45)";
      if (fi > 0) {
        g.beginPath(); g.moveTo(xa, ALCA); g.lineTo(x(ini + fi), ALCA); g.lineTo(xa, ALTURA); g.closePath(); g.fill();
      }
      if (fo > 0) {
        g.beginPath(); g.moveTo(xb, ALCA); g.lineTo(x(ini + dur - fo), ALCA); g.lineTo(xb, ALTURA); g.closePath(); g.fill();
      }
      g.strokeStyle = "#fde68a";
      g.lineWidth = 1.5;
      if (fi > 0) { g.beginPath(); g.moveTo(xa, ALTURA); g.lineTo(x(ini + fi), ALCA); g.stroke(); }
      if (fo > 0) { g.beginPath(); g.moveTo(x(ini + dur - fo), ALCA); g.lineTo(xb, ALTURA); g.stroke(); }
      g.lineWidth = 1;
      g.fillStyle = "#fde68a";
      g.strokeStyle = "#78350f";
      for (const hx of [x(ini + fi), x(ini + dur - fo)]) {
        const q = Math.max(0, Math.min(largura - 9, hx - 4.5));
        g.fillRect(q, ALCA - 4, 9, 9);
        g.strokeRect(q + 0.5, ALCA - 3.5, 8, 8);
      }
      if (puxandoFade) {
        g.fillStyle = "#fff";
        g.font = "11px sans-serif";
        const txt = puxandoFade.lado === "in" ? `fade-in ${fi.toFixed(2)} s` : `fade-out ${fo.toFixed(2)} s`;
        g.fillText(txt, Math.max(4, Math.min(largura - 110, puxandoFade.lado === "in" ? x(ini + fi) + 8 : x(ini + dur - fo) - 105)), ALCA + 22);
      }
    }
    // Marcadores (ímã): fim da locução em âmbar, outras faixas em branco.
    g.setLineDash([4, 4]);
    for (const m of marcadores) {
      if (m.t < g0 || m.t > g1) continue;
      g.strokeStyle = m.cor;
      g.beginPath();
      g.moveTo(x(m.t) + 0.5, 0);
      g.lineTo(x(m.t) + 0.5, ALTURA);
      g.stroke();
    }
    g.setLineDash([]);
    // Trecho marcado POR CIMA da onda (atrás dela some quando a voz é alta).
    const marcado = arrasto || sel;
    if (marcado && dur) {
      const [a, b] = [Math.min(...marcado), Math.max(...marcado)];
      g.fillStyle = "rgba(250, 204, 21, 0.38)";
      g.fillRect(x(ini + a), ALCA, Math.max(1, x(ini + b) - x(ini + a)), ALTURA - ALCA);
      g.fillStyle = "#facc15";
      g.fillRect(x(ini + a), ALCA, 1, ALTURA - ALCA);
      g.fillRect(Math.max(0, x(ini + b) - 1), ALCA, 1, ALTURA - ALCA);
    }
    // Cursor ÚNICO (o mesmo segundo em todas as faixas): verde tocando, vermelho parado.
    if (cursor >= g0 && cursor <= g1) {
      g.fillStyle = tocandoMix ? "#4ade80" : "#f87171";
      g.fillRect(Math.min(largura - 2, x(cursor)), 0, 2, ALTURA);
    }
  }, [envelope, largura, sel, arrasto, cursor, tocandoMix, buffer, tipo, g0, g1, span, dur, ini, movendo, marcadores, fi, fo, puxandoFade, ALTURA]);

  // Ponteiro → segundo da régua (global) e altura dentro da onda.
  const ponteiro = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return { g: g0 + frac * span, y: e.clientY - r.top };
  };
  const local = (g: number) => Math.min(dur, Math.max(0, g - inicio));
  const dentroDoTrecho = (t: number) => !!sel && t >= sel[0] && t <= sel[1];

  const onDown = (e: React.PointerEvent) => {
    if (!buffer) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const { g, y } = ponteiro(e);
    // Quadradinhos de fade (cantos de cima): ~9 px de folga pra pegar com o mouse.
    const pxPorSeg = largura / span;
    if (y <= ALCA + 8 && dur) {
      const dIn = Math.abs((g - (inicio + fi)) * pxPorSeg);
      const dOut = Math.abs((g - (inicio + dur - fo)) * pxPorSeg);
      if (Math.min(dIn, dOut) <= 9) {
        setPuxandoFade({ lado: dIn <= dOut ? "in" : "out", fi, fo });
        return;
      }
    }
    // Alça do objeto: move a faixa inteira na linha do tempo.
    if (y <= ALCA && g >= inicio && g <= inicio + dur) {
      setMovendo({ gIni: g, inicioIni: inicio, novo: inicio });
      return;
    }
    const t = local(g);
    // Clicou DENTRO do trecho laranja: começa a levar o trecho pra outra faixa.
    if (onSoltarTrecho && dentroDoTrecho(t)) {
      setLevando({ x: e.clientX, y: e.clientY });
      return;
    }
    setArrasto([t, t]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (puxandoFade) {
      const { g } = ponteiro(e);
      if (puxandoFade.lado === "in") setPuxandoFade({ ...puxandoFade, fi: Math.max(0, Math.min(dur - puxandoFade.fo, g - inicio)) });
      else setPuxandoFade({ ...puxandoFade, fo: Math.max(0, Math.min(dur - puxandoFade.fi, inicio + dur - g)) });
      return;
    }
    if (movendo) {
      const { g } = ponteiro(e);
      const bruto = Math.max(0, movendo.inicioIni + (g - movendo.gIni));
      // Ímã: o começo OU o fim do objeto grudam no marcador mais perto (~16 px na tela).
      const tol = (16 / Math.max(1, largura)) * span;
      const alvos = [0, ...marcadores.map((m) => m.t)];
      const peloInicio = imantar(bruto, alvos, tol);
      const peloFim = imantar(bruto + dur, alvos, tol) - dur;
      const novo = Math.abs(peloInicio - bruto) > 0 ? peloInicio
        : Math.abs(peloFim - bruto) > 0 ? Math.max(0, peloFim) : bruto;
      setMovendo({ ...movendo, novo });
      return;
    }
    if (levando) { setLevando({ x: e.clientX, y: e.clientY }); return; }
    if (arrasto) setArrasto([arrasto[0], local(ponteiro(e).g)]);
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
    if (puxandoFade) {
      const r2 = (v: number) => Math.round(v * 100) / 100;
      onFades(r2(puxandoFade.fi), r2(puxandoFade.fo));
      setPuxandoFade(null);
      return;
    }
    if (movendo) {
      const novo = Math.round(movendo.novo * 100) / 100;
      setMovendo(null);
      if (Math.abs(novo - inicio) >= 0.005) onMover(novo);
      return;
    }
    if (levando) return soltarTrecho(e);
    if (!arrasto || !buffer) return;
    const t = local(ponteiro(e).g);
    const trecho = trechoValido(arrasto[0], t, buffer.duration);
    setArrasto(null);
    if (trecho) {
      setSel(trecho);
    } else {
      setSel(null);   // clique sem arrastar: o cursor de TODAS as faixas vai pra cá
      onCursor(ponteiro(e).g);
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

  // Zoom da LINHA (todas as faixas juntas), ancorado no cursor se ele estiver na tela.
  const zoomar = (novo: number) => {
    const z = Math.max(1, Math.min(ZOOM_MAX, novo));
    const ancora = cursor >= g0 && cursor <= g1 ? cursor : (g0 + g1) / 2;
    linha.mudarZoom(z, ancora, (ancora - g0) / span);
  };

  return (
    <div className="space-y-2">
      {/* Contador da faixa: posição do cursor (vermelho) ou do Play verde (mix). */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`font-mono text-xl tabular-nums ${tocandoMix ? "text-green-400" : "text-white"}`}>
          ⏱ {relogio(cursor)}
        </span>
        <span className="font-mono text-sm text-white/50 tabular-nums">/ {relogio(buffer?.duration || 0)}</span>
        <span className="text-xs text-white/40">
          {tocandoMix ? "tocando o mix (Play verde)" : "cursor (o mesmo em todas as faixas)"}{ini > 0 ? ` · entra em ${relogio(ini)}` : ""}{fi > 0 ? ` · fade-in ${fi.toFixed(1)} s` : ""}{fo > 0 ? ` · fade-out ${fo.toFixed(1)} s` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={!buffer || linha.zoom <= 1} onClick={() => zoomar(linha.zoom / 2)}
            className="h-7 px-2 bg-white/5 border-white/20 text-white hover:bg-white/10" title="Zoom − (afastar — vale pra todas as faixas)">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="font-mono text-xs text-white/60 w-9 text-center tabular-nums" title="Zoom da linha do tempo">{linha.zoom}×</span>
          <Button size="sm" variant="outline" disabled={!buffer || linha.zoom >= ZOOM_MAX} onClick={() => zoomar(linha.zoom * 2)}
            className="h-7 px-2 bg-white/5 border-white/20 text-white hover:bg-white/10" title="Zoom + (aproximar — vale pra todas as faixas)">
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div ref={caixaRef} className="relative w-full rounded-lg bg-black/30 border border-white/10 overflow-hidden" style={{ height: ALTURA }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: ALTURA, cursor: movendo || levando ? "grabbing" : buffer ? "text" : "default", touchAction: "none" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          aria-label="Onda do áudio: clique para posicionar, arraste para marcar um trecho, arraste a alça de cima para mover"
        />
        {!buffer && !erro && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> desenhando a onda…
          </div>
        )}
      </div>
      {/* Barra de rolagem da LINHA (aparece com zoom): rola todas as faixas juntas. */}
      <div
        ref={barraRef}
        className="w-full overflow-x-scroll overflow-y-hidden rounded bg-white/10 [&::-webkit-scrollbar]:h-3.5 [&::-webkit-scrollbar-track]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sky-400/70 hover:[&::-webkit-scrollbar-thumb]:bg-sky-300"
        style={{ height: 14, display: linha.zoom > 1 ? "block" : "none", colorScheme: "dark" }}
        onScroll={(e) => {
          const total = largura * linha.zoom;
          if (total) linha.rolarPara((e.currentTarget.scrollLeft / total) * linha.total);
        }}
        aria-label="Rolagem da onda"
      >
        <div style={{ width: largura * linha.zoom, height: 1 }} />
      </div>
      <audio ref={audioRef} src={audioUrl} controls className="w-full" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-white/60 mr-1">
          {sel
            ? `Trecho: ${fmt(sel[0])} → ${fmt(sel[1])} (${fmt(sel[1] - sel[0])})${onSoltarTrecho ? " · arraste o laranja pra outra faixa" : ""}`
            : "Som original da faixa (sem efeitos) · arraste na onda pra marcar o erro · clique move o cursor · alça de cima move · quadradinhos = fade"}
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
