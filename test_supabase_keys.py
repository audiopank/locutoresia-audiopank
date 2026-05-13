#!/usr/bin/env python3
"""
Script para verificar qual chave do Supabase está funcionando
Testa anon key vs service_role key
"""

from supabase import create_client

# Configurações do projeto NewPost-IA
SUPABASE_URL = "https://ykswhzqdjoshjoaruhqs.supabase.co"

# Chaves para testar
CHAVES = {
    "Publishable (Anon)": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrc3doenFkam9zaGpvYXJ1aHFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTA4MjYsImV4cCI6MjA4NzE4NjgyNn0.yzezm6VZ5U_O7Txaj8B4_TD0PFVSpjZspYcZ1CYD0jo",
    "Service Role": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrc3doenFkam9zaGpvYXJ1aHFzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxMDgyNiwiZXhwIjoyMDg3MTg2ODI2fQ.jnVoRruRPlMpcskHU0ofEdH5hEY8_5tvT89HT6lKWK8"
}

print("="*70)
print("TESTE DE CHAVES SUPABASE - NewPost-IA")
print(f"URL: {SUPABASE_URL}")
print("="*70)

for nome_chave, chave in CHAVES.items():
    print(f"\n{'-'*70}")
    print(f"Testando: {nome_chave}")
    print(f"Chave: {chave[:50]}...")
    
    try:
        # Criar cliente
        supabase = create_client(SUPABASE_URL, chave)
        
        # Teste 1: Ler da tabela posts
        print("\n1. Testando LEITURA (select)...")
        result = supabase.table('posts').select('*').limit(1).execute()
        print(f"   ✅ LEITURA OK - Encontrados: {len(result.data)} registros")
        
        # Teste 2: Tentar inserir um registro de teste
        print("\n2. Testando ESCRITA (insert)...")
        test_data = {
            'title': 'Teste de Chave - ' + nome_chave,
            'content': 'Teste automatizado de verificação de chave',
            'source_url': 'https://teste.com',
            'category': 'teste',
            'status': 'draft',
            'author_id': '3a1a93d0-e451-47a4-a126-f1b7375895eb'
        }
        
        insert_result = supabase.table('posts').insert(test_data).execute()
        
        if insert_result.data:
            novo_id = insert_result.data[0].get('id')
            print(f"   ✅ ESCRITA OK - Post criado com ID: {novo_id}")
            
            # Limpar - deletar o post de teste
            print("\n3. Limpando teste (delete)...")
            supabase.table('posts').delete().eq('id', novo_id).execute()
            print(f"   ✅ LIMPEZA OK - Post de teste removido")
            
            print(f"\n🎉 CHAVE '{nome_chave}' FUNCIONA COMPLETAMENTE!")
        else:
            print(f"   ⚠️ ESCRITA retornou vazio")
            
    except Exception as e:
        erro_str = str(e)
        if "Invalid API key" in erro_str:
            print(f"   ❌ CHAVE INVÁLIDA: {erro_str}")
        elif "row-level security" in erro_str.lower() or "rls" in erro_str.lower():
            print(f"   ⚠️ RLS bloqueando: {erro_str[:100]}...")
        else:
            print(f"   ❌ ERRO: {erro_str[:150]}...")

print("\n" + "="*70)
print("RESUMO:")
print("- Service Role Key = Permissão total (leitura + escrita)")
print("- Anon Key = Geralmente só leitura (bloqueada por RLS)")
print("="*70)
