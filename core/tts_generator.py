# To run this code you need to install the following dependencies:
# pip install google-genai elevenlabs python-dotenv edge-tts gtts pyttsx3

import mimetypes
import os
import re
import struct
import requests
import asyncio
import io
import threading

# Importar pyttsx3 se disponível
try:
    import pyttsx3
except ImportError:
    pyttsx3 = None

# Carregar variáveis de ambiente do arquivo .env
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass  # python-dotenv não está instalado


class TTSGenerator:
    """Classe para gerar áudio usando ElevenLabs como principal e Google Gemini como fallback"""
    
    def __init__(self):
        self.elevenlabs_api_key = os.environ.get("ELEVENLABS_API_KEY")
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY")
        self.gemini_client = None
        self.gemini_model = "gemini-3.1-flash-tts-preview"
        self.elevenlabs_base_url = "https://api.elevenlabs.io/v1"
    
    def _get_gemini_client(self):
        """Inicializa o cliente Gemini apenas quando necessário"""
        from google import genai
        if self.gemini_client is None and self.gemini_api_key:
            self.gemini_client = genai.Client(api_key=self.gemini_api_key)
        return self.gemini_client
    
    def generate_speech(self, text, voice_model="Sadachbia", style="normal", language="pt-BR"):
        """Gera áudio a partir do texto — Gemini 3.1 Flash TTS é a PRINCIPAL opção!"""
        
        # 1. PRIMEIRA OPÇÃO: Google Gemini 3.1 Flash TTS Preview (MAIN)
        if self.gemini_api_key and self.gemini_api_key.strip():
            try:
                print(f"🎤 Usando Gemini 3.1 Flash TTS Preview com voz: {voice_model}")
                return self._generate_with_gemini(text, voice_model, style, language)
            except Exception as e:
                print(f"⚠️ Gemini não disponível: {e}")
        
        # 2. SEGUNDA OPÇÃO: Edge TTS (gratuita e rápida)
        try:
            print(f"🎤 Usando Edge TTS com voz: {voice_model}")
            return self._generate_with_edge_tts(text, voice_model, style, language)
        except Exception as e:
            print(f"⚠️ Edge TTS não disponível: {e}")
        
        # 3. TERCEIRA OPÇÃO: GTTS (confiável)
        try:
            print(f"🎤 Usando GTTS com voz: {voice_model}")
            return self._generate_with_gtts(text, voice_model, style, language)
        except Exception as e:
            print(f"⚠️ GTTS não disponível: {e}")
        
        # 4. QUARTA OPÇÃO: ElevenLabs (fallback)
        if self.elevenlabs_api_key and self.elevenlabs_api_key.strip():
            try:
                print(f"🎤 Usando ElevenLabs com voz: {voice_model}")
                return self._generate_with_elevenlabs(text, voice_model, style, language)
            except Exception as e:
                print(f"⚠️ ElevenLabs não disponível: {e}")
        
        # 5. ÚLTIMO RECURSO: gerador WAV sintético
        try:
            print(f"🎤 Usando gerador WAV sintético")
            return self._generate_synthetic_wav(text, voice_model, style, language)
        except Exception as e:
            print(f"❌ Erro ao gerar áudio sintético: {e}")
            raise Exception("Não foi possível gerar áudio com nenhum dos serviços disponíveis")
    
    def _generate_with_edge_tts(self, text, voice_model, style, language):
        """Gera áudio usando Edge TTS (gratuito)"""
        import edge_tts
        
        # Mapear vozes para Edge TTS
        voice_mapping = {
            "Adam": "en-US-GuyNeural",
            "Bella": "en-US-AriaNeural",
            "Antonio": "pt-BR-AntonioNeural",
            "Elli": "pt-BR-FranciscaNeural",
            "Dom": "pt-BR-DanielNeural",
            "Rachel": "en-US-JennyNeural",
            "Drew": "en-US-BrandonNeural",
            "Clyde": "en-US-GuyNeural",
            "Darcy": "en-US-AriaNeural",
            "Davis": "en-US-GuyNeural",
            "Charon": "pt-BR-AntonioNeural",
            "Puck": "pt-BR-FranciscaNeural"
        }
        
        # Obter voice_id ou usar padrão baseado no idioma
        if language.startswith("pt"):
            voice_id = voice_mapping.get(voice_model, "pt-BR-AntonioNeural")
        else:
            voice_id = voice_mapping.get(voice_model, "en-US-GuyNeural")
        
        # Configurar prosódia baseada no estilo
        style_mapping = {
            "normal": "",
            "fast": "rate='fast'",
            "slow": "rate='slow'",
            "cheerful": "style='cheerful'",
            "serious": "style='calm'"
        }
        
        prosody = style_mapping.get(style, "")
        
        # Adicionar tags de prosódia se necessário
        if prosody:
            ssml_text = f"<speak><prosody {prosody}>{text}</prosody></speak>"
        else:
            ssml_text = text
        
        # Gerar áudio de forma assíncrona
        async def generate_audio():
            communicate = edge_tts.Communicate(ssml_text, voice_id)
            audio_data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data += chunk["data"]
            return audio_data
        
        # Executar de forma síncrona
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            audio_data = loop.run_until_complete(generate_audio())
            return audio_data
        finally:
            loop.close()
    
    def _generate_with_elevenlabs(self, text, voice_model, style, language):
        """Gera áudio usando ElevenLabs"""
        
        # Mapear vozes para IDs do ElevenLabs
        voice_mapping = {
            "Adam": "pNInz6obpgDQGcFmaJgB",
            "Bella": "EXAVITFr4G3IvBVL4Yj7",
            "Antonio": "ErXwocaYrNsEHvI0yS9V",
            "Elli": "MF3mGyEYCl7XYWbV9V6O",
            "Dom": "AZnzlk1XvdvUeBnXmlld",
            "Rachel": "21m00Tcm4TlvDq8ikWAM",
            "Drew": "29vD33N1CtxCmqnbPO6J",
            "Clyde": "2EiwWnXFnvU5JhP7DgOZ",
            "Darcy": "jBpfuIE2ayCOgI5xRe6L",
            "Davis": "mZ3eS6nL1x7n7RjGjV2O"
        }
        
        # Mapear estilos para configurações do ElevenLabs
        style_settings = {
            "normal": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True},
            "fast": {"stability": 0.3, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True},
            "slow": {"stability": 0.7, "similarity_boost": 0.6, "style": 0.0, "use_speaker_boost": True},
            "cheerful": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": True},
            "serious": {"stability": 0.8, "similarity_boost": 0.7, "style": 0.0, "use_speaker_boost": True}
        }
        
        # Obter voice_id ou usar padrão
        voice_id = voice_mapping.get(voice_model, "pNInz6obpgDQGcFmaJgB")  # Adam como padrão
        
        # Obter configurações de estilo
        voice_settings = style_settings.get(style, style_settings["normal"])
        
        # Configurar modelo baseado no idioma
        # Usar modelos mais recentes disponíveis no plano gratuito
        if language.startswith("pt"):
            model_id = "eleven_multilingual_v2"
        else:
            model_id = "eleven_turbo_v2"
        
        # Fazer requisição para ElevenLabs
        url = f"{self.elevenlabs_base_url}/text-to-speech/{voice_id}"
        payload = {
            "text": text,
            "model_id": model_id,
            "voice_settings": voice_settings
        }
        
        headers = {
            "xi-api-key": self.elevenlabs_api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
        }
        
        response = requests.post(url, headers=headers, json=payload)
        
        if not response.ok:
            raise Exception(f"Erro na API ElevenLabs: {response.status_code} - {response.text}")
        
        return response.content
    
    def _generate_with_gemini(self, text, voice_model, style, language):
        """Gera áudio usando Google Gemini (fallback)"""
        from google.genai import types
        
        # Mapear estilos para instruções de voz
        style_instructions = {
            "normal": "Fale em tom normal e claro",
            "fast": "Fale em tom rápido",
            "slow": "Fale em tom lento e pausado",
            "cheerful": "Fale em tom alegre e festivo",
            "serious": "Fale em tom sério e profissional"
        }
        
        instruction = style_instructions.get(style, "Fale em tom normal e claro")
        full_text = f"""## Sample Context:
{instruction}

## Transcript:
{text}"""
        
        # Mapear vozes para prebuilt voices do Gemini
        voice_mapping = {
            "Charon": "Charon",
            "Puck": "Puck",
            "Sadachbia": "Sadachbia",
            "Adam": "Sadachbia",
            "Antonio": "Charon",
            "Dom": "Shamash",
            "Drew": "Fenrir",
            "Clyde": "Onyx",
            "Davis": "Vega",
            "Bella": "Puck",
            "Elli": "Kore",
            "Rachel": "Lira",
            "Darcy": "Nova",
            "Shamash": "Shamash",
            "Kore": "Kore",
            "Lira": "Lira",
            "Nova": "Nova",
            "Onyx": "Onyx",
            "Fenrir": "Fenrir",
            "Vega": "Vega"
        }
        
        selected_voice = voice_mapping.get(voice_model, "Sadachbia")
        
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=full_text),
                ],
            ),
        ]
        
        generate_content_config = types.GenerateContentConfig(
            temperature=1,
            response_modalities=[
                "audio",
            ],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=selected_voice
                    )
                )
            ),
        )
        
        # Coletar dados de áudio
        gemini_client = self._get_gemini_client()
        if not gemini_client:
            raise Exception("Cliente Gemini não disponível")
            
        audio_data = b""
        for chunk in gemini_client.models.generate_content_stream(
            model=self.gemini_model,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.parts is None:
                continue
                
            if chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
                inline_data = chunk.parts[0].inline_data
                data_buffer = inline_data.data
                file_extension = mimetypes.guess_extension(inline_data.mime_type)
                
                if file_extension is None:
                    file_extension = ".wav"
                    data_buffer = convert_to_wav(inline_data.data, inline_data.mime_type)
                
                audio_data += data_buffer
            else:
                if text_output := chunk.text:
                    print(text_output)
        
        return audio_data
    
    def _generate_synthetic_wav(self, text, voice_model, style, language):
        """Gera áudio WAV sintético básico como último recurso"""
        
        import math
        import numpy as np
        
        # Configurações básicas
        sample_rate = 22050
        duration_per_char = 0.1  # 100ms por caractere
        total_duration = len(text) * duration_per_char
        
        # Gerar áudio sintético baseado no texto
        num_samples = int(sample_rate * total_duration)
        
        # Criar ondas senoidais simples para simular fala
        audio_data = []
        
        for i, char in enumerate(text):
            # Mapear caractere para frequência (simplificado)
            if char.lower() in 'aeiou':
                base_freq = 300 + (ord(char.lower()) % 5) * 50
            elif char.lower() in 'bcdfghjklmnpqrstvwxyz':
                base_freq = 200 + (ord(char.lower()) % 21) * 30
            else:
                base_freq = 150  # para espaços e pontuação
            
            # Ajustar frequência baseada no estilo
            if style == "fast":
                base_freq *= 1.2
            elif style == "slow":
                base_freq *= 0.8
            elif style == "cheerful":
                base_freq *= 1.1
            elif style == "serious":
                base_freq *= 0.9
            
            # Gerar samples para este caractere
            char_samples = int(sample_rate * duration_per_char)
            t = np.linspace(0, duration_per_char, char_samples)
            
            # Adicionar envelope para suavizar
            envelope = np.exp(-3 * t)  # Exponential decay
            wave = envelope * np.sin(2 * np.pi * base_freq * t)
            
            # Adicionar um pouco de ruído para tornar mais natural
            noise = 0.05 * np.random.randn(len(wave))
            wave = wave + noise
            
            audio_data.extend(wave)
        
        # Converter para bytes WAV
        audio_data = np.array(audio_data, dtype=np.float32)
        
        # Normalizar para 16-bit
        audio_data = np.int16(audio_data * 32767)
        
        # Criar WAV header
        byte_depth = 2
        channels = 1
        byte_rate = sample_rate * channels * byte_depth
        block_align = channels * byte_depth
        data_size = len(audio_data) * byte_depth
        chunk_size = 36 + data_size
        
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",          # ChunkID
            chunk_size,       # ChunkSize
            b"WAVE",          # Format
            b"fmt ",          # Subchunk1ID
            16,               # Subchunk1Size
            1,                # AudioFormat (1 for PCM)
            channels,         # NumChannels
            sample_rate,      # SampleRate
            byte_rate,        # ByteRate
            block_align,      # BlockAlign
            16,               # BitsPerSample
            b"data",          # Subchunk2ID
            data_size         # Subchunk2Size
        )
        
        return header + audio_data.tobytes()
    
    def _generate_with_gtts(self, text, voice_model, style, language):
        """Gera áudio usando Google Text-to-Speech (GTTS) - vozes reais e gratuitas"""
        from gtts import gTTS
        
        # Mapear vozes para diferentes TLDs para criar variedade real
        voice_config = {
            # Vozes masculinas - diferentes TLDs para criar variedade
            "Adam": {"lang": "pt", "tld": "com.br"},
            "Drew": {"lang": "pt", "tld": "pt"},  # Portugal
            "Clyde": {"lang": "pt", "tld": "com.mx"},  # México com português
            "Davis": {"lang": "pt", "tld": "co"},  # Colômbia
            "Dom": {"lang": "pt", "tld": "com.ar"},  # Argentina
            "Antonio": {"lang": "pt", "tld": "es"},  # Espanha com português
            "Charon": {"lang": "pt", "tld": "fr"},  # França com português
            
            # Vozes femininas - TLDs diferentes
            "Bella": {"lang": "pt", "tld": "com.br"},
            "Elli": {"lang": "pt", "tld": "it"},  # Itália com português
            "Rachel": {"lang": "pt", "tld": "de"},  # Alemanha com português
            "Darcy": {"lang": "pt", "tld": "ca"},  # Canadá com português
            "Laura": {"lang": "pt", "tld": "com.au"},  # Austrália com português
            "Puck": {"lang": "pt", "tld": "co.uk"},  # Reino Unido com português
            
            # Vozes em inglês - diferentes sotaques
            "Roger": {"lang": "en", "tld": "com"},  # EUA
            "Sarah": {"lang": "en", "tld": "co.uk"},  # Reino Unido
            "George": {"lang": "en", "tld": "com.au"},  # Austrália
            "Charlie": {"lang": "en", "tld": "ca"},  # Canadá
            
            # Espanhol - diferentes sotaques
            "Javier": {"lang": "es", "tld": "es"},  # Espanha
            "Sofia": {"lang": "es", "tld": "com.mx"},  # México
            
            # Francês - diferentes sotaques
            "Pierre": {"lang": "fr", "tld": "fr"},  # França
            "Marie": {"lang": "fr", "tld": "ca"}  # Canadá francês
        }
        
        # Obter configuração da voz ou usar padrão
        config = voice_config.get(voice_model, {"lang": "pt", "tld": "com.br"})
        gtts_lang = config["lang"]
        tld = config["tld"]
        
        # Ajustar texto baseado no estilo
        processed_text = text
        if style == "slow":
            # Adicionar pausas para falar mais devagar
            processed_text = text.replace(".", ". ").replace(",", ", ")
        elif style == "fast":
            # Remover pausas para falar mais rápido
            processed_text = text.replace(". ", ".").replace(", ", ",")
        elif style == "cheerful":
            # Adicionar ênfase para tom alegre
            processed_text = f"!{text}!" if gtts_lang == "es" else f"!{text}!"
        elif style == "serious":
            # Manter texto normal para tom sério
            pass
        
        try:
            # Criar objeto GTTS com configuração específica para variedade real
            tts = gTTS(text=processed_text, lang=gtts_lang, slow=(style == "slow"), tld=tld)
            
            # Gerar áudio em bytes
            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_data = audio_buffer.getvalue()
            
            return audio_data
            
        except Exception as e:
            raise Exception(f"Erro ao gerar áudio com GTTS: {str(e)}")


