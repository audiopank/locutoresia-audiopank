import os
import logging
from typing import List, Dict, Any
from datetime import datetime

try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False
    logging.error("⚠️ feedparser não instalado! Instale com: pip install feedparser")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RSSFetcher:
    """Busca notícias reais via RSS de múltiplas fontes"""

    RSS_FEEDS = {
        "Tecnologia": [
            "https://g1.globo.com/rss/g1/tecnologia/",
            "https://techtudo.com.br/rss/feed/",
            "https://olhardigital.com.br/feed/",
            "https://exame.com/tecnologia/feed/"
        ],
        "Economia": [
            "https://exame.com/mercados/feed/",
            "https://g1.globo.com/rss/g1/economia/",
            "https://forbes.com.br/feed/"
        ],
        "Esportes": [
            "https://ge.globo.com/rss/ultimas-noticias/",
            "https://www.lance.com.br/rss/ultimas-noticias/",
            "https://globoesporte.globo.com/rss/feed/"
        ],
        "Política": [
            "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
            "https://noticias.uol.com.br/politica/ultimas-noticias/feed/",
            "https://g1.globo.com/rss/g1/politica/"
        ],
        "Saúde": [
            "https://g1.globo.com/rss/g1/saude/",
            "https://noticias.uol.com.br/saude/ultimas-noticias/feed/"
        ],
        "Ciência": [
            "https://g1.globo.com/rss/g1/ciencia-e-saude/",
            "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml"
        ],
        "Entretenimento": [
            "https://g1.globo.com/rss/g1/pop-arte/",
            "https://entretenimento.uol.com.br/feed/ultimas-noticias/"
        ],
        "Turismo": [
            "https://g1.globo.com/rss/g1/turismo-e-viagem/",
            "https://veja.abril.com.br/feed/turismo/"
        ],
        "Cultura": [
            "https://g1.globo.com/rss/g1/pop-arte/",
            "https://veja.abril.com.br/feed/cultura/"
        ],
        "Notícias Gerais": [
            "https://g1.globo.com/rss/g1/",
            "https://oglobo.globo.com/rss/",
            "https://gazetadopovo.com.br/feed/",
            "https://diariodonordeste.verdesmares.com.br/feed/"
        ]
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

    def fetch_news(self, category: str = "Tecnologia", limit: int = 7) -> List[Dict[str, Any]]:
        """
        Busca notícias por categoria via RSS.
        Fallback para notícias mockadas se RSS falhar.
        """
        if not HAS_FEEDPARSER:
            logger.warning("⚠️ feedparser não disponível, usando notícias mockadas")
            return self._get_mock_news(category, limit)

        feeds = self.RSS_FEEDS.get(category, self.RSS_FEEDS["Tecnologia"])
        all_entries = []

        for feed_url in feeds:
            try:
                logger.info(f"🔍 Buscando notícias de: {feed_url}")
                feed = feedparser.parse(feed_url)
                entries = feed.entries[:3]
                all_entries.extend(entries)
            except Exception as e:
                logger.error(f"❌ Erro no feed {feed_url}: {e}")
                continue

        all_entries = all_entries[:limit]

        if not all_entries:
            logger.warning("⚠️ Nenhuma notícia encontrada via RSS, usando mock")
            return self._get_mock_news(category, limit)

        news_list = []
        for entry in all_entries:
            news_list.append({
                "titulo": getattr(entry, 'title', f'Notícia sobre {category}'),
                "resumo": getattr(entry, 'summary', '')[:200] if hasattr(entry, 'summary') else '',
                "fonte": getattr(getattr(entry, 'source', {}), 'title', 'Fonte') if hasattr(entry, 'source') else 'Fonte',
                "link": getattr(entry, 'link', ''),
                "data_publicacao": datetime.now().isoformat()
            })

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
                "fonte": "Fonte Mock",
                "link": "",
                "data_publicacao": datetime.now().isoformat()
            })
        return news_list

    def get_categories(self) -> List[str]:
        """Retorna lista de categorias disponíveis"""
        return list(self.RSS_FEEDS.keys())
