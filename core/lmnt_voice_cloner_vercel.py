"""
Integração LMNT otimizada para Vercel (sem dependências problemáticas)
"""

import os
import base64
import requests
import io
from typing import Optional, Dict, Any, List

class LMNTVoiceCloner:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.lmnt.com/v1/ai/voice"

    def clone_voice(self, audio_b64, voice_name, description="", enhance=True):
        # 1. Decodifica base64
        if ',' in audio_b64:
            audio_b64 = audio_b64.split(',')[1]
        audio_bytes = base64.b64decode(audio_b64)
        
        # 2. BytesIO + seek(0)
        audio_file = io.BytesIO(audio_bytes)
        audio_file.seek(0)

        # 3. Campo tem que ser 'file'
        files = {
            'file': ('clone.wav', audio_file, 'audio/wav')
        }

        data = {
            'name': voice_name,
            'enhance': str(enhance).lower()
        }
        if description:
            data['description'] = description

        # 4. Header correto: X-API-Key, não Authorization
        headers = {
            'X-API-Key': self.api_key
        }

        print(f"DEBUG: Enviando pra {self.base_url}")
        print(f"DEBUG: {len(audio_bytes)} bytes | Header: X-API-Key")

        response = requests.post(
            self.base_url,
            headers=headers,
            files=files,
            data=data,
            timeout=60
        )

        print(f"DEBUG STATUS: {response.status_code}")
        print(f"DEBUG RESP: {response.text}")
        
        response.raise_for_status()
        return response.json()

    def synthesize(self, voice_id: str, text: str, format: str = "mp3") -> bytes:
        """Gera áudio usando voz"""
        try:
            response = requests.post(
                "https://api.lmnt.com/v1/ai/speech/bytes",
                headers={
                    "X-API-Key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "voice": voice_id,
                    "text": text,
                    "format": format
                },
                timeout=30
            )
            response.raise_for_status()
            return response.content
        except Exception as e:
            raise Exception(f"Erro na síntese: {e}")

class LMNTVoiceClonerVercel(LMNTVoiceCloner):
    """Wrapper para manter compatibilidade com o código existente"""
    def __init__(self, api_key: Optional[str] = None):
        api_key = api_key or os.environ.get("LMNT_API_KEY")
        if not api_key:
            raise ValueError("LMNT_API_KEY não configurada")
        super().__init__(api_key)
        self.base_url_speech = "https://api.lmnt.com/v1"
    
    def get_account_info(self) -> Dict[str, Any]:
        """Obtém informações da conta"""
        try:
            response = requests.get(
                "https://api.lmnt.com/v1/account",
                headers={"X-API-Key": self.api_key},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            return {"error": str(e)}
    
    def list_voices(self) -> Dict[str, Any]:
        """Lista vozes disponíveis"""
        try:
            response = requests.get(
                "https://api.lmnt.com/v1/voices",
                headers={"X-API-Key": self.api_key},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            return {
                'voices': data.get('voices', []),
                'total_count': len(data.get('voices', []))
            }
        except Exception as e:
            return {"error": str(e), "voices": []}
    
    def get_voice_info(self, voice_id: str) -> Dict[str, Any]:
        """Obtém informações de uma voz específica"""
        try:
            response = requests.get(
                f"https://api.lmnt.com/v1/voices/{voice_id}",
                headers={"X-API-Key": self.api_key},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            return {"error": str(e)}

# Wrapper seguro que não quebra se LMNT falhar
class SafeLMNTIntegration:
    """Integração segura que não crasha se LMNT não estiver disponível"""
    
    def __init__(self):
        self.client = None
        self.error = None
        try:
            self.client = LMNTVoiceClonerVercel()
        except Exception as e:
            self.error = str(e)
    
    def get_status(self):
        if self.client is None:
            return {
                "status": "unavailable",
                "message": f"LMNT não disponível: {self.error}",
                "api_key_set": bool(os.environ.get("LMNT_API_KEY"))
            }
        try:
            account = self.client.get_account_info()
            if "error" in account:
                return {
                    "status": "error",
                    "message": account["error"],
                    "api_key_set": True
                }
            return {
                "status": "available",
                "message": "LMNT API funcionando",
                "plan": account.get('plan', {}).get('type', 'Unknown')
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "api_key_set": True
            }
    
    def get_available_voices(self):
        if self.client is None:
            return {"error": "LMNT não disponível", "voices": []}
        return self.client.list_voices()
    
    def generate_speech(self, text, voice_id=None, format="mp3"):
        if self.client is None:
            return {"error": "LMNT não disponível"}
        try:
            if not voice_id:
                voices = self.client.list_voices()
                if voices.get('voices'):
                    voice_id = voices['voices'][0]['id']
                else:
                    return {"error": "Nenhuma voz disponível"}
            
            audio_bytes = self.client.synthesize(voice_id, text, format)
            
            # Salvar arquivo
            import uuid
            from datetime import datetime
            filename = f"lmnt_{uuid.uuid4().hex[:8]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{format}"
            
            # No Vercel, salvar em /tmp
            upload_folder = os.environ.get('VERCEL') and '/tmp/generated_audio' or 'generated_audio'
            os.makedirs(upload_folder, exist_ok=True)
            filepath = os.path.join(upload_folder, filename)
            
            with open(filepath, 'wb') as f:
                f.write(audio_bytes)
            
            return {
                "success": True,
                "filename": filename,
                "filepath": filepath,
                "voice_id": voice_id,
                "format": format,
                "text": text,
                "size_bytes": len(audio_bytes)
            }
        except Exception as e:
            return {"error": str(e)}
    
    def clone_voice(self, name, audio_data, description="", enhance=True):
        if self.client is None:
            return {"error": "LMNT não disponível"}
        try:
            # Converte bytes para base64 para o método
            audio_b64 = base64.b64encode(audio_data).decode('utf-8')
            result = self.client.clone_voice(audio_b64, name, description, enhance)
            return {
                "voice_id": result.get("id"),
                "name": result.get("name"),
                "description": result.get("description"),
                "gender": result.get("gender"),
                "age": result.get("age"),
                "accent": result.get("accent"),
                "language": result.get("language"),
                "is_custom": result.get("is_custom", True),
                "is_public": result.get("is_public", False),
                "created_at": result.get("created_at"),
                "metadata": result.get("metadata")
            }
        except Exception as e:
            return {"error": str(e)}
    
    def get_voice_info(self, voice_id):
        if self.client is None:
            return {"error": "LMNT não disponível"}
        try:
            return self.client.get_voice_info(voice_id)
        except Exception as e:
            return {"error": str(e)}

# Instância global
lmnt_integration = SafeLMNTIntegration()