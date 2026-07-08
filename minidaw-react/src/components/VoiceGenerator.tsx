import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, Wand2, Play, Pause, Loader2, Plus, History, User, Volume2, X } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { useLMNT } from "@/hooks/useLMNT";
import { Progress } from "@/components/ui/progress";

const CLONED_VOICES_KEY = "cloned_voices_library";
const GENERATION_HISTORY_KEY = "voice_generation_history";

interface ClonedVoiceEntry {
  id: string;
  name: string;
  description?: string;
  gender?: string;
  createdAt: string;
  lmntVoiceId?: string;
}

// Locutor padrão vindo do backend /api/voices (Gemini / ElevenLabs)
interface ApiVoice {
  id: string;
  name: string;
  provider: string;
  gender?: string;
  language?: string;
}

// Chaves compostas para o Select distinguir voz clonada x locutor padrão
const clonedKey = (id: string) => `cloned::${id}`;
const apiKey = (provider: string, id: string) => `api::${provider}::${id}`;

interface GenerationHistory {
  id: string;
  text: string;
  voiceName: string;
  voiceId: string;
  audioUrl: string;
  createdAt: string;
}

interface VoiceGeneratorProps {
  open: boolean;
  onClose: () => void;
  onAudioGenerated: (audioUrl: string, name: string) => void;
  initialText?: string;
  initialVoiceKey?: string;
}

