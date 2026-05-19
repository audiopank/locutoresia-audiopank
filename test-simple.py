"""
Teste simples da aplicação em producao
"""

import requests

def test_simple():
    base_url = "https://locutoresia-iej7.vercel.app/"
    
    print("=== TESTE SIMPLES ===")
    print(f"URL: {base_url}")
    
    try:
        # Testar pagina principal
        response = requests.get(base_url, timeout=10)
        print(f"Pagina Principal: {response.status_code}")
        
        # Testar endpoints LMNT
        endpoints = [
            "/api/lmnt/status",
            "/api/lmnt/voices",
            "/api/test-env"
        ]
        
        for endpoint in endpoints:
            try:
                response = requests.get(base_url + endpoint, timeout=10)
                print(f"{endpoint}: {response.status_code}")
                if response.status_code == 200:
                    print(f"  Resposta: {response.text[:100]}...")
            except Exception as e:
                print(f"{endpoint}: ERRO - {e}")
                
    except Exception as e:
        print(f"ERRO GERAL: {e}")

if __name__ == "__main__":
    test_simple()
