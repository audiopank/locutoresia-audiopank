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
import { mixToMp3, downloadBlob } from "@/lib/mixer";
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
}

type TabKey = "roteiro" | "trilha" | "upload" | "multitrack" | "mix";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "roteiro", label: "Roteiro", icon: FileText },
  { key: "trilha", label: "Gerar Trilha", icon: Music },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "multitrack", label: "Multi-Track", icon: Sliders },
  { key: "mix", label: "Mix Rápido", icon: Download },
];

const MiniDAWIntegrated = () => {
  const navigate = useNavigate();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime] = useState(0);
  const [isMixing, setIsMixing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("audio-pank-" + Date.now());
  const [activeTab, setActiveTab] = useState<TabKey>("roteiro");
  const [roteiro, setRoteiro] = useState("");
  const [voiceGen, setVoiceGen] = useState<{ open: boolean; text: string; voiceKey?: string }>({ open: false, text: "" });
  const [vipOpen, setVipOpen] = useState(false);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const { toast } = useToast();

  // Carrega um projeto VIP salvo de volta para o estúdio
  const loadSnapshot = useCallback((snap: { projectId: string; roteiro: string; tracks: Track[] }) => {
    audioRefs.current = {};
    if (snap.projectId) setProjectId(snap.projectId);
    setRoteiro(snap.roteiro || "");
    setTracks(snap.tracks || []);
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
      effects: defaultEffects(),
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
      effects: defaultEffects(),
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
  const handleMusicTrackFromLibrary = useCallback((audioUrl: string, name: string) => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name,
      type: "music",
      audioUrl,
      volume: 100,
      color: "border-purple-500 bg-purple-500/10",
      duration: 0,
      effects: defaultEffects(),
    };
    setTracks(prev => [...prev, newTrack]);
    const audio = new Audio(audioUrl);
    audio.addEventListener('loadedmetadata', () => {
      setTracks(prev => prev.map(t => t.id === newTrack.id ? { ...t, duration: audio.duration } : t));
      audioRefs.current[newTrack.id] = audio;
    });
    audio.load();
    toast({ title: "Trilha adicionada!", description: name });
  }, [toast]);

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

  const playPause = useCallback(() => {
    if (isPlaying) {
      Object.values(audioRefs.current).forEach(audio => audio.pause());
      setIsPlaying(false);
    } else {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio.src) audio.play().catch(e => console.log("Play error:", e));
      });
      setIsPlaying(true);
    }
  }, [isPlaying]);

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
        playable.map((t) => ({ audioUrl: t.audioUrl, type: t.type, volume: t.volume, effects: t.effects })),
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
        playable.map((t) => ({ audioUrl: t.audioUrl, type: t.type, volume: t.volume, effects: t.effects })),
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

  const createNewProject = useCallback(() => {
    setTracks([]);
    audioRefs.current = {};
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setProjectId("audio-pank-" + Date.now());
    setActiveTab("roteiro");
    toast({ title: "🎵 Novo projeto criado" });
  }, [toast]);

  // Status das etapas do fluxo de produção
  const stepStatus = (step: 1 | 2 | 3): "active" | "done" | "pending" => {
    const map: Record<TabKey, 1 | 2 | 3> = { roteiro: 1, trilha: 2, upload: 2, multitrack: 3, mix: 3 };
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
      <header className="border-b border-white/10 bg-black/30 backdrop-blur-xl sticky top-0 z-50">
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
                className="w-14 h-14 rounded-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-500/20"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
              </Button>
              <div className="text-sm">
                <span className="text-white/60">Tempo:</span>
                <span className="ml-2 font-mono text-lg">{currentTime.toFixed(1)}s</span>
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
              tracks.map((track) => (
                <Card key={track.id} className={`bg-white/5 border-2 backdrop-blur-sm ${track.color}`}>
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
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <audio src={track.audioUrl} controls className="w-full" />
                          </div>
                          <div className="text-sm text-white/60">Duração: {track.duration.toFixed(1)}s</div>
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
                          onChange={(fx) => setTracks(prev => prev.map(t => t.id === track.id ? { ...t, effects: fx } : t))}
                        />
                      </div>
                    )}
                  </div>
                </Card>
              ))
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
              <span>Gemini AI + ElevenLabs + LMNT</span>
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
        getCurrent={() => ({ projectId, roteiro, tracks })}
        onLoad={loadSnapshot}
      />
    </div>
  );
};

export default MiniDAWIntegrated;
