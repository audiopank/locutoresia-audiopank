import sqlite3
import logging
import os
import tempfile
from datetime import datetime
from typing import List, Dict, Tuple

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DatabaseManager:
    """Gerenciamento do banco de dados SQLite local para cache de notícias"""
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            if os.environ.get('VERCEL'):
                # Vercel (serverless): filesystem read-only, exceto /tmp.
                # O cache é efêmero, mas suficiente — fetch_and_publish usa use_cache=False.
                self.db_path = os.path.join(tempfile.gettempdir(), "news_cache.db")
            else:
                # Local: usar o diretório backend para o banco
                backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                self.db_path = os.path.join(backend_dir, "backend", "news_cache.db")
        else:
            self.db_path = db_path
        
        # Garantir que o diretório exista
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
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
