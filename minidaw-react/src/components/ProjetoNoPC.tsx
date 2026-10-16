import { useEffect, useRef, useState } from "react";
import { HardDriveDownload, HardDriveUpload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  suporta, permissao, salvarNaPasta, projetosNaPasta, abrirDaPasta,
  carregarPastaGeral, lembrarPastaGeral,
} from "@/lib/projetoNoPC.js";

/**
 * Botões "Salvar no PC" / "Abrir do PC" da MiniDAW React (17/10/2026).
 * Com o Supabase bloqueado o Salvar VIP não funciona; aqui o projeto vira uma
 * pasta no computador (modelo da clássica). Lógica em lib/projetoNoPC.js.
 * REGRA do Chrome (lição de 30/09 na clássica): o seletor de pasta e o pedido de
 * permissão abrem PRIMEIRO, dentro do clique — prompt/confirm só depois.
 */

interface Snapshot { projectId: string; dbProjectId?: string | null; roteiro: string; tracks: any[] }
interface Props {
  projectId: string;
  getCurrent: () => Snapshot;
  onLoad: (snap: Snapshot) => void;
  toast: (t: { title: string; description?: string; variant?: "destructive" }) => void;
}

type Item = { proj: any; pasta: any; rotulo: string; naRaiz: boolean };

const dataBR = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
};

