"""
GERADOR TTS MULTI-API - Locutores IA
Suporta Google Gemini TTS, ElevenLabs, E EdgeTTS (Gratuito!)
EdgeTTS é o padrão, pois é gratuito e não precisa de chave!

Instalação:
    pip install google-genai elevenlabs edge-tts

Configuração (opcional):
    export GEMINI_API_KEY="sua-chave-google"
    export ELEVENLABS_API_KEY="sua-chave-elevenlabs"
"""

import asyncio
import io
import mimetypes
import os
import struct
from typing import Literal

# EdgeTTS (Gratuito e padrão)
import edge_tts

# Google Gemini (opcional)
try:
    from google import genai
    from google.genai import types
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    GOOGLE_GENAI_AVAILABLE = False

# ElevenLabs (opcional)
try:
    from elevenlabs.client import ElevenLabs
    from elevenlabs import stream
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False


# ============================================================================
# MAPEAMENTO DE VOZES - EDGETTS (PADRÃO, GRATUITO!)
# ============================================================================

EDGE_VOICE_MAP = {
    # Vozes do Google Gemini mapeadas para EdgeTTS (pt-BR)
    "Zephyr": "pt-BR-AntonioNeural",
    "Puck": "pt-BR-FranciscaNeural",
    "Charon": "pt-BR-AntonioNeural",
    "Kore": "pt-BR-FranciscaNeural",
    "Fenrir": "pt-BR-AntonioNeural",
    "Leda": "pt-BR-FranciscaNeural",
    "Orus": "pt-BR-AntonioNeural",
    "Aoede": "pt-BR-FranciscaNeural",
    "Callirrhoe": "pt-BR-FranciscaNeural",
    "Autonoe": "pt-BR-FranciscaNeural",
    "Enceladus": "pt-BR-AntonioNeural",
    "Iapetus": "pt-BR-AntonioNeural",
    "Umbriel": "pt-BR-AntonioNeural",
    "Algieba": "pt-BR-FranciscaNeural",
    "Despina": "pt-BR-FranciscaNeural",
    "Erinome": "pt-BR-FranciscaNeural",
    "Algenib": "pt-BR-AntonioNeural",
    "Rasalgethi": "pt-BR-AntonioNeural",
    "Laomedeia": "pt-BR-FranciscaNeural",
    "Achernar": "pt-BR-FranciscaNeural",
    "Alnilam": "pt-BR-FranciscaNeural",
    "Schedar": "pt-BR-AntonioNeural",
    "Gacrux": "pt-BR-AntonioNeural",
    "Pulcherrima": "pt-BR-FranciscaNeural",
    "Achird": "pt-BR-FranciscaNeural",
    "Zubenelgenubi": "pt-BR-AntonioNeural",
    "Vindemiatrix": "pt-BR-AntonioNeural",
    "Sadachbia": "pt-BR-AntonioNeural",
    "Sadaltager": "pt-BR-FranciscaNeural",
    "Sulafat": "pt-BR-FranciscaNeural",
    # Aliases para compatibilidade
    "Alex Professional": "pt-BR-AntonioNeural",
    # Outros idiomas
    "en-US-GuyNeural": "en-US-GuyNeural",
    "en-US-JennyNeural": "en-US-JennyNeural",
    "es-ES-AlvaroNeural": "es-ES-AlvaroNeural",
    # Fallback
    "default": "pt-BR-AntonioNeural",
}

# Mapeamento de estilos para EdgeTTS
EDGE_STYLE_MAP = {
    "normal":   {"rate": "+0%",  "pitch": "+0Hz"},
    "fast":     {"rate": "+30%", "pitch": "+0Hz"},
    "slow":     {"rate": "-25%", "pitch": "-5Hz"},
    "cheerful": {"rate": "+10%", "pitch": "+10Hz"},
    "serious":  {"rate": "-10%", "pitch": "-10Hz"},
}

