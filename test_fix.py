#!/usr/bin/env python3
"""Test script to verify the fix for the async iterator error"""

import sys
import os

# Add core to path
core_dir = os.path.join(os.path.dirname(__file__), 'core')
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

print("="*70)
print("TESTANDO CORREÇÃO DO ERRO ASYNC")
print("="*70 + "\n")

try:
    print("1. Carregando variáveis de ambiente...")
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print(f"   ✓ .env carregado: {env_path}")
    print(f"   ✓ GEMINI_API_KEY configurada: {bool(os.getenv('GEMINI_API_KEY'))}")
    print()
    
    print("2. Importando TTSGenerator...")
    from tts_generator import TTSGenerator
    print("   ✓ Importação bem-sucedida!")
    print()
    
    print("3. Inicializando TTSGenerator...")
    tts = TTSGenerator()
    print("   ✓ TTSGenerator inicializado com sucesso!")
    print()
    
    print("4. Testando geração de áudio com Google Gemini...")
    print("   Texto: 'Olá! Esta é uma voz de teste do Google Gemini.'")
    print("   Voz: Zephyr")
    print()
    
    audio_data = tts.generate_speech(
        text="Olá! Esta é uma voz de teste do Google Gemini.",
        voice_model="Zephyr",
        api="google"
    )
    
    print(f"   ✓ Áudio gerado com sucesso! ({len(audio_data)} bytes)")
    print()
    
    # Salvar o arquivo de teste
    test_file = "teste_fix.wav"
    with open(test_file, "wb") as f:
        f.write(audio_data)
    print(f"   ✓ Arquivo salvo: {test_file}")
    print()
    
    print("="*70)
    print("✓ TESTE CONCLUÍDO COM SUCESSO!")
    print("="*70)
    
except Exception as e:
    print(f"\n✗ ERRO: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
