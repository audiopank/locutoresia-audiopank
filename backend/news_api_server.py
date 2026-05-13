"""
API Server for News Auto Post - NewPost-IA
Provides REST endpoints for the React frontend to control news automation
"""

import json
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging

from news_agent import NewsAgent

# Configuração
app = Flask(__name__)
CORS(app)  # Habilitar CORS para React frontend
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Estado global da automação
automation_state = {
    "is_running": False,
    "last_run": None,
    "next_run_in": None,
    "logs": [],
    "current_job": None,
    "stats": {
        "total_cycles": 0,
        "successful_cycles": 0,
        "failed_cycles": 0,
        "news_published": 0
    }
}

# Thread para automação
automation_thread = None
stop_automation = threading.Event()

class NewsAutomationManager:
    def __init__(self):
        self.agent = NewsAgent()
        self.enabled_sources = {
            "exame": True,
            "veja": True,
            "folha": True,
            "diario_nordeste": True
        }
    
    def add_log(self, message: str, log_type: str = "info"):
        """Adiciona entrada ao log"""
        log_entry = {
            "message": message,
            "type": log_type,
            "time": datetime.now()
        }
        automation_state["logs"].append(log_entry)
        
        # Manter apenas últimos 100 logs
        if len(automation_state["logs"]) > 100:
            automation_state["logs"] = automation_state["logs"][-100:]
        
        logger.info(f"[{log_type.upper()}] {message}")
    
    def fetch_and_post_news(self, source_id: Optional[str] = None) -> Dict:
        """Busca e publica notícias de uma fonte específica ou aleatória"""
        try:
            # Filtrar fontes habilitadas
            active_sources = [
                s for s in automation_state["enabled_sources"].keys() 
                if automation_state["enabled_sources"][s]
            ]
            
            if not active_sources:
                self.add_log("Nenhuma fonte ativa. Ative ao menos uma fonte.", "warn")
                return {"error": "Nenhuma fonte ativa"}
            
            # Selecionar fonte
            if source_id and source_id in active_sources:
                selected_source = source_id
            else:
                import random
                selected_source = random.choice(active_sources)
            
            source_config = self.agent.NEWS_SOURCES[selected_source]
            self.add_log(f"🔍 Buscando notícias em: {source_config['name']}...", "info")
            
            # Coletar notícias da fonte selecionada
            all_news = []
            for category in source_config["categories"]:
                news_batch = self.agent.collect_from_source(selected_source, category)
                all_news.extend(news_batch)
                time.sleep(0.5)  # Pequena pausa entre categorias
            
            if not all_news:
                self.add_log(f"Nenhuma notícia encontrada em {source_config['name']}", "warn")
                return {"error": "Nenhuma notícia encontrada"}
            
            # Processar primeira notícia mais relevante
            selected_news = all_news[0]
            
            # Normalizar e validar
            processed = self.agent.news_utils.normalize_news(selected_news)
            
            # Verificar duplicata
            is_duplicate = self.agent.news_utils.is_duplicate(processed["source_url"])
            if is_duplicate:
                self.add_log(f"Notícia já existe: {processed['title']}", "warn")
                return {"error": "Notícia duplicada"}
            
            # Publicar
            success, msg = self.agent.news_utils.save_to_supabase(processed)
            if success:
                self.add_log(f"✅ Notícia publicada: {processed['title']}", "success")
                
                # Atualizar estatísticas
                automation_state["stats"]["news_published"] += 1
                
                return {
                    "title": processed["title"],
                    "summary": processed["content"][:200] + "...",
                    "category": processed["category"],
                    "source": source_config["name"],
                    "source_emoji": self.get_source_emoji(selected_source),
                    "hashtags": processed["metadata"]["tags"],
                    "published_date": datetime.now().strftime("%d/%m/%Y %H:%M"),
                    "success": True
                }
            else:
                self.add_log(f"❌ Erro ao publicar: {msg}", "error")
                return {"error": msg}
                
        except Exception as e:
            self.add_log(f"❌ Erro ao processar notícia: {str(e)}", "error")
            return {"error": str(e)}
    
    def get_source_emoji(self, source_id: str) -> str:
        """Retorna emoji da fonte"""
        emojis = {
            "exame": "📊",
            "veja": "📖", 
            "folha": "📰",
            "diario_nordeste": "🌵"
        }
        return emojis.get(source_id, "📰")
    
    def run_automation_cycle(self):
        """Executa um ciclo completo de automação"""
        self.add_log("🚀 Iniciando ciclo de automação...", "info")
        
        result = self.fetch_and_post_news()
        
        if result.get("success"):
            automation_state["stats"]["successful_cycles"] += 1
            automation_state["stats"]["total_cycles"] += 1
            self.add_log("✅ Ciclo concluído com sucesso", "success")
        else:
            automation_state["stats"]["failed_cycles"] += 1
            automation_state["stats"]["total_cycles"] += 1
            self.add_log(f"❌ Ciclo falhou: {result.get('error', 'Erro desconhecido')}", "error")
        
        automation_state["last_run"] = datetime.now()
        return result

