import os
import logging
import uuid
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

    def log_usage_event(self, event_type: str) -> bool:
        """
        Registra um evento real de uso (geração de áudio ou salvamento de
        roteiro) na tabela usage_events, pra alimentar as estatísticas
        reais da home. Falha silenciosamente (nunca deve quebrar o fluxo
        principal por causa de uma estatística).
        """
        # usage_events foi criada no projeto NEWPOST_SUPABASE_URL (mesmo Supabase
        # onde vive o schema do Locutores IA hoje) — usar newpost_manager_client.
        if not self.newpost_manager_client:
            return False

        try:
            self.newpost_manager_client.table("usage_events").insert(
                {"event_type": event_type}
            ).execute()
            return True
        except Exception as e:
            logger.error(f"❌ Erro ao registrar usage_event ({event_type}): {e}")
            return False

    def get_usage_counts(self) -> Dict[str, int]:
        """
        Retorna as contagens reais de eventos de uso, agrupadas por tipo.
        Se o Supabase não estiver disponível, retorna zeros (nunca inventa
        número).
        """
        counts = {"audio_generated": 0, "project_saved": 0}
        if not self.newpost_manager_client:
            return counts

        for event_type in counts:
            try:
                result = (
                    self.newpost_manager_client.table("usage_events")
                    .select("id", count="exact")
                    .eq("event_type", event_type)
                    .execute()
                )
                counts[event_type] = result.count or 0
            except Exception as e:
                logger.error(f"❌ Erro ao contar usage_events ({event_type}): {e}")

        return counts

    def get_all_authors(self):
        """
        Retorna todos os autores da tabela 'users'
        """
        if not self.newpost_manager_client:
            return []
        
        try:
            result = self.newpost_manager_client.table("users").select("*").execute()
            return result.data
        except Exception as e:
            logger.error(f"❌ Erro ao buscar autores: {e}")
            return []
            
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

    def publish_to_newpost(self, title: str, content: str, author_id: Optional[str] = None, category: str = "Geral", tags: Optional[List[str]] = None, source_url: Optional[str] = None) -> Dict[str, Any]:
        """Publica um post na NewPost-IA usando o payload que você informou"""
        try:
            # Se não tem author_id, usa o padrão do .env
            if not author_id:
                author_id = os.getenv("NEWPOST_AUTHOR_ID", "3f51ca52-5a5c-4cf0-a95a-ec26c96245e3")
            if not tags:
                tags = ["#NewsAgent", "#LocutoresIA", "#Brasil"]

            # Garante que o usuário existe no Manager antes de publicar
            self._ensure_profile_exists(author_id)

            # Publicar na NewPost-IA usando o payload correto
            if self.newpost_manager_client:
                manager_payload = {
                    "author_id": author_id,
                    "title": title,
                    "content": f"📰 {title}\n\n{content}",
                    "status": "published",
                    "is_ia_generated": True,
                    # Link REAL da matéria. Antes gravava um str(uuid.uuid4()) aqui,
                    # o que não é URL — quebrava quem fazia new URL(source_url) na
                    # tela e deixava o post sem a fonte de verdade.
                    "source_url": (source_url or "").strip(),
                    "category": category,
                    "tags": tags
                }
                manager_response = self.newpost_manager_client.table("posts").insert(manager_payload).execute()
                if manager_response.data:
                    logger.info(f"✅ Post publicado na NewPost-IA: {title[:30]}...")
                    return {
                        "success": True,
                        "post_id": manager_response.data[0]['id'],
                        "data": manager_response.data[0]
                    }
            return {"success": False, "error": "NewPost Manager client not connected"}
        except Exception as e:
            logger.error(f"❌ Erro ao publicar na NewPost-IA: {e}")
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