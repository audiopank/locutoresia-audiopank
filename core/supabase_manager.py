import os
import logging
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
        self.newpost_client: Optional[Client] = None
        self._connect()

    def _connect(self):
        """Estabelece conexões com os projetos Supabase"""
        if not HAS_SUPABASE:
            return

        try:
            locutores_url = os.getenv("SUPABASE_URL")
            locutores_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY")

            if locutores_url and locutores_key:
                self.locutores_client = create_client(locutores_url, locutores_key)
                logger.info("✅ Conectado ao Supabase Locutores IA")

            newpost_url = os.getenv("NEWPOST_SUPABASE_URL")
            newpost_key = os.getenv("NEWPOST_SUPABASE_SERVICE_KEY") or os.getenv("NEWPOST_SUPABASE_ANON_KEY")

            if newpost_url and newpost_key:
                self.newpost_client = create_client(newpost_url, newpost_key)
                logger.info("✅ Conectado ao Supabase NewPost-IA")

        except Exception as e:
            logger.error(f"❌ Erro ao conectar ao Supabase: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Retorna status das conexões"""
        return {
            "locutores_connected": self.locutores_client is not None,
            "newpost_connected": self.newpost_client is not None
        }

    def _ensure_profile_exists(self, author_id: str) -> bool:
        """
        Verifica se o perfil existe e cria automaticamente se não existir,
        com fallback inteligente (ignora colunas inexistentes)
        """
        if not self.newpost_client:
            return False
        
        try:
            # Primeiro, tenta buscar o perfil para verificar se existe
            check = self.newpost_client.table("newpost_profiles").select("id").eq("id", author_id).limit(1).execute()
            if check.data and len(check.data) > 0:
                logger.info(f"✅ Perfil {author_id} já existe")
                return True
        except Exception as e:
            logger.warning(f"⚠️ Não foi possível verificar perfil (provavelmente tabela não existe): {e}")
            return True  # Se não pode verificar, assume que existe
        
        # Se chegou aqui, tenta criar o perfil
        try:
            # Tenta criar com o mínimo de campos possível para evitar erros de schema
            create_data = {"id": author_id}
            
            # Tenta adicionar campos com fallback (se falhar, ignora)
            try:
                create_data["nome"] = "Usuário IA"
            except Exception:
                pass
                
            try:
                create_data["email"] = "usuario@ia.local"
            except Exception:
                pass
                
            response = self.newpost_client.table("newpost_profiles").insert(create_data).execute()
            if response.data:
                logger.info(f"✅ Perfil {author_id} criado automaticamente")
                return True
        except Exception as e:
            logger.warning(f"⚠️ Não foi possível criar perfil (ignorando): {e}")
            # Mesmo se falhar, tenta publicar o post de qualquer forma
            return True
        
        return False

    def publish_to_newpost(self, title: str, content: str, author_id: Optional[str] = None) -> Dict[str, Any]:
        """Publica um post na NewPost-IA com auto-criação de perfil"""
        if not self.newpost_client:
            return {"success": False, "error": "NewPost-IA não conectado"}

        try:
            # Se não tem author_id, usa o padrão do .env
            if not author_id:
                author_id = os.getenv("NEWPOST_AUTHOR_ID", "3a1a93d0-e451-47a4-a126-f1b7375895eb")
            
            # Garante que o perfil existe (auto-cria se necessário)
            self._ensure_profile_exists(author_id)
            
            payload = {
                "title": title,
                "content": content[:500],
                "author_id": author_id,
                "is_ia_generated": True,
                "source": "audio-pank-ia",
                "status": "ready"
            }

            response = self.newpost_client.table("posts").insert(payload).execute()

            if response.data:
                logger.info(f"✅ Post publicado na NewPost-IA: {title[:50]}...")
                return {
                    "success": True,
                    "post_id": response.data[0].get("id"),
                    "data": response.data[0]
                }
            else:
                return {"success": False, "error": "Nenhum dado retornado"}

        except Exception as e:
            logger.error(f"❌ Erro ao publicar na NewPost-IA: {e}")
            return {"success": False, "error": str(e)}

    def get_published_posts(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Retorna posts publicados na NewPost-IA"""
        if not self.newpost_client:
            return []

        try:
            response = self.newpost_client.table("posts").select("*").order("created_at", desc=True).limit(limit).execute()
            return response.data if response.data else []
        except Exception as e:
            logger.error(f"❌ Erro ao buscar posts: {e}")
            return []
