import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Wand2, Loader2, Mic, Copy } from "lucide-react";
import { useToast } from "@/hooks/useToast";

interface ScriptPanelProps {
  value: string;
  onChange: (text: string) => void;
  onSendToVoice: () => void;
}

/**
 * Painel "Roteiro com IA": gera um roteiro a partir de um briefing (Gemini),
 * permite o produtor editar, e envia o texto final para o Gerador de Voz.
 */
export const ScriptPanel = ({ value, onChange, onSendToVoice }: ScriptPanelProps) => {
  const { toast } = useToast();
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("profissional");
  const [isGenerating, setIsGenerating] = useState(false);
  const [variations, setVariations] = useState<string[]>([]);
  const [isVarying, setIsVarying] = useState(false);

  const generateVariations = async () => {
    if (!value.trim()) {
      toast({ title: "Escreva o roteiro primeiro", description: "Preciso de um texto base para gerar variações.", variant: "destructive" });
      return;
    }
    setIsVarying(true);
    try {
      const res = await fetch("/api/gemini/variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao gerar variações");
      setVariations(data.variations || []);
      toast({ title: "Variações geradas!", description: "Clique na que você preferir para usá-la." });
    } catch (e: any) {
      toast({ title: "Erro ao gerar variações", description: e.message || "Tente novamente", variant: "destructive" });
    } finally {
      setIsVarying(false);
    }
  };

  const pickVariation = (v: string) => {
    onChange(v);
    setVariations([]);
    toast({ title: "Variação aplicada", description: "Texto atualizado no editor." });
  };

  const generate = async () => {
    if (!brief.trim()) {
      toast({ title: "Descreva o briefing", description: "Diga o tema/objetivo do roteiro.", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/gemini/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: brief, tone }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Falha ao gerar roteiro");
      onChange((data.text || "").trim());
      toast({ title: "Roteiro gerado!", description: "Edite à vontade antes de gerar a voz." });
    } catch (e: any) {
      toast({ title: "Erro ao gerar roteiro", description: e.message || "Tente novamente", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const tones = ["profissional", "jovem", "institucional", "comercial", "descontraído", "épico"];

  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Roteiro com IA
          </h3>
        </div>

        {/* Briefing + tom */}
        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <Input
            placeholder="Briefing/tema: ex. 'Spot de 30s para uma pizzaria com promoção de terça'"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") generate(); }}
            className="bg-white/10 border-white/20 text-white placeholder-white/40"
          />
          <div className="flex items-center gap-2">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              aria-label="Tom do roteiro"
              className="bg-white/10 border border-white/20 text-white rounded-md px-3 py-2 text-sm"
            >
              {tones.map((t) => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
            </select>
            <Button onClick={generate} disabled={isGenerating} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Gerar Roteiro
            </Button>
          </div>
        </div>

        {/* Editor do roteiro */}
        <div>
          <label className="text-sm font-medium text-white/80 mb-2 block">Roteiro (edite o texto se necessário)</label>
          <Textarea
            placeholder="O roteiro gerado aparecerá aqui. Você também pode digitar/colar o seu."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={6}
            className="bg-white/10 border-white/20 text-white placeholder-white/40 resize-y"
          />
          <div className="text-xs text-white/50 mt-1 text-right">{value.length} caracteres</div>
        </div>

        {/* Variações de roteiro */}
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            onClick={generateVariations}
            disabled={isVarying || !value.trim()}
            className="gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10"
          >
            {isVarying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
            Gerar Variações
          </Button>

          {variations.length > 0 && (
            <div className="grid gap-2">
              {variations.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickVariation(v)}
                  className="text-left rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/90 hover:border-purple-400 hover:bg-white/10 transition-colors"
                >
                  <span className="block text-xs font-semibold text-purple-300 mb-1">Variação {i + 1}</span>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={onSendToVoice} disabled={!value.trim()} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <Mic className="w-4 h-4" />
            Enviar para Gerar Voz
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default ScriptPanel;
