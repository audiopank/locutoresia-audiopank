"""
Agente Jornalístico Automatizado - NewPost-IA
Coleta, processa e publica notícias de fontes brasileiras confiáveis
"""

import json
import uuid
import time
import requests
import re
import os
import sys
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

# Adicionar diretório raiz ao path para encontrar o módulo 'core'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configuração
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configurações Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.endswith("/rest/v1/posts"):
    SUPABASE_URL = f"{SUPABASE_URL.rstrip('/')}/rest/v1/posts"
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY", "")

# Fontes de notícias brasileiras
NEWS_SOURCES = {
    "exame": {
        "domain": "exame.com.br",
        "url": "https://www.exame.com.br",
        "categories": ["tecnologia", "negocios", "economia"],
        "name": "Exame"
    },
    "veja": {
        "domain": "veja.com.br",
        "url": "https://www.veja.com.br",
        "categories": ["economia", "politica", "brasil"],
        "name": "Veja"
    },
    "folha": {
        "domain": "folha.uol.com.br",
        "url": "https://www.folha.uol.com.br",
        "categories": ["mercado", "cotidiano", "brasil"],
        "name": "Folha de S.Paulo"
    },
    "g1": {
        "domain": "g1.globo.com",
        "url": "https://g1.globo.com",
        "categories": ["economia", "tecnologia", "brasil"],
        "name": "G1"
    }
}

from core.news_utils import NewsUtils

class NewsAgent:
    def __init__(self):
        self.cycle_id = str(uuid.uuid4())
        self.start_time = datetime.utcnow()
        self.news_utils = NewsUtils()
        self.stats = {
            "news_collected": 0,
            "news_validated": 0,
            "news_published": 0,
            "duplicates_found": 0,
            "validation_failed": 0,
            "supabase_errors": 0,
            "sources_success": [],
            "sources_failed": [],
            "news_collected_by_source": {source: 0 for source in NEWS_SOURCES.keys()}
        }
        self.errors = []
        
    def log_info(self, message: str):
        """Registra informação no log"""
        logger.info(f"[{self.cycle_id[:8]}] {message}")
        
    def log_error(self, message: str, error_type: str = "general"):
        """Registra erro no log"""
        error_msg = {
            "type": error_type,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "cycle_id": self.cycle_id
        }
        self.errors.append(error_msg)
        logger.error(f"[{self.cycle_id[:8]}] ERROR: {message}")
        
    def web_search(self, query: str, max_results: int = 5) -> List[Dict]:
        """
        Simula busca web por notícias usando as NewsUtils
        """
        return self.news_utils.fetch_web_search(query, max_results)
    
    def extract_news_data(self, result: Dict, source: str, category: str) -> Optional[Dict]:
        """Extrai e estrutura dados da notícia"""
        try:
            return {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "source": NEWS_SOURCES[source]["name"],
                "source_domain": NEWS_SOURCES[source]["domain"],
                "published_at": result.get("published_at", ""),
                "snippet": result.get("snippet", ""),
                "category": category,
                "image_url": None
            }
        except Exception as e:
            self.log_error(f"Erro ao extrair dados: {str(e)}", "parse")
            return None
    
    def collect_from_source(self, source_key: str, category: str) -> List[Dict]:
        """Coleta notícias de uma fonte específica"""
        try:
            self.log_info(f"Coletando notícias de {NEWS_SOURCES[source_key]['name']} - {category}")
            
            # Construir query de busca
            domain = NEWS_SOURCES[source_key]["domain"]
            query = f"site:{domain} {category}"
            
            # Buscar notícias
            results = self.web_search(query, max_results=3)
            
            collected_news = []
            for result in results:
                news_data = self.extract_news_data(result, source_key, category)
                if news_data:
                    collected_news.append(news_data)
                    self.stats["news_collected"] += 1
                    self.stats["news_collected_by_source"][source_key] += 1
            
            self.stats["sources_success"].append(f"{NEWS_SOURCES[source_key]['name']} - {category}")
            return collected_news
            
        except Exception as e:
            self.stats["sources_failed"].append(f"{NEWS_SOURCES[source_key]['name']} - {category}")
            self.log_error(f"Erro ao coletar de {source_key}: {str(e)}", "fetch")
            return []
    
    def run_cycle(self) -> Dict:
        """Executa ciclo completo de coleta e publicação (Consolidado)"""
        self.log_info("Iniciando ciclo multicanal consolidado (status: draft)")
        
        all_news = []
        for source_key, source_config in NEWS_SOURCES.items():
            for category in source_config["categories"]:
                news_batch = self.collect_from_source(source_key, category)
                all_news.extend(news_batch)
                time.sleep(1)
        
        # Processar e Publicar usando NewsUtils
        for news_data in all_news:
            try:
                # 1. Normalizar
                processed = self.news_utils.normalize_news(news_data)
                
                # 2. Verificar Duplicata
                if self.news_utils.is_duplicate(processed["source_url"]):
                    self.stats["duplicates_found"] += 1
                    continue
                
                # 3. Publicar como Draft
                success, msg = self.news_utils.save_to_supabase(processed)
                if success:
                    self.stats["news_published"] += 1
                else:
                    self.stats["supabase_errors"] += 1
            except Exception as e:
                self.log_error(f"Erro no ciclo principal: {e}")

        
        # Gerar log final
        end_time = datetime.utcnow()
        execution_time = (end_time - self.start_time).total_seconds()
        
        log_entry = {
            "id": self.cycle_id,
            "cycle_id": self.cycle_id,
            "execution_timestamp": self.start_time.isoformat(),
            "task_name": "Coleta Multicanal - Exame, Veja, Folha, G1",
            "status": "success" if self.stats["news_published"] > 0 else "failed",
            
            "ESTATISTICAS": {
                **self.stats,
                "execution_time_seconds": execution_time,
                "avg_processing_time_per_news": execution_time / max(1, self.stats["news_collected"])
            },
            
            "ERROS": {
                "errors_count": len(self.errors),
                "error_details": self.errors
            },
            
            "MENSAGEM": f"Coletou {self.stats['news_collected']} notícias, publicou {self.stats['news_published']}, removeu {self.stats['duplicates_found']} duplicatas"
        }
        
        # Salvar log em arquivo (usar /tmp na Vercel)
        log_dir = "/tmp" if os.environ.get('VERCEL') else "."
        log_filename = f"news_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        log_path = os.path.join(log_dir, log_filename)
        
        with open(log_path, "w", encoding='utf-8') as f:
            json.dump(log_entry, f, ensure_ascii=False, indent=2)
        
        self.log_info(f"Ciclo finalizado. Status: {log_entry['status']}")
        return log_entry

