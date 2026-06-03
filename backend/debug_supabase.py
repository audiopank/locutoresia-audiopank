import os
from dotenv import load_dotenv

# Carregar .env do diretório pai
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
print(f"Tentando carregar: {env_path}")
print(f"Existe? {os.path.exists(env_path)}")

if os.path.exists(env_path):
    load_dotenv(env_path, override=True)
    print("\n=== Variáveis de ambiente NEWPOST ===")
    print(f"NEWPOST_SUPABASE_URL: {os.getenv('NEWPOST_SUPABASE_URL')}")
    print(f"NEWPOST_SUPABASE_SERVICE_KEY: {os.getenv('NEWPOST_SUPABASE_SERVICE_KEY')[:30]}...")
    print(f"NEWPOST_SUPABASE_ANON_KEY: {os.getenv('NEWPOST_SUPABASE_ANON_KEY')[:30]}...")

print("\n=== Tentando fazer requisição de teste ===")
import requests
supabase_url = os.getenv('NEWPOST_SUPABASE_URL', '').rstrip('/')
supabase_key = os.getenv('NEWPOST_SUPABASE_SERVICE_KEY', '')

if not supabase_url or not supabase_key:
    print("❌ Variáveis faltando!")
else:
    headers = {
        'apikey': supabase_key,
        'Authorization': f'Bearer {supabase_key}',
        'Content-Type': 'application/json'
    }
    
    print(f"\nURL da requisição: {supabase_url}/rest/v1/newpost_profiles?select=*")
    
    try:
        response = requests.get(
            f"{supabase_url}/rest/v1/newpost_profiles?select=*&limit=1",
            headers=headers,
            timeout=10
        )
        print(f"Status code: {response.status_code}")
        print(f"Resposta: {response.text}")
        
        if response.status_code == 200:
            print("✅ Funcionou!")
        else:
            print("❌ Erro na requisição")
    except Exception as e:
        print(f"❌ Exceção: {e}")
