# 📰 NewsAgent - API de Coleta Automática de Notícias Brasileiras
# Agente inteligente para coleta, armazenamento e publicação automática de notícias

import json
import sqlite3
import requests
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse
import os
import sys
from bs4 import BeautifulSoup
import feedparser
import re
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

# Importar configuração da NewPost-IA
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
try:
    from newpost_config import get_newpost_config
except ImportError:
    def get_newpost_config():
        return {
            "url": "https://plugpost-ai.lovable.app",
            "api_endpoint": "/api/posts",
            "timeout": 10,
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "NewsAutoPost/1.0"
            }
        }

# Configuração Supabase da NewPost-IA (PROJETO ATIVO)
# Usa variáveis do .env se disponíveis, caso contrário usa fallback
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://hzmtdfojctctvgqjdbex.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bXRkZm9qY3RjdHZncWpkYmV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDUwMTIsImV4cCI6MjA3OTIyMTAxMn0.bv_6SFc_vNnw_eIyD73xNsRVXtL0guSbMRNuCthIy4Q")

from postgrest.exceptions import APIError

# Configuração de logging
# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('news_agent.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Fontes de notícias brasileiras
SOURCES = {
    "g1": {
        "url": "https://g1.globo.com",
        "name": "G1",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "politica": "/politica/"
        },
        "rss_feeds": {
            "brasil": "https://g1.globo.com/rss/g1/brasil/",
            "economia": "https://g1.globo.com/rss/g1/economia/",
            "tecnologia": "https://g1.globo.com/rss/g1/tecnologia/",
            "politica": "https://g1.globo.com/rss/g1/politica/"
        }
    },
    "uol": {
        "url": "https://noticias.uol.com.br",
        "name": "UOL",
        "categories": {
            "brasil": "/cotidiano/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "politica": "/politica/"
        },
        "rss_feeds": {
            "brasil": "http://rss.uol.com.br/feed/noticias.xml",
            "economia": "http://rss.uol.com.br/feed/economia.xml",
            "tecnologia": "http://rss.uol.com.br/feed/tecnologia.xml",
            "politica": "http://rss.uol.com.br/feed/noticias.xml"
        }
    },
    "folha": {
        "url": "https://www.folha.uol.com.br",
        "name": "Folha de S.Paulo",
        "categories": {
            "brasil": "/poder/brasil/",
            "economia": "/mercado/",
            "tecnologia": "/tec/",
            "politica": "/poder/"
        },
        "rss_feeds": {
            "brasil": "https://www1.folha.uol.com.br/rss/folha/poder/",
            "economia": "https://www1.folha.uol.com.br/rss/folha/mercado/",
            "tecnologia": "https://www1.folha.uol.com.br/rss/folha/tec/",
            "politica": "https://www1.folha.uol.com.br/rss/folha/poder/"
        }
    },
    "exame": {
        "url": "https://exame.com",
        "name": "Exame",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "politica": "/politica/"
        },
        "rss_feeds": {
            "economia": "https://exame.com/feed/rss/economia/",
            "tecnologia": "https://exame.com/feed/rss/tecnologia/"
        }
    },
    "veja": {
        "url": "https://veja.abril.com.br",
        "name": "Veja",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "politica": "/politica/"
        },
        "rss_feeds": {
            "brasil": "https://veja.abril.com.br/rss/veja/brasil.xml",
            "economia": "https://veja.abril.com.br/rss/veja/economia.xml",
            "politica": "https://veja.abril.com.br/rss/veja/politica.xml"
        }
    },
    "olhar_digital": {
        "url": "https://olhardigital.com.br",
        "name": "Olhar Digital",
        "categories": {
            "tecnologia": "/",
            "economia": "/mercado/",
            "brasil": "/brasil/"
        },
        "rss_feeds": {
            "tecnologia": "https://olhardigital.com.br/rss/"
        }
    },
    "forbes_brasil": {
        "url": "https://forbes.com.br",
        "name": "Forbes Brasil",
        "categories": {
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "brasil": "/brasil/"
        },
        "rss_feeds": {
            "economia": "https://forbes.com.br/feed/",
            "tecnologia": "https://forbes.com.br/feed/"
        }
    },
    "diario_nordeste": {
        "url": "https://diariodonordeste.verdesmares.com.br",
        "name": "Diário do Nordeste",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/"
        },
        "rss_feeds": {
            "brasil": "https://diariodonordeste.verdesmares.com.br/rss/brasil/",
            "economia": "https://diariodonordeste.verdesmares.com.br/rss/economia/"
        }
    },
    "gazeta_do_povo": {
        "url": "https://gazetadopovo.com.br",
        "name": "Gazeta do Povo",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/"
        },
        "rss_feeds": {
            "brasil": "https://gazetadopovo.com.br/rss/brasil.xml",
            "economia": "https://gazetadopovo.com.br/rss/economia.xml"
        }
    },
    "oglobo": {
        "url": "https://oglobo.globo.com",
        "name": "O Globo",
        "categories": {
            "brasil": "/brasil/",
            "economia": "/economia/",
            "tecnologia": "/tecnologia/",
            "politica": "/politica/"
        },
        "rss_feeds": {
            "brasil": "https://oglobo.globo.com/rss.xml",
            "economia": "https://oglobo.globo.com/economia/rss.xml"
        }
    }
}

