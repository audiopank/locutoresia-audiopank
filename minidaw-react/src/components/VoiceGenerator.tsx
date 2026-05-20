import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, Wand2, Play, Pause, Loader2, Plus, History, User, Volume2 } from "lucide-react";
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

interface GenerationHistory {
  id: string;
  text: string;
  voiceName: string;
  voiceId: string;
  audioUrl: string;
  createdAt: string;
}

export const VoiceGenerator = ({ onAudioGenerated }: { onAudioGenerated: (audioUrl: string, name: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [voices, setVoices] = useState<ClonedVoiceEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { toast } = useToast();
  const { synthesizeSpeech, isLoading } = useLMNT();

  useEffect(() => {
    loadVoices();
    loadHistory();
  }, []);

  const loadVoices = () => {
    try {
      const stored = localStorage.getItem(CLONED_VOICES_KEY);
      if (stored) {
        setVoices(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Error loading voices:", e);
    }
  };

  const loadHistory = () => {
    try {
      const stored = localStorage.getItem(GENERATION_HISTORY_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Error loading history:", e);
    }
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

    if (!selectedVoiceId) {
      toast({
        title: "Voz obrigatória",
        description: "Selecione uma voz clonada",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);

    // Simulação de progresso
    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      const result = await synthesizeSpeech(text, selectedVoiceId, 'pt');
      
      clearInterval(progressInterval);
      setGenerationProgress(100);
      
      setAudioUrl(result.audioUrl);
      
      // Salva no histórico
      const newHistory: GenerationHistory = {
        id: Date.now().toString(),
        text,
        voiceName: voices.find(v => v.id === selectedVoiceId)?.name || "Voz Desconhecida",
        voiceId: selectedVoiceId,
        audioUrl: result.audioUrl,
        createdAt: new Date().toISOString(),
      };
      
      const updatedHistory = [newHistory, ...history].slice(0, 20); // Mantém 20 mais recentes
      setHistory(updatedHistory);
      localStorage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(updatedHistory));
      
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
      const voiceName = voices.find(v => v.id === selectedVoiceId)?.name || "Voz AI";
      onAudioGenerated(audioUrl, `${voiceName} - ${text.substring(0, 30)}${text.length > 30 ? "..." : ""}`);
      setIsOpen(false);
      setText("");
      setAudioUrl(null);
      toast({
        title: "Áudio adicionado à track",
        description: "O áudio gerado foi adicionado como nova locução",
      });
    }
  };

  const handleUseHistory = (item: GenerationHistory) => {
    setText(item.text);
    setSelectedVoiceId(item.voiceId);
    setAudioUrl(item.audioUrl);
  };

  const selectedVoice = voices.find(v => v.id === selectedVoiceId);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
      >
        <Wand2 className="w-4 h-4" />
        Gerar Voz AI
      </Button>
    );
  }

  return (
    <Card className="p-6 bg-card border-border max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Mic className="w-6 h-6 text-purple-500" />
          Gerador de Voz IA
        </h2>
        <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
          Fechar
        </Button>
      </div>

      <div className="space-y-4">
        {/* Seleção de Voz */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">
            Voz Clonada
          </label>
          <Select value={selectedVoiceId} onValueChange={setSelectedVoiceId} disabled={isGenerating}>
            <SelectTrigger className="bg-input border-border">
              <SelectValue placeholder="Selecione uma voz clonada" />
            </SelectTrigger>
            <SelectContent>
              {voices.length === 0 ? (
                <SelectItem disabled value="">
                  Nenhuma voz clonada encontrada
                </SelectItem>
              ) : (
                voices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <div>
                        <div className="font-medium">{voice.name}</div>
                        {voice.description && (
                          <div className="text-xs text-muted-foreground">{voice.description}</div>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          
          {voices.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Clone vozes primeiro para poder gerar áudio
            </p>
          )}
        </div>

        {/* Texto para Gerar */}
        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">
            Texto para Gerar
          </label>
          <Textarea
            placeholder="Digite o texto que será falado pela voz IA..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-input border-border resize-none"
            rows={4}
            disabled={isGenerating}
            maxLength={500}
          />
          <div className="text-xs text-muted-foreground mt-1">
            {text.length}/500 caracteres
          </div>
        </div>

        {/* Botão de Gerar */}
        <Button
          onClick={handleGenerate}
          disabled={!text.trim() || !selectedVoiceId || isGenerating || isLoading}
          className="w-full gap-2"
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
            <div className="flex items-center justify-between text-sm">
              <span>Gerando áudio...</span>
              <span>{generationProgress}%</span>
            </div>
            <Progress value={generationProgress} className="h-2" />
          </div>
        )}

        {/* Preview do Áudio Gerado */}
        {audioUrl && (
          <div className="border-2 border-green-500/50 rounded-lg p-4 bg-green-500/5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-green-700 flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                Áudio Gerado
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePlayPreview}
                  className="gap-1"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3 h-3" />
                      Pausar
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      Ouvir
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleAddToTrack}
                  size="sm"
                  className="gap-1 bg-green-600 hover:bg-green-700"
                >
                  <Plus className="w-3 h-3" />
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
            />
            
            <div className="text-sm text-muted-foreground">
              <p><strong>Voz:</strong> {selectedVoice?.name}</p>
              <p><strong>Texto:</strong> {text}</p>
            </div>
          </div>
        )}

        {/* Histórico de Gerações */}
        {history.length > 0 && (
          <div>
            <h3 className="font-medium text-foreground mb-3 flex items-center gap-2">
              <History className="w-4 h-4" />
              Gerações Recentes
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {history.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="p-2 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleUseHistory(item)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.voiceName}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.text}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-1">
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
