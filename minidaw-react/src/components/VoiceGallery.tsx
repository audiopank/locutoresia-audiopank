import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Volume2, Play, Pause, Loader2, Search, Mic, Plus } from "lucide-react";
import { useLMNT } from "@/hooks/useLMNT";
import { useToast } from "@/hooks/useToast";

const CLONED_VOICES_KEY = "cloned_voices_library";
const PREVIEW_TEXT = "Olá! Esta é uma amostra da minha voz para o seu projeto.";

interface GalleryVoice {
  key: string;
  id: string;          // id usado na geração (ou lmntVoiceId p/ clonadas)
  name: string;
  description?: string;
  provider: string;    // gemini | elevenlabs | clonada | ...
  kind: "api" | "cloned";
}

// Rótulos amigáveis por provider
const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Google",
  google: "Google",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
  lmnt: "LMNT",
  clonada: "Clonadas",
};

const providerLabel = (p: string) => PROVIDER_LABEL[p] || p.charAt(0).toUpperCase() + p.slice(1);

interface VoiceGalleryProps {
  // Abre o Gerador de Voz já com este locutor selecionado (chave: cloned::id | api::provider::id)
  onUseVoice?: (voiceKey: string) => void;
}

export const VoiceGallery = ({ onUseVoice }: VoiceGalleryProps) => {
  const navigate = useNavigate();
  const { synthesizeSpeech, synthesizeClonedVoice } = useLMNT();
  const { toast } = useToast();

  const [voices, setVoices] = useState<GalleryVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("todas");
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewCache = useRef<Record<string, string>>({});

  useEffect(() => {
    loadVoices();
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const loadVoices = async () => {
    setLoading(true);
    const list: GalleryVoice[] = [];

    // Vozes clonadas (localStorage)
    try {
      const stored = localStorage.getItem(CLONED_VOICES_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      for (const v of parsed) {
        list.push({
          key: `cloned::${v.id}`,
          id: v.lmntVoiceId || v.id,
          name: v.name,
          description: v.description,
          provider: "clonada",
          kind: "cloned",
        });
      }
    } catch (e) {
      console.error("Erro ao carregar vozes clonadas:", e);
    }

    // Locutores do backend
    try {
      const res = await fetch("/api/voices");
      if (res.ok) {
        const data = await res.json();
        for (const v of data.voices || []) {
          list.push({
            key: `api::${v.provider}::${v.id}`,
            id: v.id,
            name: v.name,
            description: v.gender ? `${providerLabel(v.provider)} · ${v.gender}` : providerLabel(v.provider),
            provider: v.provider,
            kind: "api",
          });
        }
      }
    } catch (e) {
      console.error("Erro ao carregar locutores:", e);
    }

    setVoices(list);
    setLoading(false);
  };

  // Providers presentes (para montar as abas dinamicamente)
  const providers = useMemo(() => {
    const set = new Set(voices.map((v) => v.provider));
    return Array.from(set);
  }, [voices]);

  const filtered = useMemo(() => {
    return voices.filter((v) => {
      const matchProvider = providerFilter === "todas" || v.provider === providerFilter;
      const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase());
      return matchProvider && matchSearch;
    });
  }, [voices, providerFilter, search]);

  const handlePreview = async (voice: GalleryVoice) => {
    // Se já está tocando esta voz, pausa
    if (playingKey === voice.key && audioRef.current) {
      audioRef.current.pause();
      setPlayingKey(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();

    try {
      let url = previewCache.current[voice.key];
      if (!url) {
        setPreviewingKey(voice.key);
        const result =
          voice.kind === "cloned"
            ? await synthesizeClonedVoice(PREVIEW_TEXT, voice.id)
            : await synthesizeSpeech(PREVIEW_TEXT, voice.id, "pt", voice.provider);
        url = result.audioUrl;
        previewCache.current[voice.key] = url;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingKey(null);
      audio.onerror = () => {
        setPlayingKey(null);
        toast({ title: "Erro ao reproduzir preview", variant: "destructive" });
      };
      await audio.play();
      setPlayingKey(voice.key);
    } catch {
      // erro já tratado/toast no hook
    } finally {
      setPreviewingKey(null);
    }
  };

  const handleUse = (voice: GalleryVoice) => {
    // Abre o Gerador de Voz com este locutor pré-selecionado (o produtor digita/cola o roteiro lá)
    if (onUseVoice) onUseVoice(voice.key);
  };

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <div className="p-5 space-y-4">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-purple-400" />
            <div>
              <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Galeria de Vozes Profissionais
              </h3>
              <p className="text-xs text-white/60">Ouça exemplos, clone vozes e gere áudio direto para os tracks</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => navigate("/voice-cloning")} variant="outline" size="sm" className="gap-2 border-white/20 hover:bg-white/10">
              <Mic className="w-4 h-4" />
              Clonar Voz
            </Button>
            <Badge variant="secondary" className="bg-purple-500/20 text-purple-200">{voices.length} vozes</Badge>
          </div>
        </div>

        {/* Filtros por provider */}
        <div className="flex items-center gap-2 flex-wrap">
          {["todas", ...providers].map((p) => (
            <button
              key={p}
              onClick={() => setProviderFilter(p)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                providerFilter === p
                  ? "bg-white text-slate-900 font-medium"
                  : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {p === "todas" ? "Todas" : providerLabel(p)}
            </button>
          ))}
        </div>

        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <Input
            placeholder="Buscar vozes por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white/10 border-white/20 text-white placeholder-white/40"
          />
        </div>

        {/* Grid de vozes */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-white/60 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Carregando vozes...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-white/50">Nenhuma voz encontrada.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[28rem] overflow-y-auto pr-1">
            {filtered.map((voice) => (
              <Card key={voice.key} className="bg-white/5 border-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-white">{voice.name}</div>
                    {voice.description && <div className="text-xs text-white/60">{voice.description}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px] border-white/20 text-white/70 whitespace-nowrap">
                    {providerLabel(voice.provider)}
                  </Badge>
                </div>

                <Button
                  onClick={() => handlePreview(voice)}
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-white/20 hover:bg-white/10"
                  disabled={previewingKey === voice.key}
                >
                  {previewingKey === voice.key ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
                  ) : playingKey === voice.key ? (
                    <><Pause className="w-4 h-4" /> Pausar</>
                  ) : (
                    <><Play className="w-4 h-4" /> Ouvir Preview</>
                  )}
                </Button>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-white/40">ID: {voice.id}</span>
                  {onUseVoice && (
                    <Button onClick={() => handleUse(voice)} size="sm" variant="ghost" className="h-7 gap-1 text-purple-300 hover:text-purple-200 hover:bg-purple-500/10">
                      <Plus className="w-3.5 h-3.5" /> Usar
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default VoiceGallery;
