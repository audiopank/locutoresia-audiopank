
import requests

url = "http://127.0.0.1:5000/api/generate-audio"
data = {
    "text": "Olá! Este é um teste do Locutores IA funcionando localmente!",
    "voice": "Zephyr",
    "style": "normal",
    "language": "pt-BR",
    "api": "auto"
}

print("Enviando requisição para", url)
print("Dados:", data)
print("-"*60)

try:
    response = requests.post(url, json=data, timeout=60)
    
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
    
    if response.status_code == 200 and response.json().get("success"):
        print("\n✅ REQUISIÇÃO FUNCIONOU!")
        print("Download URL:", response.json()["download_url"])
        
except Exception as e:
    print(f"\n❌ ERRO: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