# Instância global do gerenciador
manager = NewsAutomationManager()

def automation_worker():
    """Worker thread para automação contínua"""
    logger.info("Thread de automação iniciada")
    
    while not stop_automation.is_set():
        try:
            # Executar ciclo
            result = manager.run_automation_cycle()
            
            # Esperar 1 hora para próximo ciclo (ou parar se solicitado)
            for i in range(3600):  # 3600 segundos = 1 hora
                if stop_automation.is_set():
                    break
                
                # Atualizar contador
                remaining = 3600 - i
                automation_state["next_run_in"] = remaining
                time.sleep(1)
                
        except Exception as e:
            logger.error(f"Erro no worker de automação: {e}")
            time.sleep(60)  # Esperar 1 minuto antes de tentar novamente
    
    logger.info("Thread de automação finalizada")

# Endpoints da API
@app.route('/api/news/status', methods=['GET'])
def get_status():
    """Retorna status atual da automação"""
    return jsonify({
        "is_running": automation_state["is_running"],
        "last_run": automation_state["last_run"].isoformat() if automation_state["last_run"] else None,
        "next_run_in": automation_state["next_run_in"],
        "enabled_sources": automation_state["enabled_sources"],
        "stats": automation_state["stats"],
        "logs": [
            {
                "message": log["message"],
                "type": log["type"],
                "time": log["time"].isoformat()
            }
            for log in automation_state["logs"][-50:]  # Últimos 50 logs
        ]
    })