export const VoiceGenerator = ({ open, onClose, onAudioGenerated, initialText, initialVoiceKey }: VoiceGeneratorProps) => {
  const [text, setText] = useState(initialText || "");
  const [selectedKey, setSelectedKey] = useState("");
  const [clonedVoices, setClonedVoices] = useState<ClonedVoiceEntry[]>([]);
  const [apiVoices, setApiVoices] = useState<ApiVoice[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { synthesizeSpeech, synthesizeClonedVoice, isLoading } = useLMNT();

  // Carrega vozes (clonadas + locutores do backend) e define a seleção inicial
  // numa única passagem, sem corrida: se o usuário veio da Galeria com um
  // locutor explícito (initialVoiceKey), essa escolha sempre vence — antes,
  // vozes clonadas (carregamento síncrono) sempre "ganhavam" dos locutores de
  // API (carregamento assíncrono) por pura ordem de chegada.
  useEffect(() => {
    if (!open) return;

    let cloned: ClonedVoiceEntry[] = [];
    try {
      const stored = localStorage.getItem(CLONED_VOICES_KEY);
      cloned = stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Error loading cloned voices:", e);
    }
    setClonedVoices(cloned);

    if (initialText !== undefined) setText(initialText);

    if (initialVoiceKey) {
      setSelectedKey(initialVoiceKey);
    } else if (cloned.length > 0) {
      setSelectedKey(clonedKey(cloned[0].id));
    }

    (async () => {
      try {
        const res = await fetch("/api/voices");
        if (!res.ok) return;
        const data = await res.json();
        const list: ApiVoice[] = data.voices || [];
        setApiVoices(list);
        // Só usa o primeiro locutor de API como default se nada mais já foi selecionado.
        if (!initialVoiceKey && cloned.length === 0 && list.length > 0) {
          setSelectedKey(apiKey(list[0].provider, list[0].id));
        }
      } catch (e) {
        console.error("Error loading locutores:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText, initialVoiceKey]);

  // Ao concluir a geração, rola até o player para o produtor ver/ouvir
  useEffect(() => {
    if (audioUrl && previewRef.current) {
      previewRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [audioUrl]);

  // Trava o scroll do body enquanto o modal está aberto (evita "vazamento" da página atrás)
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Resolve a chave selecionada para os dados necessários à geração
  const resolveSelected = () => {
    if (selectedKey.startsWith("cloned::")) {
      const id = selectedKey.slice("cloned::".length);
      const entry = clonedVoices.find((v) => v.id === id);
      if (!entry) return null;
      return {
        kind: "cloned" as const,
        generationId: entry.lmntVoiceId || entry.id,
        name: entry.name,
      };
    }
    if (selectedKey.startsWith("api::")) {
      const rest = selectedKey.slice("api::".length);
      const sep = rest.indexOf("::");
      const provider = rest.slice(0, sep);
      const id = rest.slice(sep + 2);
      const entry = apiVoices.find((v) => v.id === id && v.provider === provider);
      if (!entry) return null;
      return {
        kind: "api" as const,
        generationId: entry.id,
        provider: entry.provider,
        name: entry.name,
      };
    }
    return null;
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      toast({
        title: "Texto obrigatório",
        description: "Digite o texto para gerar a voz",
        variant: "destructive",
      });
      return;
    }

    const selected = resolveSelected();
    if (!selected) {
      toast({
        title: "Voz obrigatória",
        description: "Selecione um locutor ou voz clonada",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);

    // Progresso com ease-out até ~95% (a geração com IA pode levar ~20s; não pode parecer travado)
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        if (prev >= 95) return 95;
        return Math.min(95, prev + Math.max(1, Math.round((95 - prev) * 0.06)));
      });
    }, 400);

    try {
      // Vozes clonadas → LMNT; locutores padrão → /api/generate-audio com provider
      const result =
        selected.kind === "cloned"
          ? await synthesizeClonedVoice(text, selected.generationId)
          : await synthesizeSpeech(text, selected.generationId, 'pt', selected.provider);

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setAudioUrl(result.audioUrl);
      
      toast({
        title: "Voz gerada com sucesso!",
        description: "O áudio foi gerado e está pronto para uso",
      });
      
    } catch (error) {
      console.error("Error generating voice:", error);
      toast({
        title: "Erro ao gerar voz",
        description: "Tente novamente",
        variant: "destructive",
      });
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
      setGenerationProgress(0);
    }
  };

  const handlePlayPreview = () => {
    if (!audioUrl) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (audioRef.current) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleAddToTrack = () => {
    if (audioUrl) {
      const voiceName = resolveSelected()?.name || "Voz AI";
      onAudioGenerated(audioUrl, `${voiceName} - ${text.substring(0, 30)}${text.length > 30 ? "..." : ""}`);
      onClose();
      setText("");
      setAudioUrl(null);
      toast({
        title: "Áudio adicionado à track",
        description: "O áudio gerado foi adicionado como nova locução",
      });
    }
  };

  const selectedInfo = resolveSelected();

  if (!open) return null;

  // Renderizado via Portal no document.body para escapar de ancestrais com
  // backdrop-filter/transform (que prendem elementos `position: fixed` e faziam
  // o modal sobrepor as tracks em vez de cobrir a tela).
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-full max-w-2xl my-auto bg-slate-900 border border-white/10 shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Mic className="w-6 h-6 text-purple-400" />
              Gerador de Voz IA
            </h2>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-white/60 hover:text-white hover:bg-white/10">
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="space-y-5">
            {/* Seleção de Voz */}
            <div>
              <label className="text-sm font-medium text-white/80 mb-2 block">
                Locutor / Voz
              </label>
              <Select value={selectedKey} onValueChange={setSelectedKey} disabled={isGenerating}>
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Selecione um locutor ou voz clonada" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-white max-h-72">
                  {clonedVoices.length === 0 && apiVoices.length === 0 ? (
                    <SelectItem disabled value="none" className="text-white/40">
                      Nenhuma voz disponível
                    </SelectItem>
                  ) : (
                    <>
                      {clonedVoices.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-purple-300">Vozes Clonadas</SelectLabel>
                          {clonedVoices.map((voice) => (
                            <SelectItem
                              key={clonedKey(voice.id)}
                              value={clonedKey(voice.id)}
                              className="text-white hover:bg-white/10 focus:bg-white/10"
                            >
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-purple-400" />
                                <div>
                                  <div className="font-medium">{voice.name}</div>
                                  {voice.description && (
                                    <div className="text-xs text-white/60">{voice.description}</div>
                                  )}
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {apiVoices.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-purple-300">Locutores Disponíveis</SelectLabel>
                          {apiVoices.map((voice) => (
                            <SelectItem
                              key={apiKey(voice.provider, voice.id)}
                              value={apiKey(voice.provider, voice.id)}
                              className="text-white hover:bg-white/10 focus:bg-white/10"
                            >
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-white/50" />
                                <div>
                                  <div className="font-medium">{voice.name}</div>
                                  <div className="text-xs text-white/60 capitalize">{voice.provider}</div>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </>
                  )}
                </SelectContent>
              </Select>

              {clonedVoices.length === 0 && (
                <p className="text-xs text-white/60 mt-2">
                  Sem vozes clonadas — usando locutores padrão. Clone vozes na página de clonagem para vê-las aqui.
                </p>
              )}
            </div>

            {/* Texto para Gerar */}
            <div>
              <label className="text-sm font-medium text-white/80 mb-2 block">
                Texto para Gerar
              </label>
              <Textarea
                placeholder="Digite o texto que será falado pela voz IA..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder-white/40 resize-y"
                rows={4}
                disabled={isGenerating}
                maxLength={1500}
              />
              <div className="text-xs text-white/60 mt-1 text-right">
                {text.length}/1500 caracteres
              </div>
            </div>

            {/* Botão de Gerar */}
            <Button
              onClick={handleGenerate}
              disabled={!text.trim() || !selectedKey || isGenerating || isLoading}
              className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gerando Voz...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Gerar Voz
                </>
              )}
            </Button>

            {/* Progresso */}
            {isGenerating && generationProgress > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-white/80">
                  <span>Gerando áudio com IA...</span>
                  <span>{generationProgress}%</span>
                </div>
                <Progress value={generationProgress} className="h-2 bg-white/10" />
                <p className="text-xs text-white/50">Textos longos podem levar até ~20 segundos. Aguarde…</p>
              </div>
            )}

            {/* Preview do Áudio Gerado */}
            {audioUrl && (
              <div ref={previewRef} className="border-2 border-green-500/50 rounded-lg p-5 bg-green-500/10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-green-400 flex items-center gap-2">
                    <Volume2 className="w-5 h-5" />
                    Áudio Gerado
                  </h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePlayPreview}
                      className="gap-1 border-white/20 hover:bg-white/10 text-white"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4" />
                          Pausar
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          Ouvir
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleAddToTrack}
                      size="sm"
                      className="gap-1 bg-green-600 hover:bg-green-700"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar à Track
                    </Button>
                  </div>
                </div>
                
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => {
                    toast({
                      title: "Erro ao reproduzir áudio",
                      variant: "destructive",
                    });
                    setIsPlaying(false);
                  }}
                  className="w-full"
                />
                
                {selectedInfo && (
                  <div className="text-sm text-white/70 mt-3">
                    <p><strong>Voz:</strong> {selectedInfo.name}</p>
                    <p className="mt-1"><strong>Texto:</strong> {text}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>,
    document.body
  );
};
