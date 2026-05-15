#!/usr/bin/env python3
"""Simple test script to verify the fix"""

import sys
import os

# Add core to path
core_dir = os.path.join(os.path.dirname(__file__), 'core')
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

print("="*70)
print("TESTANDO CORRECAO DO ERRO ASYNC")
print("="*70)
print()

try:
    print("1. Carregando variaveis de ambiente...")
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print("   OK: .env carregado")
    print("   OK: GEMINI_API_KEY configurada:", bool(os.getenv('GEMINI_API_KEY')))
    print()
    
    print("2. Importando TTSGenerator...")
    from tts_generator import TTSGenerator
    print("   OK: Importacao bem-sucedida")
    print()
    
    print("3. Inicializando TTSGenerator...")
    tts = TTSGenerator()
    print("   OK: TTSGenerator inicializado")
    print()
    
    print("4. Testando geracao de audio com Google Gemini...")
    print("   Texto: 'Ola! Esta e uma voz de teste do Google Gemini.'")
    print("   Voz: Zephyr")
    print()
    
    audio_data = tts.generate_speech(
        text="Ola! Esta e uma voz de teste do Google Gemini.",
        voice_model="Zephyr",
        api="google"
    )
    
    print("   OK: Audio gerado com sucesso! Tamanho:", len(audio_data), "bytes")
    print()
    
    test_file = "teste_fix.wav"
    with open(test_file, "wb") as f:
        f.write(audio_data)
    print("   OK: Arquivo salvo:", test_file)
    print()
    
    print("="*70)
    print("TESTE CONCLUIDO COM SUCESSO!")
    print("="*70)
    
except Exception as e:
    print()
    print("ERRO:", type(e).__name__, ":", str(e))
    import traceback
    traceback.print_exc()
    sys.exit(1)