def save_binary_file(file_name, data):
    f = open(file_name, "wb")
    f.write(data)
    f.close()
    print(f"File saved to to: {file_name}")


def generate():
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
    )

    model = "gemini-2.5-pro-preview-tts"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="""FALE EM TOM RÁPIDO E ALEGRE E FESTIVO

Atenção, Limoeiro do Norte.
A dengue é uma doença séria, mas pode ser evitada com cuidados simples no dia a dia.

Evite água parada em pratos de plantas, garrafas, pneus e caixas d’água abertas.
Mantenha tudo limpo e bem vedado.

Sem água parada, o mosquito não se multiplica. Faça a sua parte. Proteja sua família.

Prefeitura de Limoeiro do Norte
Secretaria de Saúde, em parceria com o SAAE."""),
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        temperature=1,
        response_modalities=[
            "audio",
        ],
        speech_config=types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=[
                    types.SpeakerVoiceConfig(
                        speaker="Speaker 1",
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name="Charon"
                            )
                        ),
                    ),
                    types.SpeakerVoiceConfig(
                        speaker="Speaker 2",
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name="Puck"
                            )
                        ),
                    ),
                ]
            ),
        ),
    )

    file_index = 0
    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        if (
            chunk.parts is None
        ):
            continue
        if chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
            file_name = f"ENTER_FILE_NAME_{file_index}"
            file_index += 1
            inline_data = chunk.parts[0].inline_data
            data_buffer = inline_data.data
            file_extension = mimetypes.guess_extension(inline_data.mime_type)
            if file_extension is None:
                file_extension = ".wav"
                data_buffer = convert_to_wav(inline_data.data, inline_data.mime_type)
            save_binary_file(f"{file_name}{file_extension}", data_buffer)
        else:
            if text := chunk.text:
                print(text)