class DatabaseManager:
    """Gerenciamento do banco de dados SQLite local"""
    
    def __init__(self, db_path: str = "news_cache.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Inicializa as tabelas do banco de dados"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                # Tabela de notícias
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS news (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        summary TEXT,
                        url TEXT UNIQUE NOT NULL,
                        source TEXT NOT NULL,
                        category TEXT NOT NULL,
                        published_at TEXT,
                        collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        published BOOLEAN DEFAULT FALSE,
                        image_url TEXT
                    )
                ''')
                
                # Tabela de status das fontes
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS source_status (
                        source TEXT PRIMARY KEY,
                        last_update TIMESTAMP,
                        status TEXT,
                        error_message TEXT
                    )
                ''')
                
                # Índices para performance
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_source ON news(source)')
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)')
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at)')
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_collected_at ON news(collected_at)')
                
                conn.commit()
                logger.info("Banco de dados inicializado com sucesso")
                
        except Exception as e:
            logger.error(f"Erro ao inicializar banco de dados: {e}")
            raise
    
    def save_news(self, news_data: List[Dict]) -> Tuple[int, int]:
        """Salva notícias no banco, retorna (salvos, duplicados)"""
        saved = 0
        duplicates = 0
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                
                for news in news_data:
                    try:
                        cursor.execute('''
                            INSERT OR IGNORE INTO news 
                            (title, summary, url, source, category, published_at, image_url)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            news.get('title', ''),
                            news.get('snippet', ''),
                            news.get('url', ''),
                            news.get('source', ''),
                            news.get('category', ''),
                            news.get('published_at', ''),
                            news.get('image_url', '')
                        ))
                        
                        if cursor.rowcount > 0:
                            saved += 1
                        else:
                            duplicates += 1
                            
                    except Exception as e:
                        logger.warning(f"Erro ao salvar notícia {news.get('url', 'unknown')}: {e}")
                
                conn.commit()
                logger.info(f"Notícias salvas: {saved}, duplicadas: {duplicates}")
                
        except Exception as e:
            logger.error(f"Erro ao salvar notícias no banco: {e}")
            
        return saved, duplicates
    
    def get_cached_news(self, limit: int = 50, category: str = None) -> List[Dict]:
        """Recupera notícias do cache local"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                query = '''
                    SELECT * FROM news 
                    WHERE collected_at > datetime('now', '-2 hours')
                '''
                params = []
                
                if category:
                    query += ' AND category = ?'
                    params.append(category)
                
                query += ' ORDER BY collected_at DESC LIMIT ?'
                params.append(limit)
                
                cursor.execute(query, params)
                rows = cursor.fetchall()
                
                return [dict(row) for row in rows]
                
        except Exception as e:
            logger.error(f"Erro ao recuperar notícias do cache: {e}")
            return []
    
    def update_source_status(self, source: str, status: str, error_message: str = None):
        """Atualiza status de uma fonte"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT OR REPLACE INTO source_status 
                    (source, last_update, status, error_message)
                    VALUES (?, ?, ?, ?)
                ''', (source, datetime.now().isoformat(), status, error_message))
                conn.commit()
        except Exception as e:
            logger.error(f"Erro ao atualizar status da fonte {source}: {e}")
    
    def get_source_status(self) -> Dict:
        """Retorna status de todas as fontes"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute('SELECT * FROM source_status ORDER BY last_update DESC')
                rows = cursor.fetchall()
                
                return {row['source']: {
                    'status': row['status'],
                    'last_update': row['last_update'],
                    'error_message': row['error_message']
                } for row in rows}
        except Exception as e:
            logger.error(f"Erro ao obter status das fontes: {e}")
            return {}

class NewsAgent:
    """Agente principal de coleta de notícias"""
    
    def __init__(self, db_path: str = "news_cache.db"):
        self.db = DatabaseManager(db_path)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        # Timeout padrão para requisições (10 segundos)
        self.timeout = 10

    def save_to_supabase(self, news: Dict):
        """Salva notícia na tabela posts (local) para aparecer na lista de Publicações Salvas"""
        AI_AUTHOR_ID = '3a1a93d0-e451-47a4-a126-f1b7375895eb'
        
        # Preparar payload com colunas do novo projeto
        payload = { 
            "author_id": AI_AUTHOR_ID, 
            "title": news.get("title", ""), 
            "content": news.get("content", news.get("summary", news.get("snippet", ""))), 
            "source_url": news.get("url", ""), 
            "category": news.get("category", "noticias"), 
            "is_ia_generated": True, 
            "status": "draft", # Usamos draft para curadoria, como antes
            "privacy": "public", 
            "published_at": datetime.now(timezone.utc).isoformat(), 
            "tags": [f"#{news.get('category', 'noticias')}", "#NewsAgent", "#LocutoresIA", "#Brasil"], 
            "media_urls": [news["image_url"]] if news.get("image_url") else [], 
            "media_types": ["image"] if news.get("image_url") else [], 
        }

        try:
            from supabase import create_client
            supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
            
            # Verificar se já existe
            existing = supabase.table('posts').select('id').eq('source_url', payload['source_url']).execute()
            if existing.data:
                logger.info(f"[SKIP] Ja existe em posts: {news.get('title', '')[:50]}...")
                return

            res = supabase.table("posts").insert(payload).execute()
            if res.data:
                logger.info(f"✅ Salvo no Supabase: {news['title'][:60]}... id={res.data[0]['id']}")
            else:
                logger.warning(f"⚠️ Post inserido mas sem retorno de dados")

        except APIError as e:
            code = getattr(e, "code", None) or (e.args[0].get("code") if e.args and isinstance(e.args[0], dict) else None)
            msg  = getattr(e, "message", str(e))
            details = getattr(e, "details", "")
            hint = getattr(e, "hint", "")

            if code == "23505":
                logger.warning(f"⏭️  DUPLICATA (source_url já existe): {payload['source_url']}")
            elif code == "42501":
                logger.error(
                    f"🔒 RLS BLOQUEOU INSERT (42501) — verifique se está usando SERVICE_ROLE_KEY.\n"
                    f"   URL: {payload['source_url']}"
                )
            elif code == "23502":
                logger.error(f"❌ NULL em coluna NOT NULL ({details}): {payload['source_url']}")
            elif code == "23503":
                logger.error(f"❌ FK inválida — author_id {AI_AUTHOR_ID} não existe em profiles")
            else:
                logger.error(
                    f"❌ Erro Supabase code={code} msg={msg} details={details} hint={hint}\n"
                    f"   payload={payload}"
                )

        except Exception as e:
            logger.exception(f"❌ Erro inesperado ao salvar {news.get('url')}: {e}")
        
    def _collect_g1(self, category: str) -> List[Dict]:
        """Coleta notícias do G1 via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["g1"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'g1')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'G1',
                    'source_key': 'g1',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do G1 ({category}): {e}")
            self.db.update_source_status('g1', 'error', str(e))
            
        return news_list
    
    def _collect_uol(self, category: str) -> List[Dict]:
        """Coleta notícias do UOL via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["uol"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'uol')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'UOL',
                    'source_key': 'uol',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do UOL ({category}): {e}")
            self.db.update_source_status('uol', 'error', str(e))
            
        return news_list
    
    def _collect_folha(self, category: str) -> List[Dict]:
        """Coleta notícias da Folha via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["folha"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:  # Limita a 5 para não sobrecarregar
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                # Busca conteúdo completo
                full_content = self._fetch_full_content(url, 'folha')
                
                # Usa o conteúdo do RSS se não conseguir buscar o completo
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    # Remove tags HTML do summary
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,  # Campo completo para o frontend
                    'content': full_content,    # Campo alternativo
                    'source': 'Folha de S.Paulo',
                    'source_key': 'folha',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                
                # Delay para não sobrecarregar o servidor
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar da Folha ({category}): {e}")
            self.db.update_source_status('folha', 'error', str(e))
            
        return news_list
    
    def _collect_exame(self, category: str) -> List[Dict]:
        """Coleta notícias do Exame via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["exame"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'exame')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Exame',
                    'source_key': 'exame',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do Exame ({category}): {e}")
            self.db.update_source_status('exame', 'error', str(e))
            
        return news_list
    
    def _collect_veja(self, category: str) -> List[Dict]:
        """Coleta notícias da Veja via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["veja"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'veja')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Veja',
                    'source_key': 'veja',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar da Veja ({category}): {e}")
            self.db.update_source_status('veja', 'error', str(e))
            
        return news_list
    
    def _collect_olhar_digital(self, category: str) -> List[Dict]:
        """Coleta notícias do Olhar Digital via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["olhar_digital"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'olhar_digital')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Olhar Digital',
                    'source_key': 'olhar_digital',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do Olhar Digital ({category}): {e}")
            self.db.update_source_status('olhar_digital', 'error', str(e))
            
        return news_list
    
    def _collect_forbes_brasil(self, category: str) -> List[Dict]:
        """Coleta notícias da Forbes Brasil via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["forbes_brasil"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'forbes_brasil')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Forbes Brasil',
                    'source_key': 'forbes_brasil',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar da Forbes Brasil ({category}): {e}")
            self.db.update_source_status('forbes_brasil', 'error', str(e))
            
        return news_list
    
    def _collect_diario_nordeste(self, category: str) -> List[Dict]:
        """Coleta notícias do Diário do Nordeste via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["diario_nordeste"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'diario_nordeste')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Diário do Nordeste',
                    'source_key': 'diario_nordeste',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do Diário do Nordeste ({category}): {e}")
            self.db.update_source_status('diario_nordeste', 'error', str(e))
            
        return news_list
    
    def _collect_gazeta_do_povo(self, category: str) -> List[Dict]:
        """Coleta notícias da Gazeta do Povo via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["gazeta_do_povo"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'gazeta_do_povo')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'Gazeta do Povo',
                    'source_key': 'gazeta_do_povo',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar da Gazeta do Povo ({category}): {e}")
            self.db.update_source_status('gazeta_do_povo', 'error', str(e))
            
        return news_list
    
    def _collect_oglobo(self, category: str) -> List[Dict]:
        """Coleta notícias do O Globo via RSS com conteúdo completo"""
        news_list = []
        try:
            rss_url = SOURCES["oglobo"]["rss_feeds"].get(category)
            if not rss_url:
                return news_list
                
            feed = feedparser.parse(rss_url)
            
            for entry in feed.entries[:5]:
                url = entry.get('link', '')
                title = entry.get('title', '')
                
                if not title or not url:
                    continue
                
                full_content = self._fetch_full_content(url, 'oglobo')
                rss_summary = entry.get('summary', '')
                if not full_content and rss_summary:
                    soup = BeautifulSoup(rss_summary, 'html.parser')
                    full_content = soup.get_text(strip=True)
                
                news_data = {
                    'title': title,
                    'url': url,
                    'snippet': full_content[:200] if full_content else rss_summary[:200],
                    'summary': full_content,
                    'content': full_content,
                    'source': 'O Globo',
                    'source_key': 'oglobo',
                    'category': category,
                    'published_at': self._parse_date(entry.get('published')),
                    'image_url': self._extract_image(rss_summary)
                }
                
                news_list.append(news_data)
                time.sleep(0.5)
                    
        except Exception as e:
            logger.error(f"Erro ao coletar do O Globo ({category}): {e}")
            self.db.update_source_status('oglobo', 'error', str(e))
            
        return news_list
    
    def _parse_date(self, date_str: str) -> str:
        """Parse de datas para formato padrão"""
        if not date_str:
            return datetime.now().strftime('%d/%m/%Y %H:%M')
        
        try:
            # Tenta vários formatos de data
            formats = [
                '%a, %d %b %Y %H:%M:%S %Z',
                '%Y-%m-%dT%H:%M:%S%z',
                '%Y-%m-%dT%H:%M:%SZ',
                '%Y-%m-%d %H:%M:%S'
            ]
            
            for fmt in formats:
                try:
                    dt = datetime.strptime(date_str.strip(), fmt)
                    return dt.strftime('%d/%m/%Y %H:%M')
                except ValueError:
                    continue
                    
        except Exception:
            pass
            
        return datetime.now().strftime('%d/%m/%Y %H:%M')
    
    def _extract_image(self, content: str) -> str:
        """Extrai URL da imagem do conteúdo HTML"""
        try:
            if not content:
                return ""
                
            soup = BeautifulSoup(content, 'html.parser')
            img_tag = soup.find('img')
            
            if img_tag and img_tag.get('src'):
                src = img_tag['src']
                # Converte URLs relativas para absolutas
                if src.startswith('//'):
                    return 'https:' + src
                elif src.startswith('/'):
                    return 'https://exame.com' + src  # Fallback
                return src
                
        except Exception as e:
            logger.debug(f"Erro ao extrair imagem: {e}")
            
        return ""
    
    def _fetch_full_content(self, url: str, source_key: str) -> str:
        """Busca conteúdo completo da notícia acessando a URL"""
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Seletores específicos por fonte
            selectors = {
                'g1': ['.mc-article-body__content', 'article', '.content-text__container', 'p.content-text__container'],
                'uol': ['.text', '.article-content', 'article', '.content'],
                'folha': ['.c-news__body', '.article-body', 'article', '.content'],
                'exame': ['.article-content', '.post-content', 'article', '.content'],
                'veja': ['.article-content', '.post-content', 'article', '.content'],
                'olhar_digital': ['.article-content', '.post-content', 'article'],
                'forbes_brasil': ['.article-content', '.post-content', 'article', '.content'],
                'diario_nordeste': ['.article-content', '.post-content', 'article'],
                'gazeta_do_povo': ['.article-content', '.post-content', 'article', '.content'],
                'oglobo': ['.article-content', '.post-content', 'article', '.content', '[data-testid="article-content"]', '.c-news__body']
            }
            
            content_parts = []
            
            # Tenta os seletores específicos da fonte
            for selector in selectors.get(source_key, ['article', '.content', '.entry-content', 'main']):
                elements = soup.select(selector)
                if elements:
                    for elem in elements:
                        # Remove scripts e estilos
                        for script in elem.find_all(['script', 'style', 'nav', 'header', 'footer']):
                            script.decompose()
                        text = elem.get_text(strip=True, separator=' ')
                        if len(text) > 100:
                            content_parts.append(text)
                    break
            
            if content_parts:
                full_content = ' '.join(content_parts)
                logger.info(f"[CONTENT OK] Conteúdo extraído de {url}: {len(full_content)} caracteres")
                # Limita a 2000 caracteres
                return full_content[:2000] + ('...' if len(full_content) > 2000 else '')
            
            # Fallback: busca todos os parágrafos
            paragraphs = soup.find_all('p')
            text_parts = []
            for p in paragraphs:
                text = p.get_text(strip=True)
                if len(text) > 50:
                    text_parts.append(text)
            
            if text_parts:
                full_text = ' '.join(text_parts[:10])  # Primeiros 10 parágrafos
                return full_text[:1500] + ('...' if len(full_text) > 1500 else '')
            
            return ""
            
        except Exception as e:
            logger.warning(f"[CONTENT ERROR] Erro ao buscar conteúdo de {url}: {e}")
            return ""
    
    def collect_from_source(self, source: str, category: str) -> List[Dict]:
        """Coleta notícias de uma fonte específica"""
        if source not in SOURCES:
            logger.error(f"Fonte não encontrada: {source}")
            return []
        
        # Mapeamento para métodos de coleta
        collectors = {
            'g1': self._collect_g1,
            'uol': self._collect_uol,
            'folha': self._collect_folha,
            'exame': self._collect_exame,
            'veja': self._collect_veja,
            'olhar_digital': self._collect_olhar_digital,
            'forbes_brasil': self._collect_forbes_brasil,
            'diario_nordeste': self._collect_diario_nordeste,
            'gazeta_do_povo': self._collect_gazeta_do_povo,
            'oglobo': self._collect_oglobo
        }
        
        collector = collectors.get(source)
        if not collector:
            logger.error(f"Coletor não encontrado para fonte: {source}")
            return []
        
        try:
            news_list = collector(category)
            
            # Atualiza status da fonte
            if news_list:
                self.db.update_source_status(source, 'success')
                logger.info(f"Coletadas {len(news_list)} notícias de {SOURCES[source]['name']} - {category}")
            else:
                self.db.update_source_status(source, 'no_news', 'Nenhuma notícia encontrada')
                
            return news_list
            
        except Exception as e:
            logger.error(f"Erro ao coletar de {source}: {e}")
            self.db.update_source_status(source, 'error', str(e))
            return []
    
    def execute_collection(self, enabled_sources: Dict[str, bool], categories: List[str], limit: int = 50) -> Dict:
        """Executa coleta de notícias com filtros"""
        all_news = []
        collection_stats = {}
        
        for source_key, enabled in enabled_sources.items():
            if not enabled:
                continue
                
            source_news = []
            for category in categories:
                news_batch = self.collect_from_source(source_key, category)
                source_news.extend(news_batch)
                
                # Limita por fonte
                if len(source_news) >= limit // len([s for s in enabled_sources if enabled_sources[s]]):
                    break
            
            collection_stats[source_key] = {
                'collected': len(source_news),
                'error': None
            }
            
            all_news.extend(source_news)
        
        # Salva no banco local
        saved, duplicates = self.db.save_news(all_news)
        
        # Salva no Supabase (tabela posts) para aparecer no dashboard
        logger.info(f"[SAVE] Tentando salvar {len(all_news)} notícias no Supabase...")
        supabase_saved = 0
        for news in all_news:
            try:
                self.save_to_supabase(news)
                supabase_saved += 1
            except Exception as e:
                logger.error(f"[SAVE ERROR] Falha ao salvar notícia: {e}")
        logger.info(f"[SAVE] Total salvo no Supabase: {supabase_saved}/{len(all_news)}")
        
        # Limita resultado final
        limited_news = all_news[:limit]
        
        return {
            'success': True,
            'total_news': len(limited_news),
            'news': limited_news,
            'collection_stats': collection_stats,
            'saved_to_cache': saved,
            'duplicates_found': duplicates,
            'timestamp': datetime.now().isoformat()
        }
    
    def get_sources(self) -> Dict:
        """Retorna lista de fontes disponíveis"""
        sources_list = []
        
        for source_key, source_config in SOURCES.items():
            sources_list.append({
                'id': source_key,
                'label': source_config['name'],
                'url': source_config['url'],
                'categories': list(source_config['categories'].keys())
            })
        
        return {
            'success': True,
            'sources': sources_list,
            'total_sources': len(sources_list),
            'timestamp': datetime.now().isoformat()
        }
    
    def get_cached_news(self, limit: int = 50, category: str = None) -> Dict:
        """Retorna notícias do cache local"""
        cached_news = self.db.get_cached_news(limit, category)
        
        return {
            'success': True,
            'total_cached': len(cached_news),
            'news': cached_news,
            'timestamp': datetime.now().isoformat()
        }
    
    def get_status(self) -> Dict:
        """Retorna status do agente e fontes"""
        source_status = self.db.get_source_status()
        
        return {
            'success': True,
            'status': source_status,
            'agent_ok': True,
            'timestamp': datetime.now().isoformat()
        }
    
    def health_check(self) -> Dict:
        """Health check do serviço"""
        try:
            # Testa conexão com banco
            cached = self.db.get_cached_news(1)
            
            return {
                'success': True,
                'status': 'healthy',
                'agent_ok': True,
                'database_ok': True,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            return {
                'success': False,
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }

# Instância global para ser usada pelo Flask/Backend
news_agent = NewsAgent()

# Função principal para testes
if __name__ == "__main__":
    # Teste de coleta
    print("🔍 Testando coleta de notícias...")
    
    # Testa fontes
    sources = agent.get_sources()
    print(f"Fontes disponíveis: {sources['total_sources']}")
    
    # Testa coleta do G1
    g1_news = agent.collect_from_source('g1', 'brasil')
    print(f"Notícias do G1: {len(g1_news)}")
    
    # Testa cache
    cached = agent.get_cached_news(5)
    print(f"Notícias em cache: {cached['total_cached']}")
    
    # Testa status
    status = agent.get_status()
    print(f"Status: {status['status']}")
    
    print("✅ Testes concluídos!")
