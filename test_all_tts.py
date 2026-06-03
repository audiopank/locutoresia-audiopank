
import os
import sys
from dotenv import load_dotenv

load_dotenv()

core_dir = os.path.join(os.path.dirname(__file__), 'core')
sys.path.insert(0, core_dir)

from tts_generator import TTSGenerator

print("="*60)
print("TESTE DE TODOS OS MÉTODOS TTS")
print("="*60)

print("\n[1] Inicializando TTSGenerator...")
try:
    generator = TTSGenerator()
    print("✅ TTSGenerator inicializado com sucesso!")
except Exception as e:
    print(f"❌ ERRO: {e}")
    sys.exit(1)

test_text = "Olá! Este é um teste profissional de voz com o Locutores IA!"

# Testar LMNT (padrão)
print("\n" + "-"*60)
print("[2] Testando LMNT (padrão profissional)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="lmnt")
    with open("test_lmnt.wav", "wb") as f:
        f.write(audio)
    print("✅ LMNT funcionou! Arquivo salvo como test_lmnt.wav")
except Exception as e:
    print(f"⚠️ LMNT falhou: {e}")

# Testar EdgeTTS
print("\n" + "-"*60)
print("[3] Testando EdgeTTS (gratuito)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="edge")
    with open("test_edge.wav", "wb") as f:
        f.write(audio)
    print("✅ EdgeTTS funcionou! Arquivo salvo como test_edge.wav")
except Exception as e:
    print(f"⚠️ EdgeTTS falhou: {e}")

# Testar Google (opcional)
print("\n" + "-"*60)
print("[4] Testando Google Gemini (opcional)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="google")
    with open("test_google.wav", "wb") as f:
        f.write(audio)
    print("✅ Google Gemini funcionou! Arquivo salvo como test_google.wav")
except Exception as e:
    print(f"⚠️ Google Gemini falhou: {e}")

# Testar ElevenLabs (opcional)
print("\n" + "-"*60)
print("[5] Testando ElevenLabs (opcional)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="elevenlabs")
    with open("test_elevenlabs.wav", "wb") as f:
        f.write(audio)
    print("✅ ElevenLabs funcionou! Arquivo salvo como test_elevenlabs.wav")
except Exception as e:
    print(f"⚠️ ElevenLabs falhou: {e}")

print("\n" + "="*60)
print("TESTE CONCLUÍDO!")
print("="*60)
