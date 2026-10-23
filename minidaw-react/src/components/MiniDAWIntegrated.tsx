import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Headphones, Newspaper, Search, Mic, Music, Save, Download, Play, Pause, Trash2,
  Upload, Loader2, Settings, FolderOpen, Star, Plus, Workflow, Zap, FileText, Sliders, Wand2, Home,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/useToast";
import { VoiceGenerator } from "@/components/VoiceGenerator";
import { VoiceGallery } from "@/components/VoiceGallery";
import { ScriptPanel } from "@/components/ScriptPanel";
import { SecretsManager } from "@/components/SecretsManager";
import { TrackEffectsPanel } from "@/components/TrackEffectsPanel";
import { VipProjects } from "@/components/VipProjects";
import MasterizarPanel from "./MasterizarPanel";
import { OndaEditavel, ZOOM_MAX, type LinhaComum, type Marcador } from "./OndaEditavel";
import { ReguaLinha } from "./ReguaLinha";
import { totalDaLinha } from "@/lib/edicaoOnda.js";
import { ProjetoNoPC } from "./ProjetoNoPC";
import { mixToMp3, downloadBlob } from "@/lib/mixer";
import { fimDaVoz } from "@/lib/linhaDoTempo.js";
import { decodificar, paraWav } from "@/lib/audioFile.js";
import { pedacosDosCortes } from "@/lib/vozFatiada.js";
import { defaultEffects, type TrackEffects } from "@/lib/audioEffects";

interface Track {
  id: string;
  name: string;
  type: "voiceover" | "music";
  audioUrl: string;
  volume: number;
  color: string;
  duration: number;
  effects: TrackEffects;
  // Vêm do Salvar VIP: apontam pro áudio JÁ salvo. Editar a onda tem que limpar
  // os dois, senão o projeto salvo voltaria com o áudio antigo (projectStorage).
  audio_path?: string;
  audio_url_direct?: string;
  // 17/10/2026 — assinatura cantada do jingle no fim (lib/linhaDoTempo.js):
  inicio?: number;                      // "Entra em" (s)
  fade?: "voz" | "fim" | "nenhum";      // só trilha
  fadeIn?: number;                      // alças de fade do objeto (s)
  fadeOut?: number;
}

// O que o motor de mix precisa de cada faixa (Play verde, Prévia e Exportar iguais).
const paraMix = (t: Track) => ({
  audioUrl: t.audioUrl, type: t.type, volume: t.volume, effects: t.effects, inicio: t.inicio || 0, fade: t.fade,
  fadeIn: t.fadeIn || 0, fadeOut: t.fadeOut || 0,
});

type TabKey = "roteiro" | "trilha" | "upload" | "multitrack" | "mix" | "master";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "roteiro", label: "Roteiro", icon: FileText },
  { key: "trilha", label: "Gerar Trilha", icon: Music },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "multitrack", label: "Multi-Track", icon: Sliders },
  { key: "mix", label: "Mix Rápido", icon: Download },
  { key: "master", label: "Masterizar", icon: Wand2 },
];