# ============================================================================
# MAPEAMENTO DE VOZES - GOOGLE GEMINI TTS (OPCIONAL)
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
        EdgeTTS é a padrão e gratuita!

        Parâmetros
        ----------
        google_api_key : str, optional
            API key do Google. Se não fornecido, usa GEMINI_API_KEY do ambiente.
        elevenlabs_api_key : str, optional
            API key do ElevenLabs. Se não fornecido, usa ELEVENLABS_API_KEY do ambiente.
        """
        self.google_available = False
        self.elevenlabs_available = False
        self.edge_available = True  # EdgeTTS está sempre disponível!
        
        print("✓ EdgeTTS (Gratuito) disponível como padrão!")
        
        # ==================== GOOGLE GEMINI (OPCIONAL) ====================
        google_key = google_api_key or os.environ.get("GEMINI_API_KEY")
        if google_key and GOOGLE_GENAI_AVAILABLE:
            try:
                self.google_client = genai.Client(api_key=google_key)
                self.google_model = "gemini-3.1-flash-tts-preview"
                self.google_available = True
                print("✓ Google Gemini TTS disponível (opcional)")
            except Exception as e:
                print(f"⚠️  Google Gemini TTS indisponível: {e}")
        
        # ==================== ELEVENLABS (OPCIONAL) ====================
        elevenlabs_key = elevenlabs_api_key or os.environ.get("ELEVENLABS_API_KEY")
        if elevenlabs_key and ELEVENLABS_AVAILABLE:
            try:
                self.elevenlabs_client = ElevenLabs(api_key=elevenlabs_key)
                self.elevenlabs_available = True
                print("✓ ElevenLabs TTS disponível (opcional)")
            except Exception as e:
                print(f"⚠️  ElevenLabs TTS indisponível: {e}")
        elif elevenlabs_key and not ELEVENLABS_AVAILABLE:
            print("⚠️  ElevenLabs API key configurada mas biblioteca não instalada")
            print("   Instale com: pip install elevenlabs")

    def generate_speech(
        self,
        text: str,
        voice_model: str = "Zephyr",
        style: str = "normal",
        language: str = "pt-BR",
        api: Literal["edge", "google", "elevenlabs", "auto"] = "auto"
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
            Qual API usar: "edge", "google", "elevenlabs", ou "auto" (usa EdgeTTS por padrão)

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
        
        >>> # Usar EdgeTTS (padrão e gratuito!)
        >>> audio = generator.generate_speech("Olá!")
        
        >>> # Usar Google Gemini
        >>> audio = generator.generate_speech("Olá!", api="google")
        
        >>> # Usar ElevenLabs (qualidade superior)
        >>> audio = generator.generate_speech("Olá!", api="elevenlabs")
        """
        # Validar texto
        if not text or not text.strip():
            raise ValueError("❌ Texto não pode estar vazio")

        # Determinar qual API usar
        if api == "auto":
            # EdgeTTS é o padrão (gratuito!)
            api = "edge"
        
        # Verificar se API está disponível
        if api == "google" and not self.google_available:
            raise ValueError("❌ Google Gemini TTS não disponível")
        if api == "elevenlabs" and not self.elevenlabs_available:
            raise ValueError("❌ ElevenLabs não disponível")
        # EdgeTTS sempre está disponível!

        # Log informativo
        print(f"🎙️  Gerando áudio com {api.upper()}...")
        print(f"    Voz: {voice_model}")
        print(f"    Estilo: {style}")

        # Chamar API apropriada
        try:
            if api == "edge":
                return self._generate_edge(text, voice_model, style, language)
            elif api == "google":
                return self._generate_google(text, voice_model, style, language)
            elif api == "elevenlabs":
                return self._generate_elevenlabs(text, voice_model, style)
            else:
                raise ValueError(f"API inválida: {api}")
        except Exception as e:
            print(f"❌ Erro ao gerar áudio: {e}")
            raise

    # ========================================================================
    # EDGETTS (PADRÃO, GRATUITO!)
    # ========================================================================

    def _generate_edge(
        self,
        text: str,
        voice_model: str,
        style: str,
        language: str
    ) -> bytes:
        """Gera áudio com EdgeTTS (gratuita!)."""
        voice = EDGE_VOICE_MAP.get(voice_model, EDGE_VOICE_MAP["default"])
        style_params = EDGE_STYLE_MAP.get(style, EDGE_STYLE_MAP["normal"])
        
        # Ajustar voz por idioma
        if language.startswith("en") and voice not in ["en-US-GuyNeural", "en-US-JennyNeural"]:
            voice = "en-US-GuyNeural"
        elif language.startswith("es") and voice not in ["es-ES-AlvaroNeural"]:
            voice = "es-ES-AlvaroNeural"
        
        audio_bytes = asyncio.run(self._synthesize_edge(text, voice, style_params["rate"], style_params["pitch"]))
        print(f"✓ Áudio gerado ({len(audio_bytes)} bytes)")
        return audio_bytes

    @staticmethod
    async def _synthesize_edge(text: str, voice: str, rate: str, pitch: str) -> bytes:
        """Síntese assíncrona com EdgeTTS."""
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
        buffer.seek(0)
        return buffer.read()

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