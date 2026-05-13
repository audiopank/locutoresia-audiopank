"""
Social Post Publisher — Locutores IA
Gerencia criação, edição e publicação automática de posts na NewPost-IA
(https://plugpost-ai.lovable.app/)
"""

import os
import json
import requests
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

# Carregar variáveis de ambiente usando o caminho correto (independente do cwd)
try:
    from dotenv import load_dotenv
    import pathlib
    _BASE_DIR = pathlib.Path(__file__).resolve().parent.parent  # raiz do projeto
    load_dotenv(_BASE_DIR / '.env')                          # carrega .env
    load_dotenv(_BASE_DIR / '.env.local', override=True)     # .env.local tem prioridade
except ImportError:
    pass

logger = logging.getLogger(__name__)

# ============================================================
# CONFIGURAÇÃO NEWPOST-IA
# ============================================================
# URL correta da NewPost-IA
NEWPOST_IA_URL = os.getenv("NEWPOST_IA_URL", "https://plugpost-ai.lovable.app")
NEWPOST_SUPABASE_URL = os.getenv("NEWPOST_SUPABASE_URL", os.getenv("SUPABASE_URL", "https://hzmtdfojctctvgqjdbex.supabase.co"))
# Garantir que usamos a chave de serviço para bypass de RLS
NEWPOST_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

# Supabase local (Locutores IA)
LOCAL_SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
LOCAL_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))

# Configuração de fallback para publicação direta
NEWPOST_FALLBACK_ENABLED = True


