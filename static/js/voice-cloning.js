import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Mic, X, FileAudio, Loader2, Play, Pause } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLMNT } from "@/hooks/useLMNT";
import { Progress } from "@/components/ui/progress";

const CLONING_STEPS = [
  { label: "Preparando áudio...", progress: 20 },
  { label: "Enviando para servidor...", progress: 40 },
  { label: "Processando características...", progress: 60 },
  { label: "Criando modelo de voz...", progress: 80 },
  { label: "Finalizando clone...", progress: 95 },
];

const CLONED_VOICES_KEY = "cloned_voices_library";

const VoiceCloning = () => {
  const navigate = useNavigate();
  const [voiceName, setVoiceName] = useState("");
  const [description, setDescription] = useState("");
  const [gender, setGender] = useState("");
  const [uploadMethod, setUploadMethod] = useState<"upload" | "record">("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [cloningProgress, setCloningProgress] = useState(0);
  const [cloningStep, setCloningStep] = useState("");
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartRef = useRef<number>(0);
  const { toast } = useToast();
  const { cloneVoice, isLoading } = useLMNT();

  // Cria URL de preview quando tem áudio
  useEffect(() => {
    if (uploadedFile) {
      const url = URL.createObjectURL(uploadedFile);
      setPreviewAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else if (recordedBlob) {
      const url = URL.createObjectURL(recordedBlob);
      setPreviewAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewAudioUrl(null);
    }
  }, [uploadedFile, recordedBlob]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setRecordedBlob(null);
      toast({
        title: "Áudio carregado",
        description: file.name,
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setUploadedFile(file);
      setRecordedBlob(null);
      toast({
        title: "Áudio carregado",
        description: file.name,
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Timer para duração da gravação
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      recordingStartRef.current = Date.now();
      interval = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - recordingStartRef.current) / 1000));
      }, 1000);
    } else {
      setRecordingDuration(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Setup AudioContext e Analyser para waveform
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setUploadedFile(null);
        stream.getTracks().forEach(track => track.stop());
        
        // Cleanup AudioContext
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        analyserRef.current = null;
        
        const duration = Math.floor((Date.now() - recordingStartRef.current) / 1000);
        toast({
          title: "Gravação concluída",
          description: `Duração: ${duration}s`,
        });
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      toast({
        title: "Erro ao acessar microfone",
        description: "Verifique as permissões do navegador",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const clearAudio = () => {
    setUploadedFile(null);
    setRecordedBlob(null);
    setPreviewAudioUrl(null);
    setIsPreviewPlaying(false);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const togglePreview = () => {
    if (!previewAudioUrl) return;

    if (isPreviewPlaying && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
    } else {
      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio(previewAudioUrl);
        previewAudioRef.current.onended = () => setIsPreviewPlaying(false);
      }
      previewAudioRef.current.play();
      setIsPreviewPlaying(true);
    }
  };

  const hasAudio = uploadedFile || recordedBlob;

  // Converte arquivo/blob para base64
  const convertToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        // Remove o prefixo data:audio/...;base64,
        const base64Data = base64.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Simula progresso durante a clonagem
  const simulateProgress = () => {
    let stepIndex = 0;
    
    const interval = setInterval(() => {
      if (stepIndex < CLONING_STEPS.length) {
        setCloningStep(CLONING_STEPS[stepIndex].label);
        setCloningProgress(CLONING_STEPS[stepIndex].progress);
        stepIndex++;
      }
    }, 2000);

    return () => clearInterval(interval);
  };

  const handleCreateVoiceClone = async () => {
    if (!voiceName.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Insira um nome para a voz",
        variant: "destructive",
      });
      return;
    }

    if (!hasAudio) {
      toast({
        title: "Áudio obrigatório",
        description: "Faça upload ou grave um áudio",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setCloningProgress(0);
    setCloningStep(CLONING_STEPS[0].label);

    // Inicia simulação de progresso
    const stopProgress = simulateProgress();

    try {
      // Converte o áudio para base64
      const audioBlob = uploadedFile || recordedBlob;
      if (!audioBlob) throw new Error("Nenhum áudio disponível");

      const audioBase64 = await convertToBase64(audioBlob);
      
      // Cria descrição completa
      const fullDescription = [
        description,
        gender ? `Gender: ${gender}` : null
      ].filter(Boolean).join(' | ');

      // Chama a API de clonagem
      const result = await cloneVoice(voiceName, audioBase64, fullDescription || undefined);

      // Finaliza progresso
      setCloningProgress(100);
      setCloningStep("Concluído!");

      // Salva na biblioteca de vozes clonadas
      try {
        const stored = localStorage.getItem(CLONED_VOICES_KEY);
        const existingVoices = stored ? JSON.parse(stored) : [];
        const newVoice = {
          id: result?.id || Date.now().toString(),
          name: voiceName,
          description: description || undefined,
          gender: gender || undefined,
          createdAt: new Date().toISOString(),
          lmntVoiceId: result?.id,
        };
        existingVoices.unshift(newVoice);
        localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(existingVoices));
      } catch (e) {
        console.error("Error saving to library:", e);
      }

      toast({
        title: "Voz clonada com sucesso!",
        description: `A voz "${voiceName}" foi salva na biblioteca de vozes clonadas`,
      });

      // Limpa e navega para a biblioteca
      setTimeout(() => {
        setVoiceName("");
        setDescription("");
        setGender("");
        clearAudio();
        setCloningProgress(0);
        setCloningStep("");
        navigate('/cloned-voices');
      }, 1500);

    } catch (error: any) {
      console.error("Erro ao clonar voz:", error);
      setCloningProgress(0);
      setCloningStep("");
      // O toast de erro já é mostrado pelo useLMNT
    } finally {
      stopProgress();
      setIsCreating(false);
    }
  };

  const isProcessing = isCreating || isLoading;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Voice Cloning</h1>
          <p className="text-muted-foreground">Create a custom voice clone from audio samples</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 bg-card border-border">
            <h2 className="text-lg font-semibold text-foreground mb-6">Voice details</h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Voice name <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder="e.g., My Narrator Voice"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="bg-input border-border"
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Description
                </label>
                <Textarea
                  placeholder="e.g., Professional narration voice for documentaries"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-input border-border resize-none"
                  rows={3}
                  disabled={isProcessing}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Gender
                </label>
                <Select value={gender} onValueChange={setGender} disabled={isProcessing}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Select gender (Optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-card border-border">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-foreground">Voice input</h2>
              <span className="text-xs text-muted-foreground">? Tips for best quality</span>
            </div>

            <div className="flex gap-2 mb-6">
              <Button
                variant={uploadMethod === "upload" ? "default" : "outline"}
                onClick={() => setUploadMethod("upload")}
                className="flex-1"
                disabled={isProcessing}
              >
                Upload audio
              </Button>
              <Button
                variant={uploadMethod === "record" ? "default" : "outline"}
                onClick={() => setUploadMethod("record")}
                className="flex-1"
                disabled={isProcessing}
              >
                Record voice
              </Button>
            </div>

            {hasAudio ? (
              <div className="border-2 border-primary/50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[250px] bg-primary/5">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                  <FileAudio className="w-8 h-8 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {uploadedFile ? uploadedFile.name : "Gravação de voz"}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {uploadedFile
                    ? `${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB`
                    : recordedBlob
                      ? `${(recordedBlob.size / 1024).toFixed(1)} KB`
                      : ""
                  }
                </p>
                
                {/* Botões de Preview e Remover */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={togglePreview}
                    className="gap-2"
                    disabled={isProcessing}
                  >
                    {isPreviewPlaying ? (
                      <>
                        <Pause className="w-4 h-4" />
                        Pausar
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Ouvir Preview
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAudio}
                    className="gap-2"
                    disabled={isProcessing}
                  >
                    <X className="w-4 h-4" />
                    Remover
                  </Button>
                </div>
              </div>
            ) : isRecording ? (
              <div
                className="border-2 border-destructive/50 rounded-lg p-6 flex flex-col items-center justify-center min-h-[250px] bg-destructive/5 cursor-pointer"
                onClick={stopRecording}
              >
                <div className="w-16 h-16 rounded-full bg-destructive animate-pulse flex items-center justify-center mb-4">
                  <Mic className="w-8 h-8 text-destructive-foreground" />
                </div>
                <p className="text-lg font-bold text-destructive mb-2">
                  {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
                </p>
                <p className="text-sm font-medium text-foreground mb-1">
                  Gravando... Clique para parar
                </p>
                <p className="text-xs text-muted-foreground">
                  Fale claramente para melhor qualidade
                </p>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center min-h-[250px] hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => uploadMethod === "upload" ? fileInputRef.current?.click() : startRecording()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-secondary">
                  {uploadMethod === "upload" ? (
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  ) : (
                    <Mic className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {uploadMethod === "upload"
                    ? "Clique para fazer upload ou arraste e solte"
                    : "Clique para iniciar a gravação"
                  }
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Suporta mp3, wav, mp4, m4a, webm, ogg
                </p>
                <p className="text-xs text-muted-foreground">
                  Para melhores resultados, envie pelo menos 5 segundos de fala clara
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* Barra de Progresso */}
        {isProcessing && cloningProgress > 0 && (
          <Card className="mt-6 p-6 bg-card border-border">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{cloningStep}</p>
                <span className="text-sm text-muted-foreground">{cloningProgress}%</span>
              </div>
              <Progress value={cloningProgress} className="h-2" />
            </div>
          </Card>
        )}

        <div className="mt-6">
          <Button
            className="w-full"
            onClick={handleCreateVoiceClone}
            disabled={isProcessing || !voiceName.trim() || !hasAudio}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Clonando voz...
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Criar Clone de Voz
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VoiceCloning;