def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    """Generates a WAV file header for the given audio data and parameters.

    Args:
        audio_data: The raw audio data as a bytes object.
        mime_type: Mime type of the audio data.

    Returns:
        A bytes object representing the WAV file header.
    """
    parameters = parse_audio_mime_type(mime_type)
    bits_per_sample = parameters["bits_per_sample"]
    sample_rate = parameters["rate"]
    num_channels = 1
    data_size = len(audio_data)
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    chunk_size = 36 + data_size  # 36 bytes for header fields before data chunk size

    # http://soundfile.sapp.org/doc/WaveFormat/

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",          # ChunkID
        chunk_size,       # ChunkSize (total file size - 8 bytes)
        b"WAVE",          # Format
        b"fmt ",          # Subchunk1ID
        16,               # Subchunk1Size (16 for PCM)
        1,                # AudioFormat (1 for PCM)
        num_channels,     # NumChannels
        sample_rate,      # SampleRate
        byte_rate,        # ByteRate
        block_align,      # BlockAlign
        bits_per_sample,  # BitsPerSample
        b"data",          # Subchunk2ID
        data_size         # Subchunk2Size (size of audio data)
    )
    return header + audio_data

def parse_audio_mime_type(mime_type: str) -> dict[str, int | None]:
    """Parses bits per sample and rate from an audio MIME type string.

    Assumes bits per sample is encoded like "L16" and rate as "rate=xxxxx".

    Args:
        mime_type: The audio MIME type string (e.g., "audio/L16;rate=24000").

    Returns:
        A dictionary with "bits_per_sample" and "rate" keys. Values will be
        integers if found, otherwise None.
    """
    bits_per_sample = 16
    rate = 24000

    # Extract rate from parameters
    parts = mime_type.split(";")
    for param in parts: # Skip the main type part
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate_str = param.split("=", 1)[1]
                rate = int(rate_str)
            except (ValueError, IndexError):
                # Handle cases like "rate=" with no value or non-integer value
                pass # Keep rate as default
        elif param.startswith("audio/L"):
            try:
                bits_per_sample = int(param.split("L", 1)[1])
            except (ValueError, IndexError):
                pass # Keep bits_per_sample as default if conversion fails

    return {"bits_per_sample": bits_per_sample, "rate": rate}


if __name__ == "__main__":
    generate()


