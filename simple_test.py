import os
import sys
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# Adicionar diretório core ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.tts_generator import TTSGenerator, save_binary_file

print("Inicializando TTS Generator...")
tts = TTSGenerator()

text = """Olá! Este é um teste do novo gerador de vozes do Gemini 3.1 Flash TTS Preview!"""

print(f"Gerando áudio com voz Sadachbia...")
audio_data = tts._generate_with_gemini(text, "Sadachbia", "normal", "pt-BR")

output_file = "teste_gemini.mp3"
with open(output_file, "wb") as f:
    f.write(audio_data)

print(f"✅ Áudio gerado com sucesso! Salvo como {output_file}")
print(f"   Tamanho: {len(audio_data)} bytes")
