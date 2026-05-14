#!/usr/bin/env python3

import os
import sys

# Adicionar o diretório do projeto ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.tts_generator import TTSGenerator

def test_tts():
    print("=" * 60)
    print("Teste do Gerador de Vozes - Gemini 3.1 Flash TTS Preview")
    print("=" * 60)
    
    tts = TTSGenerator()
    
    test_text = """Febre, coceira intensa e bolinhas vermelhas pelo corpo podem ser sinais de catapora.
A doença é transmitida principalmente pelo ar, através da fala, da tosse e do espirro.
Ao perceber os sintomas, procure uma unidade de saúde e evite locais públicos até a recuperação completa.
E lembre-se: a vacinação é a principal forma de prevenção e está disponível para os grupos prioritários conforme o calendário vacinal.
Procure a UBS mais próxima e informe-se."""
    
    test_cases = [
        ("Sadachbia", "normal"),
        ("Puck", "cheerful"),
        ("Charon", "serious"),
        ("Adam", "fast")
    ]
    
    for i, (voice, style) in enumerate(test_cases, 1):
        print(f"\nTeste {i}: Voz={voice}, Estilo={style}")
        print("-" * 60)
        try:
            audio_data = tts._generate_with_gemini(test_text, voice, style, "pt-BR")
            
            output_file = f"test_voice_{voice}_{style}.mp3"
            
            with open(output_file, "wb") as f:
                f.write(audio_data)
            
            print(f"✅ Sucesso! Arquivo salvo: {output_file}")
            print(f"   Tamanho: {len(audio_data)} bytes")
            
        except Exception as e:
            print(f"❌ Erro: {e}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "=" * 60)
    print("Testes concluídos!")
    print("=" * 60)

if __name__ == "__main__":
    test_tts()