# Função principal para execução
def main():
    """Função principal para executar o agente de notícias"""
    agent = NewsAgent()
    result = agent.run_cycle()
    
    print("\n=== RESUMO DA EXECUÇÃO ===")
    print(f"Status: {result['status']}")
    print(f"Notícias coletadas: {result['ESTATISTICAS']['news_collected']}")
    print(f"Notícias publicadas: {result['ESTATISTICAS']['news_published']}")
    print(f"Duplicatas removidas: {result['ESTATISTICAS']['duplicates_found']}")
    print(f"Tempo de execução: {result['ESTATISTICAS']['execution_time_seconds']:.2f} segundos")
    print("=== FIM ===")

# Instância global do NewsAgent
news_agent = NewsAgent()

# Função principal para execução
def main():
    """Função principal para executar o agente de notícias"""
    agent = NewsAgent()
    result = agent.run_cycle()
    
    print("\n=== RESUMO DA EXECUÇÃO ===")
    print(f"Status: {result['status']}")
    print(f"Notícias coletadas: {result['ESTATISTICAS']['news_collected']}")
    print(f"Notícias publicadas: {result['ESTATISTICAS']['news_published']}")
    print(f"Duplicatas removidas: {result['ESTATISTICAS']['duplicates_found']}")
    print(f"Tempo de execução: {result['ESTATISTICAS']['execution_time_seconds']:.2f} segundos")
    print("=== FIM ===")

if __name__ == "__main__":
    main()
