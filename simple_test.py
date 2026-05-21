import os
from dotenv import load_dotenv

load_dotenv('.env.local', override=True)

print("Carregadas variáveis de ambiente")
print(f"SUPABASE_URL: {os.getenv('SUPABASE_URL')}")
print(f"SUPABASE_SERVICE_ROLE_KEY: {os.getenv('SUPABASE_SERVICE_ROLE_KEY')}")
print(f"NEWPOST_SUPABASE_URL: {os.getenv('NEWPOST_SUPABASE_URL')}")

# Testar importar SupabaseNewsLog
print("\nImportando SupabaseNewsLog...")
from backend.supabase_news_log import SupabaseNewsLog
supabase_log = SupabaseNewsLog()
print(f"Supabase enabled: {supabase_log.enabled}")

# Testar importar NewsAgent
print("\nImportando NewsAgent...")
from backend.news_agent import NewsAgent
agent = NewsAgent()
print("OK")

# Testar normalize_news
test_data = {
    "title": "Teste Simples",
    "url": "https://teste.com/123",
    "snippet": "Conteúdo de teste",
    "source": "Fonte Teste",
    "published_at": "2026-05-21T14:00:00Z",
    "category": "teste"
}

print("\nTestando normalize_news...")
processed = agent.news_utils.normalize_news(test_data)
print(processed)
