import os
import logging
from typing import Dict, Any, List, Optional

from .supabase_manager import SupabaseManager
from .rss_fetcher import RSSFetcher

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class NewsAutomationAgent:
    """Orquestrador da integração Locutores IA ↔ NewPost-IA"""

    def __init__(self):
        self.supabase = SupabaseManager()
        self.rss = RSSFetcher()
        self.newpost_author_id = os.getenv("NEWPOST_AUTHOR_ID")

    def get_status(self) -> Dict[str, Any]:
        """Retorna status completo da integração"""
        supabase_status = self.supabase.get_status()
        return {
            "success": True,
            "data": {
                "supabase": supabase_status,
                "categories": self.rss.get_categories(),
                "author_id": self.newpost_author_id
            }
        }

    def fetch_news(self, category: str = "Tecnologia", limit: int = 7) -> Dict[str, Any]:
        """Busca notícias via RSS"""
        try:
            news = self.rss.fetch_news(category, limit)
            return {
                "success": True,
                "data": {
                    "noticias": news,
                    "total": len(news),
                    "categoria": category
                }
            }
        except Exception as e:
            logger.error(f"❌ Erro ao buscar notícias: {e}")
            return {"success": False, "error": str(e)}

    def publish_single(self, title: str, content: str) -> Dict[str, Any]:
        """Publica uma única notícia na NewPost-IA"""
        try:
            result = self.supabase.publish_to_newpost(
                title=title,
                content=content,
                author_id=self.newpost_author_id
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
                news_result = self.fetch_news(category, limit_per_category)

                if not news_result.get("success"):
                    failed += 1
                    continue

                news_list = news_result["data"]["noticias"]
                total_fetched += len(news_list)

                if auto_publish:
                    for news_item in news_list:
                        publish_result = self.publish_single(
                            title=news_item["titulo"],
                            content=news_item["resumo"]
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