const MiniDAWIntegrated = () => {
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [montandoPlay, setMontandoPlay] = useState(false);
  // `currentTime` = CURSOR ÚNICO da linha do tempo (17/10/2026): o mesmo segundo em
  // todas as faixas e na régua; o Play verde toca a partir dele.
  const [currentTime, setCurrentTime] = useState(0);
  const inicioDoPlayRef = useRef(0);          // onde o play começou (2 toques no Espaço voltam pra cá)
  const cabecalhoRef = useRef<HTMLElement>(null);
  const [alturaCabecalho, setAlturaCabecalho] = useState(80);
  // Play verde = o MIX de verdade (efeitos, gate e fade da trilha), igual à Prévia/Exportar.
  // Antes tocava as faixas cruas lado a lado: mexer no reverb/EQ não mudava nada no
  // play e a trilha não fazia fade (17/10/2026). O WAV fica guardado enquanto nada muda.
  const mixPlayRef = useRef<{ chave: string; url: string; audio: HTMLAudioElement } | null>(null);
  // LINHA DO TEMPO COMUM (17/10/2026): mesma régua, zoom e rolagem pra todas as
  // faixas — senão não dá pra alinhar a assinatura cantada no fim da locução.
  const [linhaZoom, setLinhaZoom] = useState(1);
  const [linhaG0, setLinhaG0] = useState(0);
  const [isMixing, setIsMixing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("audio-pank-" + Date.now());
  const [dbProjectId, setDbProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("roteiro");
  const [roteiro, setRoteiro] = useState("");
  const [voiceGen, setVoiceGen] = useState<{ open: boolean; text: string; voiceKey?: string }>({ open: false, text: "" });
  const [vipOpen, setVipOpen] = useState(false);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const { toast } = useToast();

  // Projetos salvos antes do Gate existir não têm `effects.gate` — preenche
  // com o default do tipo da track (ativo=true só em locução) sem perder o
  // resto dos efeitos que o usuário já tinha configurado.
  const normalizeTrackEffects = (t: Track): Track => ({
    ...t,
    effects: {
      ...defaultEffects(t.type),
      ...t.effects,
      gate: { ...defaultEffects(t.type).gate, ...(t.effects?.gate || {}) },
      limparRuido: !!t.effects?.limparRuido,
      limparRuidoIntensidade: t.effects?.limparRuidoIntensidade ?? 80,
    },
  });

  // Carrega um projeto VIP salvo de volta para o estúdio
  const loadSnapshot = useCallback((snap: { projectId: string; dbProjectId?: string | null; roteiro: string; tracks: Track[] }) => {
    audioRefs.current = {};
    if (snap.projectId) setProjectId(snap.projectId);
    setDbProjectId(snap.dbProjectId || null);
    setRoteiro(snap.roteiro || "");
    setTracks((snap.tracks || []).map(normalizeTrackEffects));
    setActiveTab("multitrack");
  }, []);

  // Abre o Gerador de Voz já com o roteiro e (opcionalmente) o locutor selecionado
  const openVoiceGen = useCallback((opts?: { text?: string; voiceKey?: string }) => {
    setVoiceGen({ open: true, text: opts?.text ?? roteiro, voiceKey: opts?.voiceKey });
  }, [roteiro]);

  const addTrack = useCallback((type: "voiceover" | "music") => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name: type === "voiceover"
        ? `Locução ${tracks.filter(t => t.type === "voiceover").length + 1}`
        : `Trilha ${tracks.filter(t => t.type === "music").length + 1}`,
      type,
      audioUrl: "",
      volume: 100,
      color: type === "voiceover" ? "border-blue-500 bg-blue-500/10" : "border-purple-500 bg-purple-500/10",
      duration: 0,
      effects: defaultEffects(type),
    };
    setTracks(prev => [...prev, newTrack]);
    setActiveTab("multitrack");
  }, [tracks]);

  const removeTrack = useCallback((id: string) => {
    setTracks(prev => prev.filter(t => t.id !== id));
    if (audioRefs.current[id]) {
      audioRefs.current[id].pause();
      delete audioRefs.current[id];
    }
  }, []);

  const handleVolumeChange = useCallback((trackId: string, [volume]: number[]) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, volume } : t));
    if (audioRefs.current[trackId]) {
      audioRefs.current[trackId].volume = volume / 100;
    }
  }, []);

  // Onda editada (cortar/silenciar/desfazer): a faixa passa a apontar pro WAV novo.
  // Prévia, Exportar e Masterizar leem `audioUrl`; o Salvar VIP sobe o áudio de novo
  // porque audio_path/audio_url_direct saem.
  const aplicarEdicao = useCallback((trackId: string, url: string, duracao: number) => {
    setTracks(prev => prev.map(t => t.id === trackId
      ? { ...t, audioUrl: url, duration: duracao, audio_path: undefined, audio_url_direct: undefined,
          fadeIn: Math.min(t.fadeIn || 0, duracao / 2), fadeOut: Math.min(t.fadeOut || 0, duracao / 2) }
      : t));
    const antigo = audioRefs.current[trackId];
    if (antigo) antigo.pause();
    const audio = new Audio(url);
    audio.volume = (tracks.find(t => t.id === trackId)?.volume ?? 100) / 100;
    audioRefs.current[trackId] = audio;
  }, [tracks]);

  // Trecho arrastado de uma faixa pra outra (17/10/2026): a de destino recebe só o
  // trecho, entrando no MESMO tempo em que ele estava. Faixa com áudio pergunta antes.
  const receberTrecho = useCallback((origemId: string, destinoId: string, trecho: { url: string; duracao: number; inicio: number }) => {
    const origem = tracks.find(t => t.id === origemId);
    const destino = tracks.find(t => t.id === destinoId);
    if (!origem || !destino) return false;
    if (destino.audioUrl && !window.confirm(`A faixa "${destino.name}" já tem áudio. Trocar pelo trecho arrastado?`)) return false;
    const inicio = Math.round(((origem.inicio || 0) + trecho.inicio) * 100) / 100;
    setTracks(prev => prev.map(t => t.id === destinoId
      ? { ...t, audioUrl: trecho.url, duration: trecho.duracao, inicio, audio_path: undefined, audio_url_direct: undefined }
      : t));
    const antigo = audioRefs.current[destinoId];
    if (antigo) antigo.pause();
    audioRefs.current[destinoId] = new Audio(trecho.url);
    toast({ title: `⤵ Trecho levado para "${destino.name}"`, description: `${trecho.duracao.toFixed(1)} s, entrando em ${inicio.toFixed(1)} s. "Desfazer" na faixa de origem devolve o trecho lá.` });
    return true;
  }, [tracks, toast]);

  const handleFileUpload = useCallback((trackId: string, file: File) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, audioUrl: url, duration: audio.duration } : t));
      audioRefs.current[trackId] = audio;
      toast({ title: "Arquivo carregado!", description: file.name });
    });
    audio.addEventListener('error', () => {
      toast({ title: "Erro ao carregar áudio", variant: "destructive" });
    });
    audio.load();
  }, [toast]);

  const handleAudioGenerated = useCallback((audioUrl: string, name: string) => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name,
      type: "voiceover",
      audioUrl,
      volume: 100,
      color: "border-blue-500 bg-blue-500/10",
      duration: 0,
      effects: defaultEffects("voiceover"),
    };
    setTracks(prev => [...prev, newTrack]);
    const audio = new Audio(audioUrl);
    audio.addEventListener('loadedmetadata', () => {
      setTracks(prev => prev.map(t => t.id === newTrack.id ? { ...t, duration: audio.duration } : t));
      audioRefs.current[newTrack.id] = audio;
    });
    audio.load();
    toast({ title: "Voz adicionada!", description: name });
  }, [toast]);

  // Trilha vinda da Biblioteca de Trilhas Sonoras (/library -> "Usar no MiniDAW React"),
  // entregue via localStorage por não haver navegação com estado entre as duas páginas.
  const handleMusicTrackFromLibrary = useCallback((audioUrl: string, name: string, silencioso = false) => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name,
      type: "music",
      audioUrl,
      volume: 100,
      color: "border-purple-500 bg-purple-500/10",
      duration: 0,
      effects: defaultEffects("music"),
    };
    setTracks(prev => [...prev, newTrack]);
    const audio = new Audio(audioUrl);
    audio.addEventListener('loadedmetadata', () => {
      setTracks(prev => prev.map(t => t.id === newTrack.id ? { ...t, duration: audio.duration } : t));
      audioRefs.current[newTrack.id] = audio;
    });
    audio.load();
    if (!silencioso) toast({ title: "Trilha adicionada!", description: name });
  }, [toast]);

  // VOZ FATIADA VINDA DO STUDIO (23/10/2026, botão "Fatiado → React"): corta a
  // locução no meio das pausas entre parágrafos (/static/fatiar-paragrafos.js, o
  // mesmo da clássica) e cada parágrafo vira uma faixa de locução com "Entra em"
  // = o tempo dele na gravação. Tocadas juntas, remontam a voz inteira.
  useEffect(() => {
    const url = localStorage.getItem("minidaw_react_pending_audio");
    if (!url) return;
    const nPar = parseInt(localStorage.getItem("minidaw_react_pending_fatiar") || "0", 10);
    localStorage.removeItem("minidaw_react_pending_audio");
    localStorage.removeItem("minidaw_react_pending_fatiar");
    (async () => {
      try {
        const buf: AudioBuffer = await decodificar(await (await fetch(url)).blob());
        let mono = buf.getChannelData(0);
        if (buf.numberOfChannels > 1) {
          const dir = buf.getChannelData(1);
          mono = Float32Array.from(mono, (v, i) => (v + dir[i]) / 2);
        }
        const FP = (window as any).FatiarParagrafos;
        const cortes: number[] = nPar >= 2 && FP ? FP.acharCortes(mono, buf.sampleRate, nPar) : [];
        const pedacos = pedacosDosCortes(buf.length, buf.sampleRate, cortes);
        const base = tracksRef.current.filter((t) => t.type === "voiceover").length;
        const novas: Track[] = pedacos.map((p, i) => {
          const b = new AudioBuffer({ length: p.fim - p.ini, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
          for (let c = 0; c < buf.numberOfChannels; c++) b.copyToChannel(buf.getChannelData(c).subarray(p.ini, p.fim), c);
          const u = URL.createObjectURL(paraWav(b));
          const id = `${Date.now()}_${i}`;
          audioRefs.current[id] = new Audio(u);
          return {
            id, name: `Locução ${base + i + 1}`, type: "voiceover", audioUrl: u, volume: 100,
            color: "border-blue-500 bg-blue-500/10", duration: b.duration,
            effects: defaultEffects("voiceover"), inicio: Math.round(p.inicio * 1000) / 1000,
          };
        });
        setTracks((prev) => [...prev, ...novas]);
        setActiveTab("multitrack");
        const faltou = cortes.length + 1 < nPar;
        toast({
          title: `✂ Voz fatiada em ${novas.length} faixa${novas.length > 1 ? "s" : ""}`,
          description: faltou
            ? `O roteiro tem ${nPar} parágrafos; achei ${novas.length} trechos (a locução emendou algum).`
            : "Cada parágrafo numa faixa, no mesmo tempo da gravação.",
        });
      } catch (e: any) {
        toast({ title: "Não consegui receber a voz do Studio", description: e?.message || String(e), variant: "destructive" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PRÉ-ESCUTA DE TRILHAS DO PC (23/10/2026): o painel é o mesmo da clássica
  // (/static/pre-escuta.js, tecla W). Aqui só a ponte: tocar as vozes junto e
  // adicionar a trilha escolhida. Nada sobe pro servidor.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const vozesPreRef = useRef<{ chave: string; url: string; audio: HTMLAudioElement } | null>(null);
  useEffect(() => {
    const w = window as any;
    const pararTudo = () => {
      mixPlayRef.current?.audio.pause();
      vozesPreRef.current?.audio.pause();
      setIsPlaying(false);
    };
    w.preEscutaHost = {
      avisar: (msg: string, tipo?: string) =>
        toast({ title: msg, variant: tipo === "error" ? "destructive" : undefined }),
      temVoz: () => tracksRef.current.some((t) => t.type === "voiceover" && t.audioUrl),
      tocandoProjeto: () =>
        !!(mixPlayRef.current && !mixPlayRef.current.audio.paused) || !!(vozesPreRef.current && !vozesPreRef.current.audio.paused),
      pararProjeto: pararTudo,
      zerarProjeto: () => {
        pararTudo();
        if (vozesPreRef.current) vozesPreRef.current.audio.currentTime = 0;
      },
      // Mix SÓ das vozes (com os efeitos delas), montado uma vez e reaproveitado.
      tocarVozesDe: async (t: number) => {
        const vozes = tracksRef.current.filter((x) => x.type === "voiceover" && x.audioUrl).map(paraMix);
        const chave = JSON.stringify(vozes);
        let v = vozesPreRef.current;
        if (!v || v.chave !== chave) {
          const blob = await mixToMp3(vozes, { format: "wav" });
          if (v) { v.audio.pause(); URL.revokeObjectURL(v.url); }
          const url = URL.createObjectURL(blob);
          v = { chave, url, audio: new Audio(url) };
          vozesPreRef.current = v;
          await new Promise((r) => v!.audio.addEventListener("loadedmetadata", r, { once: true }));
        }
        v.audio.currentTime = Math.min(t, Math.max(0, v.audio.duration - 0.05));
        await v.audio.play();
      },
      devolverTrilhas: () => {},   // aqui as trilhas nem entram no mix das vozes
      // 1ª faixa de trilha vazia; senão cria "Trilha N". Nunca substitui.
      adicionarTrilha: async (arquivo: File) => {
        const vazia = tracksRef.current.find((x) => x.type === "music" && !x.audioUrl);
        setActiveTab("multitrack");
        if (vazia) { handleFileUpload(vazia.id, arquivo); return vazia.name; }
        const nome = `Trilha ${tracksRef.current.filter((x) => x.type === "music").length + 1}`;
        handleMusicTrackFromLibrary(URL.createObjectURL(arquivo), nome, true);
        return nome;
      },
    };
    return () => { delete w.preEscutaHost; };
  }, [toast, handleFileUpload, handleMusicTrackFromLibrary]);

  useEffect(() => {
    const pendingUrl = localStorage.getItem('selectedTrackUrl');
    if (!pendingUrl) return;
    const pendingName = localStorage.getItem('selectedTrackName') || 'Trilha da Biblioteca';
    localStorage.removeItem('selectedTrackUrl');
    localStorage.removeItem('selectedTrackName');
    handleMusicTrackFromLibrary(pendingUrl, pendingName);
    setActiveTab('multitrack');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contador e cursor verde suaves enquanto o mix toca (timeupdate só vem ~4x/s).
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const passo = () => {
      const a = mixPlayRef.current?.audio;
      if (a) setCurrentTime(a.currentTime);
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const playPause = useCallback(async () => {
    const atual = mixPlayRef.current;
    if (isPlaying && atual) {
      atual.audio.pause();
      setIsPlaying(false);
      return;
    }
    const playable = tracks.filter((t) => t.audioUrl);
    if (playable.length === 0) {
      toast({ title: "Nada para tocar", description: "Adicione ao menos uma faixa com áudio.", variant: "destructive" });
      return;
    }
    const faixas = playable.map(paraMix);
    const chave = JSON.stringify(faixas);
    let tocar = atual;
    if (!atual || atual.chave !== chave) {
      setMontandoPlay(true);
      try {
        const blob = await mixToMp3(faixas, { musicFadeAfterVoice: 1.1, format: "wav" });
        if (atual) { atual.audio.pause(); URL.revokeObjectURL(atual.url); }
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        // Acabou o mix: volta pro ponto onde o play começou (como no Samplitude).
        audio.addEventListener("ended", () => { setIsPlaying(false); setCurrentTime(inicioDoPlayRef.current); });
        tocar = { chave, url, audio };
        mixPlayRef.current = tocar;
      } catch (e: any) {
        console.error("Erro ao montar o play:", e);
        toast({ title: "Erro ao tocar o mix", description: e?.message || "Falha na mixagem", variant: "destructive" });
        return;
      } finally {
        setMontandoPlay(false);
      }
    }
    try {
      const a = tocar!.audio;
      if (!Number.isFinite(a.duration)) await new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }));
      // Toca A PARTIR DO CURSOR (no fim do mix, recomeça do 0).
      const de = currentTime < a.duration - 0.05 ? currentTime : 0;
      a.currentTime = de;
      inicioDoPlayRef.current = de;
      await a.play();
      setIsPlaying(true);
    } catch (e) {
      console.log("Play error:", e);
    }
  }, [isPlaying, tracks, toast, currentTime]);

  // Stop de verdade (dois toques no Espaço): para e volta pro ponto onde o play começou.
  const pararMix = useCallback(() => {
    const atual = mixPlayRef.current;
    if (atual) atual.audio.pause();
    setIsPlaying(false);
    setCurrentTime(inicioDoPlayRef.current);
  }, []);

  // Mover o cursor (clique numa onda ou na régua). Tocando, o mix pula pra lá.
  const moverCursor = useCallback((g: number) => {
    const t = Math.max(0, g);
    setCurrentTime(t);
    const atual = mixPlayRef.current;
    if (atual && isPlaying && Number.isFinite(atual.audio.duration)) {
      atual.audio.currentTime = Math.min(t, atual.audio.duration);
      inicioDoPlayRef.current = t;
    }
  }, [isPlaying]);

  // Altura do cabeçalho fixo: a régua gruda logo embaixo dele.
  useEffect(() => {
    const el = cabecalhoRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAlturaCabecalho(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // BARRA DE ESPAÇO (pedido dele, 17/10/2026): 1 toque = Play/Pausa do Play verde;
  // 2 toques rápidos (< 350 ms) = Stop e volta pro começo. Digitando num campo
  // (roteiro, nome da faixa…) o Espaço continua sendo espaço.
  const atalhoRef = useRef({ playPause: () => {}, pararMix: () => {}, novaFaixa: () => {}, zoomLinha: () => {}, alturaFaixa: () => {} } as {
    playPause: () => void; pararMix: () => void; novaFaixa: (tipo: "voiceover" | "music") => void;
    zoomLinha: (fator: number) => void; alturaFaixa: (fator: number) => void;
  });
  useEffect(() => {
    let ultimoToque = 0;
    const tecla = (e: KeyboardEvent) => {
      // Alt+V = nova faixa de voz, Alt+T = nova faixa de trilha. (Ctrl+N o Chrome
      // não deixa site nenhum usar: é "nova janela".)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyV" || e.code === "KeyT")) {
        e.preventDefault();
        atalhoRef.current.novaFaixa(e.code === "KeyV" ? "voiceover" : "music");
        return;
      }
      const alvo = e.target as HTMLElement | null;
      const tag = (alvo?.tagName || "").toLowerCase();
      const digitando = alvo?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
      // 23/10/2026 (igual à clássica): + / − = zoom da LARGURA (linha toda);
      // Alt+1 / Alt+2 = ALTURA da faixa sob o mouse (fora das faixas = todas).
      if (!digitando && !e.ctrlKey && !e.metaKey && !document.querySelector('[role="dialog"]')) {
        if (e.altKey && !e.shiftKey && ["Digit1", "Digit2", "Numpad1", "Numpad2"].includes(e.code)) {
          e.preventDefault();
          atalhoRef.current.alturaFaixa(e.code.endsWith("1") ? 1.3 : 1 / 1.3);
          return;
        }
        if (!e.altKey && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) {
          e.preventDefault(); atalhoRef.current.zoomLinha(2); return;
        }
        if (!e.altKey && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract")) {
          e.preventDefault(); atalhoRef.current.zoomLinha(0.5); return;
        }
      }
      if (e.code !== "Space" && e.key !== " ") return;
      if (digitando) return;
      if (document.querySelector('[role="dialog"]')) return;   // janela aberta (VIP, gerador de voz…)
      e.preventDefault();          // não rola a página nem "clica" o botão em foco
      if (e.repeat) return;        // tecla segurada não conta como vários toques
      const agora = Date.now();
      if (agora - ultimoToque < 350) {
        ultimoToque = 0;
        atalhoRef.current.pararMix();
      } else {
        ultimoToque = agora;
        atalhoRef.current.playPause();
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, []);
  // Altura de cada faixa (Alt+1 / Alt+2). É só VISTA: não vai pro projeto salvo.
  const [alturas, setAlturas] = useState<Record<string, number>>({});
  const faixaSobMouseRef = useRef<string | null>(null);
  const alturaFaixa = (fator: number) => {
    const alvo = faixaSobMouseRef.current;
    const ids = alvo ? [alvo] : tracksRef.current.map((t) => t.id);
    setAlturas((prev) => {
      const n = { ...prev };
      for (const id of ids) n[id] = Math.round(Math.max(40, Math.min(300, (prev[id] ?? 76) * fator)));
      return n;
    });
  };
  atalhoRef.current = { ...atalhoRef.current, playPause, pararMix, novaFaixa: addTrack, alturaFaixa };   // sempre a versão atual (estado novo)

  const saveProject = useCallback(() => {
    setIsSaving(true);
    setTimeout(() => {
      toast({ title: "Projeto salvo!", description: "Seu projeto foi salvo com sucesso." });
      setIsSaving(false);
    }, 1000);
  }, [toast]);

  const mixAndDownload = useCallback(async () => {
    const playable = tracks.filter((t) => t.audioUrl);
    if (playable.length === 0) {
      toast({ title: "Nada para mixar", description: "Adicione ao menos uma faixa com áudio.", variant: "destructive" });
      return;
    }
    setIsMixing(true);
    toast({ title: "Mixando áudio...", description: "Renderizando e codificando o MP3 (fade-out automático da trilha)." });
    try {
      const blob = await mixToMp3(
        playable.map(paraMix),
        { musicFadeAfterVoice: 1.1 }
      );
      downloadBlob(blob, `${projectId}.mp3`);
      toast({ title: "Mix concluído! 🎧", description: "MP3 final exportado (voz + trilha mixadas, com fade-out)." });
    } catch (e: any) {
      console.error("Erro na mixagem:", e);
      toast({ title: "Erro ao mixar", description: e?.message || "Falha na mixagem", variant: "destructive" });
    } finally {
      setIsMixing(false);
    }
  }, [tracks, projectId, toast]);

  // Gera uma prévia do mix REAL (com efeitos + fade-out) para o usuário ouvir antes de
  // exportar. Reutiliza o mesmo motor da exportação, então o que se ouve = o que se baixa.
  const previewMix = useCallback(async () => {
    const playable = tracks.filter((t) => t.audioUrl);
    if (playable.length === 0) {
      toast({ title: "Nada para ouvir", description: "Adicione ao menos uma faixa com áudio.", variant: "destructive" });
      return;
    }
    setIsPreviewing(true);
    toast({ title: "Gerando prévia...", description: "Aplicando os efeitos e o fade-out para você ouvir o resultado real." });
    try {
      const blob = await mixToMp3(
        playable.map(paraMix),
        { musicFadeAfterVoice: 1.1, format: "wav" }
      );
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      toast({ title: "Prévia pronta! 🎧", description: "Toque o player abaixo para ouvir o mix com os efeitos." });
    } catch (e: any) {
      console.error("Erro na prévia:", e);
      toast({ title: "Erro ao gerar prévia", description: e?.message || "Falha ao gerar a prévia", variant: "destructive" });
    } finally {
      setIsPreviewing(false);
    }
  }, [tracks, toast]);

  const comAudio = tracks.filter(t => t.audioUrl && t.duration > 0);
  const totalLinha = totalDaLinha(comAudio.map(t => ({ inicio: t.inicio || 0, duracao: t.duration })));
  const linha: LinhaComum = {
    total: totalLinha,
    zoom: linhaZoom,
    g0: linhaG0,
    mudarZoom: (z, ancora, frac) => {
      setLinhaZoom(z);
      setLinhaG0(Math.max(0, Math.min(totalLinha - totalLinha / z, ancora - frac * (totalLinha / z))));
    },
    rolarPara: (g) => setLinhaG0(Math.max(0, Math.min(totalLinha - totalLinha / linhaZoom, g))),
  };
  // Teclas + / − : o mesmo zoom dos botões das faixas, ancorado no cursor se ele estiver na tela.
  atalhoRef.current.zoomLinha = (fator: number) => {
    if (!totalLinha) return;
    const z = Math.max(1, Math.min(ZOOM_MAX, linhaZoom * fator));
    if (z === linhaZoom) return;
    const span = totalLinha / linhaZoom;
    const ancora = currentTime >= linhaG0 && currentTime <= linhaG0 + span ? currentTime : linhaG0 + span / 2;
    linha.mudarZoom(z, ancora, (ancora - linhaG0) / span);
  };
  // Marcadores (ímã) que cada faixa enxerga: início/fim das OUTRAS faixas e o fim da locução.
  const marcadoresDe = (id: string): Marcador[] => {
    const outras = comAudio.filter(t => t.id !== id);
    const lista: Marcador[] = [];
    let fimVoz = 0;
    for (const t of outras) {
      const ini = t.inicio || 0;
      const fim = ini + t.duration;
      if (t.type === "voiceover") fimVoz = Math.max(fimVoz, fim);
      lista.push({ t: fim, cor: "rgba(255,255,255,0.55)", rotulo: `fim de ${t.name}` });
      if (ini > 0) lista.push({ t: ini, cor: "rgba(255,255,255,0.35)", rotulo: `início de ${t.name}` });
    }
    if (fimVoz > 0) lista.push({ t: fimVoz, cor: "#f59e0b", rotulo: "fim da locução" });
    return lista;
  };

  const createNewProject = useCallback(() => {
    setTracks([]);
    audioRefs.current = {};
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setProjectId("audio-pank-" + Date.now());
    setDbProjectId(null);
    setActiveTab("roteiro");
    toast({ title: "🎵 Novo projeto criado" });
  }, [toast]);

  // Status das etapas do fluxo de produção
  const stepStatus = (step: 1 | 2 | 3): "active" | "done" | "pending" => {
    const map: Record<TabKey, 1 | 2 | 3> = { roteiro: 1, trilha: 2, upload: 2, multitrack: 3, mix: 3, master: 3 };
    const current = map[activeTab];
    if (step === current) return "active";
    if (step < current) return "done";
    return "pending";
  };

  const StepBadge = ({ step }: { step: 1 | 2 | 3 }) => {
    const s = stepStatus(step);
    if (s === "active") return <Badge className="bg-blue-600 text-white">Ativo</Badge>;
    if (s === "done") return <Badge className="bg-green-600 text-white">Concluído</Badge>;
    return <Badge variant="outline" className="border-white/20 text-white/60">Pendente</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white">
      {/* Header */}
      <header ref={cabecalhoRef} className="border-b border-white/10 bg-black/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600">
                <Headphones className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Audio Pank Studio
                </h1>
                <p className="text-sm text-white/60">Roteiro → IA → Locução → Mixagem → Download</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => setVipOpen(true)} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <FolderOpen className="w-4 h-4" /> Projetos
              </Button>
              <Button onClick={() => setVipOpen(true)} variant="outline" className="gap-2 border-yellow-500/50 hover:bg-yellow-500/10">
                <Star className="w-4 h-4 text-yellow-500" /> VIP
              </Button>
              {/* Salvar/Abrir no PC (17/10/2026): funciona sem o Supabase (bloqueado por cota). */}
              <ProjetoNoPC
                projectId={projectId}
                getCurrent={() => ({ projectId, dbProjectId, roteiro, tracks })}
                onLoad={loadSnapshot}
                toast={toast}
              />
              <Button onClick={createNewProject} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <Plus className="w-4 h-4" /> Novo
              </Button>
              <SecretsManager />
              <Badge variant="outline" className="border-white/20 text-white/60">v2.1</Badge>
              <Button onClick={() => { window.location.href = "/"; }} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <Home className="w-4 h-4" /> Início
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Configurações do Projeto */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-400" />
                <span className="text-lg font-semibold">Configurações do Projeto</span>
              </div>
              <Badge className="bg-purple-600 text-white">Ativo</Badge>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-white/70">ID do Projeto</label>
                <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} className="bg-white/10 border-white/20 text-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-white/70">Status</label>
                <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg border border-white/10">
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm">{tracks.length > 0 ? "Pronto para mixagem" : "Aguardando conteúdo"}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Fluxo de Produção */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <span className="text-lg font-semibold">Fluxo de Produção</span>
              <Badge variant="outline" className="border-white/20 text-white/60">Projeto: {projectId}</Badge>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              {[
                { n: 1 as const, label: "Roteiro + IA", icon: FileText },
                { n: 2 as const, label: "Trilha Musical", icon: Music },
                { n: 3 as const, label: "Mixagem", icon: Sliders },
              ].map(({ n, label, icon: Icon }) => (
                <div key={n} className="flex items-center justify-between gap-3 p-4 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-purple-400" />
                    <span className="font-medium">{n}. {label}</span>
                  </div>
                  <StepBadge step={n} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Abas */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                activeTab === key ? "bg-black/40 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {/* Barra de transporte / ações */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <div className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                onClick={playPause}
                disabled={montandoPlay}
                title="Toca o mix de verdade: efeitos, gate e fade da trilha — igual ao Exportar. Atalho: Espaço (2 toques = Stop)"
                className="w-14 h-14 rounded-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-500/20"
              >
                {montandoPlay ? <Loader2 className="w-6 h-6 animate-spin" /> : isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
              </Button>
              <div className="text-sm">
                <span className="text-white/60">Tempo:</span>
                <span className="ml-2 font-mono text-lg">{currentTime.toFixed(1)}s</span>
                <div className="text-xs text-white/40">{montandoPlay ? "montando o mix…" : "mix com efeitos e fade · Espaço = play/pausa · 2× = stop · Alt+V nova voz · Alt+T nova trilha · W pré-escuta · +/− zoom · Alt+1/2 altura"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => openVoiceGen()} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                <Wand2 className="w-4 h-4" /> Gerar Voz AI
              </Button>
              <Button onClick={() => addTrack("voiceover")} className="gap-2 bg-blue-600 hover:bg-blue-700">
                <Mic className="w-4 h-4" /> Adicionar Locução
              </Button>
              <Button onClick={() => addTrack("music")} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <Music className="w-4 h-4" /> Adicionar Trilha
              </Button>
              <Button onClick={() => (window as any).PreEscuta?.abrir()} variant="outline" className="gap-2 border-white/20 hover:bg-white/10"
                      title="Ouvir trilhas do seu PC antes de subir (sozinha ou junto com a voz) — atalho W">
                <Headphones className="w-4 h-4" /> Pré-escuta (W)
              </Button>
              <Button onClick={saveProject} variant="outline" className="gap-2 border-white/20 hover:bg-white/10" disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
              </Button>
              <Button
                onClick={previewMix}
                disabled={isPreviewing || tracks.length === 0}
                variant="outline"
                className="gap-2 border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/10"
              >
                {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Ouvir Prévia
              </Button>
              <Button
                onClick={mixAndDownload}
                disabled={isMixing || tracks.length === 0}
                className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {isMixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exportar
              </Button>
            </div>
          </div>
        </Card>

        {/* Player da prévia do mix (com efeitos + fade-out aplicados) */}
        {previewUrl && (
          <Card className="bg-cyan-500/5 border-cyan-400/20 backdrop-blur-sm">
            <div className="p-4 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-cyan-200 flex items-center gap-2 whitespace-nowrap">
                <Sliders className="w-4 h-4" /> Prévia do mix (efeitos + fade):
              </span>
              <audio src={previewUrl} controls autoPlay className="flex-1 min-w-[240px]" />
            </div>
          </Card>
        )}

        {/* Conteúdo por aba */}
        {activeTab === "roteiro" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => navigate("/busca-noticias")} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <Search className="w-4 h-4" /> Busca Notícias RSS
              </Button>
              <Button onClick={() => navigate("/newpost-manager")} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                <Newspaper className="w-4 h-4" /> NewPost-IA Manager
              </Button>
            </div>
            <ScriptPanel value={roteiro} onChange={setRoteiro} onSendToVoice={() => openVoiceGen({ text: roteiro })} />
            <VoiceGallery onUseVoice={(voiceKey) => openVoiceGen({ text: roteiro, voiceKey })} />
          </div>
        )}

        {activeTab === "trilha" && (
          <Card className="bg-white/5 border-white/10 border-dashed border-2">
            <div className="p-12 text-center">
              <Music className="w-14 h-14 mx-auto mb-4 text-white/40" />
              <h3 className="text-xl font-semibold mb-2">Gerar Trilha Musical</h3>
              <p className="text-white/60 mb-6 max-w-md mx-auto">
                Adicione uma trilha musical ao projeto. A geração por IA (MusicGen) requer a chave REPLICATE_API_KEY configurada.
              </p>
              <Button onClick={() => addTrack("music")} className="gap-2 bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4" /> Adicionar Trilha
              </Button>
            </div>
          </Card>
        )}

        {activeTab === "upload" && (
          <Card className="bg-white/5 border-white/10 border-dashed border-2">
            <div className="p-12 text-center">
              <Upload className="w-14 h-14 mx-auto mb-4 text-white/40" />
              <h3 className="text-xl font-semibold mb-2">Upload de Áudio</h3>
              <p className="text-white/60 mb-6 max-w-md mx-auto">
                Crie uma faixa e arraste seu arquivo de áudio (.mp3, .wav) para dentro dela na aba Multi-Track.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button onClick={() => addTrack("voiceover")} className="gap-2 bg-blue-600 hover:bg-blue-700">
                  <Mic className="w-4 h-4" /> Nova Locução
                </Button>
                <Button onClick={() => addTrack("music")} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                  <Music className="w-4 h-4" /> Nova Trilha
                </Button>
              </div>
            </div>
          </Card>
        )}

        {activeTab === "multitrack" && (
          <div className="space-y-4">
            {tracks.length === 0 ? (
              <Card className="bg-white/5 border-white/10 border-dashed border-2">
                <div className="p-12 text-center">
                  <Upload className="w-16 h-16 mx-auto mb-4 text-white/40" />
                  <h3 className="text-xl font-semibold mb-2">Comece seu projeto</h3>
                  <p className="text-white/60 mb-6 max-w-md mx-auto">
                    Adicione locuções, trilhas ou gere voz com IA para criar seu áudio profissional.
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <Button onClick={() => openVoiceGen()} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
                      <Wand2 className="w-4 h-4" /> Gerar Voz AI
                    </Button>
                    <Button onClick={() => addTrack("voiceover")} className="gap-2 bg-blue-600 hover:bg-blue-700">
                      <Mic className="w-4 h-4" /> Adicionar Locução
                    </Button>
                    <Button onClick={() => addTrack("music")} variant="outline" className="gap-2 border-white/20 hover:bg-white/10">
                      <Music className="w-4 h-4" /> Adicionar Trilha
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <>
              {comAudio.length > 0 && (
                <ReguaLinha linha={linha} cursor={currentTime} tocando={isPlaying} onCursor={moverCursor} topo={alturaCabecalho} />
              )}
              {tracks.map((track) => (
                <Card key={track.id} data-faixa-id={track.id}
                  onMouseEnter={() => { faixaSobMouseRef.current = track.id; }}
                  onMouseLeave={() => { if (faixaSobMouseRef.current === track.id) faixaSobMouseRef.current = null; }}
                  className={`bg-white/5 border-2 backdrop-blur-sm ${track.color}`}>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`w-2 h-10 rounded-full ${track.type === "voiceover" ? "bg-blue-500" : "bg-purple-500"}`} />
                        <Input
                          value={track.name}
                          onChange={(e) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, name: e.target.value } : t))}
                          className="bg-white/10 border-white/20 text-white placeholder-white/40 max-w-sm"
                        />
                        <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white/80 whitespace-nowrap">
                          {track.type === "voiceover" ? "Locução" : "Trilha"}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeTrack(track.id)}
                        className="text-white/60 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>

                    {!track.audioUrl ? (
                      <div className="flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed border-white/20 rounded-lg bg-white/5">
                        <Upload className="w-10 h-10 text-white/40" />
                        <p className="text-sm text-white/60">Arraste um arquivo de áudio aqui</p>
                        <input
                          type="file"
                          accept="audio/*"
                          aria-label="Selecionar arquivo de áudio"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(track.id, file);
                          }}
                          className="text-sm text-white/60 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                        />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <OndaEditavel
                          audioUrl={track.audioUrl}
                          tipo={track.type}
                          onEditado={(url, duracao) => aplicarEdicao(track.id, url, duracao)}
                          cursor={currentTime}
                          tocandoMix={isPlaying}
                          onCursor={moverCursor}
                          faixaId={track.id}
                          onSoltarTrecho={(destino, trecho) => receberTrecho(track.id, destino, trecho)}
                          inicio={track.inicio || 0}
                          linha={linha}
                          marcadores={marcadoresDe(track.id)}
                          onMover={(v) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, inicio: v } : t))}
                          fadeIn={track.fadeIn || 0}
                          fadeOut={track.fadeOut || 0}
                          onFades={(fi, fo) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, fadeIn: fi, fadeOut: fo } : t))}
                          altura={alturas[track.id]}
                        />
                        <div className="text-sm text-white/60">Duração: {track.duration.toFixed(1)}s</div>
                        {/* Entra em + fade (17/10/2026): assinatura cantada do jingle no fim do spot. */}
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="font-medium text-white/80">Entra em:</span>
                          <Input
                            type="number" min={0} step={0.1}
                            value={track.inicio ?? 0}
                            onChange={(e) => {
                              const v = Math.max(0, parseFloat(e.target.value) || 0);
                              setTracks(prev => prev.map(t => t.id === track.id ? { ...t, inicio: v } : t));
                            }}
                            className="w-24 h-8 bg-white/10 border-white/20 text-white"
                            aria-label="Entra em (segundos)"
                          />
                          <span className="text-white/50">s</span>
                          <Button size="sm" variant="outline" className="h-8 bg-white/5 border-white/20 text-white hover:bg-white/10"
                            title="Põe esta faixa pra entrar quando a última fala da locução acaba (ex.: assinatura cantada do jingle)"
                            onClick={() => {
                              const fim = fimDaVoz(tracks.filter(t => t.id !== track.id).map(t => ({ type: t.type, duracao: t.duration, inicio: t.inicio })));
                              setTracks(prev => prev.map(t => t.id === track.id ? { ...t, inicio: Math.round(fim * 10) / 10 } : t));
                            }}>
                            ⇥ logo depois da voz
                          </Button>
                          {track.type === "music" && (
                            <>
                              <span className="font-medium text-white/80 ml-2">Fade da trilha:</span>
                              <select
                                value={track.fade || "voz"}
                                onChange={(e) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, fade: e.target.value as Track["fade"] } : t))}
                                className="h-8 rounded-md bg-slate-900 border border-white/20 text-white px-2"
                                aria-label="Fade da trilha"
                              >
                                <option value="voz">desce no fim da locução</option>
                                <option value="fim">desce no fim do spot (fica por baixo do jingle)</option>
                                <option value="nenhum">sem fade (toca até o fim — use no jingle)</option>
                              </select>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-white/80 w-16">Volume:</span>
                          <Slider
                            value={[track.volume]}
                            onValueChange={(value) => handleVolumeChange(track.id, value)}
                            max={100}
                            step={1}
                            className="flex-1 max-w-md"
                          />
                          <span className="text-sm text-white/60 w-12 text-right">{track.volume}%</span>
                        </div>

                        {/* Efeitos por faixa (EQ + Compressor + Reverb + Nivelar) */}
                        <TrackEffectsPanel
                          effects={track.effects}
                          trackType={track.type}
                          onChange={(fx) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, effects: fx } : t))}
                        />
                      </div>
                    )}
                  </div>
                </Card>
              ))}
              </>
            )}
          </div>
        )}

        {activeTab === "mix" && (
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <div className="p-8 text-center space-y-4">
              <Download className="w-14 h-14 mx-auto text-purple-400" />
              <h3 className="text-xl font-semibold">Mix Rápido</h3>
              <p className="text-white/60 max-w-md mx-auto">
                {tracks.length === 0
                  ? "Adicione faixas antes de mixar."
                  : `${tracks.length} faixa(s) prontas. Mixe e exporte seu áudio final.`}
              </p>
              <Button
                onClick={mixAndDownload}
                disabled={isMixing || tracks.length === 0}
                className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {isMixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Mixar e Exportar
              </Button>
            </div>
          </Card>
        )}

        {activeTab === "master" && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
            <MasterizarPanel />
          </div>
        )}

        {/* Rodapé */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <div className="p-4 flex items-center justify-between text-sm text-white/60 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Workflow className="w-4 h-4 text-purple-400" />
              <span>🎛️ Audio Pank Studio v2.1</span>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:inline">Projeto: {projectId}</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-400" />
              <span>Gemini AI + ElevenLabs</span>
            </div>
          </div>
        </Card>
      </main>

      {/* Gerador de Voz controlado — abre a partir do Roteiro, Galeria ou botões */}
      <VoiceGenerator
        open={voiceGen.open}
        onClose={() => setVoiceGen((v) => ({ ...v, open: false }))}
        onAudioGenerated={handleAudioGenerated}
        initialText={voiceGen.text}
        initialVoiceKey={voiceGen.voiceKey}
      />

      {/* Projetos VIP — salvar/abrir */}
      <VipProjects
        open={vipOpen}
        onClose={() => setVipOpen(false)}
        getCurrent={() => ({ projectId, dbProjectId, roteiro, tracks })}
        onLoad={loadSnapshot}
        onSaved={(id) => setDbProjectId(id)}
      />
    </div>
  );
};

export default MiniDAWIntegrated;
