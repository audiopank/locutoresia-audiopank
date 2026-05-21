"""
Supabase News Log Integration
Substitui o sistema de arquivos JSON por banco de dados Supabase
"""

import os
from supabase import create_client, Client
from postgrest.exceptions import APIError
from typing import Dict, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class SupabaseNewsLog:
    """Gerencia logs de notícias no Supabase"""
    
    def __init__(self):
        """Inicializa cliente Supabase"""
        self.supabase = None
        self.enabled = False
        
        # Verificar variáveis de ambiente
        supabase_url = os.environ.get("VITE_SUPABASE_URL", os.environ.get("SUPABASE_URL"))
        service_role_key = os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY", 
                                      os.environ.get("SUPABASE_SERVICE_KEY", 
                                      os.environ.get("SUPABASE_SERVICE_ROLE_KEY")))
        
        if supabase_url and service_role_key:
            try:
                self.supabase = create_client(supabase_url, service_role_key)
                self.enabled = True
                logger.info("Cliente Supabase inicializado com sucesso")
            except Exception as e:
                logger.error(f"Erro ao inicializar Supabase: {e}")
        else:
            logger.warning("Variáveis do Supabase não configuradas. Usando modo mock.")
        
    def ja_foi_postada(self, url: str) -> bool:
        """Checa se a URL já existe na tabela. Substitui a leitura do .json"""
        if not self.enabled:
            logger.warning("Supabase não configurado, retornando False (permite postagem)")
            return False
            
        try:
            res = self.supabase.table('news_log').select('id', count='exact').eq('url', url).execute()
            return res.count > 0
        except Exception as e:
            logger.error(f"Erro ao checar duplicata: {e}")
            return False  # Em caso de erro, tenta postar pra não travar

    def registrar_noticia(self, noticia: dict, agente: str = 'vessel') -> bool:
        """Salva no banco. Substitui o json.dump. Retorna True se salvou, False se já existia."""
        if not self.enabled:
            logger.warning("Supabase não configurado, simulando registro bem-sucedido")
            return True
            
        try:
            self.supabase.table('news_log').insert({
                "url": noticia['url'],
                "titulo": noticia['titulo'],
                "fonte": noticia.get('fonte'),
                "categoria": noticia.get('categoria'),
                "status": 'publicada',  # ou 'coletada' se você posta depois
                "agente_origem": agente,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            return True
        except APIError as e:
            # Código '23505' é unique_violation no Postgres = duplicata
            if e.code == '23505':
                logger.info(f"Duplicata ignorada: {noticia['url']}")
                return False
            raise e  # Outro erro, deixa quebrar pra você ver no log

    def registrar_ciclo(self, ciclo_data: dict) -> bool:
        """Registra um ciclo completo de coleta"""
        if not self.enabled:
            logger.warning("Supabase não configurado, simulando registro de ciclo")
            return True
            
        try:
            self.supabase.table('news_cycles').insert({
                "cycle_id": ciclo_data.get('cycle_id'),
                "execution_timestamp": ciclo_data.get('execution_timestamp'),
                "task_name": ciclo_data.get('task_name'),
                "status": ciclo_data.get('status'),
                "estatisticas": ciclo_data.get('ESTATISTICAS'),
                "erros": ciclo_data.get('ERROS'),
                "mensagem": ciclo_data.get('MENSAGEM'),
                "created_at": datetime.utcnow().isoformat()
            }).execute()
            return True
        except Exception as e:
            logger.error(f"Erro ao registrar ciclo: {e}")
            return False

    def obter_estatisticas(self, dias: int = 7) -> Dict:
        """Obtém estatísticas dos últimos N dias"""
        if not self.enabled:
            logger.warning("Supabase não configurado, retornando estatísticas vazias")
            return {
                "total_noticias": 0,
                "noticias_por_fonte": {},
                "noticias_ultimos_dias": 0,
                "periodo_analisado_dias": dias
            }
            
        try:
            from datetime import timedelta
            
            data_limite = (datetime.utcnow() - timedelta(days=dias)).isoformat()
            
            # Total de notícias
            res_total = self.supabase.table('news_log').select('id', count='exact').execute()
            total_noticias = res_total.count or 0
            
            # Notícias por fonte
            res_fontes = self.supabase.table('news_log').select('fonte', count='exact').execute()
            noticias_por_fonte = {}
            if res_total.data:
                for item in res_total.data:
                    fonte = item.get('fonte', 'Desconhecida')
                    noticias_por_fonte[fonte] = noticias_por_fonte.get(fonte, 0) + 1
            
            # Notícias recentes
            res_recentes = self.supabase.table('news_log').select('id', count='exact').gte('created_at', data_limite).execute()
            noticias_recentes = res_recentes.count or 0
            
            return {
                "total_noticias": total_noticias,
                "noticias_por_fonte": noticias_por_fonte,
                "noticias_ultimos_dias": noticias_recentes,
                "periodo_analisado_dias": dias
            }
            
        except Exception as e:
            logger.error(f"Erro ao obter estatísticas: {e}")
            return {
                "total_noticias": 0,
                "noticias_por_fonte": {},
                "noticias_ultimos_dias": 0,
                "periodo_analisado_dias": dias
            }

# Instância global para uso em todo o sistema
supabase_log = SupabaseNewsLog()

# Funções de conveniência para compatibilidade com código existente
def ja_foi_postada(url: str) -> bool:
    """Função de conveniência para compatibilidade"""
    return supabase_log.ja_foi_postada(url)

def registrar_noticia(noticia: dict, agente: str = 'vessel') -> bool:
    """Função de conveniência para compatibilidade"""
    return supabase_log.registrar_noticia(noticia, agente)

def registrar_ciclo(ciclo_data: dict) -> bool:
    """Função de conveniência para compatibilidade"""
    return supabase_log.registrar_ciclo(ciclo_data)
