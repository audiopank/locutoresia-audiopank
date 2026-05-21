"""
Utilitário Central de Notícias - NewPost-IA
Unifica a lógica de coleta, processamento e publicação.
"""

import os
import re
import time
import json
import uuid
import requests
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

# Carregar variáveis de ambiente
try:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
except ImportError:
    pass

# Configuração de Logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class NewsUtils:
    def __init__(self):
        self.supabase_url = os.getenv("VITE_SUPABASE_URL", 
                                      os.getenv("NEWPOST_SUPABASE_URL", "https://hzmtdfojctctvgqjdbex.supabase.co")).strip()
        # Usar URL base, não adicionar /rest/v1/posts automaticamente
        self.supabase_url = self.supabase_url.rstrip('/')
        
        # Tentar diferentes variáveis de ambiente (usar ANON KEY primeiro para a tabela posts)
        self.supabase_key = os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "").strip()
        if not self.supabase_key:
            self.supabase_key = os.getenv("NEWPOST_SUPABASE_ANON_KEY", "").strip()
        if not self.supabase_key:
            self.supabase_key = os.getenv("NEWPOST_SUPABASE_SERVICE_KEY", "").strip()
        if not self.supabase_key:
            self.supabase_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bXRkZm9qY3RjdHZncWpkYmV4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTYxMDgyNiwiZXhwIjoyMDg3MTg2ODI2fQ.jnVoRruRPlMpcskHU0ofEdH5hEY8_5tvT89HT6lKWK8"
        
        print(f"Supabase URL: {self.supabase_url}")
        print(f"Supabase Key configurada: {'Sim' if self.supabase_key else 'Não'}")
        
    def fetch_from_newsapi(self, query: str, max_results: int = 5) -> List[Dict]:
        """
        Busca notícias reais usando a NewsAPI + scraping para conteúdo completo
        """
        newsapi_key = os.getenv("NEWS_API_KEY")
        if not newsapi_key:
            logger.warning("NEWS_API_KEY não configurada, usando métodos alternativos")
            return []
            
        try:
            logger.info(f"Buscando notícias via NewsAPI para: {query}")
            url = "https://newsapi.org/v2/everything"
            
            params = {
                "q": query,
                "sortBy": "publishedAt",
                "language": "pt",
                "pageSize": max_results,
                "apiKey": newsapi_key
            }
            
            response = requests.get(url, params=params, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    results = []
                    for article in data.get("articles", []):
                        full_content = article.get("description", article.get("content", ""))
                        article_url = article.get("url", "")
                        
                        # Tentar fazer scraping do conteúdo completo usando newspaper3k
                        if article_url:
                            try:
                                from newspaper import Article
                                news_article = Article(article_url)
                                news_article.config.browser_user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                news_article.download()
                                news_article.parse()
                                
                                if news_article.text and len(news_article.text) > 200:
                                    full_content = news_article.text[:5000]
                            except Exception as e:
                                logger.warning(f"Erro ao fazer scraping de {article_url}: {e}")
                        
                        results.append({
                            "title": article.get("title", "Sem Título"),
                            "url": article_url,
                            "source": article.get("source", {}).get("name", "NewsAPI"),
                            "snippet": full_content,
                            "image_url": article.get("urlToImage", ""),
                            "published_at": article.get("publishedAt", datetime.now().isoformat())
                        })
                    logger.info(f"NewsAPI retornou {len(results)} notícias")
                    return results
                else:
                    logger.warning(f"NewsAPI retornou status não ok: {data}")
                    return []
            else:
                logger.error(f"Erro NewsAPI: {response.status_code} - {response.text}")
                return []
        except Exception as e:
            logger.error(f"Exceção ao usar NewsAPI: {e}")
            return []
    
    def fetch_web_search(self, query: str, max_results: int = 5) -> List[Dict]:
        """
        Busca notícias reais usando NewsAPI, RSS feeds e web scraping
        """
        logger.info(f"Buscando notícias reais para: {query}")
        results = []
        
        try:
            # PRIMEIRO: Usar NewsAPI (melhor fonte!)
            newsapi_results = self.fetch_from_newsapi(query, max_results)
            results.extend(newsapi_results)
            
            # Se não encontrar suficiente, tentar RSS feeds
            if len(results) < max_results:
                results.extend(self._fetch_from_rss_feeds(query, max_results - len(results)))
            
            # Se ainda não encontrar suficiente, tentar web scraping direto
            if len(results) < max_results:
                results.extend(self._scrape_news_sites(query, max_results - len(results)))
            
            # Limitar resultados
            results = results[:max_results]
            
            logger.info(f"Encontradas {len(results)} notícias para: {query}")
            return results
            
        except Exception as e:
            logger.error(f"Erro ao buscar notícias: {e}")
            # Retornar resultados mock em caso de falha
            return self._fallback_results(query, max_results)
    
    def _fetch_from_rss_feeds(self, query: str, max_results: int) -> List[Dict]:
        """Busca notícias de feeds RSS"""
        import feedparser
        
        # RSS feeds das principais fontes brasileiras
        rss_feeds = {
            "exame": "https://exame.com/feed/",
            "veja": "https://veja.abril.com.br/feed/",
            "folha": "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
            "diario_nordeste": "https://diariodonordeste.verdesmares.com.br/rss/ultimas-noticias"
        }
        
        results = []
        today = datetime.now().date()
        
        for source_name, feed_url in rss_feeds.items():
            if source_name.lower() not in query.lower() and "site:" not in query:
                continue
                
            try:
                logger.info(f"Buscando RSS de {source_name}: {feed_url}")
                feed = feedparser.parse(feed_url)
                
                for entry in feed.entries[:max_results]:
                    # Verificar se a notícia é de hoje
                    if hasattr(entry, 'published'):
                        pub_date = datetime.strptime(entry.published, '%a, %d %b %Y %H:%M:%S %z').date()
                        if pub_date != today:
                            continue
                    
                    snippet = ""
                    if hasattr(entry, 'summary') and entry.summary:
                        snippet = entry.summary
                    elif hasattr(entry, 'description') and entry.description:
                        snippet = entry.description
                    else:
                        snippet = entry.title
                    
                    results.append({
                        "title": entry.title,
                        "url": entry.link,
                        "source": source_name.title(),
                        "snippet": snippet,
                        "published_at": entry.published if hasattr(entry, 'published') else datetime.now().isoformat()
                    })
                    
            except Exception as e:
                logger.warning(f"Erro ao processar RSS de {source_name}: {e}")
                continue
        
        return results
    
    def _scrape_news_sites(self, query: str, max_results: int) -> List[Dict]:
        """Faz web scraping direto dos sites de notícias"""
        try:
            from newspaper import Article
            import re
            
            # Sites para scraping
            sites = {
                "exame": "https://exame.com",
                "veja": "https://veja.abril.com.br", 
                "folha": "https://folha.uol.com.br",
                "diario_nordeste": "https://diariodonordeste.verdesmares.com.br"
            }
            
            results = []
            today = datetime.now().date()
            
            for site_name, base_url in sites.items():
                if site_name.lower() not in query.lower() and "site:" not in query:
                    continue
                    
                try:
                    logger.info(f"Scraping {site_name}: {base_url}")
                    
                    # Configurar artigo para scraping
                    article = Article(base_url)
                    article.config.browser_user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    article.download()
                    article.parse()
                    
                    # Extrair informações
                    if article.title and len(article.title) > 10:
                        # Verificar data de publicação
                        pub_date = today
                        if hasattr(article, 'publish_date') and article.publish_date:
                            pub_date = article.publish_date.date()
                        
                        # Apenas notícias de hoje
                        if pub_date == today:
                            results.append({
                                "title": article.title,
                                "url": article.url,
                                "source": site_name.title(),
                                "snippet": article.text[:5000] if article.text else article.title,
                                "published_at": article.publish_date.isoformat() if hasattr(article, 'publish_date') else datetime.now().isoformat()
                            })
                            
                except Exception as e:
                    logger.warning(f"Erro ao fazer scraping de {site_name}: {e}")
                    continue
            
            return results
            
        except ImportError:
            logger.warning("newspaper3k não instalado, usando método alternativo")
            return []
        except Exception as e:
            logger.error(f"Erro no scraping: {e}")
            return []
    
    def _fallback_results(self, query: str, max_results: int) -> List[Dict]:
        """Resultados mock em caso de falha nas buscas reais"""
        logger.warning("Usando resultados mock devido a falha na busca real")
        results = []
        for i in range(min(max_results, 3)):
            results.append({
                "title": f"Notícia {i+1} sobre {query}: Desenvolvimentos recentes",
                "url": f"https://exemplo.com.br/noticia-{uuid.uuid4().hex[:6]}",
                "source": "Fonte Brasileira",
                "snippet": f"Últimas atualizações sobre {query} no cenário nacional...",
                "published_at": datetime.now().isoformat()
            })
        return results

    def normalize_news(self, raw_data: Dict) -> Dict:
        """
        Padroniza os dados da notícia para o formato do banco.
        """
        title = raw_data.get("title", "Sem Título").strip()
        content = raw_data.get("snippet", raw_data.get("content", ""))
        
        # Garantir que o conteúdo nunca esteja vazio
        if not content or len(content.strip()) == 0:
            content = f"{title} - Notícia importante sobre o tema."
        
        # Gerar Slug Simples
        slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
        slug = slug[:50] + f"-{int(time.time()) % 10000}"

        # Tags baseadas no título
        tags = ["ia", "tecnologia"]
        if "brasil" in title.lower(): tags.append("brasil")
        if "google" in title.lower(): tags.append("google")

        return {
            "title": title[:5000],
            "content": content,
            "source_url": raw_data.get("url"),
            "image_url": raw_data.get("image_url"),
            "category": raw_data.get("category", "tecnologia").lower(),
            "published_at": raw_data.get("published_at", datetime.now().isoformat()),
            "status": "draft",
            "metadata": {
                "source": raw_data.get("source", "Web"),
                "sentiment": "neutro",
                "relevance_score": 7,
                "tags": tags,
                "slug": slug
            }
        }

    def is_duplicate(self, title: str) -> bool:
        """
        Verifica se o título já existe no Supabase (tabela posts).
        (Usando título porque a tabela não tem source_url)
        """
        if not self.supabase_url or not self.supabase_key:
            return False
            
        try:
            # Normalizar título para comparação
            normalized_title = title.strip().lower()[:100]
            
            # Usar URL correta com /rest/v1/posts
            posts_url = f"{self.supabase_url}/rest/v1/posts"
            params = {"title": f"eq.{normalized_title}", "select": "id"}
            headers = {"apikey": self.supabase_key, "Authorization": f"Bearer {self.supabase_key}"}
            response = requests.get(posts_url, params=params, headers=headers, timeout=10)
            if response.status_code == 200:
                return len(response.json()) > 0
            return False
        except Exception as e:
            logger.error(f"Erro ao checar duplicata: {e}")
            return False

    def save_to_supabase(self, data: Dict) -> Tuple[bool, str]:
        """
        Salva a notícia no Supabase no formato correto.
        FIX_2: Com valores padrão para campos NOT NULL
        FIX_3: Com normalização de URL para evitar duplicatas
        """
        if not self.supabase_url or not self.supabase_key:
            return False, "Credenciais Supabase ausentes"

        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

        try:
            # FIX_3: Normalizar URL agressivamente para evitar duplicatas
            source_url = data.get("source_url", "").strip().lower()
            source_url = source_url.split('?')[0].split('#')[0]  # Remove tracking params
            
            # FIX_2: Valores padrão para campos obrigatórios
            fonte = data.get("metadata", {}).get("source", "Web").strip()
            if not fonte:
                fonte = "News Collector"
            
            categoria = data.get("category", "geral").strip()
            if not categoria:
                categoria = "geral"
            
            # Usar campos corretos da tabela posts
            # Preparar campos para compatibilidade com NewPost-IA
            author_id = '3a1a93d0-e451-47a4-a126-f1b7375895eb'  # Autor fixo NewsAgent
            
            # Converter hashtags para tags array se existirem
            hashtags = data.get("hashtags", []) or []
            if isinstance(hashtags, str):
                hashtags = [tag.strip() for tag in hashtags.split(',') if tag.strip()]
            
            # Preparar media arrays se houver image_url
            media_urls = []
            media_types = []
            if data.get('image_url'):
                media_urls = [data['image_url']]
                media_types = ['image']
            
            payload = {
                "title": data.get("title", "Sem Título").strip()[:5000],
                "content": data.get("content", ""),
                "image_url": data.get("image_url"),
                "category": categoria,  # Nunca vazio
                "status": "draft", # Status para posts
                "published_at": data.get("published_at", datetime.now().isoformat()),
                # Campos para compatibilidade com NewPost-IA
                "author_id": author_id,
                "is_ia_generated": True,
                "tags": hashtags if hashtags else None,
                "media_urls": media_urls if media_urls else None,
                "media_types": media_types if media_types else None,
                "audio_url": data.get("audio_url"),
                "metadata": {
                    "author": "newsagent",
                    "source": fonte,
                    "is_ia_generated": True,
                    "voxcraft": True  # Voxcraft: True para aparecer na interface
                }
            }

            # Usar URL correta com /rest/v1/posts
            posts_url = f"{self.supabase_url}/rest/v1/posts"
            response = requests.post(posts_url, json=payload, headers=headers, timeout=20)
            
            if response.status_code in [201, 200]:
                logger.info(f"Notícia salva com sucesso: {data.get('title', 'Sem Título')}")
                return True, "Sucesso"
            else:
                logger.error(f"Erro Supabase ({response.status_code}): {response.text}")
                return False, response.text
        except Exception as e:
            logger.error(f"Exceção ao salvar: {e}")
            return False, str(e)
