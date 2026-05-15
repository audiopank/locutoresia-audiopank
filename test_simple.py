import sys
import os

print("TESTE SIMPLES")
print()

try:
    from dotenv import load_dotenv
    load_dotenv()
    print("1. .env carregado")
    print("   GEMINI_API_KEY:", "OK" if os.getenv('GEMINI_API_KEY') else "NOT FOUND")
    print()
    
    from tts_generator import TTSGenerator
    print("2. TTSGenerator importado")
    print()
    
    tts = TTSGenerator()
    print("3. TTSGenerator inicializado")
    print()
    
    print("SUCESSO!")
    
except Exception as e:
    print()
    print("ERRO:", type(e).__name__)
    print(str(e))
    import traceback
    traceback.print_exc()
    sys.exit(1)
