import os
import logging
import time
import uuid
import re
import requests
from typing import List, Dict, Any
from datetime import datetime
from bs4 import BeautifulSoup

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False
    logging.error("⚠️ feedparser não instalado! Instale com: pip install feedparser")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RSSFetcher:
    """Busca notícias reais via RSS de múltiplas fontes brasileiras"""

    # Mapeia a categoria recebida (que vem capitalizada/acentuada do config,
    # ex.: "Tecnologia", "Economia", "Esportes") para a CHAVE canônica usada
    # nos rss_feeds das fontes. Era essa a causa de cair sempre no mock:
    # "Tecnologia" não casava com a chave "tecnologia".
    CATEGORY_ALIASES = {
        "tecnologia": "tecnologia", "tech": "tecnologia", "technology": "tecnologia",
        "economia": "economia", "economy": "economia", "financas": "economia",
        "negocios": "economia", "mercado": "economia", "dinheiro": "economia",
        "esporte": "esporte", "esportes": "esporte", "sports": "esporte", "futebol": "esporte",
        "politica": "politica", "poder": "politica",
        "brasil": "brasil", "geral": "brasil", "noticias": "brasil",
        "saude": "saude", "ciencia": "ciencia", "tecnologia e ciencia": "tecnologia",
    }

    @staticmethod
    def _canonical_category(category: str) -> str:
        """Normaliza (sem acento/minúsculo) e mapeia para a chave de feed."""
        import unicodedata
        raw = unicodedata.normalize("NFKD", category or "")
        raw = "".join(c for c in raw if not unicodedata.combining(c)).lower().strip()
        return RSSFetcher.CATEGORY_ALIASES.get(raw, raw or "brasil")

    # Fontes de notícias completas (do código que você compartilhou)
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
                "politica": "https://g1.globo.com/rss/g1/politica/",
                "esporte": "https://ge.globo.com/rss/ge/"
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
                "politica": "http://rss.uol.com.br/feed/noticias.xml",
                "esporte": "http://rss.uol.com.br/feed/esporte.xml"
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

    MOCK_NEWS = {
        "Tecnologia": [
            {"title": "IA revoluciona mercado de trabalho", "summary": "Novos modelos de IA estão transformando a forma como trabalhamos."},
            {"title": "5 tendências de tecnologia para 2026", "summary": "Veja as tecnologias que vão dominar o mercado este ano."},
            {"title": "Ferramentas de IA essenciais para produtividade", "summary": "Aumente sua produtividade com essas ferramentas de IA."}
        ],
        "Economia": [
            {"title": "Mercados em alta: oportunidades para investidores", "summary": "A bolsa de valores mostra sinais de recuperação."},
            {"title": "Dicas de investimento para iniciantes", "summary": "Comece a investir com essas dicas simples e práticas."},
            {"title": "Economia brasileira: perspectivas para 2026", "summary": "Analistas preveem crescimento para a economia brasileira."}
        ],
        "Esportes": [
            {"title": "Brasil vence partida importante", "summary": "Seleção brasileira conquista vitória em jogo emocionante."},
            {"title": "Novos talentos surgem no futebol brasileiro", "summary": "Jovens promessas estão se destacando nos clubes."},
            {"title": "Atleta brasileiro conquista medalha de ouro", "summary": "Vitória histórica para o esporte nacional."}
        ],
        "Política": [
            {"title": "Reforma aprovada no Congresso", "summary": "Nova lei promete mudanças significativas."},
            {"title": "Governo anuncia programa de investimentos", "summary": "Novos recursos para infraestrutura e educação."},
            {"title": "Debate político ganha destaque nas redes", "summary": "Discussões sobre o futuro do país movimentam a internet."}
        ],
        "Saúde": [
            {"title": "Pesquisa revela benefícios da meditação", "summary": "Estudo mostra impacto positivo na saúde mental."},
            {"title": "Dicas de alimentação saudável", "summary": "Melhore sua dieta com essas recomendações."},
            {"title": "Vacinação: importância para a saúde pública", "summary": "Entenda por que se vacinar é fundamental."}
        ],
        "Ciência": [
            {"title": "Descoberta científica revoluciona área da saúde", "summary": "Novos tratamentos prometem salvar vidas."},
            {"title": "Exploração espacial: missão envia dados importantes", "summary": "Sonda espacial coleta informações sobre o universo."},
            {"title": "Pesquisa brasileira ganha destaque internacional", "summary": "Trabalho de cientistas brasileiros é reconhecido mundialmente."}
        ],
        "Entretenimento": [
            {"title": "Lançamento de filme aguardado", "summary": "Produção cinematográfica chega aos cinemas."},
            {"title": "Cantor brasileiro lança novo álbum", "summary": "Novo trabalho musical promete fazer sucesso."},
            {"title": "Série viraliza nas plataformas de streaming", "summary": "Produção original conquista milhares de fãs."}
        ],
        "Cultura": [
            {"title": "Exposição de arte abre no centro cultural", "summary": "Mostra apresenta trabalhos de artistas contemporâneos."},
            {"title": "Festival de música atrai multidão", "summary": "Evento cultural reúne artistas de diversos estilos."},
            {"title": "Livro brasileiro ganha prêmio internacional", "summary": "Obra literária é reconhecida por sua qualidade."}
        ],
        "Notícias Gerais": [
            {"title": "Notícia do dia: atualização importante", "summary": "Acompanhe as principais notícias do dia."},
            {"title": "Evento comunitário une moradores", "summary": "Ação social promove integração na comunidade."},
            {"title": "Clima: previsão para os próximos dias", "summary": "Confira as condições meteorológicas da região."}
        ]
    }

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.timeout = 10

    def _extract_image(self, html_content: str) -> str:
        """Extrai a primeira imagem do conteúdo HTML"""
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            img_tag = soup.find('img')
            if img_tag and img_tag.get('src'):
                return img_tag['src']
        except Exception as e:
            logger.warning(f"Erro ao extrair imagem: {e}")
        return ""

    def _parse_date(self, date_str: str) -> str:
        """Parses a date string to ISO format"""
        try:
            if not date_str:
                return datetime.now().isoformat()
            
            # Try to parse common date formats
            from dateutil import parser
            parsed_date = parser.parse(date_str, fuzzy=True)
            return parsed_date.isoformat()
        except Exception as e:
            logger.warning(f"Erro ao parsear data: {e}")
            return datetime.now().isoformat()

    def _fetch_full_content(self, url: str, source: str) -> str:
        """Busca o conteúdo completo da notícia (se implementado)"""
        try:
            logger.info(f"Buscando conteúdo completo de: {url}")
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Métodos genéricos para tentar extrair o conteúdo
            content_selectors = [
                'article',
                '.article-content',
                '.content',
                '.entry-content',
                '.post-content',
                'main'
            ]
            
            for selector in content_selectors:
                content = soup.select_one(selector)
                if content:
                    text = content.get_text(separator='\n', strip=True)
                    if len(text) > 100:
                        return text
                        
        except Exception as e:
            logger.warning(f"Erro ao buscar conteúdo completo: {e}")
        
        return ""

    def _parse_feed(self, rss_url: str):
        """Baixa o RSS com timeout próprio (feedparser sozinho não tem) e parseia."""
        try:
            resp = self.session.get(rss_url, timeout=self.timeout)
            resp.raise_for_status()
            return feedparser.parse(resp.content)
        except Exception as e:
            logger.warning(f"Falha ao baixar feed {rss_url}: {e}")
            # Última tentativa: deixa o feedparser resolver a URL sozinho
            try:
                return feedparser.parse(rss_url)
            except Exception:
                return None

    def _entry_to_news(self, entry, source_name: str, source_key: str, category: str) -> Dict:
        """Converte uma entrada de RSS no formato interno, usando só o resumo
        do RSS (sem scrape pesado da página — rápido e seguro no serverless)."""
        rss_summary = entry.get('summary', '') or entry.get('description', '')
        clean = rss_summary
        if rss_summary:
            try:
                clean = BeautifulSoup(rss_summary, 'html.parser').get_text(strip=True)
            except Exception:
                clean = rss_summary
        return {
            'title': entry.get('title', ''),
            'url': entry.get('link', ''),
            'snippet': clean[:200],
            'summary': clean,
            'content': clean,
            'source': source_name,
            'source_key': source_key,
            'category': category,
            'published_at': self._parse_date(entry.get('published') or entry.get('updated')),
            'image_url': self._extract_image(rss_summary)
        }

    def _collect_from_source(self, source_key: str, category: str, limit: int = 5) -> List[Dict]:
        """Coleta notícias de uma fonte específica (category já canônica)."""
        news_list = []
        source = self.SOURCES.get(source_key)
        if not source:
            return news_list

        rss_url = source['rss_feeds'].get(category)
        if not rss_url:
            return news_list

        logger.info(f"🔍 Buscando notícias de {source['name']} - {category}")
        feed = self._parse_feed(rss_url)
        if not feed or not getattr(feed, 'entries', None):
            return news_list

        for entry in feed.entries[:limit]:
            if not entry.get('title') or not entry.get('link'):
                continue
            news_list.append(self._entry_to_news(entry, source['name'], source_key, category))
        return news_list

    def _collect_from_google_news(self, category: str, limit: int = 5) -> List[Dict]:
        """Fonte de segurança: Google Notícias (RSS de busca) garante notícia
        REAL para qualquer categoria — inclusive as sem feed nativo."""
        query_map = {
            "tecnologia": "tecnologia", "economia": "economia",
            "esporte": "esporte brasil", "politica": "política brasil",
            "brasil": "brasil", "saude": "saúde", "ciencia": "ciência",
        }
        termo = query_map.get(category, category)
        url = ("https://news.google.com/rss/search?q="
               + requests.utils.quote(f"{termo} when:1d")
               + "&hl=pt-BR&gl=BR&ceid=BR:pt-419")
        feed = self._parse_feed(url)
        if not feed or not getattr(feed, 'entries', None):
            return []
        news_list = []
        for entry in feed.entries[:limit]:
            if not entry.get('title'):
                continue
            news_list.append(self._entry_to_news(entry, "Google Notícias", "google_news", category))
        return news_list

    def fetch_news(self, category: str = "Tecnologia", limit: int = 7) -> List[Dict[str, Any]]:
        """
        Busca notícias por categoria via RSS real.
        Estratégia: fontes nativas → Google Notícias (fallback real) → mock.
        """
        if not HAS_FEEDPARSER:
            logger.warning("⚠️ feedparser não disponível, usando notícias mockadas")
            return self._get_mock_news(category, limit)

        canonical = self._canonical_category(category)
        all_news = []

        # 1) Fontes nativas que tenham feed para a categoria canônica.
        #    Para no momento em que já temos o suficiente (evita timeout).
        for source_key, source in self.SOURCES.items():
            if canonical in source.get('rss_feeds', {}):
                all_news.extend(self._collect_from_source(source_key, canonical, limit))
                if len(all_news) >= limit:
                    break

        # 2) Se nada veio das nativas, tenta o Google Notícias (real).
        if not all_news:
            logger.info(f"ℹ️ Sem resultado nas fontes nativas para '{category}', tentando Google Notícias")
            all_news = self._collect_from_google_news(canonical, limit)

        all_news = all_news[:limit]

        # 3) Último recurso: mock (mantém o sistema funcionando se tudo falhar).
        if not all_news:
            logger.warning("⚠️ Nenhuma notícia real encontrada, usando mock")
            return self._get_mock_news(category, limit)

        # Converte para o formato esperado pelo resto do sistema
        news_list = []
        for news in all_news:
            news_list.append({
                "titulo": news["title"],
                "resumo": news["snippet"],
                "conteudo_completo": news["content"],
                "fonte": news["source"],
                "link": news["url"],
                "imagem_url": news.get("image_url", ""),
                "data_publicacao": news["published_at"]
            })

        # Remove notícias com conteúdo sensível (crimes/violência) antes de devolver
        try:
            from .content_filter import filter_news
            news_list, _blocked = filter_news(news_list)
        except Exception as e:
            logger.warning(f"Filtro de conteúdo indisponível: {e}")

        logger.info(f"✅ {len(news_list)} notícias encontradas para categoria: {category}")
        return news_list

    def _get_mock_news(self, category: str, limit: int) -> List[Dict[str, Any]]:
        """Retorna notícias mockadas para fallback"""
        mock = self.MOCK_NEWS.get(category, self.MOCK_NEWS["Notícias Gerais"])
        news_list = []
        for item in mock[:limit]:
            news_list.append({
                "titulo": item["title"],
                "resumo": item["summary"],
                "conteudo_completo": item["summary"],
                "fonte": "Fonte Mock",
                "link": "",
                "imagem_url": "",
                "data_publicacao": datetime.now().isoformat()
            })
        return news_list

    def get_categories(self) -> List[str]:
        """Retorna lista de categorias disponíveis"""
        return list(self.MOCK_NEWS.keys())

    def get_sources(self) -> List[str]:
        """Retorna lista de fontes disponíveis"""
        return list(self.SOURCES.keys())
