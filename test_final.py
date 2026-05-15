#!/usr/bin/env python3
"""Simple test without emojis"""

import sys
import os

core_dir = os.path.join(os.path.dirname(__file__), 'core')
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

print("="*70)
print("TESTE FINAL")
print("="*70)
print()

try:
    print("1. Loading .env...")
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print("   OK")
    print("   GEMINI_API_KEY exists:", bool(os.getenv('GEMINI_API_KEY')))
    print()
    
    print("2. Importing TTSGenerator...")
    from tts_generator import TTSGenerator
    print("   OK")
    print()
    
    print("3. Initializing TTSGenerator...")
    tts = TTSGenerator()
    print("   OK")
    print()
    
    print("4. Generating audio...")
    audio_data = tts.generate_speech(
        text="Ola! Este e um teste de voz do Google Gemini.",
        voice_model="Zephyr",
        api="google"
    )
    
    print("   OK! Audio size:", len(audio_data), "bytes")
    print()
    
    test_file = "teste_final.wav"
    with open(test_file, "wb") as f:
        f.write(audio_data)
    print("5. File saved:", test_file)
    print()
    
    print("="*70)
    print("SUCESSO!")
    print("="*70)
    
except Exception as e:
    print()
    print("ERRO:", type(e).__name__)
    print("Message:", str(e))
    import traceback
    traceback.print_exc()
    sys.exit(1)
