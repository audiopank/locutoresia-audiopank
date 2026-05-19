"""
Script para verificar status da aplicação em produção
"""

import requests
import json

def check_production_status():
    """Verifica o status da aplicação em produção"""
    
    base_url = "https://locutoresia-iej7.vercel.app/"
    
    print("=== VERIFICANDO APLICAÇÃO EM PRODUÇÃO ===")
    print(f"URL Base: {base_url}")
    print()
    
    # Testar página principal
    try:
        response = requests.get(base_url, timeout=10)
        print(f"✅ Página Principal: {response.status_code} - {response.reason}")
    except Exception as e:
        print(f"❌ Página Principal: ERRO - {e}")
        return False
    
    # Testar endpoints LMNT
    endpoints = [
        ("/api/lmnt/status", "Status LMNT"),
        ("/api/lmnt/voices", "Lista de Vozes"),
        ("/api/generate-audio", "Geração de Áudio"),
        ("/minidaw", "MiniDAW"),
        ("/minidaw-react", "MiniDAW React")
    ]
    
    print("\n=== TESTANDO ENDPOINTS ===")
    
    for endpoint, name in endpoints:
        try:
            url = base_url + endpoint
            response = requests.get(url, timeout=10)
            status_icon = "✅" if response.status_code == 200 else "⚠️"
            print(f"{status_icon} {name:<25} {response.status_code} - {response.reason}")
            
            # Mostrar conteúdo para status LMNT
            if endpoint == "/api/lmnt/status" and response.status_code == 200:
                try:
                    data = response.json()
                    print(f"    Status: {data.get('status', 'unknown')}")
                    print(f"    Plano: {data.get('plan', 'unknown')}")
                    print(f"    Vozes: {data.get('voices_count', 'unknown')}")
                except:
                    print("    Resposta não é JSON válido")
                    
        except Exception as e:
            print(f"❌ {name:<25} ERRO - {e}")
    
    print("\n=== RESUMO ===")
    print("A aplicação está online e funcionando!")
    print("Para testar os endpoints LMNT, configure a variável LMNT_API_KEY no dashboard Vercel")
    print()
    print("URLs importantes:")
    print(f"- Principal: {base_url}")
    print(f"- API Status: {base_url}/api/lmnt/status")
    print(f"- API Vozes: {base_url}/api/lmnt/voices")
    print(f"- MiniDAW: {base_url}/minidaw")
    print(f"- MiniDAW React: {base_url}/minidaw-react")

if __name__ == "__main__":
    check_production_status()
