#!/usr/bin/env python3
"""
📰 NewsAgent Scheduler - Agendamento Automático de Coleta de Notícias
Executa coletas automáticas em intervalos configurados
"""

import time
import json
import logging
import argparse
import schedule
from datetime import datetime, timedelta
from typing import Dict, List
import os
import sys

# Adicionar diretório atual ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from news_agent import NewsAgent

# Configuração de logging
# Forçar UTF-8 no Windows
import sys
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class NewsScheduler:
    """Agendador de coleta automática de notícias"""
    
    def __init__(self, config_file: str = "scheduler_config.json"):
        self.config_file = config_file
        self.agent = NewsAgent()
        self.stats_file = "scheduler_stats.json"
        self.load_config()
        self.load_stats()
    
    def load_config(self):
        """Carrega configuração do agendador"""
        default_config = {
            "enabled_sources": {
                "g1": True,
                "folha": True,
                "exame": True,
                "veja": True,
                "olhar_digital": True,
                "forbes_brasil": True
            },
            "categories": ["brasil", "economia", "tecnologia", "politica"],
            "collection_interval_minutes": 5,
            "max_news_per_collection": 100,
            "retry_failed_sources": True,
            "retry_interval_minutes": 30,
            "cleanup_days": 7,
            "notifications": {
                "enabled": False,
                "email": "",
                "webhook_url": ""
            }
        }
        
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    self.config = json.load(f)
                logger.info(f"Configuração carregada de {self.config_file}")
            else:
                self.config = default_config
                self.save_config()
                logger.info("Configuração padrão criada")
        except Exception as e:
            logger.error(f"Erro ao carregar configuração: {e}")
            self.config = default_config
    
    def save_config(self):
        """Salva configuração atual"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao salvar configuração: {e}")
    
    def load_stats(self):
        """Carrega estatísticas do scheduler"""
        try:
            if os.path.exists(self.stats_file):
                with open(self.stats_file, 'r', encoding='utf-8') as f:
                    self.stats = json.load(f)
            else:
                self.stats = {
                    "total_collections": 0,
                    "successful_collections": 0,
                    "failed_collections": 0,
                    "total_news_collected": 0,
                    "last_collection": None,
                    "start_time": datetime.now().isoformat(),
                    "collections_by_hour": {},
                    "source_performance": {}
                }
        except Exception as e:
            logger.error(f"Erro ao carregar estatísticas: {e}")
            self.stats = {
                "total_collections": 0,
                "successful_collections": 0,
                "failed_collections": 0,
                "total_news_collected": 0,
                "last_collection": None,
                "start_time": datetime.now().isoformat(),
                "collections_by_hour": {},
                "source_performance": {}
            }
    
    def save_stats(self):
        """Salva estatísticas do scheduler"""
        try:
            with open(self.stats_file, 'w', encoding='utf-8') as f:
                json.dump(self.stats, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao salvar estatísticas: {e}")
    
    def update_stats(self, collection_result: Dict):
        """Atualiza estatísticas após coleta"""
        self.stats["total_collections"] += 1
        self.stats["last_collection"] = datetime.now().isoformat()
        
        if collection_result.get('success', False):
            self.stats["successful_collections"] += 1
            self.stats["total_news_collected"] += collection_result.get('total_news', 0)
            
            # Estatísticas por hora
            current_hour = datetime.now().hour
            hour_key = f"{current_hour:02d}:00"
            self.stats["collections_by_hour"][hour_key] = self.stats["collections_by_hour"].get(hour_key, 0) + 1
            
            # Performance por fonte
            collection_stats = collection_result.get('collection_stats', {})
            for source, stats in collection_stats.items():
                if source not in self.stats["source_performance"]:
                    self.stats["source_performance"][source] = {
                        "total_collections": 0,
                        "successful_collections": 0,
                        "total_news": 0
                    }
                
                self.stats["source_performance"][source]["total_collections"] += 1
                if stats.get('collected', 0) > 0:
                    self.stats["source_performance"][source]["successful_collections"] += 1
                self.stats["source_performance"][source]["total_news"] += stats.get('collected', 0)
        else:
            self.stats["failed_collections"] += 1
        
        self.save_stats()
    
    def collect_news_job(self):
        """Job principal de coleta de notícias"""
        logger.info("🚀 Iniciando coleta automática de notícias...")
        
        try:
            # Executa coleta
            result = self.agent.execute_collection(
                enabled_sources=self.config["enabled_sources"],
                categories=self.config["categories"],
                limit=self.config["max_news_per_collection"]
            )
            
            # Atualiza estatísticas
            self.update_stats(result)
            
            # Log do resultado
            if result['success']:
                logger.info(f"✅ Coleta concluída: {result['total_news']} notícias coletadas")
                logger.info(f"💾 Salvas no cache: {result.get('saved_to_cache', 0)}")
                logger.info(f"🔄 Duplicatas: {result.get('duplicates_found', 0)}")
                
                # Estatísticas por fonte
                for source, stats in result.get('collection_stats', {}).items():
                    status = "✅" if stats.get('collected', 0) > 0 else "⚠️"
                    logger.info(f"{status} {source}: {stats.get('collected', 0)} notícias")
                
                # Envia notificações se configurado
                self.send_notification(result)
                
            else:
                logger.error("❌ Coleta falhou")
                
        except Exception as e:
            logger.error(f"❌ Erro na coleta automática: {e}")
            self.stats["failed_collections"] += 1
            self.save_stats()
    
    def retry_failed_sources_job(self):
        """Job para tentar fontes que falharam"""
        if not self.config.get("retry_failed_sources", False):
            return
        
        logger.info("🔄 Verificando fontes com falhas...")
        
        try:
            status = self.agent.get_status()
            failed_sources = []
            
            for source, info in status.get('status', {}).items():
                if info.get('status') == 'error':
                    failed_sources.append(source)
            
            if failed_sources:
                logger.info(f"Tentando novamente fontes com falha: {failed_sources}")
                
                # Coleta apenas das fontes com falha
                retry_sources = {k: v for k, v in self.config["enabled_sources"].items() if k in failed_sources}
                
                result = self.agent.execute_collection(
                    enabled_sources=retry_sources,
                    categories=self.config["categories"],
                    limit=20  # Limite menor para retry
                )
                
                if result['success']:
                    logger.info(f"✅ Retry bem-sucedido: {result['total_news']} notícias")
                else:
                    logger.error(f"❌ Retry falhou: {failed_sources}")
            else:
                logger.info("✅ Nenhuma fonte com falha encontrada")
                
        except Exception as e:
            logger.error(f"❌ Erro no retry de fontes: {e}")
    
    def cleanup_old_data_job(self):
        """Job para limpar dados antigos"""
        cleanup_days = self.config.get("cleanup_days", 7)
        if cleanup_days <= 0:
            return
        
        logger.info(f"🧹 Limpando dados com mais de {cleanup_days} dias...")
        
        try:
            # Implementação de limpeza (seria necessário adicionar método ao DatabaseManager)
            cutoff_date = datetime.now() - timedelta(days=cleanup_days)
            logger.info(f"Dados anteriores a {cutoff_date.strftime('%d/%m/%Y')} seriam removidos")
            
            # TODO: Implementar limpeza real no DatabaseManager
            # self.agent.db.cleanup_old_data(cutoff_date)
            
        except Exception as e:
            logger.error(f"❌ Erro na limpeza de dados: {e}")
    
    def send_notification(self, result: Dict):
        """Envia notificações sobre o resultado da coleta"""
        if not self.config.get("notifications", {}).get("enabled", False):
            return
        
        try:
            notification_config = self.config["notifications"]
            
            # Prepara mensagem
            if result['success']:
                message = f"""
