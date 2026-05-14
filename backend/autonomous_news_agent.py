import os
import sys
import time
import json
import random
import logging
from datetime import datetime, timezone
import schedule

# Adicionar o diretório pai ao path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from news_agent import NewsAgent
from backend.social_post_publisher import social_publisher

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('autonomous_agent.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger('AutonomousAgent')

# Variáveis de Controle
PUBLISHED_LOG_FILE = 'published_news.json'

def load_published_log():
    if os.path.exists(PUBLISHED_LOG_FILE):
        try:
            with open(PUBLISHED_LOG_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except Exception as e:
            logger.error(f"Erro ao carregar log de publicadas: {e}")
            return set()
    return set()

def save_published_log(published_urls):
    try:
        with open(PUBLISHED_LOG_FILE, 'w', encoding='utf-8') as f:
            json.dump(list(published_urls), f, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Erro ao salvar log de publicadas: {e}")

published_urls = load_published_log()

def select_most_relevant_news(all_news):
    """
    Seleciona a notícia mais relevante com base em impacto e atualidade.
    Neste exemplo, priorizamos as mais recentes que tenham um tamanho razoável
    e que ainda não foram publicadas.
    """
    valid_news = []
    for news in all_news:
        url = news.get('url', '')
        if url in published_urls:
            continue
        
        # Filtros de qualidade
        content_len = len(news.get('content', ''))
        summary_len = len(news.get('summary', ''))
        if content_len < 100 and summary_len < 100:
            continue
            
        valid_news.append(news)
        
    if not valid_news:
        return None
        
    # Podemos ordenar por data, mas como o RSS já vem ordenado, 
    # e algumas fontes são mais quentes, pegamos a primeira válida
    # Para ser mais robusto, sorteamos uma das top 5 para variar as fontes
    top_n = min(5, len(valid_news))
    selected = random.choice(valid_news[:top_n])
    
    return selected

def execute_cycle():
    logger.info("==================================================")
    logger.info("🚀 Iniciando ciclo do Agente Autônomo de Notícias")
    logger.info("==================================================")
    
    try:
        agent = NewsAgent()
        
        # 1. Coletar notícias
        sources = {
            "g1": True, "uol": True, "folha": True, 
            "exame": True, "veja": True, 
            "forbes_brasil": True, "diario_nordeste": True
        }
        categories = ["brasil", "economia", "tecnologia"]
        
        logger.info("Coletando notícias das fontes configuradas...")
        result = agent.execute_collection(
            enabled_sources=sources,
            categories=categories,
            limit=20
        )
        
        if not result.get('success'):
            logger.error("Falha ao coletar notícias (Pode ser apenas falta de novas). Continuaremos com o cache.")
            
        # Pegamos as notícias do cache mais recentes para garantir que temos conteúdo
        recent_news = agent.db.get_cached_news(limit=50)
        if not recent_news:
            logger.warning("Nenhuma notícia recente no cache para selecionar.")
            return
            
        # 2. Selecionar a mais relevante
        selected_news = select_most_relevant_news(recent_news)
        
        if not selected_news:
            logger.warning("Nenhuma notícia inédita e com qualidade suficiente encontrada.")
            return
            
        title = selected_news.get('title', '')
        url = selected_news.get('url', '')
        content = selected_news.get('content', '') or selected_news.get('summary', '')
        
        logger.info(f"📰 Notícia selecionada: {title[:80]}...")
        
        # 3. Gerar imagem (fallback)
        image_url = selected_news.get('image_url')
        if not image_url:
            # Gerador simples usando pollinations
            seed = random.randint(1, 999999)
            image_url = f"https://image.pollinations.ai/prompt/{title.replace(' ', '%20')}?width=1024&height=1024&nologo=true&seed={seed}&model=flux-realism"
        
        # 4. Gerar post com IA e salvar como rascunho
        logger.info("🤖 Gerando legenda com IA...")
        post_resp = social_publisher.create_from_news(
            news_title=title,
            news_content=content,
            image_url=image_url,
            auto_caption=True
        )
        
        if not post_resp.get('success'):
            logger.error(f"Erro ao criar rascunho: {post_resp.get('error')}")
            return
            
        post_id = post_resp.get('post', {}).get('id')
        if not post_id:
            logger.error("Falha ao obter ID do post criado.")
            return
            
        logger.info(f"✅ Rascunho criado com ID: {post_id}")
        
        # 5. Aprovar automaticamente
        logger.info("👍 Aprovando postagem...")
        app_resp = social_publisher.approve_post(post_id, approved_by="autonomous_agent")
        if not app_resp.get('success'):
            logger.error(f"Erro ao aprovar post: {app_resp.get('error')}")
            return
            
        # 6. Publicar na NewPost-IA
        logger.info("🚀 Publicando na NewPost-IA...")
        pub_resp = social_publisher.publish_to_newpost(post_id)
        
        if pub_resp.get('success'):
            logger.info("🎉 POST PUBLICADO COM SUCESSO!")
            # 7. Marcar como publicada para evitar duplicatas
            published_urls.add(url)
            save_published_log(published_urls)
        else:
            logger.error(f"❌ Erro ao publicar: {pub_resp.get('message')} - {pub_resp.get('error', '')}")
            
    except Exception as e:
        logger.error(f"🔥 Erro crítico no ciclo do agente: {e}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Agente Autônomo de Notícias')
    parser.add_argument('--once', action='store_true', help='Executar apenas um ciclo e sair')
    args = parser.parse_args()
    
    logger.info("🤖 Agente Autônomo Contínuo Iniciado")
    
    if args.once:
        logger.info("Modo execução única (--once) ativado.")
        execute_cycle()
        return

    logger.info("Configurando agendamento para rodar a cada 1 hora...")
    
    # Executar imediatamente a primeira vez
    execute_cycle()
    
    # Agendar para cada 1 hora
    schedule.every(1).hours.do(execute_cycle)
    
    while True:
        try:
            schedule.run_pending()
            time.sleep(60) # Verifica a cada minuto
        except KeyboardInterrupt:
            logger.info("⏹️ Agente encerrado pelo usuário.")
            break
        except Exception as e:
            logger.error(f"Erro no loop principal: {e}")
            time.sleep(60)

if __name__ == "__main__":
    main()
