import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Wand2, Volume2, Clock, Zap, Sparkles } from "lucide-react";

export interface TrackEffectsSettings {
  reverb: boolean;
  reverbAmount: number;
  delay: boolean;
  delayTime: number;
  distortion: boolean;
  distortionAmount: number;
  pitch: boolean;
  pitchAmount: number;
  nectar: boolean;
}

export const defaultEffects: TrackEffectsSettings = {
  reverb: false,
  reverbAmount: 30,
  delay: false,
  delayTime: 250,
  distortion: false,
  distortionAmount: 20,
  pitch: false,
  pitchAmount: 0,
  nectar: false,
};

interface TrackEffectsProps {
  effects: TrackEffectsSettings;
  onChange: (effects: TrackEffectsSettings) => void;
  trackName: string;
}

export const TrackEffects: React.FC<TrackEffectsProps> = ({ effects, onChange, trackName }) => {
  const [expanded, setExpanded] = useState(false);

  const updateEffect = (key: keyof TrackEffectsSettings, value: any) => {
    onChange({
      ...effects,
      [key]: value,
    });
  };

  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Wand2 className="w-4 h-4" />
          Efeitos de Áudio
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
          {/* Reverb */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4" />
              <Label>Reverb</Label>
            </div>
            <Switch
              checked={effects.reverb}
              onCheckedChange={(checked) => updateEffect('reverb', checked)}
            />
          </div>
          {effects.reverb && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Intensidade: {effects.reverbAmount}%</Label>
              <Slider
                value={[effects.reverbAmount]}
                onValueChange={([value]) => updateEffect('reverbAmount', value)}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Delay */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <Label>Delay</Label>
            </div>
            <Switch
              checked={effects.delay}
              onCheckedChange={(checked) => updateEffect('delay', checked)}
            />
          </div>
          {effects.delay && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Tempo: {effects.delayTime}ms</Label>
              <Slider
                value={[effects.delayTime]}
                onValueChange={([value]) => updateEffect('delayTime', value)}
                min={50}
                max={1000}
                step={10}
                className="w-full"
              />
            </div>
          )}

          {/* Distortion */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <Label>Distortion</Label>
            </div>
            <Switch
              checked={effects.distortion}
              onCheckedChange={(checked) => updateEffect('distortion', checked)}
            />
          </div>
          {effects.distortion && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Intensidade: {effects.distortionAmount}%</Label>
              <Slider
                value={[effects.distortionAmount]}
                onValueChange={([value]) => updateEffect('distortionAmount', value)}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Pitch */}
          <div className="flex items-center justify-between">
            <Label>Pitch Shift</Label>
            <Switch
              checked={effects.pitch}
              onCheckedChange={(checked) => updateEffect('pitch', checked)}
            />
          </div>
          {effects.pitch && (
            <div className="pl-6 space-y-2">
              <Label className="text-sm">Semitons: {effects.pitchAmount > 0 ? '+' : ''}{effects.pitchAmount}</Label>
              <Slider
                value={[effects.pitchAmount]}
                onValueChange={([value]) => updateEffect('pitchAmount', value)}
                min={-12}
                max={12}
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
              checked={effects.nectar}
              onCheckedChange={(checked) => updateEffect('nectar', checked)}
            />
          </div>
        </div>
      )}
    </Card>
  );
};