📰 Coleta de Notícias Concluída

✅ Status: Sucesso
📊 Notícias coletadas: {result['total_news']}
💾 Salvas no cache: {result.get('saved_to_cache', 0)}
🔄 Duplicatas: {result.get('duplicates_found', 0)}
⏰ Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
"""
            else:
                message = f"""
❌ Coleta de Notícias Falhou

📊 Status: Falha
⏰ Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
"""
            
            # Envia por webhook se configurado
            webhook_url = notification_config.get("webhook_url")
            if webhook_url:
                try:
                    import requests
                    payload = {
                        "text": message,
                        "username": "NewsAgent Scheduler"
                    }
                    requests.post(webhook_url, json=payload, timeout=10)
                    logger.info("📡 Notificação por webhook enviada")
                except Exception as e:
                    logger.warning(f"⚠️ Erro ao enviar webhook: {e}")
            
            # TODO: Implementar notificação por e-mail
            # email = notification_config.get("email")
            # if email:
            #     self.send_email_notification(email, message)
                
        except Exception as e:
            logger.error(f"❌ Erro ao enviar notificação: {e}")
    
    def get_stats_summary(self) -> Dict:
        """Retorna resumo das estatísticas"""
        uptime = datetime.now() - datetime.fromisoformat(self.stats["start_time"])
        
        return {
            "uptime_hours": uptime.total_seconds() / 3600,
            "total_collections": self.stats["total_collections"],
            "success_rate": (
                self.stats["successful_collections"] / max(1, self.stats["total_collections"]) * 100
            ),
            "total_news_collected": self.stats["total_news_collected"],
            "avg_news_per_collection": (
                self.stats["total_news_collected"] / max(1, self.stats["successful_collections"])
            ),
            "last_collection": self.stats.get("last_collection"),
            "best_hour": max(self.stats["collections_by_hour"].items(), 
                           key=lambda x: x[1], default=(None, 0))[0],
            "best_source": max(self.stats["source_performance"].items(), 
                             key=lambda x: x[1]["total_news"], 
                             default=(None, {}))[0]
        }
    
    def setup_schedule(self):
        """Configura o agendamento das tarefas"""
        interval = self.config.get("collection_interval_minutes", 60)
        
        # Coleta principal
        schedule.every(interval).minutes.do(self.collect_news_job)
        logger.info(f"📅 Coleta principal agendada a cada {interval} minutos")
        
        # Retry de fontes com falha
        if self.config.get("retry_failed_sources", False):
            retry_interval = self.config.get("retry_interval_minutes", 30)
            schedule.every(retry_interval).minutes.do(self.retry_failed_sources_job)
            logger.info(f"🔄 Retry de fontes agendado a cada {retry_interval} minutos")
        
        # Limpeza de dados (diária às 2 da manhã)
        schedule.every().day.at("02:00").do(self.cleanup_old_data_job)
        logger.info("🧹 Limpeza de dados agendada para 02:00 diariamente")
        
        # Relatório de estatísticas (diário às 8 da manhã)
        schedule.every().day.at("08:00").do(self.print_daily_report)
        logger.info("📊 Relatório diário agendado para 08:00")
    
    def print_daily_report(self):
        """Imprime relatório diário"""
        summary = self.get_stats_summary()
        
        logger.info("""
