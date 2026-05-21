"""
Debug detalhado do fluxo do NewsAgent
"""

import os
from dotenv import load_dotenv
from backend.news_agent import NewsAgent
from backend.supabase_news_log import SupabaseNewsLog

def debug_news_agent_flow():
    """Debug passo a passo do NewsAgent"""
    
    print("🔍 DEBUG DO NEWSAGENT FLOW")
    print("=" * 50)
    
    # Carregar variáveis
    load_dotenv('.env.local', override=True)
    
    # Inicializar componentes
    supabase_log = SupabaseNewsLog()
    
    print(f"Supabase Log habilitado: {supabase_log.enabled}")
    
    # Criar agente
    try:
        agent = NewsAgent()
        print("✅ NewsAgent criado")
        
        # Testar coleta de uma fonte só
        print("\n🧪 TESTANDO COLETA SIMPLES...")
        
        # Simular dados de notícia
        test_news_data = {
            "title": "Notícia de Teste Debug",
            "url": "https://debug-test.com/noticia-unica-12345",
            "snippet": "Conteúdo de teste para debug do fluxo",
            "source": "Fonte Debug",
            "published_at": "2026-04-20T14:00:00Z",
            "category": "teste"
        }
        
        print(f"Dados de teste: {test_news_data}")
        
        # Testar normalize_news
        print("\n1. Testando normalize_news...")
        processed = agent.news_utils.normalize_news(test_news_data)
        print(f"   Processado: {processed}")
        
        # Testar verificação de duplicata
        print("\n2. Testando verificação de duplicata...")
        is_duplicate = supabase_log.ja_foi_postada(processed["source_url"])
        print(f"   URL: {processed['source_url']}")
        print(f"   É duplicata? {is_duplicate}")
        
        if not is_duplicate:
            print("\n3. Testando save_to_supabase...")
            success, msg = agent.news_utils.save_to_supabase(processed)
            print(f"   Sucesso: {success}")
            print(f"   Mensagem: {msg}")
            
            if success:
                print("\n4. Testando registrar_noticia...")
                noticia_log = {
                    'url': processed["source_url"],
                    'titulo': processed["title"],
                    'fonte': processed["source"],
                    'categoria': processed["category"]
                }
                registered = supabase_log.registrar_noticia(noticia_log, agente='debug')
                print(f"   Registrado: {registered}")
            else:
                print("   ❌ Falha no save_to_supabase")
        else:
            print("   ⚠️ Notícia já existe (duplicata)")
        
    except Exception as e:
        print(f"❌ Erro no debug: {e}")
        import traceback
        traceback.print_exc()

def test_direct_supabase_insert():
    """Testa inserção direta no Supabase"""
    
    print("\n🔌 TESTE DIRETO SUPABASE")
    print("=" * 50)
    
    load_dotenv('.env.local', override=True)
    
    from supabase import create_client
    
    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    supabase = create_client(supabase_url, service_key)
    
    # Testar inserção direta
    test_data = {
        "titulo": "Teste Direto Supabase",
        "url": "https://teste-direto.com/noticia-67890",
        "fonte": "Teste Direto",
        "categoria": "debug",
        "status": "publicada",
        "agente_origem": "debug_direct",
        "created_at": "2026-04-20T14:00:00.000Z"
    }
    
    try:
        result = supabase.table('news_log').insert(test_data).execute()
        print("✅ Inserção direta bem-sucedida!")
        print(f"   Resultado: {result}")
    except Exception as e:
        print(f"❌ Erro na inserção direta: {e}")

if __name__ == "__main__":
    debug_news_agent_flow()
    test_direct_supabase_insert()
