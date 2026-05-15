"""
GERADOR TTS MULTI-API - Locutores IA
Suporta Google Gemini TTS E ElevenLabs
Escolha qual API usar para cada voz!

Instalação:
    pip install google-genai elevenlabs

Configuração:
    export GEMINI_API_KEY="sua-chave-google"
    export ELEVENLABS_API_KEY="sua-chave-elevenlabs"
"""

import asyncio
import io
import mimetypes
import os
import struct
from typing import Literal
from google import genai
from google.genai import types

# ElevenLabs (opcional)
try:
    from elevenlabs.client import ElevenLabs
    from elevenlabs import stream
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False


# ============================================================================
# MAPEAMENTO DE VOZES - GOOGLE GEMINI TTS
# ============================================================================

GOOGLE_VOICE_MAP = {
    # Todas as vozes do Google Gemini TTS (30 opções)
    "Zephyr": "Zephyr",
    "Puck": "Puck",
    "Charon": "Charon",
    "Kore": "Kore",
    "Fenrir": "Fenrir",
    "Leda": "Leda",
    "Orus": "Orus",
    "Aoede": "Aoede",
    "Callirrhoe": "Callirrhoe",
    "Autonoe": "Autonoe",
    "Enceladus": "Enceladus",
    "Iapetus": "Iapetus",
    "Umbriel": "Umbriel",
    "Algieba": "Algieba",
    "Despina": "Despina",
    "Erinome": "Erinome",
    "Algenib": "Algenib",
    "Rasalgethi": "Rasalgethi",
    "Laomedeia": "Laomedeia",
    "Achernar": "Achernar",
    "Alnilam": "Alnilam",
    "Schedar": "Schedar",
    "Gacrux": "Gacrux",
    "Pulcherrima": "Pulcherrima",
    "Achird": "Achird",
    "Zubenelgenubi": "Zubenelgenubi",
    "Vindemiatrix": "Vindemiatrix",
    "Sadachbia": "Sadachbia",
    "Sadaltager": "Sadaltager",
    "Sulafat": "Sulafat",
    # Aliases para compatibilidade
    "Alex Professional": "Zephyr",
    # Fallback
    "default": "Zephyr",
}

# ============================================================================
# MAPEAMENTO DE VOZES - ELEVENLABS
# ============================================================================

ELEVENLABS_VOICE_MAP = {
    # Vozes ElevenLabs (IDs reais)
    "Alex Professional": "adam",          # Masculino, profissional
    "Charon": "onyx",                     # Masculino, profundo
    "Puck": "arnold",                     # Masculino, jovem
    "Leda": "bella",                      # Feminino, claro
    "Zephyr": "adam",                     # Masculino, natural
    
    # Aliases adicionais
    "Elena": "emma",                      # Feminino
    "Mateus": "onyx",                     # Masculino
    "Lucas": "arnold",                    # Masculino jovem
    "Isabella": "bella",                  # Feminino
    "Adam": "adam",                       # Masculino
    "Liv": "liv",                         # Feminino
    "Chris": "chris",                     # Masculino
    "Patrick": "patrick",                 # Masculino
    
    # Fallback
    "default": "adam",
}

# ============================================================================
# MAPEAMENTO DE ESTILOS
# ============================================================================

STYLE_MAP = {
    "normal":   {"temperature": 1.0,    "stability": 0.5},
    "fast":     {"temperature": 0.8,    "stability": 0.7},
    "slow":     {"temperature": 1.2,    "stability": 0.4},
    "cheerful": {"temperature": 1.3,    "stability": 0.5},
    "serious":  {"temperature": 0.7,    "stability": 0.8},
}


# ============================================================================
# CLASSE PRINCIPAL - TTSGenerator (MULTI-API)
# ============================================================================

