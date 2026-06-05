import os
import logging
import requests
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

try:
    from supabase import create_client, Client
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False
    logging.error("⚠️ Supabase não instalado! Instale com: pip install supabase")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SupabaseManager:
    """Gerencia conexões com múltiplos projetos Supabase"""

    def __init__(self):
        self.locutores_client: Optional[Client] = None
        self.newpost_manager_client: Optional[Client] = None  # Projeto Manager (autores)
        self._connect()

    def _connect(self):
        """Estabelece conexões com os projetos Supabase"""
        if not HAS_SUPABASE:
            return

        try:
            # Projeto Locutores IA
            locutores_url = os.getenv("SUPABASE_URL")
            locutores_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY")
            if locutores_url and locutores_key:
                self.locutores_client = create_client(locutores_url, locutores_key)
                logger.info("✅ Conectado ao Supabase Locutores IA")

            # Projeto NewPost-IA Manager (autores/perfis)
            newpost_manager_url = os.getenv("NEWPOST_SUPABASE_URL")
            newpost_manager_key = os.getenv("NEWPOST_SUPABASE_SERVICE_KEY") or os.getenv("NEWPOST_SUPABASE_ANON_KEY")
            if newpost_manager_url and newpost_manager_key:
                self.newpost_manager_client = create_client(newpost_manager_url, newpost_manager_key)
                logger.info("✅ Conectado ao Supabase NewPost-IA Manager")

        except Exception as e:
            logger.error(f"❌ Erro ao conectar ao Supabase: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Retorna status das conexões"""
        return {
            "locutores_connected": self.locutores_client is not None,
            "newpost_manager_connected": self.newpost_manager_client is not None
        }

    def _ensure_profile_exists(self, author_id: str) -> bool:
        """
        Verifica se o usuário existe na tabela 'users' do NewPost-IA Manager.
        Cria automaticamente se não existir.
        """
        if not self.newpost_manager_client:
            return False

        try:
            # Busca na tabela 'users' do projeto Manager
            check = self.newpost_manager_client.table("users").select("id").eq("id", author_id).limit(1).execute()
            if check.data and len(check.data) > 0:
                logger.info(f"✅ Usuário {author_id} já existe em users (Manager)")
                return True
        except Exception as e:
            logger.warning(f"⚠️ Não foi possível verificar usuário (Manager): {e}")
            return True  # Se não pode verificar, assume que existe

        # Usuário não existe — cria com campos mínimos da tabela users
        try:
            create_data = {
                "id": author_id,
                "name": "Usuário IA",
                "email": "usuario@ia.local",
            }
            response = self.newpost_manager_client.table("users").insert(create_data).execute()
            if response.data:
                logger.info(f"✅ Usuário {author_id} criado automaticamente em users (Manager)")
                return True
        except Exception as e:
            logger.warning(f"⚠️ Não foi possível criar usuário (Manager, ignorando): {e}")
            return True  # Tenta publicar mesmo assim

        return False

    def publish_to_newpost(self, title: str, content: str, author_id: Optional[str] = None) -> Dict[str, Any]:
        """Publica um post no PlugPost-IA Feed com auto-criação de perfil no Manager (usa requests diretamente)"""
        try:
            # Se não tem author_id, usa o padrão do .env
            if not author_id:
                author_id = os.getenv("NEWPOST_AUTHOR_ID", "3a1a93d0-e451-47a4-a126-f1b7375895eb")

            # Garante que o usuário existe no Manager antes de publicar
            self._ensure_profile_exists(author_id)

            # 1. Publicar na NewPost-IA Manager (ykswhzqdjoshjoaruhqs) - tabela posts original
            try:
                if self.newpost_manager_client:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    manager_payload = {
                        "title": title,
                        "content": content[:500],
                        "author_id": author_id,
                        "is_ia_generated": True,
                        "source": "audio-pank-ia",
                        "status": "published",
                        "published_at": now_iso
                    }
                    manager_response = self.newpost_manager_client.table("posts").insert(manager_payload).execute()
                    if manager_response.data:
                        logger.info(f"✅ Post publicado na NewPost-IA Manager: {title[:30]}...")
            except Exception as manager_err:
                logger.warning(f"⚠️ Erro ao publicar na NewPost-IA Manager (continuando): {manager_err}")

            # 2. Publicar no PlugPost Feed (hzmtdfojctctvgqjdbex) - usando requests diretamente (como na rota /api/newpost/publish)
            plugpost_url = os.getenv('PLUGPOST_SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
            plugpost_key = os.getenv('PLUGPOST_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY')
            plugpost_author_id = os.getenv('PLUGPOST_AUTHOR_ID', 'e387d9c0-31d9-409c-b3ac-5d31109630b4')
            
            if plugpost_url and plugpost_key:
                logger.info(f"[DEBUG] Publishing to PlugPost: {plugpost_url}")
                
                # Payload EXATO do JS do usuário (mesmo que a rota /api/newpost/publish)!
                plugpost_payload = {
                    "author_id": plugpost_author_id,
                    "content": f"📰 {title}\n\n{content}",
                    "status": "published",
                    "privacy": "public",
                    "is_ia_generated": True,
                    "source_url": "",
                    "category": "geral",
                    "media_urls": [],
                    "media_types": [],
                    "tags": ["NewPostIA", "LocutoresIA"],
                    "watch_projected": 100
                }
                
                headers = {
                    "apikey": plugpost_key,
                    "Authorization": f"Bearer {plugpost_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                
                plugpost_response = requests.post(
                    f"{plugpost_url}/rest/v1/posts",
                    json=plugpost_payload,
                    headers=headers,
                    timeout=30
                )
                
                if plugpost_response.status_code in (200, 201):
                    plugpost_data = plugpost_response.json()
                    logger.info(f"✅ Post publicado no PlugPost Feed! Post ID: {plugpost_data[0]['id'] if plugpost_data else 'N/A'}")
                    return {
                        "success": True,
                        "post_id": plugpost_data[0]['id'] if plugpost_data else None,
                        "data": plugpost_data[0] if plugpost_data else None
                    }
                else:
                    logger.error(f"❌ Erro no PlugPost Feed: {plugpost_response.status_code} - {plugpost_response.text}")
                    return {"success": False, "error": f"PlugPost error: {plugpost_response.status_code}"}
            else:
                logger.warning(f"⚠️ Credenciais do PlugPost Feed faltando, usando apenas a Manager")
                return {"success": True, "message": "Published to Manager only"}

        except Exception as e:
            logger.error(f"❌ Erro geral ao publicar: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}

    def get_published_posts(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Retorna posts publicados no PlugPost-IA Feed (usando requests diretamente)"""
        try:
            plugpost_url = os.getenv('PLUGPOST_SUPABASE_URL', 'https://hzmtdfojctctvgqjdbex.supabase.co').rstrip('/')
            plugpost_key = os.getenv('PLUGPOST_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY')
            
            if plugpost_url and plugpost_key:
                headers = {
                    "apikey": plugpost_key,
                    "Authorization": f"Bearer {plugpost_key}",
                    "Content-Type": "application/json"
                }
                
                response = requests.get(
                    f"{plugpost_url}/rest/v1/posts?select=*&order=created_at.desc&limit={limit}",
                    headers=headers,
                    timeout=30
                )
                
                if response.status_code in (200, 201):
                    return response.json()
                else:
                    logger.error(f"❌ Erro ao buscar posts no PlugPost Feed: {response.status_code} - {response.text}")
                    return []
            else:
                return []
        except Exception as e:
            logger.error(f"❌ Erro ao buscar posts: {e}")
            return []