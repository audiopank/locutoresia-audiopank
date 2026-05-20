import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Newspaper, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Plus, Trash2, Volume2, Music, Download, Loader2, Undo2, Redo2, Copy, Gauge, PanelLeftClose, PanelRightClose, Save, FolderOpen, Clock, FileAudio, Upload, Mic, Wand2, History, Sliders, Activity, Waves, Music2, Bookmark, Grid3X3, ChevronUp, ChevronDown, GripVertical, Scissors, ZoomIn, ZoomOut, Keyboard, Eye, CheckSquare, Square, Layers, TrendingUp, TrendingDown } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { TrackWaveform } from "@/components/TrackWaveform";
import { TrackControls } from "@/components/TrackControls";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { AudioTrimDialog } from "@/components/AudioTrimDialog";
import { AutoSaveRestoreDialog } from "@/components/AutoSaveRestoreDialog";
import { DAWTimeline } from "@/components/DAWTimeline";
import { TrackEffects, TrackEffectsSettings, defaultEffects } from "@/components/TrackEffects";
import { RecordingDialog } from "@/components/RecordingDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import { useAudioEffects } from "@/hooks/useAudioEffects";
import { TimelineMarkers, Marker } from "@/components/TimelineMarkers";
import { GraphicEqualizer, EQ10BandSettings, defaultEQ10Band } from "@/components/GraphicEqualizer";
import { TrackClipHandles } from "@/components/TrackClipHandles";
import { DAWStatusBar } from "@/components/DAWStatusBar";
import { useBPMDetector } from "@/hooks/useBPMDetector";
import { CompressorVUMeter } from "@/components/CompressorVUMeter";
import { LUFSMeter } from "@/components/LUFSMeter";
import { ScissorCursor } from "@/components/ScissorCursor";
import { ProjectOverview } from "@/components/ProjectOverview";
import { VoiceProcessors, VoiceProcessorSettings, defaultVoiceProcessors } from "@/components/VoiceProcessors";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VoiceGenerator } from "@/components/VoiceGenerator";

// Importa todos os tipos e interfaces do MiniDAW original
interface AutoSaveData {
  projectName: string;
  tracks: Array<{ id: string; name: string; type: string }>;
  savedAt: string;
}

interface Track {
  id: string;
  name: string;
  type: "voiceover" | "music";
  audioUrl: string;
  volume: number;
  color: string;
  fadeIn: number;
  fadeOut: number;
  zoom: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  pan: number;
  playbackRate: number;
  effects: TrackEffectsSettings;
  showEffects: boolean;
  eq10Band: EQ10BandSettings;
  showEQ10Band: boolean;
  compressorEnabled: boolean;
  voiceProcessors: VoiceProcessorSettings;
  showVoiceProcessors: boolean;
  muted: boolean;
  solo: boolean;
}

interface HistoryState {
  tracks: Track[];
  description: string;
}

interface ProjectData {
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  tracks: Omit<Track, 'audioUrl'>[];
  audioData: { [trackId: string]: string };
}

interface RecentProject {
  name: string;
  updatedAt: string;
  trackCount: number;
  data: string;
}

// Constantes
const MAX_HISTORY_SIZE = 50;
const RECENT_PROJECTS_KEY = "minidaw_recent_projects";
const MAX_RECENT_PROJECTS = 10;
const AUTO_SAVE_KEY = "minidaw_autosave";
const AUTO_SAVE_INTERVAL = 30000;
const VIP_AUTO_SAVE_INTERVAL = 120000;