📊 RELATÓRIO DIÁRIO - NEWSAGENT SCHEDULER
{}

⏱️ Uptime: {:.1f} horas
🔄 Total de coletas: {}
✅ Taxa de sucesso: {:.1f}%
📰 Total de notícias: {:.0f}
📈 Média por coleta: {:.1f}
🏆 Melhor hora: {}
🌟 Melhor fonte: {}
🕐 Última coleta: {}
""".format(
            "=" * 50,
            summary["uptime_hours"],
            summary["total_collections"],
            summary["success_rate"],
            summary["total_news_collected"],
            summary["avg_news_per_collection"],
            summary["best_hour"] or "N/A",
            summary["best_source"] or "N/A",
            summary["last_collection"] or "Nenhuma"
        ))
    
    def run_once(self):
        """Executa uma única coleta e sai"""
        logger.info("🔧 Executando coleta única...")
        self.collect_news_job()
        logger.info("✅ Coleta única concluída")
    
    def run_continuous(self):
        """Executa em modo contínuo com agendamento"""
        logger.info("🚀 Iniciando scheduler em modo contínuo...")
        
        # Configura agendamento
        self.setup_schedule()
        
        # Executa primeira coleta imediatamente
        self.collect_news_job()
        
        # Loop principal
        try:
            while True:
                schedule.run_pending()
                time.sleep(60)  # Verifica a cada minuto
        except KeyboardInterrupt:
            logger.info("⏹️ Scheduler interrompido pelo usuário")
        except Exception as e:
            logger.error(f"❌ Erro no scheduler: {e}")
        finally:
            logger.info("📋 Salvando estatísticas finais...")
            self.save_stats()

def main():
    """Função principal"""
    parser = argparse.ArgumentParser(description='NewsAgent Scheduler')
    parser.add_argument('--once', action='store_true', 
                       help='Executa uma única coleta e sai')
    parser.add_argument('--config', default='scheduler_config.json',
                       help='Arquivo de configuração')
    parser.add_argument('--stats', action='store_true',
                       help='Mostra estatísticas e sai')
    
    args = parser.parse_args()
    
    try:
        scheduler = NewsScheduler(args.config)
        
        if args.stats:
            # Mostra estatísticas
            summary = scheduler.get_stats_summary()
            print(json.dumps(summary, indent=2, ensure_ascii=False))
            return
        
        if args.once:
            # Executa uma vez
            scheduler.run_once()
        else:
            # Executa contínuo
            scheduler.run_continuous()
            
    except Exception as e:
        logger.error(f"❌ Erro fatal: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