class TTSGenerator:
    """
    Gerador TTS profissional com suporte a MÚLTIPLAS APIs.
    
    Suporta:
    - Google Gemini 3.1 Flash TTS (padrão)
    - ElevenLabs (opcional)
    
    Escolha qual API usar para cada voz!
    
    Exemplo de uso:
        >>> generator = TTSGenerator()
        >>> 
        >>> # Usar Google Gemini TTS (padrão)
        >>> audio = generator.generate_speech(
        ...     "Olá mundo!",
        ...     voice_model="Zephyr",
        ...     api="google"
        ... )
        >>> 
        >>> # Usar ElevenLabs (qualidade superior)
        >>> audio = generator.generate_speech(
        ...     "Olá mundo!",
        ...     voice_model="Elena",
        ...     api="elevenlabs"
        ... )
    """

    def __init__(self, google_api_key: str = None, elevenlabs_api_key: str = None):
        """
        Inicializa o gerador com suporte a múltiplas APIs.

        Parâmetros
        ----------
        google_api_key : str, optional
            API key do Google. Se não fornecido, usa GEMINI_API_KEY do ambiente.
        elevenlabs_api_key : str, optional
            API key do ElevenLabs. Se não fornecido, usa ELEVENLABS_API_KEY do ambiente.

        Levanta
        -------
        ValueError
            Se nenhuma API estiver disponível.
        """
        self.google_available = False
        self.elevenlabs_available = False
        
        # ==================== GOOGLE GEMINI ====================
        google_key = google_api_key or os.environ.get("GEMINI_API_KEY")
        if google_key:
            try:
                self.google_client = genai.Client(api_key=google_key)
                self.google_model = "gemini-3.1-flash-tts-preview"
                self.google_available = True
                print("✓ Google Gemini TTS disponível")
            except Exception as e:
                print(f"⚠️  Google Gemini TTS indisponível: {e}")
        
        # ==================== ELEVENLABS ====================
        elevenlabs_key = elevenlabs_api_key or os.environ.get("ELEVENLABS_API_KEY")
        if elevenlabs_key and ELEVENLABS_AVAILABLE:
            try:
                self.elevenlabs_client = ElevenLabs(api_key=elevenlabs_key)
                self.elevenlabs_available = True
                print("✓ ElevenLabs TTS disponível")
            except Exception as e:
                print(f"⚠️  ElevenLabs TTS indisponível: {e}")
        elif elevenlabs_key and not ELEVENLABS_AVAILABLE:
            print("⚠️  ElevenLabs API key configurada mas biblioteca não instalada")
            print("   Instale com: pip install elevenlabs")
        
        # ==================== VALIDAÇÃO ====================
        if not self.google_available and not self.elevenlabs_available:
            raise ValueError(
                "❌ Nenhuma API TTS disponível!\n"
                "Configure pelo menos uma:\n"
                "- Google: export GEMINI_API_KEY='sua-chave'\n"
                "- ElevenLabs: export ELEVENLABS_API_KEY='sua-chave'\n"
                "Obtenha chaves em:\n"
                "- Google: https://aistudio.google.com/\n"
                "- ElevenLabs: https://elevenlabs.io/\n"
            )

    def generate_speech(
        self,
        text: str,
        voice_model: str = "Zephyr",
        style: str = "normal",
        language: str = "pt-BR",
        api: Literal["google", "elevenlabs", "auto"] = "auto"
    ) -> bytes:
        """
        Gera áudio WAV a partir de texto usando a API especificada.

        Parâmetros
        ----------
        text : str
            Texto a ser convertido em fala
        voice_model : str, default "Zephyr"
            Modelo de voz a usar
        style : str, default "normal"
            Estilo de fala (normal, fast, slow, cheerful, serious)
        language : str, default "pt-BR"
            Código do idioma (pt-BR, en-US, es-ES)
        api : str, default "auto"
            Qual API usar: "google", "elevenlabs", ou "auto" (usa melhor disponível)

        Retorna
        -------
        bytes
            Conteúdo do arquivo WAV

        Levanta
        ------
        ValueError
            Se texto vazio ou API não disponível
        RuntimeError
            Se houver erro na síntese

        Exemplo
        -------
        >>> generator = TTSGenerator()
        
        >>> # Usar Google (padrão)
        >>> audio = generator.generate_speech("Olá!")
        
        >>> # Usar ElevenLabs (qualidade superior)
        >>> audio = generator.generate_speech(
        ...     "Olá!",
        ...     api="elevenlabs"
        ... )
        
        >>> # Deixar escolher automaticamente
        >>> audio = generator.generate_speech(
        ...     "Olá!",
        ...     api="auto"
        ... )
        """
        # Validar texto
        if not text or not text.strip():
            raise ValueError("❌ Texto não pode estar vazio")

        # Determinar qual API usar
        if api == "auto":
            # Preferir ElevenLabs se disponível (melhor qualidade)
            if self.elevenlabs_available:
                api = "elevenlabs"
            elif self.google_available:
                api = "google"
            else:
                raise ValueError("❌ Nenhuma API TTS disponível")
        
        # Verificar se API está disponível
        if api == "google" and not self.google_available:
            raise ValueError("❌ Google Gemini TTS não disponível")
        if api == "elevenlabs" and not self.elevenlabs_available:
            raise ValueError("❌ ElevenLabs não disponível")

        # Log informativo
        print(f"🎙️  Gerando áudio com {api.upper()}...")
        print(f"    Voz: {voice_model}")
        print(f"    Estilo: {style}")

        # Chamar API apropriada
        try:
            if api == "google":
                return self._generate_google(text, voice_model, style, language)
            elif api == "elevenlabs":
                return self._generate_elevenlabs(text, voice_model, style)
            else:
                raise ValueError(f"API inválida: {api}")
        except Exception as e:
            print(f"❌ Erro ao gerar áudio: {e}")
            raise

    # ========================================================================
    # GOOGLE GEMINI TTS
    # ========================================================================

    def _generate_google(
        self,
        text: str,
        voice_model: str,
        style: str,
        language: str
    ) -> bytes:
        """Gera áudio com Google Gemini TTS."""
        voice = GOOGLE_VOICE_MAP.get(voice_model, GOOGLE_VOICE_MAP["default"])
        style_params = STYLE_MAP.get(style, STYLE_MAP["normal"])
        temperature = style_params["temperature"]

        audio_bytes = self._synthesize_google(text, voice, temperature, language)
        print(f"✓ Áudio gerado ({len(audio_bytes)} bytes)")
        return audio_bytes

    def _synthesize_google(
        self,
        text: str,
        voice: str,
        temperature: float,
        language: str
    ) -> bytes:
        """Síntese síncrona com Google Gemini."""
        try:
            generate_content_config = types.GenerateContentConfig(
                temperature=temperature,
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice
                        )
                    )
                ),
            )

            audio_data = io.BytesIO()
            
            response = self.google_client.models.generate_content(
                model=self.google_model,
                contents=text,
                config=generate_content_config,
            )
            
            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data.write(part.inline_data.data)

            audio_bytes = audio_data.getvalue()
            if not audio_bytes:
                raise RuntimeError("Nenhum dado de áudio recebido")

            mime_type = "audio/L16;rate=24000"
            wav_data = self._convert_to_wav(audio_bytes, mime_type)
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com Google: {str(e)}") from e

    # ========================================================================
    # ELEVENLABS TTS
    # ========================================================================

    def _generate_elevenlabs(
        self,
        text: str,
        voice_model: str,
        style: str
    ) -> bytes:
        """Gera áudio com ElevenLabs."""
        voice_id = ELEVENLABS_VOICE_MAP.get(voice_model, ELEVENLABS_VOICE_MAP["default"])
        style_params = STYLE_MAP.get(style, STYLE_MAP["normal"])

        try:
            # Gerar áudio com ElevenLabs
            audio_stream = self.elevenlabs_client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id="eleven_monolingual_v1",
                voice_settings={
                    "stability": style_params["stability"],
                    "similarity_boost": 0.75,
                }
            )

            # Coletar dados de áudio
            audio_data = io.BytesIO()
            for chunk in audio_stream:
                audio_data.write(chunk)

            audio_bytes = audio_data.getvalue()
            
            if not audio_bytes:
                raise RuntimeError("Nenhum áudio gerado pelo ElevenLabs")

            # ElevenLabs retorna MP3, converter para WAV
            wav_data = self._convert_mp3_to_wav(audio_bytes)
            print(f"✓ Áudio gerado ({len(wav_data)} bytes)")
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com ElevenLabs: {str(e)}") from e

    # ========================================================================
    # CONVERSÃO DE ÁUDIO
    # ========================================================================

    @staticmethod
    def _convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
        """Converte áudio PCM (Google) para WAV."""
        parameters = TTSGenerator._parse_audio_mime_type(mime_type)
        bits_per_sample = parameters["bits_per_sample"]
        sample_rate = parameters["rate"]
        num_channels = 1

        data_size = len(audio_data)
        bytes_per_sample = bits_per_sample // 8
        block_align = num_channels * bytes_per_sample
        byte_rate = sample_rate * block_align
        chunk_size = 36 + data_size

        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            chunk_size,
            b"WAVE",
            b"fmt ",
            16,
            1,
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b"data",
            data_size
        )

        return header + audio_data

    @staticmethod
    def _convert_mp3_to_wav(audio_data: bytes) -> bytes:
        """Converte MP3 (ElevenLabs) para WAV."""
        try:
            import pydub
            from pydub import AudioSegment
            
            # Converter MP3 para WAV
            audio = AudioSegment.from_mp3(io.BytesIO(audio_data))
            
            # Exportar como WAV
            wav_buffer = io.BytesIO()
            audio.export(
                wav_buffer,
                format="wav",
                parameters=["-q:a", "9"]
            )
            
            return wav_buffer.getvalue()
        except ImportError:
            print("⚠️  Biblioteca pydub não instalada")
            print("   Para usar ElevenLabs, instale: pip install pydub")
            print("   E ffmpeg: apt-get install ffmpeg")
            raise

    @staticmethod
    def _parse_audio_mime_type(mime_type: str) -> dict:
        """Parse de MIME type."""
        bits_per_sample = 16
        rate = 24000

        parts = mime_type.split(";")
        for param in parts:
            param = param.strip()
            
            if param.lower().startswith("rate="):
                try:
                    rate = int(param.split("=", 1)[1])
                except (ValueError, IndexError):
                    pass
            elif "L" in param:
                try:
                    bits_per_sample = int(param.split("L")[1].split(";")[0])
                except (ValueError, IndexError):
                    pass

        return {"bits_per_sample": bits_per_sample, "rate": rate}


