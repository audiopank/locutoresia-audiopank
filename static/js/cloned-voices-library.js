import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Play, Pause, Trash2, Mic, Download, Upload, Clock, User, Send, Loader2 } from "lucide-react";
import { useLMNT } from "@/hooks/useLMNT";
import { useToast } from "@/hooks/use-toast";

const CLONED_VOICES_KEY = "cloned_voices_library";

export interface ClonedVoiceEntry {
  id: string;
  name: string;
  description?: string;
  gender?: string;
  createdAt: string;
  lmntVoiceId?: string;
}

const ClonedVoicesLibrary = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [voices, setVoices] = useState<ClonedVoiceEntry[]>([]);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [sendingToDAW, setSendingToDAW] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { isLoading, synthesizeSpeech } = useLMNT();
  const { toast } = useToast();

  useEffect(() => {
    loadVoices();
  }, []);

  const loadVoices = () => {
    try {
      const stored = localStorage.getItem(CLONED_VOICES_KEY);
      if (stored) {
        setVoices(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Error loading cloned voices:", e);
    }
  };

  const deleteVoice = (voiceId: string, voiceName: string) => {
    const updated = voices.filter(v => v.id !== voiceId);
    setVoices(updated);
    localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(updated));
    toast({ title: "Voz removida", description: voiceName });
  };

  const filteredVoices = voices.filter(v =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePlayPreview = async (voice: ClonedVoiceEntry) => {
    const voiceId = voice.lmntVoiceId || voice.id;
    if (playingVoice === voiceId) {
      if (audioElement) { audioElement.pause(); audioElement.currentTime = 0; }
      setPlayingVoice(null);
      return;
    }
    try {
      setPlayingVoice(voiceId);
      if (audioElement) audioElement.pause();
      const result = await synthesizeSpeech("Olá, esta é uma prévia da minha voz clonada.", voiceId, 'pt');
      const audio = new Audio(result.audioUrl);
      setAudioElement(audio);
      audio.onended = () => setPlayingVoice(null);
      audio.onerror = () => { setPlayingVoice(null); toast({ title: "Erro ao reproduzir", variant: "destructive" }); };
      await audio.play();
    } catch { setPlayingVoice(null); }
  };

  const handleUseVoice = (voice: ClonedVoiceEntry) => {
    navigate('/', {
      state: { selectedVoiceId: voice.lmntVoiceId || voice.id, selectedVoiceName: voice.name }
    });
    toast({ title: "Voz selecionada", description: `${voice.name} para Text to Speech` });
  };

  const handleSendToDAW = async (voice: ClonedVoiceEntry) => {
    const voiceId = voice.lmntVoiceId || voice.id;
    setSendingToDAW(voiceId);
    try {
      const result = await synthesizeSpeech(
        "Olá, esta é uma demonstração da minha voz clonada. Você pode editar este áudio no MiniDAW.",
        voiceId, 'pt'
      );
      const response = await fetch(result.audioUrl);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      navigate('/minidaw', {
        state: { audioBase64: base64, name: `Voz Clonada - ${voice.name}`, type: 'voiceover' }
      });
    } catch {
      toast({ title: "Erro ao enviar para MiniDAW", description: "Tente novamente", variant: "destructive" });
    } finally {
      setSendingToDAW(null);
    }
  };

  // --- Export / Import ---
  const handleExportAll = () => {
    if (voices.length === 0) {
      toast({ title: "Nada para exportar", description: "Adicione vozes clonadas primeiro", variant: "destructive" });
      return;
    }
    const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), voices }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vozes-clonadas-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Exportação concluída", description: `${voices.length} voz(es) exportada(s)` });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        const imported: ClonedVoiceEntry[] = parsed.voices || parsed;
        if (!Array.isArray(imported) || imported.length === 0) {
          toast({ title: "Arquivo inválido", description: "Nenhuma voz encontrada no arquivo", variant: "destructive" });
          return;
        }
        // Merge: skip duplicates by id
        const existingIds = new Set(voices.map(v => v.id));
        const newVoices = imported.filter(v => v.name && !existingIds.has(v.id));
        if (newVoices.length === 0) {
          toast({ title: "Nenhuma voz nova", description: "Todas as vozes já existem na biblioteca" });
          return;
        }
        const merged = [...newVoices, ...voices];
        setVoices(merged);
        localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(merged));
        toast({ title: "Importação concluída", description: `${newVoices.length} voz(es) importada(s)` });
      } catch {
        toast({ title: "Erro ao importar", description: "Arquivo JSON inválido", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    // Reset input
    if (importInputRef.current) importInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Vozes Clonadas</h1>
            <p className="text-muted-foreground">Gerencie suas vozes clonadas personalizadas</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <Button variant="outline" size="sm" className="gap-2" onClick={() => importInputRef.current?.click()}>
              <Upload className="w-4 h-4" /> Importar
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportAll} disabled={voices.length === 0}>
              <Download className="w-4 h-4" /> Exportar
            </Button>
            <Button onClick={() => navigate('/voice-cloning')} className="gap-2" size="sm">
              <Mic className="w-4 h-4" /> Clonar Nova Voz
            </Button>
          </div>
        </div>

        {voices.length > 0 && (
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar vozes clonadas..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 bg-input border-border" />
            </div>
          </div>
        )}

        {filteredVoices.length === 0 ? (
          <Card className="p-12 bg-card border-border">
            <div className="text-center">
              <Mic className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {voices.length === 0 ? "Nenhuma voz clonada ainda" : "Nenhum resultado encontrado"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {voices.length === 0 ? "Clone sua primeira voz ou importe de outro dispositivo" : "Tente uma busca diferente"}
              </p>
              <div className="flex items-center justify-center gap-3">
                {voices.length === 0 && (
                  <>
                    <Button onClick={() => navigate('/voice-cloning')} className="gap-2">
                      <Mic className="w-4 h-4" /> Clonar Primeira Voz
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => importInputRef.current?.click()}>
                      <Upload className="w-4 h-4" /> Importar Arquivo
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVoices.map((voice) => (
              <Card key={voice.id} className="p-5 bg-card border-border hover:border-primary/50 transition-colors">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{voice.name}</h3>
                    {voice.description && <p className="text-sm text-muted-foreground truncate">{voice.description}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {voice.gender && (
                        <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-foreground capitalize">{voice.gender}</span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(voice.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => handlePlayPreview(voice)} disabled={isLoading && playingVoice === (voice.lmntVoiceId || voice.id)}>
                    {playingVoice === (voice.lmntVoiceId || voice.id) ? <><Pause className="w-3 h-3" /> Pausar</> : <><Play className="w-3 h-3" /> Preview</>}
                  </Button>
                  <Button size="sm" className="flex-1 gap-1" onClick={() => handleUseVoice(voice)}>
                    <Mic className="w-3 h-3" /> Usar
                  </Button>
                  <Button variant="secondary" size="sm" className="flex-1 gap-1" onClick={() => handleSendToDAW(voice)} disabled={sendingToDAW === (voice.lmntVoiceId || voice.id)}>
                    {sendingToDAW === (voice.lmntVoiceId || voice.id) ? <><Loader2 className="w-3 h-3 animate-spin" /> Enviando...</> : <><Send className="w-3 h-3" /> MiniDAW</>}
                  </Button>
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => deleteVoice(voice.id, voice.name)}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClonedVoicesLibrary;