"""
Script para testar se as variáveis de ambiente estão configuradas na Vercel
"""

import requests
import json

def test_vercel_environment():
    """Testa as variáveis de ambiente na Vercel"""
    
    base_url = "https://locutoresia-iej7.vercel.app/"
    
    print("=== TESTANDO VARIÁVEIS DE AMBIENTE NA VERCEL ===")
    print(f"URL: {base_url}/api/test-env")
    print()
    
    try:
        response = requests.get(f"{base_url}/api/test-env", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            print("VARIÁVEIS DE AMBIENTE:")
            env_vars = data.get('environment_variables', {})
            for var, status in env_vars.items():
                icon = "Configurada" if status else "Não configurada"
                print(f"  {var}: {icon}")
            
            print(f"\nLMNT SDK Import: {'Sucesso' if data.get('lmnt_import_success') else 'Falha'}")
            if data.get('lmnt_import_error'):
                print(f"Erro LMNT: {data['lmnt_import_error']}")
            
            print(f"\nPython Version: {data.get('python_version', 'N/A')}")
            print(f"Working Directory: {data.get('working_directory', 'N/A')}")
            print(f"Vercel Environment: {env_vars.get('VERCEL_ENV', 'N/A')}")
            
            # Verificar se LMNT está configurado
            if env_vars.get('LMNT_API_KEY'):
                print("\n=== RESULTADO ===")
                print("A variável LMNT_API_KEY está configurada!")
                print("Aguarde 2-3 minutos para o deploy completar.")
                print("Depois teste: https://locutoresia-iej7.vercel.app/api/lmnt/status")
            else:
                print("\n=== PROBLEMA ===")
                print("A variável LMNT_API_KEY NÃO está configurada!")
                print("Verifique no dashboard Vercel:")
                print("1. Settings > Environment Variables")
                print("2. Adicione: LMNT_API_KEY = ak_AbZv3CzqvsHjHxRFj4oL9h")
                print("3. Salve e aguarde redeploy")
                
        else:
            print(f"ERRO: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"ERRO DE CONEXÃO: {e}")
        print("Verifique se a aplicação está online")

if __name__ == "__main__":
    test_vercel_environment()