@app.route('/api/news/start', methods=['POST'])
def start_automation():
    """Inicia a automação de notícias"""
    global automation_thread, stop_automation
    
    if automation_state["is_running"]:
        return jsonify({"error": "Automação já está em execução"}), 400
    
    try:
        # Atualizar fontes habilitadas se enviado no request
        data = request.get_json() or {}
        if "enabled_sources" in data:
            automation_state["enabled_sources"] = data["enabled_sources"]
            manager.enabled_sources = data["enabled_sources"]
        
        # Iniciar thread de automação
        stop_automation.clear()
        automation_thread = threading.Thread(target=automation_worker, daemon=True)
        automation_thread.start()
        
        automation_state["is_running"] = True
        manager.add_log("🚀 Automação iniciada com sucesso!", "success")
        
        return jsonify({"message": "Automação iniciada"})
        
    except Exception as e:
        logger.error(f"Erro ao iniciar automação: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/news/stop', methods=['POST'])
def stop_automation_endpoint():
    """Para a automação de notícias"""
    global stop_automation
    
    if not automation_state["is_running"]:
        return jsonify({"error": "Automação não está em execução"}), 400
    
    try:
        stop_automation.set()
        automation_state["is_running"] = False
        automation_state["next_run_in"] = None
        manager.add_log("⛔ Automação parada pelo usuário", "warn")
        
        return jsonify({"message": "Automação parada"})
        
    except Exception as e:
        logger.error(f"Erro ao parar automação: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/news/execute', methods=['POST'])
def execute_now():
    """Executa um ciclo de coleta imediatamente"""
    try:
        # Atualizar fontes habilitadas se enviado no request
        data = request.get_json() or {}
        if "enabled_sources" in data:
            automation_state["enabled_sources"] = data["enabled_sources"]
            manager.enabled_sources = data["enabled_sources"]
        
        result = manager.run_automation_cycle()
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Erro ao executar ciclo: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/news/sources', methods=['GET'])
def get_sources():
    """Retorna lista de fontes disponíveis"""
    sources = []
    for source_id, config in manager.agent.NEWS_SOURCES.items():
        sources.append({
            "id": source_id,
            "label": config["name"],
            "url": config["url"],
            "emoji": manager.get_source_emoji(source_id)
        })
    
    return jsonify({"sources": sources})

@app.route('/api/news/logs/clear', methods=['POST'])
def clear_logs():
    """Limpa o log de execuções"""
    automation_state["logs"] = []
    manager.add_log("Log limpo pelo usuário", "info")
    return jsonify({"message": "Log limpo"})

@app.route('/api/newpost/publish', methods=['POST'])
def publish_to_newpost_ia():
    """Endpoint para publicar conteúdo na NewPost-IA (compatível com frontend)"""
    try:
        data = request.get_json()
        content = data.get("content", "")
        hashtags = data.get("hashtags", [])
        
        if not content:
            return jsonify({"error": "Conteúdo é obrigatório"}), 400
        
        # Simular publicação na NewPost-IA
        # Em produção, integrar com API real da NewPost-IA
        post_id = f"newpost_{int(time.time())}"
        
        # Salvar no Supabase como post da NewPost-IA
        try:
            news_utils = manager.agent.news_utils
            newpost_ia_url = os.getenv("NEWPOST_IA_URL", "https://plugpost-ai.lovable.app").rstrip("/")
            post_data = {
                "title": content[:80],
                "content": content,
                "source_url": f"{newpost_ia_url}/post/{post_id}",
                "category": "newpost_ia",
                "status": "published",
                "published_at": datetime.now().isoformat(),
                "metadata": {
                    "source": "NewPost-IA",
                    "post_id": post_id,
                    "hashtags": hashtags,
                    "platform": "newpost_ia",
                    "auto_generated": True
                }
            }
            
            success, msg = news_utils.save_to_supabase(post_data)
            if success:
                manager.add_log(f"✅ Publicado na NewPost-IA: {content[:50]}...", "success")
                return jsonify({
                    "success": True,
                    "post_id": post_id,
                    "message": "Publicado com sucesso na NewPost-IA"
                })
            else:
                manager.add_log(f"❌ Erro ao salvar no Supabase: {msg}", "error")
                return jsonify({"error": f"Erro ao salvar: {msg}"}), 500
                
        except Exception as e:
            manager.add_log(f"❌ Erro na publicação NewPost-IA: {str(e)}", "error")
            return jsonify({"error": str(e)}), 500
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "automation_running": automation_state["is_running"]
    })

if __name__ == '__main__':
    # Inicializar estado
    automation_state["enabled_sources"] = manager.enabled_sources
    
    print("🚀 News API Server iniciando...")
    print("📰 Endpoints disponíveis:")
    print("  GET  /api/news/status     - Status da automação")
    print("  POST /api/news/start      - Iniciar automação") 
    print("  POST /api/news/stop       - Parar automação")
    print("  POST /api/news/execute    - Executar agora")
    print("  GET  /api/news/sources    - Listar fontes")
    print("  POST /api/news/logs/clear - Limpar logs")
    print("  GET  /api/health          - Health check")
    print()
    print("🌐 Servidor rodando em: http://localhost:5000")
    
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
