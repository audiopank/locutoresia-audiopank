import { useEffect, useRef, useState } from "react";
import type { LinhaComum } from "./OndaEditavel";

/**
 * Régua de tempo da MiniDAW React (17/10/2026, pedido dele): fica no topo das
 * faixas (presa embaixo do cabeçalho ao rolar a página) e mostra o CURSOR ÚNICO.
 * Clicar/arrastar na régua move o cursor de todas as faixas — é assim que o
 * produtor leva o cursor até a respiração no fim da locução e tira ela.
 */

interface Props {
  linha: LinhaComum;
  cursor: number;
  tocando: boolean;
  onCursor: (g: number) => void;
  topo: number;                 // altura do cabeçalho fixo (px)
}

const ALTURA = 30;
const PASSOS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];

const rotulo = (s: number, passo: number) => {
  const m = Math.floor(s / 60);
  const resto = s - m * 60;
  const seg = passo < 1 ? resto.toFixed(1).replace(".", ",").padStart(4, "0") : String(Math.round(resto)).padStart(2, "0");
  return `${m}:${seg}`;
};

export function ReguaLinha({ linha, cursor, tocando, onCursor, topo }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [largura, setLargura] = useState(0);
  const [arrastando, setArrastando] = useState(false);

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = linha.total / linha.zoom;
  const g0 = Math.max(0, Math.min(linha.total - span, linha.g0));

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
    // Passo das marcas: o menor que deixa ~70 px entre os números.
    const passo = PASSOS.find((p) => (p / span) * largura >= 70) || 120;
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.font = "11px ui-monospace, monospace";
    for (let t = Math.ceil(g0 / passo) * passo; t <= g0 + span + 1e-9; t += passo) {
      const px = Math.round(x(t)) + 0.5;
      g.beginPath();
      g.moveTo(px, ALTURA - 10);
      g.lineTo(px, ALTURA);
      g.stroke();
      g.fillText(rotulo(t, passo), px + 3, 12);
      // marquinhas no meio
      const meio = Math.round(x(t + passo / 2)) + 0.5;
      g.beginPath();
      g.moveTo(meio, ALTURA - 5);
      g.lineTo(meio, ALTURA);
      g.stroke();
    }
    // Cursor: linha + triângulo no topo.
    if (cursor >= g0 && cursor <= g0 + span) {
      const cx = x(cursor);
      g.fillStyle = tocando ? "#4ade80" : "#f87171";
      g.fillRect(Math.min(largura - 2, cx), 0, 2, ALTURA);
      g.beginPath();
      g.moveTo(cx - 6, ALTURA - 9);
      g.lineTo(cx + 7, ALTURA - 9);
      g.lineTo(cx + 1, ALTURA);
      g.closePath();
      g.fill();
    }
  }, [largura, g0, span, cursor, tocando]);

  const tempoDo = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return g0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span;
  };

  return (
    <div className="sticky z-40 px-[22px] py-1 rounded-lg bg-slate-950/90 backdrop-blur border border-white/10" style={{ top: topo }}>
      <div ref={caixaRef} className="w-full">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: ALTURA, cursor: "pointer", touchAction: "none", display: "block" }}
          aria-label="Régua de tempo: clique ou arraste para mover o cursor de todas as faixas"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setArrastando(true); onCursor(tempoDo(e)); }}
          onPointerMove={(e) => { if (arrastando) onCursor(tempoDo(e)); }}
          onPointerUp={() => setArrastando(false)}
        />
      </div>
    </div>
  );
}
