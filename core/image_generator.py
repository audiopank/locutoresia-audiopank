"""
Gerador de Imagens com Fallback - NewPost-IA
Orquestra a geração de imagens usando Replicate e Stable Horde.
"""

import os
import requests
import logging
import time
from typing import Optional, Dict

logger = logging.getLogger(__name__)

class ImageGenerator:
    def __init__(self):
        self.replicate_token = os.getenv("REPLICATE_API_TOKEN")
        # Só usa Stable Horde se houver chave própria configurada — a fila anônima
        # ('0000000000') pode levar minutos, o que estoura o timeout do Vercel
        self.stable_horde_key = os.getenv("STABLE_HORDE_API_KEY")

    def generate_image(self, prompt: str) -> Optional[str]:
        """
        Tenta gerar imagem usando múltiplos provedores.
        Retorna a URL da imagem gerada ou None.

        Timeouts são propositalmente curtos: a função roda numa serverless
        function do Vercel com poucos segundos de orçamento total, então cada
        provedor precisa falhar rápido para deixar tempo pro fallback final.
        """
        # 1. Tentar Replicate
        if self.replicate_token:
            logger.info("Tentando gerar imagem via Replicate...")
            url = self._generate_via_replicate(prompt)
            if url: return url

        # 2. Tentar Stable Horde (só com chave própria configurada)
        if self.stable_horde_key:
            logger.info("Tentando gerar imagem via Stable Horde...")
            url = self._generate_via_stable_horde(prompt)
            if url: return url

        # 3. Fallback final: Imagem Placeholder/Mock
        logger.warning("Nenhum provedor de imagem configurado/disponível. Usando placeholder.")
        return f"https://loremflickr.com/800/600/technology,artificialintelligence?random={int(time.time())}"

    def _generate_via_replicate(self, prompt: str) -> Optional[str]:
        """Integração com Replicate API (SDXL Turbo)"""
        try:
            headers = {
                "Authorization": f"Token {self.replicate_token}",
                "Content-Type": "application/json"
            }
            payload = {
                "version": "a8274a3834a2f8c5c70f90e945c50c05b8229bd8dc1d743a1682f6f582f3c788", # SDXL Turbo
                "input": {"prompt": prompt, "width": 768, "height": 768, "num_inference_steps": 1}
            }

            response = requests.post("https://api.replicate.com/v1/predictions", json=payload, headers=headers, timeout=5)
            if response.status_code == 201:
                prediction = response.json()
                get_url = prediction["urls"]["get"]

                # Polling curto: orçamento total de segundos é limitado pela serverless function
                for _ in range(3):
                    res = requests.get(get_url, headers=headers, timeout=5)
                    pred_data = res.json()
                    if pred_data["status"] == "succeeded":
                        return pred_data["output"][0] if pred_data.get("output") else None
                    if pred_data["status"] == "failed":
                        break
                    time.sleep(1.5)
            return None
        except Exception as e:
            logger.error(f"Erro no Replicate: {e}")
            return None

    def _generate_via_stable_horde(self, prompt: str) -> Optional[str]:
        """Integração com Stable Horde (requer chave própria — fila anônima é lenta demais p/ serverless)"""
        try:
            headers = {
                "Content-Type": "application/json",
                "apikey": self.stable_horde_key
            }
            payload = {
                "prompt": f"{prompt} ### fotorealism, cinematic",
                "params": {
                    "steps": 20,
                    "n": 1,
                    "sampler_name": "k_euler",
                    "width": 512,
                    "height": 512
                }
            }

            # 1. Enviar requisição
            response = requests.post("https://stablehorde.net/api/v2/generate/async", json=payload, headers=headers, timeout=5)
            if response.status_code == 202:
                req_id = response.json()["id"]

                # 2. Polling curto: orçamento total de segundos é limitado pela serverless function
                for _ in range(3):
                    status_res = requests.get(f"https://stablehorde.net/api/v2/generate/check/{req_id}", timeout=5)
                    status_data = status_res.json()
                    if status_data.get("done"):
                        final_res = requests.get(f"https://stablehorde.net/api/v2/generate/status/{req_id}", timeout=5)
                        final_data = final_res.json()
                        return final_data["generations"][0]["img"] # Retorna URL da imagem hospedada ou base64
                    time.sleep(1.5)
            return None
        except Exception as e:
            logger.error(f"Erro no Stable Horde: {e}")
            return None
