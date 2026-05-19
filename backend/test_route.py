"""
Script de teste para verificar rotas do backend
"""

import requests
import json

def test_routes():
    """Testa todas as rotas principais"""
    base_url = "https://locutoresia-iej7.vercel.app/"
    
    routes_to_test = [
        "/",
        "/busca",
        "/noticias", 
        "/painel",
        "/contato",
        "/minidaw",
        "/minidaw-react",
        "/api/news/status",
        "/api/generate-audio"
    ]
    
    results = {}
    
    for route in routes_to_test:
        try:
            response = requests.get(f"{base_url}{route}", timeout=10)
            results[route] = {
                "status_code": response.status_code,
                "success": response.status_code == 200,
                "content_length": len(response.text) if response.status_code == 200 else 0
            }
            print(f"✅ {route}: {response.status_code}")
        except Exception as e:
            results[route] = {
                "status_code": "ERROR",
                "success": False,
                "error": str(e)
            }
            print(f"❌ {route}: {str(e)}")
    
    # Salvar resultados
    with open("route_test_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print("\n=== RESUMO DOS TESTES ===")
    success_count = sum(1 for r in results.values() if r.get("success"))
    print(f"Rotas funcionando: {success_count}/{len(routes_to_test)}")
    print(f"Resultados salvos em: route_test_results.json")

if __name__ == "__main__":
    test_routes()