// Função auxiliar para converter AudioBuffer para WAV
const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numberOfChannels * 2;
  const arrBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrBuffer);
  const channels: Float32Array[] = [];
  let pos = 0;
  const writeString = (str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(pos++, str.charCodeAt(i)); };
  writeString('RIFF');
  view.setUint32(pos, 36 + length, true); pos += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(pos, 16, true); pos += 4;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, numberOfChannels, true); pos += 2;
  view.setUint32(pos, buffer.sampleRate, true); pos += 4;
  view.setUint32(pos, buffer.sampleRate * numberOfChannels * 2, true); pos += 4;
  view.setUint16(pos, numberOfChannels * 2, true); pos += 2;
  view.setUint16(pos, 16, true); pos += 2;
  writeString('data');
  view.setUint32(pos, length, true); pos += 4;
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  let offset = 0;
  while (offset < buffer.length) {
    for (let i = 0; i < numberOfChannels; i++) {
      const sample = Math.max(-1, Math.min(1, channels[i][offset]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      pos += 2;
    }
    offset++;
  }
  return arrBuffer;
};

const MiniDAWIntegrated = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryState[]>([{ tracks: [], description: "Estado inicial" }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const tracks = history[historyIndex]?.tracks || [];
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMixing, setIsMixing] = useState(false);
  const [exportFormat, setExportFormat] = useState<"wav" | "mp3">("wav");
  const [mp3Bitrate, setMp3Bitrate] = useState<128 | 192 | 320>(192);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const analyserRefs = useRef<{ [key: string]: AnalyserNode }>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const { toast } = useToast();
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [trimDialogOpen, setTrimDialogOpen] = useState(false);
  const [trackToTrim, setTrackToTrim] = useState<Track | null>(null);
  const [projectName, setProjectName] = useState("Novo Projeto");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showAutoSaveDialog, setShowAutoSaveDialog] = useState(false);
  const [autoSaveData, setAutoSaveData] = useState<AutoSaveData | null>(null);
  const [showRecordingDialog, setShowRecordingDialog] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estados adicionais (mantidos do original)
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [detectedBPM, setDetectedBPM] = useState<number | null>(null);
  const [isDetectingBPM, setIsDetectingBPM] = useState(false);
  const [globalCompressorEnabled, setGlobalCompressorEnabled] = useState(true);
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false);
  const [crossfadeDuration, setCrossfadeDuration] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [scissorMode, setScissorMode] = useState(false);
  const [showOverview, setShowOverview] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [clipboardClips, setClipboardClips] = useState<Track[]>([]);
  const [dragIndicatorTrackId, setDragIndicatorTrackId] = useState<string | null>(null);
  const [vipAutoSaves, setVipAutoSaves] = useState<{name: string, savedAt: string, trackCount: number}[]>([]);
  const vipAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoFadeOnVoiceEnd, setAutoFadeOnVoiceEnd] = useState(true);
  const autoFadeDuration = 1.05;
  const voiceEndDetectedRef = useRef<{ [trackId: string]: boolean }>({});
  const [strimEnabled, setStrimEnabled] = useState(false);
  const [strimThreshold, setStrimThreshold] = useState(0.5);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  // Hooks
  const audioEffects = useAudioEffects(audioContextRef.current);
  const { detectBPM } = useBPMDetector();

  // Funções simplificadas - mantendo apenas as essenciais para demonstração
  const setTracks = useCallback((newTracks: Track[] | ((prev: Track[]) => Track[]), description?: string) => {
    const resolvedTracks = typeof newTracks === 'function' 
      ? newTracks(tracks) 
      : newTracks;
    
    if (description) {
      setHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push({ tracks: resolvedTracks, description });
        if (newHistory.length > MAX_HISTORY_SIZE) {
          newHistory.shift();
          setHistoryIndex(prev => Math.max(0, prev));
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY_SIZE - 1));
    } else {
      setHistory(prev => {
        const newHistory = [...prev];
        newHistory[historyIndex] = { 
          tracks: resolvedTracks, 
          description: prev[historyIndex]?.description || "Atualização"
        };
        return newHistory;
      });
    }
  }, [tracks, historyIndex]);

  const addTrack = (type: "voiceover" | "music") => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name: type === "voiceover" ? `Locução ${tracks.filter(t => t.type === "voiceover").length + 1}` : `Trilha ${tracks.filter(t => t.type === "music").length + 1}`,
      type,
      audioUrl: "",
      volume: 100,
      color: type === "voiceover" ? "bg-blue-500/20 border-blue-500" : "bg-purple-500/20 border-purple-500",
      fadeIn: 0,
      fadeOut: 0,
      zoom: 1,
      duration: 0,
      trimStart: 0,
      trimEnd: 0,
      pan: 0,
      playbackRate: 1,
      effects: defaultEffects,
      showEffects: false,
      eq10Band: defaultEQ10Band,
      showEQ10Band: false,
      compressorEnabled: type === "voiceover",
      voiceProcessors: defaultVoiceProcessors,
      showVoiceProcessors: false,
      muted: false,
      solo: false,
    };
    setTracks([...tracks, newTrack], `Adicionou ${type === "voiceover" ? "locução" : "trilha"}`);
  };

  const removeTrack = (id: string) => {
    const trackName = tracks.find(t => t.id === id)?.name || "track";
    if (audioRefs.current[id]) {
      audioRefs.current[id].pause();
      delete audioRefs.current[id];
    }
    setTracks(tracks.filter(t => t.id !== id), `Removeu ${trackName}`);
  };

  const playPause = () => {
    if (isPlaying) {
      Object.values(audioRefs.current).forEach(audio => audio.pause());
      setIsPlaying(false);
    } else {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio.src) audio.play().catch(e => console.log("Play error:", e));
      });
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (trackId: string, [volume]: number[]) => {
    setTracks(tracks.map(t => 
      t.id === trackId ? { ...t, volume } : t
    ));
    if (audioRefs.current[trackId]) {
      audioRefs.current[trackId].volume = volume / 100;
    }
  };

  const handleSeek = (trackId: string, time: number) => {
    if (audioRefs.current[trackId]) {
      audioRefs.current[trackId].currentTime = time;
    }
    setCurrentTime(time);
  };

  const handlePanChange = (trackId: string, pan: number) => {
    setTracks(tracks.map(t => 
      t.id === trackId ? { ...t, pan } : t
    ));
  };

  const handlePlaybackRateChange = (trackId: string, rate: number) => {
    setTracks(tracks.map(t => 
      t.id === trackId ? { ...t, playbackRate: rate } : t
    ));
    if (audioRefs.current[trackId]) {
      audioRefs.current[trackId].playbackRate = rate;
    }
  };

  const handleTrim = (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
      setTrackToTrim(track);
      setTrimDialogOpen(true);
    }
  };

  const duplicateTrack = (id: string) => {
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    const newTrackId = Date.now().toString();
    const newTrack: Track = {
      ...track,
      id: newTrackId,
      name: `${track.name} (Cópia)`,
    };

    if (track.audioUrl) {
      const newAudio = new Audio(track.audioUrl);
      newAudio.addEventListener('loadedmetadata', () => {
        audioRefs.current[newTrackId] = newAudio;
      });
      newAudio.load();
    }

    setTracks([...tracks, newTrack], `Duplicou ${track.name}`);
  };

  const handleFileUpload = async (trackId: string, file: File) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    
    audio.addEventListener('loadedmetadata', () => {
      setTracks(tracks.map(t => 
        t.id === trackId ? { ...t, audioUrl: url, duration: audio.duration, trimEnd: audio.duration } : t
      ), `Carregou ${file.name}`);
      audioRefs.current[trackId] = audio;
    });
    
    audio.addEventListener('error', (e) => {
      console.error("Audio load error:", e);
      toast({
        title: "Erro ao carregar áudio",
        description: "Não foi possível carregar o arquivo de áudio",
        variant: "destructive",
      });
    });
    
    audio.load();
  };

  const handleDragOver = (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    if (trackId) {
      setDragOverTrackId(trackId);
    } else {
      setGlobalDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setGlobalDragOver(false);
    setDragOverTrackId(null);
  };

  const handleDrop = (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    setGlobalDragOver(false);
    setDragOverTrackId(null);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      if (trackId) {
        // Drop em track específica
        handleFileUpload(trackId, files[0]);
      } else {
        // Drop global - criar nova track
        const file = files[0];
        const trackType = file.name.toLowerCase().includes('music') || file.name.toLowerCase().includes('trilha') ? "music" : "voiceover";
        addTrack(trackType);
        
        // Adiciona à primeira track vazia do tipo correspondente
        setTimeout(() => {
          const emptyTrack = tracks.find(t => t.type === trackType && !t.audioUrl);
          if (emptyTrack) {
            handleFileUpload(emptyTrack.id, file);
          }
        }, 100);
      }
    }
  };

  const handleAudioGenerated = (audioUrl: string, name: string) => {
    // Encontra ou cria uma track de voiceover vazia
    let targetTrack = tracks.find(t => t.type === "voiceover" && !t.audioUrl);
    
    if (!targetTrack) {
      // Cria nova track se não encontrar vazia
      addTrack("voiceover");
      setTimeout(() => {
        const newTrack = tracks.find(t => t.type === "voiceover" && !t.audioUrl);
        if (newTrack) {
          handleFileUpload(newTrack.id, new File([], name, { type: "audio/wav" }));
          // Simula o upload com a URL gerada
          setTimeout(() => {
            setTracks(tracks.map(t => 
              t.id === newTrack.id ? { ...t, audioUrl, name } : t
            ), `Gerou voz: ${name}`);
            audioRefs.current[newTrack.id] = new Audio(audioUrl);
          }, 100);
        }
      }, 100);
    } else {
      // Usa track existente
      setTracks(tracks.map(t => 
        t.id === targetTrack.id ? { ...t, audioUrl, name } : t
      ), `Gerou voz: ${name}`);
      audioRefs.current[targetTrack.id] = new Audio(audioUrl);
    }
  };

  // Funções de mixagem (simplificadas)
  const mixAndDownload = async (format: "wav" | "mp3", bitrate?: 128 | 192 | 320) => {
    setIsMixing(true);
    try {
      toast({
        title: "Iniciando mixagem",
        description: `Formato: ${format.toUpperCase()}` + (bitrate ? ` ${bitrate}kbps` : ""),
      });

      // Simulação de mixagem
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cria um áudio de exemplo para download
      const audioContext = new AudioContext();
      const sampleRate = 44100;
      const duration = 5; // 5 segundos
      const buffer = audioContext.createBuffer(2, sampleRate * duration, sampleRate);
      
      // Gera um tom simples como exemplo
      for (let channel = 0; channel < 2; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.1; // 440Hz tom
        }
      }

      const wav = audioBufferToWav(buffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, '_')}_mix.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Mix concluído!",
        description: "Áudio baixado com sucesso",
      });

    } catch (error) {
      console.error("Mix error:", error);
      toast({
        title: "Erro na mixagem",
        description: "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsMixing(false);
    }
  };

  const saveProject = () => {
    setIsSaving(true);
    try {
      const project: ProjectData = {
        name: projectName,
        version: "1.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tracks: tracks.map(({ audioUrl, ...rest }) => rest),
        audioData: {},
      };

      const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, '_')}.vip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Projeto salvo",
        description: `${projectName}.vip`,
      });

    } catch (error) {
      toast({
        title: "Erro ao salvar",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const project: ProjectData = JSON.parse(evt.target?.result as string);
        setProjectName(project.name);
        // Implementar restauração do projeto aqui
        toast({
          title: "Projeto carregado",
          description: project.name,
        });
      } catch (error) {
        toast({
          title: "Arquivo inválido",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
  };

  // Inicialização
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-full mx-auto space-y-4">
        {/* Cabeçalho com Gerador de Voz */}
        <Card className="p-4 bg-card border-border">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">MiniDAW Integrada</h1>
              <p className="text-muted-foreground">Estúdio de áudio com Geração de Voz IA</p>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <Button 
                onClick={() => navigate("/busca-noticias")} 
                variant="outline" 
                className="gap-2 border-blue-500/50 hover:bg-blue-500/10"
              >
                <Search className="w-4 h-4 text-blue-400" />
                Busca Notícias RSS
              </Button>
              
              <Button 
                onClick={() => navigate("/newpost-manager")} 
                variant="outline" 
                className="gap-2 border-purple-500/50 hover:bg-purple-500/10"
              >
                <Newspaper className="w-4 h-4 text-purple-400" />
                NewPost-IA Manager
              </Button>
              
              <VoiceGenerator onAudioGenerated={handleAudioGenerated} />
              
              <Button onClick={() => addTrack("voiceover")} className="gap-2">
                <Mic className="w-4 h-4" />
                Adicionar Locução
              </Button>
              
              <Button onClick={() => addTrack("music")} variant="outline" className="gap-2">
                <Music className="w-4 h-4" />
                Adicionar Trilha
              </Button>
              
              <Button onClick={saveProject} variant="outline" className="gap-2">
                <Save className="w-4 h-4" />
                Salvar
              </Button>
              
              <Button 
                onClick={() => mixAndDownload("mp3", 320)}
                disabled={isMixing || tracks.length === 0}
                className="gap-2 bg-gradient-to-r from-green-600 to-green-500"
              >
                {isMixing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Exportar
              </Button>
            </div>
          </div>
        </Card>

        {/* Controles de Reprodução */}
        <Card className="p-4 bg-card border-border">
          <div className="flex items-center gap-4">
            <Button
              size="lg"
              onClick={playPause}
              className="w-12 h-12 rounded-full"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>
            
            <div className="flex-1">
              <div className="text-sm text-muted-foreground">
                Tempo: {currentTime.toFixed(1)}s
              </div>
            </div>
          </div>
        </Card>

        {/* Área de Tracks */}
        <div
          className={`space-y-4 transition-all ${globalDragOver ? "ring-2 ring-primary ring-dashed rounded-lg p-2 bg-primary/5" : ""}`}
          onDragOver={(e) => handleDragOver(e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e)}
        >
          {tracks.length === 0 ? (
            <Card className="p-12 bg-card border-border border-dashed text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Comece seu projeto</h3>
              <p className="text-muted-foreground mb-4">
                Adicione locuções, trilhas ou gere voz com IA
              </p>
              <div className="flex items-center justify-center gap-3">
                <VoiceGenerator onAudioGenerated={handleAudioGenerated} />
                <Button onClick={() => addTrack("voiceover")}>
                  <Mic className="w-4 h-4 mr-2" />
                  Adicionar Locução
                </Button>
                <Button onClick={() => addTrack("music")} variant="outline">
                  <Music className="w-4 h-4 mr-2" />
                  Adicionar Trilha
                </Button>
              </div>
            </Card>
          ) : (
            tracks.map((track) => (
              <Card key={track.id} className={`p-4 border-2 ${track.color}`}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-8 rounded ${track.type === "voiceover" ? "bg-blue-500" : "bg-purple-500"}`} />
                      <Input
                        value={track.name}
                        onChange={(e) => setTracks(tracks.map(t => 
                          t.id === track.id ? { ...t, name: e.target.value } : t
                        ))}
                        className="max-w-xs"
                      />
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        {track.type === "voiceover" ? "Locução" : "Trilha"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeTrack(track.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {!track.audioUrl ? (
                    <div 
                      className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-lg ${
                        dragOverTrackId === track.id ? "border-primary bg-primary/5" : "border-muted"
                      }`}
                      onDragOver={(e) => handleDragOver(e, track.id)}
                      onDrop={(e) => handleDrop(e, track.id)}
                    >
                      <Upload className="w-8 h-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Arraste um arquivo de áudio aqui</p>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(track.id, file);
                        }}
                        className="text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Áudio carregado - Duração: {track.duration.toFixed(1)}s
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Volume:</span>
                        <Slider
                          value={[track.volume]}
                          onValueChange={(value) => handleVolumeChange(track.id, value)}
                          max={100}
                          step={1}
                          className="w-32"
                        />
                        <span className="text-sm text-muted-foreground w-10">
                          {track.volume}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MiniDAWIntegrated;
