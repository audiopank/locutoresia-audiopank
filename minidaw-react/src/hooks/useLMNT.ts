import { useState, useCallback } from "react"
import { useToast } from "./useToast"

interface SynthesizeResult {
  audioUrl: string
  id: string
}

interface CloneResult {
  id: string
  name: string
}

export const useLMNT = () => {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const synthesizeSpeech = useCallback(
    async (text: string, voiceId: string, language: string = 'pt'): Promise<SynthesizeResult> => {
      setIsLoading(true)
      try {
        // Use backend API endpoint
        const response = await fetch('/api/generate-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text,
            voice: voiceId,
            language: language === 'pt' ? 'pt-BR' : language,
            style: 'professional',
            provider: 'auto'
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Erro ao gerar áudio');
        }

        const result = await response.json();
        return {
          audioUrl: result.download_url,
          id: result.voice_id || voiceId
        };
      } catch (error: any) {
        console.error("Error synthesizing speech:", error)
        toast({
          title: "Erro ao sintetizar fala",
          description: error.message || "Não foi possível gerar o áudio",
          variant: "destructive"
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [toast]
  )

  const cloneVoice = useCallback(
    async (name: string, audioBase64: string, description?: string): Promise<CloneResult | null> => {
      setIsLoading(true)
      try {
        // Use backend API endpoint for LMNT voice cloning
        const response = await fetch('/api/lmnt/clone', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name,
            audio_data: audioBase64,
            description,
            enhance: true
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Erro ao clonar voz');
        }

        const result = await response.json();
        return {
          id: result.voice_id,
          name: result.name
        };
      } catch (error: any) {
        console.error("Error cloning voice:", error)
        toast({
          title: "Erro ao clonar voz",
          description: error.message || "Não foi possível criar o clone de voz",
          variant: "destructive"
        })
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [toast]
  )

  return {
    isLoading,
    synthesizeSpeech,
    cloneVoice
  }
}