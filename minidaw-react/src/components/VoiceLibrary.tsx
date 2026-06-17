import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Play, Star, MoreVertical, Loader2, Pause, Download, Mic, Globe, UserCircle, Filter } from "lucide-react";
import { useLMNT, LMNTVoice } from "@/hooks/useLMNT";
import { useToast } from "@/hooks/useToast";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const FAVORITES_KEY = "voice_library_favorites";

interface VoiceLibraryProps {
  onSelectVoice?: (voice: LMNTVoice) => void;
  standalone?: boolean;
}

const VoiceLibrary = ({ onSelectVoice, standalone = true }: VoiceLibraryProps) => {
  const navigate = useNavigate();
  const { fetchVoices, voices, isLoading, synthesizeSpeech } = useLMNT();
  const { toast } = useToast();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [generatingPreview, setGeneratingPreview] = useState<string | null>(null);
  
  // Filters
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    fetchVoices();
    const storedFavorites = localStorage.getItem(FAVORITES_KEY);
    if (storedFavorites) {
      try {
        setFavorites(new Set(JSON.parse(storedFavorites)));
      } catch (e) {
        console.error("Error loading favorites", e);
      }
    }
    
    return () => {
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, []);

  const toggleFavorite = (voiceId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(voiceId)) {
        next.delete(voiceId);
      } else {
        next.add(voiceId);
      }
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handlePlayPreview = async (voice: LMNTVoice) => {
    if (playingVoiceId === voice.id) {
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      setPlayingVoiceId(null);
      return;
    }

    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    setGeneratingPreview(voice.id);
    
    try {
      const audioUrl = await synthesizeSpeech(
        "Olá! Esta é uma prévia da minha voz. Espero que seja exatamente o que você procura para o seu projeto.",
        voice.id
      );
      
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setPlayingVoiceId(null);
      };
      
      audio.onerror = () => {
        toast({
          title: "Erro ao reproduzir preview",
          description: "Não foi possível carregar o áudio.",
          variant: "destructive"
        });
        setPlayingVoiceId(null);
      };

      setAudioElement(audio);
      setPlayingVoiceId(voice.id);
      await audio.play();
      
    } catch (error) {
      toast({
        title: "Erro na geração",
        description: "Falha ao gerar o preview da voz.",
        variant: "destructive"
      });
    } finally {
      setGeneratingPreview(null);
    }
  };

  const handleSelectVoice = (voice: LMNTVoice) => {
    if (onSelectVoice) {
      onSelectVoice(voice);
    } else {
      localStorage.setItem('selectedVoiceId', voice.id);
      localStorage.setItem('selectedVoiceName', voice.name);
      
      toast({
        title: "Voz selecionada",
        description: `${voice.name} está pronta para uso.`
      });
      
      navigate("/");
    }
  };

  const filteredVoices = voices.filter(voice => {
    const matchesSearch = voice.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGender = genderFilter === "all" || voice.gender === genderFilter;
    const matchesLanguage = languageFilter === "all" || 
      (languageFilter === "pt" && voice.language === "pt") ||
      (languageFilter === "en" && voice.language === "en") ||
      (languageFilter === "other" && voice.language !== "pt" && voice.language !== "en");
    
    // Simplification for type filter since the real LMNT API might have different properties
    const matchesType = typeFilter === "all" || 
      (typeFilter === "cloned" && voice.id.startsWith("clone_")) ||
      (typeFilter === "favorite" && favorites.has(voice.id));

    return matchesSearch && matchesGender && matchesLanguage && matchesType;
  });

  return (
    <div className={`w-full ${standalone ? 'min-h-screen bg-slate-950 text-slate-50' : ''}`}>
      {standalone && (
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Biblioteca de Vozes
              </h1>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="border-slate-700 bg-slate-800 text-slate-200" onClick={() => navigate("/voice-cloning")}>
                <Mic className="w-4 h-4 mr-2" />
                Clonar Nova Voz
              </Button>
              <Button onClick={() => navigate("/")} className="bg-indigo-600 hover:bg-indigo-700">
                Studio
              </Button>
            </div>
          </div>
        </header>
      )}

      <div className={`${standalone ? 'container mx-auto px-4 py-8' : ''}`}>
        {/* Filters and Search Area */}
        <Card className="bg-slate-900/80 border-slate-800 p-4 mb-8">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Buscar vozes por nome..." 
                className="pl-9 bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px] bg-slate-950 border-slate-800 text-slate-100">
                  <Filter className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="favorite">Favoritas</SelectItem>
                  <SelectItem value="cloned">Minhas Vozes</SelectItem>
                </SelectContent>
              </Select>

              <Select value={genderFilter} onValueChange={setGenderFilter}>
                <SelectTrigger className="w-[140px] bg-slate-950 border-slate-800 text-slate-100">
                  <UserCircle className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Gênero" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="male">Masculino</SelectItem>
                  <SelectItem value="female">Feminino</SelectItem>
                </SelectContent>
              </Select>

              <Select value={languageFilter} onValueChange={setLanguageFilter}>
                <SelectTrigger className="w-[140px] bg-slate-950 border-slate-800 text-slate-100">
                  <Globe className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="Idioma" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="en">Inglês</SelectItem>
                  <SelectItem value="other">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Voices Grid */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
            <p>Carregando biblioteca de vozes...</p>
          </div>
        ) : filteredVoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-16 h-16 bg-slate-900 rounded-full flex items-center justify-center mb-4">
              <Mic className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-xl font-semibold text-slate-200 mb-2">Nenhuma voz encontrada</h3>
            <p>Tente ajustar seus filtros ou termos de busca.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredVoices.map((voice) => {
              const isPlaying = playingVoiceId === voice.id;
              const isGenerating = generatingPreview === voice.id;
              const isFavorite = favorites.has(voice.id);
              const isCloned = voice.id.startsWith("clone_");

              return (
                <Card 
                  key={voice.id} 
                  className="bg-slate-900/50 border-slate-800 overflow-hidden hover:border-indigo-500/50 hover:bg-slate-900 transition-all group"
                >
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex gap-3 items-center">
                        <button 
                          onClick={() => handlePlayPreview(voice)}
                          disabled={isGenerating || (playingVoiceId !== null && playingVoiceId !== voice.id)}
                          className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 ${
                            isPlaying 
                              ? 'bg-rose-500 shadow-rose-500/20' 
                              : isGenerating 
                                ? 'bg-slate-800 text-slate-400' 
                                : 'bg-indigo-600 shadow-indigo-600/20'
                          }`}
                        >
                          {isGenerating ? (
                            <Loader2 className="w-5 h-5 animate-spin text-white" />
                          ) : isPlaying ? (
                            <Pause className="w-5 h-5 text-white" />
                          ) : (
                            <Play className="w-5 h-5 text-white ml-1" />
                          )}
                        </button>
                        <div>
                          <h3 className="font-semibold text-slate-100 text-lg line-clamp-1" title={voice.name}>
                            {voice.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            {voice.gender && (
                              <Badge variant="secondary" className="bg-slate-800 text-slate-300 border-slate-700 text-xs">
                                {voice.gender === 'male' ? 'Masc' : voice.gender === 'female' ? 'Fem' : voice.gender}
                              </Badge>
                            )}
                            {voice.language && (
                              <span className="text-xs text-slate-500 uppercase font-medium">{voice.language}</span>
                            )}
                            {isCloned && (
                              <Badge variant="outline" className="text-indigo-400 border-indigo-900 bg-indigo-950/30 text-[10px] px-1 py-0 h-4">
                                CLONE
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-800/50">
                      <Button 
                        onClick={() => handleSelectVoice(voice)}
                        className="w-full bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white transition-colors border-0"
                      >
                        <Mic className="w-4 h-4 mr-2" />
                        Usar Voz
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex-shrink-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-slate-200">
                          <DropdownMenuItem 
                            onClick={() => toggleFavorite(voice.id)}
                            className="hover:bg-slate-800 hover:text-white cursor-pointer focus:bg-slate-800 focus:text-white"
                          >
                            <Star className={`w-4 h-4 mr-2 ${isFavorite ? 'fill-yellow-500 text-yellow-500' : ''}`} />
                            {isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceLibrary;
