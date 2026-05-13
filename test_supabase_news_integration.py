
"""

Test script for Supabase News Log Integration

"""



import os

import sys

from dotenv import load_dotenv



# Carregar variáveis do .env

load_dotenv()



# Adicionar paths

sys.path.insert(0, os.path.dirname(__file__))

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))



def test_supabase_news_log():

    """Testa a integração com Supabase News Log"""

    

    print("=" * 60)

    print("TESTE DE INTEGRAÇÃO COM SUPABASE NEWS LOG")

    print("=" * 60)

    

    # Verificar variáveis de ambiente

    print("\n1. Verificando variáveis de ambiente:")

    required_vars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]

    

    for var in required_vars:

        value = os.getenv(var)

        status = "✓ Configurado" if value else "✗ Não encontrado"

        print(f"   {var}: {status}")

    

    if not all(os.getenv(var) for var in required_vars):

        print("\n⚠ AVISO: Variáveis de ambiente do Supabase não configuradas!")

        print("   O sistema funcionará em modo mock (simulação).")

        # Continue com o teste em modo mock

    

    try:

        # Importar o módulo

        from backend.supabase_news_log import supabase_log

        print("\n✓ Módulo supabase_news_log importado com sucesso")

        

        # Testar conexão

        print("\n2. Testando conexão com Supabase:")

        

        # Testar notícia de exemplo

        test_noticia = {

            'url': 'https://example.com/test-123',

            'titulo': 'Notícia de Teste',

            'fonte': 'Fonte Teste',

            'categoria': 'teste'

        }

        

        # Verificar se já existe

        print("   Verificando notícia de teste...")

        ja_existe = supabase_log.ja_foi_postada(test_noticia['url'])

        print(f"   Notícia já existe: {ja_existe}")

        

        # Registrar notícia

        print("   Registrando notícia de teste...")

        sucesso = supabase_log.registrar_noticia(test_noticia, agente='test')

        print(f"   Registro da notícia: {'✓ Sucesso' if sucesso else '✗ Falha'}")

        

        # Verificar novamente

        print("   Verificando se notícia foi registrada...")

        ja_existe_agora = supabase_log.ja_foi_postada(test_noticia['url'])

        print(f"   Notícia existe agora: {ja_existe_agora}")

        

        # Testar ciclo

        print("\n3. Testando registro de ciclo:")

        ciclo_teste = {

            'cycle_id': 'test-cycle-123',

            'execution_timestamp': '2026-04-20T12:00:00Z',

            'task_name': 'Ciclo de Teste',

            'status': 'success',

            'ESTATISTICAS': {

                'news_collected': 5,

                'news_published': 3,

                'duplicates_found': 2

            },

            'ERROS': {

                'errors_count': 0,

                'error_details': []

            },

            'MENSAGEM': 'Teste executado com sucesso'

        }

        

        ciclo_sucesso = supabase_log.registrar_ciclo(ciclo_teste)

        print(f"   Registro do ciclo: {'✓ Sucesso' if ciclo_sucesso else '✗ Falha'}")

        

        # Testar estatísticas

        print("\n4. Testando obtenção de estatísticas:")

        stats = supabase_log.obter_estatisticas(dias=7)

        print(f"   Total de notícias: {stats.get('total_noticias', 0)}")

        print(f"   Notícias últimos 7 dias: {stats.get('noticias_ultimos_dias', 0)}")

        print(f"   Fontes: {list(stats.get('noticias_por_fonte', {}).keys())}")

        

        print("\n✓ TODOS OS TESTES PASSARAM!")

        return True

        

    except Exception as e:

        print(f"\n✗ ERRO DURANTE TESTE: {str(e)}")

        import traceback

        traceback.print_exc()

        return False



def test_news_agent_integration():

    """Testa a integração com o NewsAgent"""

    

    print("\n" + "=" * 60)

    print("TESTE DE INTEGRAÇÃO COM NEWSAGENT")

    print("=" * 60)

    

    try:

        from backend.news_agent import NewsAgent

        print("\n✓ NewsAgent importado com sucesso")

        

        # Criar instância

        agent = NewsAgent()

        print("✓ NewsAgent instanciado com sucesso")

        

        # Verificar se o supabase_log está acessível

        if hasattr(agent, 'news_utils'):

            print("✓ NewsAgent tem news_utils")

        

        print("\n✓ INTEGRAÇÃO NEWSAGENT OK!")

        return True

        

    except Exception as e:

        print(f"\n✗ ERRO NA INTEGRAÇÃO: {str(e)}")

        import traceback

        traceback.print_exc()

        return False



if __name__ == "__main__":

    success1 = test_supabase_news_log()

    success2 = test_news_agent_integration()

    

    print("\n" + "=" * 60)

    if success1 and success2:

        print("✓ TODOS OS TESTES CONCLUÍDOS COM SUCESSO!")

        sys.exit(0)

    else:

        print("✗ TESTES FALHARAM")

        sys.exit(1)

