import os

"""
Configuração da NewPost-IA com Supabase
Credenciais fornecidas pelo usuário
"""

NEWPOST_CONFIG = {
    # Configurações da NewPost-IA REAL
    "url": os.getenv("NEWPOST_IA_URL", "https://plugpost-ai.lovable.app"),
    "api_endpoint": "/api/posts",
    "project_id": "71da61a3-9afe-44e1-903b-b696168bfa60",
    
    # Timeout da requisição (segundos)
    "timeout": 30,
    
    # Headers para NewPost-IA
    "headers": {
        "Content-Type": "application/json",
        "User-Agent": "NewsAutoPost/1.0",
        "Origin": "https://plugpost-ai.lovable.app",
        "Referer": "https://plugpost-ai.lovable.app/"
    }
}

# Exemplo de configuração real:
# NEWPOST_CONFIG = {
#     "url": "https://minha-newpost-ia.com/api/v1/posts",
#     "api_key": "abc123def456ghi789",
#     "timeout": 30,
#     "headers": {
#         "User-Agent": "NewsAutoPost/1.0"
#     }
# }

def get_newpost_config():
    """Retorna a configuração da NewPost-IA"""
    return NEWPOST_CONFIG

def is_configured():
    """Verifica se as credenciais foram configuradas"""
    return (
        NEWPOST_CONFIG["url"] != "https://sua-newpost-ia.com.br/api/publish" and
        NEWPOST_CONFIG["api_key"] != "SUA_API_KEY_AQUI"
    )
