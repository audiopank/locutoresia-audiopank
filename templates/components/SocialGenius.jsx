import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Hash, Zap, Brain, User, Clock, Wand2, Copy, CheckCheck, Send, ExternalLink, ImageIcon, Download, RefreshCw, History, Trash2, ClipboardCopy, Rocket, CalendarClock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ACTIONS = [
  { action: 'generate_caption', label: 'Gerar Legenda', description: 'Cria legendas criativas para suas redes sociais', icon: <Sparkles className="w-5 h-5" />, fields: ['text', 'platform', 'tone', 'niche'] },
  { action: 'generate_hashtags', label: 'Gerar Hashtags', description: 'Hashtags trending e relevantes para seu conteúdo', icon: <Hash className="w-5 h-5" />, fields: ['text', 'platform', 'niche', 'max_hashtags'] },
  { action: 'optimize_content', label: 'Otimizar Conteúdo', description: 'Otimiza seu texto para máximo engajamento', icon: <Zap className="w-5 h-5" />, fields: ['text', 'platform'] },
  { action: 'analyze_sentiment', label: 'Análise de Sentimento', description: 'Analisa o tom e sentimento do seu texto', icon: <Brain className="w-5 h-5" />, fields: ['text'] },
  { action: 'generate_bio', label: 'Gerar Bio', description: 'Cria bios profissionais para seu perfil', icon: <User className="w-5 h-5" />, fields: ['text', 'platform', 'tone', 'niche'] },
  { action: 'suggest_schedule', label: 'Sugerir Horário', description: 'Melhores horários para postar no Brasil', icon: <Clock className="w-5 h-5" />, fields: ['platform', 'niche'] },
  { action: 'auto_optimize', label: 'Auto Otimizar', description: 'Otimiza texto + gera hashtags automaticamente', icon: <Wand2 className="w-5 h-5" />, fields: ['text', 'platform', 'niche', 'max_hashtags'] },
];

