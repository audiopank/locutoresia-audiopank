
import os
import requests

# Todas as URLs e chaves que temos
urls = [
    "https://hzmtdfojctctvgqjdbex.supabase.co",
    "https://ykswhzqdjoshjoaruhqs.supabase.co"
]

service_keys = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bXRkZm9qY3RjdHZncWpkYmV4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxMDgyNiwiZXhwIjoyMDg3MTg2ODI2fQ.jnVoRruRPlMpcskHU0ofEdH5hEY8_5tvT89HT6lKWK8",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrc3doenFkam9zaGpvYXJ1aHFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzMxNDMwOCwiZXhwIjoyMDkyODkwMzA4fQ.QAHywO5Uu70dmcMQM7t7EslEqZG4y79-kLUIxPR81RM"
]

anon_keys = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bXRkZm9qY3RjdHZncWpkYmV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDUwMTIsImV4cCI6MjA3OTIyMTAxMn0.bv_6SFc_vNnw_eIyD73xNsRVXtL0guSbMRNuCthIy4Q",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrc3doenFkam9zaGpvYXJ1aHFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTA4MjYsImV4cCI6MjA4NzE4NjgyNn0.yzezm6VZ5U_O7Txaj8B4_TD0PFVSpjZspYcZ1CYD0jo"
]

print("=" * 80)
print("TESTANDO TODAS AS COMBINAÇÕES DE URL + CHAVES SUPABASE")
print("=" * 80)

for url in urls:
    for key_type, keys in [("SERVICE_KEY", service_keys), ("ANON_KEY", anon_keys)]:
        for key in keys:
            print(f"\n--- Testando {key_type} com URL {url} ---")
            
            headers = {
                'apikey': key,
                'Authorization': f'Bearer {key}',
                'Content-Type': 'application/json'
            }
            
            try:
                # Tentar acessar a tabela newpost_profiles
                response = requests.get(
                    f"{url}/rest/v1/newpost_profiles?select=*&limit=1",
                    headers=headers,
                    timeout=5
                )
                
                print(f"  Status Code: {response.status_code}")
                
                if response.status_code == 200:
                    print("  ✅ FUNCIONOU!")
                    print("  Resposta:", response.text[:200])
                    print("\n" + "="*80)
                    print("COMBINAÇÃO CORRETA ENCONTRADA!")
                    print("URL:", url)
                    print(f"{key_type}:", key[:50] + "..." if len(key) > 50 else key)
                    print("="*80)
                elif response.status_code == 401:
                    print("  ❌ Chave inválida")
                else:
                    print(f"  Resposta: {response.text[:100]}")
                    
            except Exception as e:
                print(f"  ❌ Erro: {e}")

print("\n--- FIM DO TESTE ---")
