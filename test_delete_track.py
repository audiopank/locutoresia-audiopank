import requests
import json

# Testar exclusão de uma trilha padrão (ex: id 1)
print("Testando exclusão de trilha padrão (id 1)...")
try:
    response = requests.delete('http://127.0.0.1:5000/api/tracks/1')
    print(f"Status code: {response.status_code}")
    print(f"Resposta: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
except Exception as e:
    print(f"Erro: {e}")

print("\nTestando carregamento de trilhas...")
try:
    response = requests.get('http://127.0.0.1:5000/api/tracks')
    print(f"Status code: {response.status_code}")
    data = response.json()
    print(f"Resposta completa: {json.dumps(data, indent=2, ensure_ascii=False)}")
except Exception as e:
    print(f"Erro: {e}")

