import sys
import os

core_dir = os.path.join(os.path.dirname(__file__), 'core')
if core_dir not in sys.path:
    sys.path.insert(0, core_dir)

print("TESTE MINIMAL")
print()

try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print("1. .env carregado")
    print("   GEMINI_API_KEY:", os.getenv('GEMINI_API_KEY')[:20] if os.getenv('GEMINI_API_KEY') else 'None', "...")
    print()
    
    from tts_generator import TTSGenerator
    print("2. TTSGenerator importado")
    print()
    
    tts = TTSGenerator()
    print("3. TTSGenerator inicializado")
    print()
    
    print("TUDO OK!")
    
except Exception as e:
    print()
    print("ERRO:", type(e).__name__)
    print(str(e))
    import traceback
    traceback.print_exc()
    sys.exit(1)