class SocialPostPublisher:
    """
    Gerencia o ciclo de vida de SocialPosts:
    rascunho → aprovado → publicado na NewPost-IA
    """

    # Status válidos conforme o schema SocialPost
    STATUS_CHOICES = ["rascunho", "pendente", "aprovado", "rejeitado", "agendado", "publicado", "erro"]
    APPROVAL_CHOICES = ["pendente", "aprovado", "rejeitado"]

    def __init__(self):
        # Ler credenciais em tempo de execução (após load_dotenv)
        self.local_url = os.getenv("SUPABASE_URL", LOCAL_SUPABASE_URL).rstrip("/")
        self.local_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", LOCAL_SUPABASE_KEY))
        self.newpost_url = NEWPOST_IA_URL
        self.newpost_supabase_url = os.getenv("NEWPOST_SUPABASE_URL", NEWPOST_SUPABASE_URL)
        self.newpost_supabase_key = os.getenv("NEWPOST_SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", NEWPOST_SUPABASE_KEY)))

    # ----------------------------------------------------------
    # HEADERS SUPABASE LOCAL
    # ----------------------------------------------------------
    def _local_headers(self) -> Dict[str, str]:
        return {
            "apikey": self.local_key,
            "Authorization": f"Bearer {self.local_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    # ----------------------------------------------------------
    # HEADERS NEWPOST-IA
    # ----------------------------------------------------------
    def _newpost_headers(self) -> Dict[str, str]:
        """Centraliza os headers para a API do NewPost"""
        return {
            "apikey": self.newpost_supabase_key,
            "Authorization": f"Bearer {self.newpost_supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    # ----------------------------------------------------------
    # GERAR LEGENDA COM IA (Gemini)
    # ----------------------------------------------------------
    def generate_ai_caption(self, title: str, content: str, hashtags: Optional[List[str]] = None) -> Dict[str, Any]:
        """Gera legenda viral para redes sociais usando Gemini"""
        try:
            gemini_key = os.getenv("GEMINI_API_KEY")
            if not gemini_key:
                return {"success": False, "error": "Gemini API Key não configurada"}

            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-pro")

            hashtags_str = " ".join(hashtags) if hashtags else "#brasil #noticias #ia"

            prompt = f"""
Você é um especialista em marketing digital para redes sociais brasileiras.
Crie uma legenda VIRAL e ENGAJANTE para o seguinte conteúdo de notícia:

Título: {title}
Conteúdo: {content[:500]}

Retorne um JSON com:
1. "caption": legenda envolvente de até 280 caracteres, com emojis, tom jornalístico e impactante
2. "hashtags": lista de 5 hashtags relevantes em português (sem o # inicial)
3. "title": título curto e chamativo de até 80 caracteres

Responda APENAS com o JSON, sem markdown.
"""
            response = model.generate_content(prompt)
            text = response.text.strip().replace("```json", "").replace("```", "").strip()

            try:
                result = json.loads(text)
                return {
                    "success": True,
                    "caption": result.get("caption", ""),
                    "hashtags": result.get("hashtags", []),
                    "title": result.get("title", title[:80]),
                    "ai_caption_generated": True,
                }
            except json.JSONDecodeError:
                return {
                    "success": True,
                    "caption": text[:280],
                    "hashtags": ["brasil", "noticias", "ia", "locutores", "conteudo"],
                    "title": title[:80],
                    "ai_caption_generated": True,
                }

        except Exception as e:
            logger.error(f"Erro ao gerar legenda IA: {e}")
            return {"success": False, "error": str(e)}

    # ----------------------------------------------------------
    # CRIAR SOCIAL POST (salva localmente no Supabase)
    # ----------------------------------------------------------
    def create_post(
        self,
        title: str,
        caption: str = "",
        audio_url: str = "",
        image_url: str = "",
        platforms: Optional[List[str]] = None,
        hashtags: Optional[List[str]] = None,
        status: str = "rascunho",
        scheduled_at: Optional[str] = None,
        ai_caption_generated: bool = False,
    ) -> Dict[str, Any]:
        """Cria um novo SocialPost no Supabase local"""

        if platforms is None:
            platforms = ["newpost_ia"]
        if hashtags is None:
            hashtags = []

        payload = {
            "title": title[:200],
            "caption": caption[:1000],
            "audio_url": audio_url,
            "image_url": image_url,
            "platforms": platforms,
            "hashtags": hashtags,
            "status": status if status in self.STATUS_CHOICES else "rascunho",
            "approval_status": "pendente",
            "ai_caption_generated": ai_caption_generated,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }

        if scheduled_at:
            payload["scheduled_at"] = scheduled_at

        try:
            resp = requests.post(
                f"{self.local_url}/rest/v1/social_posts",
                headers=self._local_headers(),
                json=payload,
                timeout=15,
            )
            if resp.status_code in (200, 201):
                data = resp.json()
                record = data[0] if isinstance(data, list) else data
                logger.info(f"SocialPost criado: {record.get('id')}")
                return {"success": True, "post": record}
            else:
                logger.error(f"Erro ao criar SocialPost: {resp.status_code} - {resp.text}")
                return {"success": False, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            logger.error(f"Exceção ao criar SocialPost: {e}")
            return {"success": False, "error": str(e)}

    # ----------------------------------------------------------
    # LISTAR POSTS
    # ----------------------------------------------------------
    def list_posts(self, status: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
        """Lista SocialPosts do Supabase local"""
        try:
            url = f"{self.local_url}/rest/v1/social_posts?order=created_at.desc&limit={limit}"
            if status:
                url += f"&status=eq.{status}"

            resp = requests.get(url, headers=self._local_headers(), timeout=15)
            if resp.status_code == 200:
                return {"success": True, "posts": resp.json(), "count": len(resp.json())}
            return {"success": False, "error": resp.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ----------------------------------------------------------
    # OBTER POST POR ID
    # ----------------------------------------------------------
    def get_post(self, post_id: str) -> Dict[str, Any]:
        """Obtém um SocialPost pelo ID"""
        try:
            resp = requests.get(
                f"{self.local_url}/rest/v1/social_posts?id=eq.{post_id}",
                headers=self._local_headers(),
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data:
                    return {"success": True, "post": data[0]}
                return {"success": False, "error": "Post não encontrado"}
            return {"success": False, "error": resp.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ----------------------------------------------------------
    # ATUALIZAR POST
    # ----------------------------------------------------------
    def update_post(self, post_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Atualiza campos de um SocialPost"""
        updates["updated_at"] = datetime.utcnow().isoformat()
        try:
            resp = requests.patch(
                f"{self.local_url}/rest/v1/social_posts?id=eq.{post_id}",
                headers=self._local_headers(),
                json=updates,
                timeout=15,
            )
            if resp.status_code in (200, 204):
                return {"success": True}
            return {"success": False, "error": resp.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ----------------------------------------------------------
    # PUBLICAR NA NEWPOST-IA
    # ----------------------------------------------------------
    def publish_to_newpost(self, post_id: str) -> Dict[str, Any]:
        """
        Publica um SocialPost aprovado na NewPost-IA seguindo o pipeline de 3 passos:
        1. Salvar na tabela 'posts' (Base)
        2. Agendar em 'scheduled_posts' (Trigger para o Feed)
        3. Acionar Edge Function (Processamento imediato)
        """
        # 1. Obter post local
        result = self.get_post(post_id)
        if not result.get("success"):
            return result

        post = result["post"]

        # 2. Verificar se está aprovado
        if post.get("approval_status") != "aprovado":
            return {
                "success": False,
                "error": f"O post precisa estar aprovado para publicar. Status atual: {post.get('approval_status')}",
            }

        # 3. Preparar dados
        hashtags = post.get("hashtags", [])
        hashtag_str = " ".join([f"#{h}" for h in hashtags])
        full_caption = f"{post.get('caption', '')} {hashtag_str}".strip()

        # Obter autor_id
        autor_id = "3a1a93d0-e451-47a4-a126-f1b7375895eb"
        try:
            with open('newsagent_autor_id.txt', 'r') as f:
                autor_id = f.read().strip() or autor_id
        except Exception:
            pass

        publish_results = {
            "posts_table": {"success": False},
            "scheduled_posts": {"success": False},
            "edge_function": {"success": False}
        }

        # --- PASSO 1: Salvar na tabela 'posts' ---
        try:
            posts_payload = {
                'title': post.get("title", ""),
                'content': full_caption,
                'author_id': autor_id,
                'status': 'published',
                'is_ia_generated': post.get("ai_caption_generated", True),
                'media_urls': [post.get("image_url")] if post.get("image_url") else [],
                'media_types': ['image'] if post.get("image_url") else [],
                'source_url': post.get("source_url", "")
            }
            
            logger.info(f"🚀 [PASSO 1] Salvando post na tabela 'posts'...")
            resp_posts = requests.post(
                f"{self.newpost_supabase_url}/rest/v1/posts",
                headers=self._newpost_headers(),
                json=posts_payload,
                timeout=20,
            )

            if resp_posts.status_code in (200, 201):
                data_posts = resp_posts.json()
                record_posts = data_posts[0] if isinstance(data_posts, list) else data_posts
                posts_id = record_posts.get("id")
                publish_results["posts_table"] = {"success": True, "post_id": posts_id}
                logger.info(f"✅ [PASSO 1] Post salvo na tabela 'posts': {posts_id}")

                # --- PASSO 2: Agendar em 'scheduled_posts' ---
                try:
                    logger.info(f"🚀 [PASSO 2] Agendando post para o Feed...")
                    # Agendar para 10 segundos no futuro
                    scheduled_at = (datetime.utcnow() + timedelta(seconds=10)).isoformat()
                    
                    scheduled_payload = {
                        "user_id": autor_id,
                        "content": full_caption,
                        "media_urls": posts_payload['media_urls'],
                        "media_types": posts_payload['media_types'],
                        "hashtags": hashtags,
                        "scheduled_at": scheduled_at,
                        "status": "scheduled",
                        "published_post_id": posts_id # Relacionar com o post já criado
                    }
                    
                    resp_sched = requests.post(
                        f"{self.newpost_supabase_url}/rest/v1/scheduled_posts",
                        headers=self._newpost_headers(),
                        json=scheduled_payload,
                        timeout=15,
                    )
                    
                    if resp_sched.status_code in (200, 201):
                        data_sched = resp_sched.json()
                        sched_id = (data_sched[0] if isinstance(data_sched, list) else data_sched).get("id")
                        publish_results["scheduled_posts"] = {"success": True, "scheduled_id": sched_id}
                        logger.info(f"✅ [PASSO 2] Post agendado com sucesso: {sched_id}")

                        # --- PASSO 3: Acionar Edge Function ---
                        try:
                            logger.info("🚀 [PASSO 3] Solicitando processamento imediato via Edge Function...")
                            resp_fn = requests.post(
                                f"{self.newpost_supabase_url}/functions/v1/auto-publish-posts",
                                headers={
                                    "apikey": self.newpost_supabase_key,
                                    "Authorization": f"Bearer {self.newpost_supabase_key}",
                                    "Content-Type": "application/json"
                                },
                                json={},
                                timeout=10
                            )
                            if resp_fn.status_code in (200, 201):
                                publish_results["edge_function"] = {"success": True, "response": resp_fn.text}
                                logger.info(f"✅ [PASSO 3] Edge Function acionada com sucesso")
                            else:
                                logger.warning(f"⚠️ [PASSO 3] Edge Function retornou {resp_fn.status_code}")
                                publish_results["edge_function"] = {"success": False, "status_code": resp_fn.status_code}
                        except requests.exceptions.Timeout:
                            logger.info(f"⚠️ [PASSO 3] Edge Function demorou, mas o post está agendado")
                            publish_results["edge_function"] = {"success": False, "error": "Timeout", "note": "Post será processado via cron"}
                        except Exception as e_fn:
                            logger.warning(f"⚠️ [PASSO 3] Falha ao acionar Edge Function: {e_fn}")
                            publish_results["edge_function"] = {"success": False, "error": str(e_fn)}
                    else:
                        logger.error(f"❌ [PASSO 2] Falha ao agendar: {resp_sched.status_code} - {resp_sched.text}")
                        publish_results["scheduled_posts"] = {"success": False, "error": resp_sched.text}
                except Exception as e_sched:
                    logger.error(f"❌ [PASSO 2] Exceção ao agendar: {e_sched}")
                    publish_results["scheduled_posts"] = {"success": False, "error": str(e_sched)}
            else:
                logger.error(f"❌ [PASSO 1] Falha ao salvar em 'posts': {resp_posts.status_code} - {resp_posts.text}")
                publish_results["posts_table"] = {"success": False, "error": resp_posts.text}
        except Exception as e:
            logger.error(f"❌ [PASSO 1] Exceção ao salvar em 'posts': {e}")
            publish_results["posts_table"] = {"success": False, "error": str(e)}

        # 4. Determinar sucesso final
        final_success = publish_results["posts_table"]["success"] and publish_results["scheduled_posts"]["success"]
        new_status = "publicado" if final_success else "erro"
        
        if final_success:
            message = "✅ Post publicado com sucesso na NewPost-IA! 🎉 Aparecerá no Feed em breve."
        else:
            message = f"❌ Falha na publicação: {publish_results['posts_table'].get('error') or publish_results['scheduled_posts'].get('error')}"

        # 5. Atualizar status local
        self.update_post(post_id, {
            "status": new_status,
            "publish_results": json.dumps(publish_results),
            "published_at": datetime.utcnow().isoformat() if final_success else None,
        })

        return {
            "success": final_success,
            "post_id": post_id,
            "status": new_status,
            "publish_results": publish_results,
            "message": message,
        }

    # ----------------------------------------------------------
    # CRIAR POST A PARTIR DE NOTÍCIA (helper)
    # ----------------------------------------------------------
    def create_from_news(
        self,
        news_title: str,
        news_content: str,
        audio_url: str = "",
        image_url: str = "",
        auto_caption: bool = True,
    ) -> Dict[str, Any]:
        """
        Cria um SocialPost a partir de uma notícia coletada.
        Opcionalmente gera legenda IA automaticamente.
        """
        # Forçar recarregamento do .env antes de criar o post
        try:
            from dotenv import load_dotenv
            load_dotenv(override=True)
            self.local_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))
        except ImportError:
            pass

        caption = ""
        hashtags = ["brasil", "noticias", "locutores", "ia", "radiobrasil"]
        ai_generated = False
        title = news_title[:80]

        if auto_caption:
            ai_result = self.generate_ai_caption(news_title, news_content)
            if ai_result.get("success"):
                caption = ai_result.get("caption", "")
                hashtags = ai_result.get("hashtags", hashtags)
                title = ai_result.get("title", title)
                ai_generated = True

        if not caption:
            caption = news_content[:280] if news_content else news_title[:280]

        return self.create_post(
            title=title,
            caption=caption,
            audio_url=audio_url,
            image_url=image_url,
            platforms=["newpost_ia"],
            hashtags=hashtags,
            status="rascunho",
            ai_caption_generated=ai_generated,
        )

    # ----------------------------------------------------------
    # APROVAR POST
    # ----------------------------------------------------------
    def approve_post(self, post_id: str, approved_by: str = "sistema") -> Dict[str, Any]:
        """Aprova um post para publicação"""
        return self.update_post(post_id, {
            "approval_status": "aprovado",
            "status": "aprovado",
            "approved_by": approved_by,
            "approved_at": datetime.utcnow().isoformat(),
        })

    # ----------------------------------------------------------
    # REJEITAR POST
    # ----------------------------------------------------------
    def reject_post(self, post_id: str, reason: str = "", rejected_by: str = "sistema") -> Dict[str, Any]:
        """Rejeita um post"""
        return self.update_post(post_id, {
            "approval_status": "rejeitado",
            "status": "rejeitado",
            "rejection_reason": reason,
            "approved_by": rejected_by,
            "approved_at": datetime.utcnow().isoformat(),
        })


# Instância global
social_publisher = SocialPostPublisher()
