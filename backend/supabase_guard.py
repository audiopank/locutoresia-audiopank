# backend/supabase_guard.py
import os, sys, logging
from supabase import create_client

logger = logging.getLogger("supabase_guard")

def validate_supabase_target():
    # Garantir que as variáveis de ambiente estejam atualizadas
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    load_dotenv(env_path, override=True)
    
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    # Tentamos SERVICE_ROLE_KEY primeiro, depois SERVICE_KEY, depois anon
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
    key = key.strip()

    if not url or not key:
        logger.critical("❌ SUPABASE_URL ou SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY não definidos")
        return False

    # Sanity-check: tenta um SELECT trivial pra confirmar que a key bate com o projeto
    try:
        sb = create_client(url, key)
        res = sb.table("posts").select("id").limit(1).execute()
        logger.info(f"✅ Supabase OK → {url}")
        return True
    except Exception as e:
        logger.warning(f"⚠️ Validação do Supabase falhou (pode ser RLS ou Key): {e}")
        return False