export function ProjetoNoPC({ projectId, getCurrent, onLoad, toast }: Props) {
  const pastaRef = useRef<any>(null);        // pasta do projeto aberto/salvo nesta sessão
  const nomeRef = useRef<string>("");
  const arquivosRef = useRef<Map<string, string>>(new Map());
  const geralRef = useRef<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [lista, setLista] = useState<{ pasta: any; itens: Item[] } | null>(null);

  useEffect(() => { if (suporta()) carregarPastaGeral().then((p) => { geralRef.current = p; }); }, []);

  // Projeto trocado por fora (Novo, VIP aberto): desvincula a pasta — senão o
  // próximo "Salvar no PC" cairia em cima do projeto anterior (regra da clássica).
  const idDoPC = useRef<string>("");
  useEffect(() => {
    if (projectId !== idDoPC.current) {
      pastaRef.current = null;
      nomeRef.current = "";
      arquivosRef.current = new Map();
    }
  }, [projectId]);

  const semSuporte = () => toast({ title: "Use o Chrome ou o Edge no computador", description: "Salvar/abrir no PC depende do acesso a pastas, que só esses navegadores têm.", variant: "destructive" });

  const salvar = async (ev: React.MouseEvent) => {
    if (!suporta()) return semSuporte();
    const snap = getCurrent();
    if (!snap.tracks.some((t) => t.audioUrl)) {
      toast({ title: "Nada para salvar", description: "Adicione voz ou trilha antes.", variant: "destructive" });
      return;
    }
    try {
      // Shift+clique = outra pasta. Com pasta desta sessão, salva direto nela (Ctrl+S).
      let pasta = !ev.shiftKey && pastaRef.current ? pastaRef.current : null;
      if (!pasta) {
        pasta = await (window as any).showDirectoryPicker({ id: "locutores-projeto", mode: "readwrite", startIn: geralRef.current || "documents" });
      }
      const nome = pasta === pastaRef.current && nomeRef.current
        ? nomeRef.current
        : window.prompt("Nome do projeto:", nomeRef.current || pasta.name);
      if (!nome) return;
      if (!(await permissao(pasta))) {
        toast({ title: "Sem permissão pra gravar nessa pasta", variant: "destructive" });
        return;
      }
      setSalvando(true);
      const mesma = !!(pastaRef.current && (await pasta.isSameEntry(pastaRef.current)));
      if (!mesma) arquivosRef.current = new Map();   // pasta nova: grava todos os áudios nela
      toast({ title: `Salvando "${nome}"…`, description: "Gravando os áudios na pasta Audio/." });
      const r = await salvarNaPasta(pasta, { nome, roteiro: snap.roteiro, tracks: snap.tracks }, arquivosRef.current,
        async (url: string) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`não consegui ler o áudio (HTTP ${res.status})`);
          return res.blob();
        });
      if (r.pastaMae) { geralRef.current = r.pastaMae; await lembrarPastaGeral(r.pastaMae); }
      pastaRef.current = r.pasta;
      nomeRef.current = nome;
      idDoPC.current = getCurrent().projectId;   // este projeto agora mora nesta pasta
      toast({
        title: `💽 "${nome}" salvo no computador`,
        description: `Pasta: ${r.ondeSalvou}` + (r.novos ? ` · ${r.novos} áudio(s) gravado(s)` : " · só o projeto (os áudios já estavam lá)"),
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error("[projeto no PC] falhou", e);
      toast({ title: "Não consegui salvar no computador", description: e?.message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const abrirOuListar = async (pasta: any) => {
    let itens: Item[];
    try {
      itens = await projetosNaPasta(pasta);
    } catch (e: any) {
      if (pasta === geralRef.current) { geralRef.current = null; await lembrarPastaGeral(null); }
      throw new Error(`não consegui ler a pasta "${pasta.name}" (${e.message}). Clique de novo pra escolher outra.`);
    }
    const raiz = itens.find((x) => x.naRaiz);
    if (raiz && itens.length === 1) return abrirProjeto(raiz);
    if (!itens.length) {
      if (pasta === geralRef.current) { geralRef.current = null; await lembrarPastaGeral(null); }
      toast({ title: `A pasta "${pasta.name}" não tem projeto da MiniDAW React`, description: "Escolha a pasta geral dos spots ou a pasta de um projeto (não a pasta Audio). Projetos da MiniDAW clássica abrem só na clássica.", variant: "destructive" });
      return;
    }
    geralRef.current = pasta;
    await lembrarPastaGeral(pasta);
    setLista({ pasta, itens });
  };

  const abrir = async () => {
    if (!suporta()) return semSuporte();
    try {
      let pasta = geralRef.current;
      if (pasta) {
        let ok = false;
        try { ok = await permissao(pasta); } catch { ok = false; }
        if (!ok) {
          geralRef.current = null;
          await lembrarPastaGeral(null);
          toast({ title: "A pasta lembrada não ficou disponível", description: 'Clique em "Abrir do PC" de novo pra escolher a pasta.' });
          return;
        }
      } else {
        pasta = await (window as any).showDirectoryPicker({ id: "locutores-projeto", mode: "readwrite", startIn: "documents" });
      }
      await abrirOuListar(pasta);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast({ title: "Erro ao abrir do computador", description: e?.message, variant: "destructive" });
    }
  };

  const abrirProjeto = async (item: Item) => {
    setLista(null);
    try {
      if (getCurrent().tracks.some((t) => t.audioUrl)
        && !window.confirm(`Abrir "${item.proj.name}" substitui o que está na bancada agora. Continuar?`)) return;
      const r = await abrirDaPasta(item.pasta, item.proj, (blob: Blob) => URL.createObjectURL(blob));
      const id = "pc-" + Date.now();
      idDoPC.current = id;
      onLoad({ projectId: id, dbProjectId: null, roteiro: r.roteiro, tracks: r.tracks });
      pastaRef.current = item.pasta;
      nomeRef.current = r.nome;
      arquivosRef.current = r.arquivos;    // salvar de novo nesta pasta não regrava esses áudios
      toast({
        title: `📂 "${r.nome}" aberto do computador`,
        description: r.faltando.length ? `Faltou na pasta Audio/: ${r.faltando.join(", ")}` : "Faixas com volume e efeitos.",
        variant: r.faltando.length ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "Erro ao abrir do computador", description: e?.message, variant: "destructive" });
    }
  };

  const outraPasta = async () => {
    const atual = lista?.pasta;
    setLista(null);
    try {
      const nova = await (window as any).showDirectoryPicker({ id: "locutores-projeto", mode: "readwrite", startIn: atual || "documents" });
      await abrirOuListar(nova);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      toast({ title: "Erro ao abrir do computador", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <>
      <Button onClick={salvar} disabled={salvando} variant="outline" className="gap-2 border-emerald-500/50 hover:bg-emerald-500/10"
        title="Salva o projeto numa pasta do computador (áudios + volumes + efeitos). Shift+clique = outra pasta.">
        <HardDriveDownload className="w-4 h-4 text-emerald-400" /> {salvando ? "Salvando…" : "Salvar no PC"}
      </Button>
      <Button onClick={abrir} variant="outline" className="gap-2 border-emerald-500/50 hover:bg-emerald-500/10"
        title="Abre um projeto salvo no computador">
        <HardDriveUpload className="w-4 h-4 text-emerald-400" /> Abrir do PC
      </Button>

      {lista && (
        <div className="fixed inset-0 z-[100] bg-black/75 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setLista(null); }}>
          <div className="bg-slate-900 border border-white/15 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-auto p-5 text-white">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="font-semibold">💽 Projetos no PC — {lista.pasta.name} ({lista.itens.length})</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-white/20" onClick={outraPasta}>Escolher outra pasta</Button>
                <Button size="sm" variant="ghost" onClick={() => setLista(null)}><X className="w-4 h-4" /></Button>
              </div>
            </div>
            {lista.itens.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg p-3 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold break-words">{item.proj.name || item.rotulo}</div>
                  <div className="text-xs text-white/50">
                    {(item.proj.tracks || []).length} faixa(s) · salvo {item.proj.salvo_em ? dataBR(item.proj.salvo_em) : "sem data"} · pasta: {item.naRaiz ? "(raiz)" : item.rotulo}
                  </div>
                </div>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 shrink-0" onClick={() => abrirProjeto(item)}>Abrir</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
