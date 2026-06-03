
import os
from dotenv import load_dotenv

load_dotenv()

LMNT_API_KEY = os.getenv("LMNT_API_KEY")
print(f"LMNT Key: {LMNT_API_KEY[:10]}...")

try:
    from lmnt.api import Speech
    speech = Speech(LMNT_API_KEY)
    
    print("Gerando voz...")
    response = speech.synthesize(
        text="Olá! Este é um teste direto com LMNT!",
        voice="09e2f15b-1f6b-4bdf-bcbe-8fa04c0b4938",  # Voz default masculina pt-BR
        format="wav"
    )
    
    print(f"Response keys: {list(response.keys())}")
    
    with open("test_lmnt_direct.wav", "wb") as f:
        f.write(response["audio"])
    
    print("✅ Arquivo test_lmnt_direct.wav criado com sucesso!")
    
except Exception as e:
    print(f"❌ Erro: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
