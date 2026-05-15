#!/usr/bin/env python3
"""Test script to verify the TTS deployment"""

import sys
import os

# Add core to path
core_dir = os.path.join(os.path.dirname(__file__), 'core')
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

print("="*70)
print("TESTE DE DEPLOYMENT - GERADOR TTS MULTI-API")
print("="*70 + "\n")

try:
    print("1. Testando importação do TTSGenerator...")
    from tts_generator import TTSGenerator, get_tts_generator
    print("   ✓ Importação bem-sucedida!\n")
    
    print("2. Verificando dependências...")
    import google.genai
    print("   ✓ google-genai OK")
    
    try:
        import elevenlabs
        print("   ✓ elevenlabs OK")
    except ImportError:
        print("   ⚠️  elevenlabs não instalado (opcional)")
    
    try:
        import pydub
        print("   ✓ pydub OK")
    except ImportError:
        print("   ⚠️  pydub não instalado (opcional para ElevenLabs)")
    
    print()
    
    print("3. Verificando mapeamento de vozes...")
    from tts_generator import GOOGLE_VOICE_MAP, ELEVENLABS_VOICE_MAP, STYLE_MAP
    print(f"   ✓ Vozes Google: {list(GOOGLE_VOICE_MAP.keys())}")
    print(f"   ✓ Vozes ElevenLabs: {list(ELEVENLABS_VOICE_MAP.keys())}")
    print(f"   ✓ Estilos: {list(STYLE_MAP.keys())}")
    print()
    
    print("="*70)
    print("✓ TESTE DE DEPLOYMENT CONCLUÍDO COM SUCESSO!")
    print("="*70)
    print("\nPróximos passos:")
    print("- Configure suas chaves API no arquivo .env ou variáveis de ambiente:")
    print("  - GEMINI_API_KEY='sua-chave-google'")
    print("  - ELEVENLABS_API_KEY='sua-chave-elevenlabs'")
    print("- Inicie o servidor Flask: python backend/app.py")
    
except Exception as e:
    print(f"\n✗ ERRO NO TESTE: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
