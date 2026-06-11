import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Mic, Volume2, Zap, Radio, Waves, Sparkles } from "lucide-react";

export interface VoiceProcessorSettings {
  noiseReduction: boolean;
  noiseReductionAmount: number;
  deEss: boolean;
  deEssAmount: number;
  compressor: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  gate: boolean;
  gateThreshold: number;
  nectar: boolean;
}

export const defaultVoiceProcessors: VoiceProcessorSettings = {
  noiseReduction: false,
  noiseReductionAmount: 50,
  deEss: false,
  deEssAmount: 30,
  compressor: false,
  compressorThreshold: -24,
  compressorRatio: 12,
  gate: false,
  gateThreshold: -40,
  nectar: false,
};

interface VoiceProcessorsProps {
  settings: VoiceProcessorSettings;
  onChange: (settings: VoiceProcessorSettings) => void;
  trackName: string;
}

export const VoiceProcessors: React.FC<VoiceProcessorsProps> = ({ settings, onChange, trackName }) => {
  const [expanded, setExpanded] = useState(false);

  const updateProcessor = (key: keyof VoiceProcessorSettings, value: any) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Mic className="w-4 h-4" />
          Processadores de Voz
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Recolher" : "Expandir"}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-4">
          {/* Noise Reduction */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4" />
              <Label>Redução de Ruído</Label>
            </div>
            <Switch
              checked={settings.noiseReduction}
              onCheckedChange={(checked) => updateProcessor('noiseReduction', checked)}
            />
          </div>
          {settings.noiseReduction && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Intensidade: {settings.noiseReductionAmount}%</Label>
              <Slider
                value={[settings.noiseReductionAmount]}
                onValueChange={([value]) => updateProcessor('noiseReductionAmount', value)}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* De-Ess */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4" />
              <Label>De-Ess</Label>
            </div>
            <Switch
              checked={settings.deEss}
              onCheckedChange={(checked) => updateProcessor('deEss', checked)}
            />
          </div>
          {settings.deEss && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Intensidade: {settings.deEssAmount}%</Label>
              <Slider
                value={[settings.deEssAmount]}
                onValueChange={([value]) => updateProcessor('deEssAmount', value)}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Compressor */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4" />
              <Label>Compressor</Label>
            </div>
            <Switch
              checked={settings.compressor}
              onCheckedChange={(checked) => updateProcessor('compressor', checked)}
            />
          </div>
          {settings.compressor && (
            <div className="pl-6 space-y-3">
              <div className="space-y-2">
                <Label className="text-sm">Threshold: {settings.compressorThreshold}dB</Label>
                <Slider
                  value={[settings.compressorThreshold]}
                  onValueChange={([value]) => updateProcessor('compressorThreshold', value)}
                  min={-60}
                  max={0}
                  step={1}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Ratio: {settings.compressorRatio}:1</Label>
                <Slider
                  value={[settings.compressorRatio]}
                  onValueChange={([value]) => updateProcessor('compressorRatio', value)}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Gate */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <Label>Gate</Label>
            </div>
            <Switch
              checked={settings.gate}
              onCheckedChange={(checked) => updateProcessor('gate', checked)}
            />
          </div>
          {settings.gate && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Threshold: {settings.gateThreshold}dB</Label>
              <Slider
                value={[settings.gateThreshold]}
                onValueChange={([value]) => updateProcessor('gateThreshold', value)}
                min={-60}
                max={0}
                step={1}
                className="w-full"
              />
            </div>
          )}
          
          {/* Nectar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <Label>Nectar (iZotope)</Label>
            </div>
            <Switch
              checked={settings.nectar}
              onCheckedChange={(checked) => updateProcessor('nectar', checked)}
            />
          </div>

          {/* Presets */}
          <div className="flex justify-center gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange(defaultVoiceProcessors)}
            >
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange({
                noiseReduction: true,
                noiseReductionAmount: 60,
                deEss: true,
                deEssAmount: 40,
                compressor: true,
                compressorThreshold: -18,
                compressorRatio: 3,
                gate: true,
                gateThreshold: -45,
              })}
            >
              Voz Limpa
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange({
                noiseReduction: false,
                noiseReductionAmount: 0,
                deEss: false,
                deEssAmount: 0,
                compressor: true,
                compressorThreshold: -12,
                compressorRatio: 6,
                gate: false,
                gateThreshold: -40,
              })}
            >
              Podcast
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