export const SocialGenius = () => {
  const [selectedAction, setSelectedAction] = useState('generate_caption');
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [tone, setTone] = useState('casual');
  const [niche, setNiche] = useState('');
  const [maxHashtags, setMaxHashtags] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const [publishingField, setPublishingField] = useState(null);
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewBaseText, setPreviewBaseText] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageStyle, setImageStyle] = useState("realistic");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageHistory, setImageHistory] = useState([]);
  const [copyingImage, setCopyingImage] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [apiPublishing, setApiPublishing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("social-genius-image-history");
      if (raw) setImageHistory(JSON.parse(raw));
    } catch {}
  }, []);

  const persistHistory = (items) => {
    setImageHistory(items);
    try {
      localStorage.setItem("social-genius-image-history", JSON.stringify(items.slice(0, 12)));
    } catch {}
  };

  const currentAction = ACTIONS.find(a => a.action === selectedAction);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const data = {};
      if (currentAction.fields.includes('text')) data.text = text;
      if (currentAction.fields.includes('platform')) data.platform = platform;
      if (currentAction.fields.includes('tone')) data.tone = tone;
      if (currentAction.fields.includes('niche')) data.niche = niche;
      if (currentAction.fields.includes('max_hashtags')) data.max_hashtags = maxHashtags;
      data.language = 'pt-BR';

      const { data: response, error: fnError } = await supabase.functions.invoke('social-genius-test', {
        body: { action: selectedAction, data },
      });

      if (fnError) throw fnError;

      if (response?.success) {
        setResult(response.data);
        toast({ title: "Sucesso!", description: `${currentAction.label} executado com sucesso` });
      } else {
        setError(response?.data?.error || response?.error || 'Erro desconhecido');
      }
    } catch (err) {
      setError(err.message || 'Erro ao chamar a API');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text, field) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({ title: "Copiado!", description: "Texto copiado para a área de transferência" });
  };

  const buildFinalContent = (baseText, withHashtags) => {
    let finalContent = baseText.trim();
    const hashtags = result?.hashtags && Array.isArray(result.hashtags) ? result.hashtags : undefined;
    if (withHashtags && hashtags && hashtags.length > 0) {
      finalContent += '\n\n' + hashtags.map((h) => h.startsWith('#') ? h : `#${h}`).join(' ');
    }
    return finalContent;
  };

  const openPreview = (content) => {
    setPreviewBaseText(content);
    setPreviewContent(buildFinalContent(content, includeHashtags));
    setImageUrl(null);
    setImagePrompt(content.slice(0, 500));
    setPreviewOpen(true);
  };

  const handleToggleHashtags = (next) => {
    setIncludeHashtags(next);
    if (previewOpen) {
      setPreviewContent(buildFinalContent(previewBaseText, next));
    }
  };

  const generateImageForPost = async () => {
    setImageLoading(true);
    try {
      const promptBase = (imagePrompt || previewBaseText || text || 'post para redes sociais').slice(0, 800);
      const { data, error: fnError } = await supabase.functions.invoke('social-genius-image', {
        body: {
          prompt: promptBase,
          customPrompt: promptBase,
          platform,
          style: imageStyle,
          aspectRatio,
        },
      });
      if (fnError) throw fnError;
      if (!data?.success || !data?.image_url) {
        throw new Error(data?.error || 'Falha ao gerar imagem');
      }
      setImageUrl(data.image_url);
      const entry = {
        id: `${Date.now()}`,
        url: data.image_url,
        prompt: promptBase,
        style: imageStyle,
        aspectRatio,
        platform,
        createdAt: Date.now(),
      };
      persistHistory([entry, ...imageHistory].slice(0, 12));
      toast({ title: 'Imagem gerada!', description: 'Imagem pronta para baixar e usar no post' });
    } catch (err) {
      toast({
        title: 'Erro ao gerar imagem',
        description: err.message || 'Não foi possível gerar a imagem',
        variant: 'destructive',
      });
    } finally {
      setImageLoading(false);
    }
  };

  const downloadImage = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `newpost-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyImageToClipboard = async (url) => {
    const target = url || imageUrl;
    if (!target) return;
    setCopyingImage(true);
    try {
      const res = await fetch(target);
      const blob = await res.blob();
      let pngBlob = blob;
      if (blob.type !== 'image/png') {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(bitmap, 0, 0);
        pngBlob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      toast({
        title: 'Imagem copiada!',
        description: 'Cole (Ctrl+V) no editor da NewPost-IA',
      });
    } catch (err) {
      toast({
        title: 'Não foi possível copiar a imagem',
        description: 'Seu navegador pode não permitir. Use o botão Baixar como alternativa.',
        variant: 'destructive',
      });
    } finally {
      setCopyingImage(false);
    }
  };

  const reuseFromHistory = (item) => {
    setImageUrl(item.url);
    setImagePrompt(item.prompt);
    setImageStyle(item.style);
    setAspectRatio(item.aspectRatio);
    toast({ title: 'Imagem reaproveitada', description: 'Você pode baixar, copiar ou gerar uma variação.' });
  };

  const removeFromHistory = (id) => {
    persistHistory(imageHistory.filter((h) => h.id !== id));
  };

  const clearHistory = () => {
    persistHistory([]);
    toast({ title: 'Histórico limpo' });
  };

  const confirmPublishToNewPost = async () => {
    setPublishingField('preview');
    try {
      await navigator.clipboard.writeText(previewContent);
      const newPostUrl = `https://plugpost-ai.lovable.app/?compose=1&content=${encodeURIComponent(previewContent)}`;
      window.open(newPostUrl, '_blank', 'noopener,noreferrer');
      toast({
        title: 'Abrindo NewPost-IA',
        description: 'Conteúdo copiado. Cole no editor e publique.',
      });
      setPreviewOpen(false);
    } catch (err) {
      toast({
        title: 'Erro ao publicar',
        description: err.message || 'Não foi possível abrir a NewPost-IA',
        variant: 'destructive',
      });
    } finally {
      setPublishingField(null);
    }
  };

  const publishViaApi = async () => {
    if (previewContent.trim().length === 0) return;
    setApiPublishing(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('newpost-publish-api', {
        body: {
          content: previewContent,
          platform,
          image_url: imageUrl ?? undefined,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        },
      });
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error || 'Falha ao publicar');

      toast({
        title: scheduledAt ? 'Post agendado!' : 'Post publicado!',
        description: data.post_url ? `Disponível em ${data.post_url}` : 'Sua publicação foi enviada para a NewPost-IA.',
      });
      setPreviewOpen(false);
      setScheduledAt('');
    } catch (err) {
      toast({
        title: 'Erro ao publicar via API',
        description: err.message || 'Não foi possível publicar na NewPost-IA',
        variant: 'destructive',
      });
    } finally {
      setApiPublishing(false);
    }
  };

  const PublishButton = ({ text: pubText, field }) => (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      disabled={publishingField === field}
      onClick={() => openPreview(pubText)}
    >
      {publishingField === field ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Send className="w-3 h-3" />
      )}
      Pré-visualizar & Postar
    </Button>
  );

  const CopyButton = ({ text: copyText, field }) => (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyToClipboard(copyText, field)}>
      {copiedField === field ? <CheckCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );

  const renderResult = () => {
    if (!result) return null;

    if (result.captions) {
      return (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Legendas Geradas:</h4>
          {result.captions.map((c, i) => (
            <Card key={i} className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground flex-1">{c.text}</p>
                  <CopyButton text={c.text} field={`caption-${i}`} />
                </div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary">Engajamento: {c.estimated_engagement}</Badge>
                  <Badge variant="outline">Emojis: {c.emoji_count}</Badge>
                </div>
                <div className="mt-3">
                  <PublishButton text={c.text} field={`pub-caption-${i}`} />
                </div>
              </CardContent>
            </Card>
          ))}
          {result.tip && <p className="text-xs text-muted-foreground italic">💡 {result.tip}</p>}
        </div>
      );
    }

    if (result.hashtags) {
      return (
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <h4 className="font-semibold text-foreground">Hashtags Geradas:</h4>
            <CopyButton text={result.hashtags.join(' ')} field="all-hashtags" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.hashtags.map((h, i) => (
              <Badge key={i} variant="secondary" className="cursor-pointer hover:bg-primary/20" onClick={() => copyToClipboard(h, `hash-${i}`)}>
                {h}
              </Badge>
            ))}
          </div>
          {result.categories && Object.entries(result.categories).map(([cat, tags]) => (
            <div key={cat}>
              <p className="text-xs text-muted-foreground font-medium mb-1">{cat}:</p>
              <div className="flex flex-wrap gap-1">
                {tags.map((t, i) => <Badge key={i} variant="outline" className="text-xs">{t}</Badge>)}
              </div>
            </div>
          ))}
          {result.tip && <p className="text-xs text-muted-foreground italic">💡 {result.tip}</p>}
        </div>
      );
    }

    if (result.optimized_text) {
      return (
        <div className="space-y-3">
          <div>
            <div className="flex items-start justify-between">
              <h4 className="font-semibold text-foreground">Texto Otimizado:</h4>
              <CopyButton text={result.optimized_text} field="optimized" />
            </div>
            <p className="text-sm text-foreground mt-1 p-3 bg-muted/50 rounded-lg">{result.optimized_text}</p>
          </div>
          <PublishButton text={result.optimized_text} field="pub-optimized" />
          {result.improvements?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Melhorias aplicadas:</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {result.improvements.map((imp, i) => <li key={i}>✅ {imp}</li>)}
              </ul>
            </div>
          )}
          <div className="flex gap-3">
            {result.readability_score && <Badge variant="secondary">Leitura: {result.readability_score}/10</Badge>}
            {result.seo_score && <Badge variant="secondary">SEO: {result.seo_score}/10</Badge>}
          </div>
          {result.suggested_cta && <p className="text-xs text-muted-foreground">🎯 CTA: {result.suggested_cta}</p>}
          {result.best_posting_time && <p className="text-xs text-muted-foreground">⏰ Melhor horário: {result.best_posting_time}</p>}
          {result.hashtags && (
            <div className="flex flex-wrap gap-1">
              {result.hashtags.map((h, i) => <Badge key={i} variant="outline" className="text-xs">{h}</Badge>)}
            </div>
          )}
        </div>
      );
    }

    if (result.sentiment) {
      const sentimentColor = result.sentiment === 'positivo' ? 'text-green-500' : result.sentiment === 'negativo' ? 'text-red-500' : 'text-yellow-500';
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="font-semibold text-foreground">Sentimento:</h4>
            <Badge className={sentimentColor}>{result.sentiment}</Badge>
            {result.confidence && <span className="text-xs text-muted-foreground">({(result.confidence * 100).toFixed(0)}% confiança)</span>}
          </div>
          {result.emotions?.length > 0 && (
            <div className="flex gap-1.5">
              {result.emotions.map((e, i) => <Badge key={i} variant="secondary">{e}</Badge>)}
            </div>
          )}
          {result.tone && <p className="text-xs text-muted-foreground">Tom: {result.tone}</p>}
          {result.brand_safety !== undefined && (
            <p className="text-xs text-muted-foreground">{result.brand_safety ? '✅ Seguro para marca' : '⚠️ Pode ter riscos para marca'}</p>
          )}
          {result.suggestions?.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {result.suggestions.map((s, i) => <li key={i}>💡 {s}</li>)}
            </ul>
          )}
        </div>
      );
    }

    if (result.bios) {
      return (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Bios Geradas:</h4>
          {result.bios.map((b, i) => (
            <Card key={i} className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground flex-1">{b.text}</p>
                  <CopyButton text={b.text} field={`bio-${i}`} />
                </div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline">{b.style}</Badge>
                  <Badge variant="secondary">{b.character_count} chars</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {result.tip && <p className="text-xs text-muted-foreground italic">💡 {result.tip}</p>}
        </div>
      );
    }

    if (result.best_times) {
      return (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Melhores Horários para Postar:</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {result.best_times.map((time, i) => (
              <Card key={i} className="bg-muted/50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-foreground">{time.day}</p>
                  <p className="text-xs text-muted-foreground">{time.time}</p>
                  <Badge variant="secondary" className="mt-2">Engajamento: {time.engagement_score}%</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
          {result.tip && <p className="text-xs text-muted-foreground italic">💡 {result.tip}</p>}
        </div>
      );
    }

    if (result.auto_optimized) {
      return (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground">Conteúdo Auto-Otimizado:</h4>
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-foreground flex-1">{result.auto_optimized.text}</p>
                <CopyButton text={result.auto_optimized.text} field="auto-optimized" />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {result.auto_optimized.hashtags.map((h, i) => (
                  <Badge key={i} variant="secondary" className="cursor-pointer hover:bg-primary/20" onClick={() => copyToClipboard(h, `auto-hash-${i}`)}>
                    {h}
                  </Badge>
                ))}
              </div>
              <div className="mt-3">
                <PublishButton text={result.auto_optimized.text} field="pub-auto-optimized" />
              </div>
            </CardContent>
          </Card>
          {result.tip && <p className="text-xs text-muted-foreground italic">💡 {result.tip}</p>}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">{JSON.stringify(result, null, 2)}</p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Social Genius</h1>
          <p className="text-muted-foreground">Ferramentas de IA para otimizar seu conteúdo nas redes sociais</p>
        </div>

        <Tabs defaultValue="generator" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="generator">Gerador de Conteúdo</TabsTrigger>
            <TabsTrigger value="image">Gerador de Imagens</TabsTrigger>
          </TabsList>

          <TabsContent value="generator">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      Escolha uma Ferramenta
                    </CardTitle>
                    <CardDescription>Selecione a ação que deseja executar</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ACTIONS.map((action) => (
                        <button
                          key={action.action}
                          onClick={() => setSelectedAction(action.action)}
                          className={`p-4 rounded-lg border text-left transition-all ${
                            selectedAction === action.action
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-muted">{action.icon}</div>
                            <div className="flex-1">
                              <p className="font-medium text-foreground">{action.label}</p>
                              <p className="text-xs text-muted-foreground">{action.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle>Configurações</CardTitle>
                    <CardDescription>Preencha os campos para executar a ferramenta</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {currentAction.fields.includes('text') && (
                      <div>
                        <Label htmlFor="text" className="text-sm font-medium text-foreground mb-2 block">
                          Texto
                        </Label>
                        <Textarea
                          id="text"
                          placeholder="Digite o texto que deseja processar..."
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          className="bg-input border-border min-h-[150px]"
                          disabled={loading}
                        />
                      </div>
                    )}

                    {currentAction.fields.includes('platform') && (
                      <div>
                        <Label htmlFor="platform" className="text-sm font-medium text-foreground mb-2 block">
                          Plataforma
                        </Label>
                        <Select value={platform} onValueChange={setPlatform} disabled={loading}>
                          <SelectTrigger id="platform" className="bg-input border-border">
                            <SelectValue placeholder="Selecione a plataforma" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="instagram">Instagram</SelectItem>
                            <SelectItem value="facebook">Facebook</SelectItem>
                            <SelectItem value="twitter">Twitter/X</SelectItem>
                            <SelectItem value="linkedin">LinkedIn</SelectItem>
                            <SelectItem value="tiktok">TikTok</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {currentAction.fields.includes('tone') && (
                      <div>
                        <Label htmlFor="tone" className="text-sm font-medium text-foreground mb-2 block">
                          Tom
                        </Label>
                        <Select value={tone} onValueChange={setTone} disabled={loading}>
                          <SelectTrigger id="tone" className="bg-input border-border">
                            <SelectValue placeholder="Selecione o tom" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="casual">Casual</SelectItem>
                            <SelectItem value="professional">Profissional</SelectItem>
                            <SelectItem value="friendly">Amigável</SelectItem>
                            <SelectItem value="funny">Divertido</SelectItem>
                            <SelectItem value="inspirational">Inspirador</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {currentAction.fields.includes('niche') && (
                      <div>
                        <Label htmlFor="niche" className="text-sm font-medium text-foreground mb-2 block">
                          Nicho
                        </Label>
                        <Input
                          id="niche"
                          placeholder="Ex: tecnologia, moda, finanças..."
                          value={niche}
                          onChange={(e) => setNiche(e.target.value)}
                          className="bg-input border-border"
                          disabled={loading}
                        />
                      </div>
                    )}

                    {currentAction.fields.includes('max_hashtags') && (
                      <div>
                        <Label htmlFor="maxHashtags" className="text-sm font-medium text-foreground mb-2 block">
                          Máximo de Hashtags
                        </Label>
                        <Input
                          id="maxHashtags"
                          type="number"
                          min="5"
                          max="50"
                          value={maxHashtags}
                          onChange={(e) => setMaxHashtags(Number(e.target.value))}
                          className="bg-input border-border"
                          disabled={loading}
                        />
                      </div>
                    )}

                    <Button
                      onClick={handleSubmit}
                      disabled={loading || (currentAction.fields.includes('text') && !text.trim())}
                      className="w-full gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90 text-white"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Processando...
                        </>
                      ) : (
                        <>
                          Executar {currentAction.label}
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                {error && (
                  <Card className="bg-destructive/10 border-destructive">
                    <CardContent className="p-4">
                      <p className="text-sm text-destructive font-medium">Erro:</p>
                      <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                  </Card>
                )}

                {result && (
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle>Resultado</CardTitle>
                    </CardHeader>
                    <CardContent>{renderResult()}</CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="image">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-primary" />
                      Gerador de Imagens
                    </CardTitle>
                    <CardDescription>Crie imagens para suas postagens</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="imagePrompt" className="text-sm font-medium text-foreground mb-2 block">
                        Prompt da Imagem
                      </Label>
                      <Textarea
                        id="imagePrompt"
                        placeholder="Descreva a imagem que deseja gerar..."
                        value={imagePrompt}
                        onChange={(e) => setImagePrompt(e.target.value)}
                        className="bg-input border-border min-h-[100px]"
                        disabled={imageLoading}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="imageStyle" className="text-sm font-medium text-foreground mb-2 block">
                          Estilo
                        </Label>
                        <Select value={imageStyle} onValueChange={setImageStyle} disabled={imageLoading}>
                          <SelectTrigger id="imageStyle" className="bg-input border-border">
                            <SelectValue placeholder="Selecione o estilo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="realistic">Realista</SelectItem>
                            <SelectItem value="artistic">Artístico</SelectItem>
                            <SelectItem value="cartoon">Cartoon</SelectItem>
                            <SelectItem value="3d">3D</SelectItem>
                            <SelectItem value="painting">Pintura</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="aspectRatio" className="text-sm font-medium text-foreground mb-2 block">
                          Proporção
                        </Label>
                        <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={imageLoading}>
                          <SelectTrigger id="aspectRatio" className="bg-input border-border">
                            <SelectValue placeholder="Selecione a proporção" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1:1">1:1 (Quadrado)</SelectItem>
                            <SelectItem value="4:5">4:5 (Instagram)</SelectItem>
                            <SelectItem value="16:9">16:9 (YouTube)</SelectItem>
                            <SelectItem value="9:16">9:16 (Reels/TikTok)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      onClick={generateImageForPost}
                      disabled={imageLoading || !imagePrompt.trim()}
                      className="w-full gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90 text-white"
                    >
                      {imageLoading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Gerando Imagem...
                        </>
                      ) : (
                        <>
                          Gerar Imagem
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {imageUrl && (
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle>Imagem Gerada</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <img src={imageUrl} alt="Imagem gerada" className="w-full rounded-lg" />
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={downloadImage} className="flex-1 gap-2">
                          <Download className="w-4 h-4" />
                          Baixar
                        </Button>
                        <Button variant="outline" onClick={() => copyImageToClipboard()} className="flex-1 gap-2" disabled={copyingImage}>
                          {copyingImage ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Copiando...
                            </>
                          ) : (
                            <>
                              <ClipboardCopy className="w-4 h-4" />
                              Copiar
                            </>
                          )}
                        </Button>
                        <Button variant="default" onClick={() => openPreview(previewBaseText || text || '')} className="flex-1 gap-2">
                          <Send className="w-4 h-4" />
                          Usar no Post
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="space-y-6">
                {imageHistory.length > 0 && (
                  <Card className="bg-card border-border">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <History className="w-5 h-5 text-primary" />
                        Histórico
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={clearHistory}>
                        Limpar
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {imageHistory.map((item) => (
                        <div key={item.id} className="relative group">
                          <img
                            src={item.url}
                            alt={item.prompt}
                            className="w-full rounded-lg cursor-pointer"
                            onClick={() => reuseFromHistory(item)}
                          />
                          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="destructive"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeFromHistory(item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Rocket className="w-5 h-5 text-primary" />
                Pré-visualizar & Postar
              </DialogTitle>
              <DialogDescription>
                Revise seu conteúdo antes de publicar
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-foreground whitespace-pre-wrap">{previewContent}</p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch id="include-hashtags" checked={includeHashtags} onCheckedChange={handleToggleHashtags} />
                  <Label htmlFor="include-hashtags">Incluir Hashtags</Label>
                </div>
              </div>

              {imageUrl && (
                <div>
                  <img src={imageUrl} alt="Imagem do post" className="w-full rounded-lg" />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="scheduledAt" className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4" />
                  Agendar para depois (opcional)
                </Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(false)}
                className="sm:flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="outline"
                onClick={confirmPublishToNewPost}
                disabled={publishingField === 'preview'}
                className="sm:flex-1 gap-2"
              >
                {publishingField === 'preview' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Abrindo NewPost-IA...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-4 h-4" />
                    Abrir na NewPost-IA
                  </>
                )}
              </Button>
              <Button
                onClick={publishViaApi}
                disabled={apiPublishing || previewContent.trim().length === 0}
                className="sm:flex-1 gap-2 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90 text-white"
              >
                {apiPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Publicando...
                  </>
                ) : (
                  <>
                    {scheduledAt ? 'Agendar via API' : 'Publicar via API'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
