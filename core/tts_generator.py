import mimetypes
import os
import struct
import io

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass


class TTSGenerator:
    def __init__(self):
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY")
        self.gemini_client = None
        self.gemini_model = "gemini-3.1-flash-tts-preview"
    
    def _get_gemini_client(self):
        from google import genai
        if self.gemini_client is None and self.gemini_api_key:
            self.gemini_client = genai.Client(api_key=self.gemini_api_key)
        return self.gemini_client
    
    def generate_speech(self, text, voice_model="Sadachbia", style="normal", language="pt-BR"):
        print(f"🔍 Debug: generate_speech() chamado")
        print(f"🔍 Debug: GEMINI_API_KEY existe? {bool(self.gemini_api_key)}")
        if self.gemini_api_key:
            print(f"🔍 Debug: GEMINI_API_KEY não está vazio: {bool(self.gemini_api_key.strip())}")
        
        if self.gemini_api_key and self.gemini_api_key.strip():
            try:
                print(f"🎤 Usando Gemini TTS com voz: {voice_model}")
                return self._generate_with_gemini(text, voice_model, style)
            except Exception as e:
                print(f"⚠️ Gemini erro: {type(e).__name__}: {e}")
                import traceback
                print(f"⚠️ Stack trace Gemini: {traceback.format_exc()}")
        
        print(f"🔍 Debug: Indo para GTTS")
        try:
            print(f"🎤 Usando GTTS com voz: {voice_model}")
            return self._generate_with_gtts(text, style)
        except Exception as e:
            print(f"⚠️ GTTS erro: {e}")
            import traceback
            print(f"⚠️ Stack trace GTTS: {traceback.format_exc()}")
            raise Exception(f"Erro TTS: {e}")
    
    def _generate_with_gemini(self, text, voice_model, style):
        print(f"🔍 Debug: _generate_with_gemini() chamado")
        from google.genai import types
        
        style_instructions = {
            "normal": "Fale em tom normal",
            "fast": "Fale rápido",
            "slow": "Fale lento",
            "cheerful": "Fale alegre",
            "serious": "Fale sério"
        }
        
        voice_mapping = {
            "Charon": "Charon", "Puck": "Puck", "Sadachbia": "Sadachbia",
            "Adam": "Sadachbia", "Antonio": "Charon", "Dom": "Shamash"
        }
        
        instruction = style_instructions.get(style, "Fale normal")
        full_text = f"{instruction}\n\n{text}"
        selected_voice = voice_mapping.get(voice_model, "Sadachbia")
        print(f"🔍 Debug: Usando voz do Gemini: {selected_voice}")
        
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=full_text)])]
        
        config = types.GenerateContentConfig(
            temperature=1,
            response_modalities=["audio"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=selected_voice)
                )
            )
        )
        print(f"🔍 Debug: Configurando Gemini com modelo: {self.gemini_model}")
        
        gemini_client = self._get_gemini_client()
        audio_data = b""
        chunk_count = 0
        print(f"🔍 Debug: Iniciando geração de conteúdo do Gemini...")
        
        for chunk in gemini_client.models.generate_content_stream(model=self.gemini_model, contents=contents, config=config):
            chunk_count += 1
            print(f"🔍 Debug: Chunk #{chunk_count} recebido")
            if chunk.parts and chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
                inline_data = chunk.parts[0].inline_data
                data_buffer = inline_data.data
                file_extension = mimetypes.guess_extension(inline_data.mime_type)
                if file_extension is None:
                    data_buffer = convert_to_wav(inline_data.data, inline_data.mime_type)
                audio_data += data_buffer
                print(f"🔍 Debug: Adicionando {len(data_buffer)} bytes de áudio")
        
        print(f"🔍 Debug: Total de chunks: {chunk_count}, total de áudio: {len(audio_data)} bytes")
        return audio_data
    
    def _generate_with_gtts(self, text, style):
        from gtts import gTTS
        
        processed_text = text
        if style == "slow":
            processed_text = text.replace(".", ". ").replace(",", ", ")
        elif style == "fast":
            processed_text = text.replace(". ", ".").replace(", ", ",")
        
        tts = gTTS(text=processed_text, lang="pt", slow=(style == "slow"), tld="com.br")
        audio_buffer = io.BytesIO()
        tts.write_to_fp(audio_buffer)
        return audio_buffer.getvalue()


def save_binary_file(file_name, data):
    with open(file_name, "wb") as f:
        f.write(data)
    print(f"File saved: {file_name}")


def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    params = parse_audio_mime_type(mime_type)
    bits_per_sample = params["bits_per_sample"]
    sample_rate = params["rate"]
    data_size = len(audio_data)
    byte_rate = sample_rate * 2
    
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE", b"fmt ",
        16, 1, 1, sample_rate, byte_rate, 2, bits_per_sample, b"data", data_size
    )
    return header + audio_data


def parse_audio_mime_type(mime_type: str) -> dict:
    bits_per_sample = 16
    rate = 24000
    
    for param in mime_type.split(";"):
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate = int(param.split("=", 1)[1])
            except (ValueError, IndexError):
                pass
    
    return {"bits_per_sample": bits_per_sample, "rate": rate}


def generate():
    from google import genai
    from google.genai import types
    
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    model = "gemini-3.1-flash-tts-preview"
    
    contents = [types.Content(role="user", parts=[types.Part.from_text(text="""FALE EM TOM RÁPIDO E ALEGRE 

Atenção, Limoeiro do Norte.
A dengue é uma doença séria, mas pode ser evitada com cuidados simples.

Evite água parada em pratos, garrafas e pneus.
Mantenha tudo limpo e bem vedado.

Sem água parada, o mosquito não se multiplica.

Prefeitura de Limoeiro do Norte""")])]
    
    config = types.GenerateContentConfig(
        temperature=1,
        response_modalities=["audio"],
        speech_config=types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=[
                    types.SpeakerVoiceConfig(speaker="Speaker 1", voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Charon"))),
                    types.SpeakerVoiceConfig(speaker="Speaker 2", voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")))
                ]
            )
        )
    )
    
    file_index = 0
    for chunk in client.models.generate_content_stream(model=model, contents=contents, config=config):
        if chunk.parts and chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
            file_name = f"audio_{file_index}"
            file_index += 1
            data_buffer = chunk.parts[0].inline_data.data
            file_extension = mimetypes.guess_extension(chunk.parts[0].inline_data.mime_type) or ".wav"
            save_binary_file(f"{file_name}{file_extension}", data_buffer)


if __name__ == "__main__":
    generate()
