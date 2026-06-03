
import os
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

# Adicionar diretório core ao path
import sys
core_dir = os.path.join(os.path.dirname(__file__), 'core')
sys.path.insert(0, core_dir)

from tts_generator import TTSGenerator

print("Inicializando TTS Generator...")
generator = TTSGenerator()

print("\nGerando áudio...")
try:
    audio_data = generator.generate_speech(
        text="Olá! Este é um teste de voz com LMNT. Espero que funcione perfeitamente!",
        voice_model="Zephyr",
        api="auto"
    )
    
    # Salvar arquivo de teste
    test_file = "test_audio.wav"
    with open(test_file, 'wb') as f:
        f.write(audio_data)
    
    print(f"\n✅ Áudio gerado com sucesso! Salvo em: {test_file}")
    
except Exception as e:
    print(f"\n❌ Erro: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
