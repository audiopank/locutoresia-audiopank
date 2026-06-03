
import os
from dotenv import load_dotenv
load_dotenv()

try:
    from google import genai
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    
    print("Listando modelos disponíveis...")
    for model in client.models.list():
        print(f"  - {model.name}")
        
except Exception as e:
    print(f"Erro: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
