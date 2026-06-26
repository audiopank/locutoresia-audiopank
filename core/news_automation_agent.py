import os
import logging
from typing import Dict, Any, List, Optional

from .supabase_manager import SupabaseManager
from .rss_fetcher import RSSFetcher
from .news_database import DatabaseManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class NewsAutomationAgent:
    """Orquestrador da integração Locutores IA ↔ NewPost-IA com cache local"""

    def __init__(self):
        self.supabase = SupabaseManager()
        self.rss = RSSFetcher()
        self.db = DatabaseManager()
        self.newpost_author_id = os.getenv("NEWPOST_AUTHOR_ID")

    def get_status(self) -> Dict[str, Any]:
        """Retorna status completo da integração"""
        supabase_status = self.supabase.get_status()
        source_status = self.db.get_source_status()
        return {
            "success": True,
            "data": {
                "supabase": supabase_status,
                "categories": self.rss.get_categories(),
                "sources": self.rss.get_sources(),
                "author_id": self.newpost_author_id,
                "source_status": source_status
            }
        }

    def fetch_news(self, category: str = "Tecnologia", limit: int = 7, use_cache: bool = True) -> Dict[str, Any]:
        """Busca notícias via RSS, com cache local"""
        try:
            # Tenta usar o cache primeiro
            if use_cache:
                cached_news = self.db.get_cached_news(limit, category)
                if cached_news:
                    logger.info(f"📦 Usando cache: {len(cached_news)} notícias")
                    # Converte para o formato esperado
                    formatted_news = []
                    for news in cached_news:
                        formatted_news.append({
                            "titulo": news["title"],
                            "resumo": news["summary"],
                            "conteudo_completo": news["summary"],
                            "fonte": news["source"],
                            "link": news["url"],
                            "imagem_url": news.get("image_url", ""),
                            "data_publicacao": news["published_at"]
                        })
                    return {
                        "success": True,
                        "data": {
                            "noticias": formatted_news,
                            "total": len(formatted_news),
                            "categoria": category,
                            "cache": True
                        }
                    }

            # Se não tem cache ou não usou, busca do RSS
            news = self.rss.fetch_news(category, limit)
            
            # Salva no cache local
            if news:
                news_to_save = []
                for item in news:
                    news_to_save.append({
                        "title": item["titulo"],
                        "snippet": item["resumo"],
                        "url": item["link"],
                        "source": item["fonte"],
                        "category": category,
                        "published_at": item["data_publicacao"],
                        "image_url": item.get("imagem_url", "")
                    })
                self.db.save_news(news_to_save)
            
            return {
                "success": True,
                "data": {
                    "noticias": news,
                    "total": len(news),
                    "categoria": category,
                    "cache": False
                }
            }
        except Exception as e:
            logger.error(f"❌ Erro ao buscar notícias: {e}")
            return {"success": False, "error": str(e)}

    def publish_single(self, title: str, content: str, author_id: str = None) -> Dict[str, Any]:
        """Publica uma única notícia na NewPost-IA"""
        try:
            author = author_id or self.newpost_author_id
            result = self.supabase.publish_to_newpost(
                title=title,
                content=content,
                author_id=author
            )
            return result
        except Exception as e:
            logger.error(f"❌ Erro ao publicar notícia: {e}")
            return {"success": False, "error": str(e)}

    def fetch_and_publish(self, categories: List[str] = None, limit_per_category: int = 5, auto_publish: bool = True) -> Dict[str, Any]:
        """
        Busca notícias e publica na NewPost-IA.
        É o endpoint principal!
        """
        if categories is None:
            categories = ["Tecnologia"]

        total_fetched = 0
        total_published = 0
        failed = 0
        results = []

        for category in categories:
            try:
                logger.info(f"🚀 Processando categoria: {category}")
                news_result = self.fetch_news(category, limit_per_category, use_cache=False)

                if not news_result.get("success"):
                    failed += 1
                    continue

                news_list = news_result["data"]["noticias"]

                # Portão final: barra conteúdo sensível (crimes/violência) antes
                # de publicar no Feed — independe da origem (RSS novo ou cache).
                try:
                    from .content_filter import filter_news
                    news_list, blocked = filter_news(news_list)
                    if blocked:
                        logger.info(f"🚫 {len(blocked)} notícia(s) bloqueada(s) na categoria {category}")
                except Exception as e:
                    logger.warning(f"Filtro de conteúdo indisponível: {e}")

                total_fetched += len(news_list)

                if auto_publish:
                    for news_item in news_list:
                        content = news_item.get("conteudo_completo", news_item.get("resumo", ""))
                        publish_result = self.publish_single(
                            title=news_item["titulo"],
                            content=content
                        )
                        if publish_result.get("success"):
                            total_published += 1
                            results.append({
                                "categoria": category,
                                "titulo": news_item["titulo"],
                                "post_id": publish_result.get("post_id")
                            })
                        else:
                            failed += 1

            except Exception as e:
                logger.error(f"❌ Erro na categoria {category}: {e}")
                failed += 1
                continue

        return {
            "success": True,
            "total_fetched": total_fetched,
            "total_published": total_published,
            "failed": failed,
            "results": results
        }

    def get_published_posts(self, limit: int = 20) -> Dict[str, Any]:
        """Retorna posts já publicados na NewPost-IA"""
        try:
            posts = self.supabase.get_published_posts(limit)
            return {
                "success": True,
                "data": {
                    "posts": posts,
                    "total": len(posts)
                }
            }
        except Exception as e:
            logger.error(f"❌ Erro ao buscar posts publicados: {e}")
            return {"success": False, "error": str(e)}
