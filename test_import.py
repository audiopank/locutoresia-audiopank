import sys
import os

print("sys.path:", sys.path)
print("\n---")

# Adicionar o caminho do core
base_dir = os.path.dirname(os.path.abspath(__file__))
core_dir = os.path.join(base_dir, 'core')
backend_dir = os.path.join(base_dir, 'backend')

sys.path.insert(0, base_dir)
sys.path.insert(0, backend_dir)
sys.path.insert(0, core_dir)

print("\nDepois de adicionar caminhos:")
print("sys.path:", sys.path)
print("\n---")

try:
    print("Tentando importar core.tts_generator...")
    from core.tts_generator import TTSGenerator
    print("✅ Importou core.tts_generator com sucesso!")
    
    tts = TTSGenerator()
    print(f"✅ TTSGenerator inicializado com sucesso!")
    print(f"   Modelo: {tts.gemini_model}")
    
except Exception as e:
    print(f"❌ Erro: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