# ============================================================================
# FUNÇÃO FACTORY
# ============================================================================

def get_tts_generator(
    google_api_key: str = None,
    elevenlabs_api_key: str = None
) -> TTSGenerator:
    """
    Factory function para criar um gerador TTS.
    
    Exemplo
    -------
    >>> generator = get_tts_generator()
    >>> audio = generator.generate_speech("Olá!")
    """
    try:
        return TTSGenerator(
            google_api_key=google_api_key,
            elevenlabs_api_key=elevenlabs_api_key
        )
    except ValueError as e:
        raise ValueError(str(e)) from e


# ============================================================================
# EXEMPLO DE USO
# ============================================================================

if __name__ == "__main__":
    import sys

    try:
        print("\n" + "=" * 70)
        print("NOVO GERADOR TTS - MULTI-API")
        print("Google Gemini + ElevenLabs")
        print("=" * 70 + "\n")

        # Inicializar
        print("Inicializando gerador TTS...")
        generator = get_tts_generator()
        print()

        # Exemplos
        exemplos = [
            {
                "text": "Olá! Usando Google Gemini TTS.",
                "voice": "Zephyr",
                "api": "google",
                "file": "exemplo_google.wav"
            },
            {
                "text": "Olá! Usando ElevenLabs TTS.",
                "voice": "Elena",
                "api": "elevenlabs",
                "file": "exemplo_elevenlabs.wav"
            },
            {
                "text": "Este exemplo deixa a API escolher automaticamente.",
                "voice": "Leda",
                "api": "auto",
                "file": "exemplo_auto.wav"
            },
        ]

        print("Gerando exemplos...\n")
        
        for idx, exemplo in enumerate(exemplos, 1):
            try:
                print(f"[{idx}/{len(exemplos)}] {exemplo['file']}")
                
                audio_data = generator.generate_speech(
                    text=exemplo['text'],
                    voice_model=exemplo['voice'],
                    api=exemplo['api']
                )

                with open(exemplo['file'], "wb") as f:
                    f.write(audio_data)

                print(f"      ✓ Salvo: {exemplo['file']}\n")

            except Exception as e:
                print(f"      ✗ Erro: {e}\n")
                continue

        print("=" * 70)
        print("✓ Exemplos gerados com sucesso!")
        print("=" * 70 + "\n")

    except ValueError as e:
        print(f"✗ Erro de Configuração:\n  {e}\n", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"✗ Erro inesperado:\n  {e}\n", file=sys.stderr)
        sys.exit(1)