
import os
import sys
from dotenv import load_dotenv

load_dotenv()

core_dir = os.path.join(os.path.dirname(__file__), 'core')
sys.path.insert(0, core_dir)

from tts_generator import TTSGenerator

print("="*60)
print("TESTE FINAL - GOOGLE E ELEVENLABS")
print("="*60)

print("\n[1] Inicializando TTSGenerator...")
generator = TTSGenerator()

test_text = "Olá! Este é um teste profissional do Locutores IA com vozes de qualidade!"

print("\n" + "-"*60)
print("[2] Testando Google Gemini (prioridade)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="google")
    with open("test_google_final.wav", "wb") as f:
        f.write(audio)
    print("✅ Google Gemini FUNCIONOU! Arquivo test_google_final.wav")
except Exception as e:
    print(f"⚠️ Google falhou: {e}")

print("\n" + "-"*60)
print("[3] Testando ElevenLabs...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="elevenlabs")
    with open("test_elevenlabs_final.wav", "wb") as f:
        f.write(audio)
    print("✅ ElevenLabs FUNCIONOU! Arquivo test_elevenlabs_final.wav")
except Exception as e:
    print(f"⚠️ ElevenLabs falhou: {e}")

print("\n" + "-"*60)
print("[4] Testando API AUTO (deve usar Google/ElevenLabs)...")
try:
    audio = generator.generate_speech(test_text, voice_model="Zephyr", api="auto")
    with open("test_auto_final.wav", "wb") as f:
        f.write(audio)
    print("✅ API AUTO FUNCIONOU! Arquivo test_auto_final.wav")
except Exception as e:
    print(f"⚠️ API AUTO falhou: {e}")

print("\n" + "="*60)
print("TESTE CONCLUÍDO!")
print("="*60)
