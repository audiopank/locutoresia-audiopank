import os
import base64
import requests
import json
from typing import Optional, Dict, Any
import io
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

class LMNTVoiceCloner:
    """Classe para clonagem de vozes usando API LMNT"""
    
    def __init__(self):
        self.api_key = os.environ.get("LMNT_API_KEY")
        if not self.api_key:
            print("AVISO: LMNT_API_KEY não encontrada no ambiente")
    
    def clone_voice(self, name: str, audio_data: bytes, description: str = "", enhance: bool = True) -> Dict[str, Any]:
        """
        Cria um clone de voz a partir de dados de áudio
        
        Args:
            name: Nome da voz a ser criada
            audio_data: Dados binários do áudio (bytes)
            description: Descrição opcional da voz
            enhance: Se deve usar enhancement de áudio
            
        Returns:
            Dicionário com informações da voz criada
        """
        if not self.api_key:
            raise ValueError("LMNT_API_KEY não configurada")
        
        # Preparar os dados para upload
        files = {
            'files': ('audio.wav', audio_data, 'audio/wav')
        }
        
        data = {
            'name': name,
            'enhance': str(enhance).lower()
        }
        
        if description:
            data['description'] = description
        
        # Fazer a requisição para API LMNT
        try:
            response = requests.post(
                'https://api.lmnt.com/v1/ai/voice',
                headers={'X-API-Key': self.api_key},
                files=files,
                data=data
            )
            
            response.raise_for_status()
            result = response.json()
            
            # Normalizar resposta
            voice_data = result.get('voice', result)
            
            print(f"Voz clonada com sucesso: {voice_data.get('id')}")
            return voice_data
            
        except requests.exceptions.RequestException as e:
            print(f"Erro na requisição LMNT: {e}")
            raise
        except json.JSONDecodeError as e:
            print(f"Erro ao decodificar resposta: {e}")
            raise
    
    def list_voices(self) -> Dict[str, Any]:
        """Lista todas as vozes disponíveis na conta LMNT"""
        if not self.api_key:
            raise ValueError("LMNT_API_KEY não configurada")
        
        try:
            response = requests.get(
                'https://api.lmnt.com/v1/ai/voice',
                headers={'X-API-Key': self.api_key}
            )
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"Erro ao listar vozes: {e}")
            raise
    
    def get_voice(self, voice_id: str) -> Dict[str, Any]:
        """Obtém informações de uma voz específica"""
        if not self.api_key:
            raise ValueError("LMNT_API_KEY não configurada")
        
        try:
            response = requests.get(
                f'https://api.lmnt.com/v1/ai/voice/{voice_id}',
                headers={'X-API-Key': self.api_key}
            )
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            print(f"Erro ao obter voz: {e}")
            raise
    
    def synthesize_with_cloned_voice(self, voice_id: str, text: str) -> bytes:
        """
        Gera áudio usando uma voz clonada
        
        Args:
            voice_id: ID da voz clonada
            text: Texto para sintetizar
            
        Returns:
            Dados binários do áudio gerado
        """
        if not self.api_key:
            raise ValueError("LMNT_API_KEY não configurada")
        
        try:
            # Endpoint atual da API LMNT (o antigo /v1/ai/synthesize retorna 404)
            response = requests.post(
                'https://api.lmnt.com/v1/ai/speech/bytes',
                headers={
                    'X-API-Key': self.api_key,
                    'Content-Type': 'application/json'
                },
                json={
                    'voice': voice_id,
                    'text': text,
                    'format': 'mp3'
                },
                timeout=30
            )

            response.raise_for_status()
            return response.content
            
        except requests.exceptions.RequestException as e:
            print(f"Erro na síntese: {e}")
            raise
    
    @staticmethod
    def base64_to_bytes(base64_string: str) -> bytes:
        """Converte string base64 para bytes"""
        try:
            # Remover prefixo data URL se presente
            if ',' in base64_string:
                base64_string = base64_string.split(',')[1]
            
            return base64.b64decode(base64_string)
        except Exception as e:
            print(f"Erro ao converter base64: {e}")
            raise
    
    @staticmethod
    def bytes_to_base64(audio_data: bytes) -> str:
        """Converte bytes para string base64"""
        return base64.b64encode(audio_data).decode('utf-8')


# Função de conveniência para uso rápido
def create_voice_clone(name: str, audio_base64: str, description: str = "", enhance: bool = True) -> Dict[str, Any]:
    """
    Função de conveniência para criar clone de voz
    
    Args:
        name: Nome da voz
        audio_base64: Áudio em base64
        description: Descrição opcional
        enhance: Se deve usar enhancement
        
    Returns:
        Informações da voz criada
    """
    cloner = LMNTVoiceCloner()
    audio_bytes = cloner.base64_to_bytes(audio_base64)
    return cloner.clone_voice(name, audio_bytes, description, enhance)


if __name__ == "__main__":
    # Teste da classe
    print("Testando LMNT Voice Cloner...")
    
    # Verificar se a API key está configurada
    api_key = os.environ.get("LMNT_API_KEY")
    if not api_key:
        print("Configure LMNT_API_KEY no arquivo .env para testar")
    else:
        print(f"API Key encontrada: {api_key[:10]}...")
        
        # Listar vozes existentes
        try:
            cloner = LMNTVoiceCloner()
            voices = cloner.list_voices()
            print(f"Vozes encontradas: {len(voices.get('voices', []))}")
        except Exception as e:
            print(f"Erro ao listar vozes: {e}")
