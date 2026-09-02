
"""
GERADOR TTS MULTI-API - Locutores IA
Suporta Google Gemini TTS, ElevenLabs, E EdgeTTS (Gratuito!)
EdgeTTS é o padrão, pois é gratuito e não precisa de chave!

Instalação:
    pip install google-genai elevenlabs edge-tts

Configuração (opcional):
    export GEMINI_API_KEY="sua-chave-google"
    export ELEVENLABS_API_KEY="sua-chave-elevenlabs"
"""

import asyncio
import io
import mimetypes
import os
import struct
import sys

# Este arquivo imprime emoji nos logs (✅, 🎙️). No console do Windows (cp1252)
# isso levanta UnicodeEncodeError e derruba a geração ANTES de sintetizar
# qualquer coisa — o TTSGenerator nem chega a ser construído no dev local.
# Forçar UTF-8 na saída resolve; no Linux/Vercel já é UTF-8 e nada muda.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
from typing import Literal

# EdgeTTS (Gratuito e padrão)
import edge_tts

# Google Gemini (opcional)
try:
    from google import genai
    from google.genai import types
    GOOGLE_GENAI_AVAILABLE = True
except ImportError:
    GOOGLE_GENAI_AVAILABLE = False

# ElevenLabs (opcional)
try:
    from elevenlabs.client import ElevenLabs
    from elevenlabs import stream
    ELEVENLABS_AVAILABLE = True
except ImportError:
    ELEVENLABS_AVAILABLE = False

# LMNT (para vozes clonadas)
try:
    from lmnt_voice_cloner_vercel import lmnt_integration
    LMNT_AVAILABLE = True
except ImportError:
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
        from lmnt_voice_cloner_vercel import lmnt_integration
        LMNT_AVAILABLE = True
    except ImportError:
        LMNT_AVAILABLE = False


# ============================================================================
# MAPEAMENTO DE VOZES - EDGETTS (PADRÃO, GRATUITO!)
# ============================================================================

EDGE_VOICE_MAP = {
    # Vozes do Google Gemini mapeadas para EdgeTTS (pt-BR)
    "Zephyr": "pt-BR-AntonioNeural",
    "Puck": "pt-BR-FranciscaNeural",
    "Charon": "pt-BR-AntonioNeural",
    "Kore": "pt-BR-FranciscaNeural",
    "Fenrir": "pt-BR-AntonioNeural",
    "Leda": "pt-BR-FranciscaNeural",
    "Orus": "pt-BR-AntonioNeural",
    "Aoede": "pt-BR-FranciscaNeural",
    "Callirrhoe": "pt-BR-FranciscaNeural",
    "Autonoe": "pt-BR-FranciscaNeural",
    "Enceladus": "pt-BR-AntonioNeural",
    "Iapetus": "pt-BR-AntonioNeural",
    "Umbriel": "pt-BR-AntonioNeural",
    "Algieba": "pt-BR-FranciscaNeural",
    "Despina": "pt-BR-FranciscaNeural",
    "Erinome": "pt-BR-FranciscaNeural",
    "Algenib": "pt-BR-AntonioNeural",
    "Rasalgethi": "pt-BR-AntonioNeural",
    "Laomedeia": "pt-BR-FranciscaNeural",
    "Achernar": "pt-BR-FranciscaNeural",
    "Alnilam": "pt-BR-FranciscaNeural",
    "Schedar": "pt-BR-AntonioNeural",
    "Gacrux": "pt-BR-AntonioNeural",
    "Pulcherrima": "pt-BR-FranciscaNeural",
    "Achird": "pt-BR-FranciscaNeural",
    "Zubenelgenubi": "pt-BR-AntonioNeural",
    "Vindemiatrix": "pt-BR-AntonioNeural",
    "Sadachbia": "pt-BR-AntonioNeural",
    "Sadaltager": "pt-BR-FranciscaNeural",
    "Sulafat": "pt-BR-FranciscaNeural",
    # Aliases para compatibilidade
    "Alex Professional": "pt-BR-AntonioNeural",
    # Outros idiomas
    "en-US-GuyNeural": "en-US-GuyNeural",
    "en-US-JennyNeural": "en-US-JennyNeural",
    "es-ES-AlvaroNeural": "es-ES-AlvaroNeural",
    # Fallback
    "default": "pt-BR-AntonioNeural",
}

# Mapeamento de estilos para EdgeTTS
# ⚠️ 27/07/2026: o seletor do Studio manda "excited"/"calm"/"professional", que
# NÃO existiam aqui. O .get(style, normal) engolia em silêncio e 3 das 4 opções
# da tela não faziam absolutamente nada. Agora cada opção da UI tem entrada real.
EDGE_STYLE_MAP = {
    "normal":       {"rate": "+0%",  "pitch": "+0Hz"},
    "fast":         {"rate": "+30%", "pitch": "+0Hz"},
    "slow":         {"rate": "-25%", "pitch": "-5Hz"},
    "cheerful":     {"rate": "+10%", "pitch": "+10Hz"},
    "serious":      {"rate": "-10%", "pitch": "-10Hz"},
    # Os que a tela realmente oferece:
    "excited":      {"rate": "+18%", "pitch": "+12Hz"},   # animado (varejo/promo)
    "calm":         {"rate": "-12%", "pitch": "-3Hz"},    # calmo, sem arrastar
    "professional": {"rate": "-3%",  "pitch": "-2Hz"},    # institucional, sóbrio
}

# Sinônimos aceitos → nome canônico. Serve pra UI em português e pra quem chama
# a API com outro nome. O que não cair aqui vira AVISO no log (não silêncio).
STYLE_ALIASES = {
    "animado": "excited", "energetico": "excited", "energético": "excited",
    "alegre": "cheerful", "feliz": "cheerful",
    "calmo": "calm", "tranquilo": "calm", "suave": "calm",
    "profissional": "professional", "institucional": "professional",
    "serio": "serious", "sério": "serious", "grave": "serious",
    "rapido": "fast", "rápido": "fast",
    "lento": "slow", "pausado": "slow",
    "padrao": "normal", "padrão": "normal",
}

# INSTRUÇÃO DE TOM pro Gemini (controllable TTS). O Gemini NÃO muda o tom por
# temperature — ele obedece a uma instrução em linguagem natural na PRIMEIRA
# linha, em caixa alta, com o texto logo abaixo (formato validado em
# gemini_tts_fixed.py). Sem isso, todos os estilos soavam iguais nele.
STYLE_INSTRUCTIONS = {
    "excited":      "FALE EM TOM ANIMADO, ENERGICO E ALTO ASTRAL",
    "cheerful":     "FALE EM TOM ALEGRE E FESTIVO",
    "calm":         "FALE EM TOM CALMO, SUAVE E ACOLHEDOR",
    "professional": "FALE EM TOM PROFISSIONAL, CLARO E CONFIANTE",
    "serious":      "FALE EM TOM SERIO E FORMAL",
    "fast":         "FALE DE FORMA AGIL E DINAMICA, SEM ATROPELAR AS PALAVRAS",
    "slow":         "FALE DE FORMA LENTA E PAUSADA, COM CALMA",
    # "normal" fica de fora de propósito: sem instrução = voz natural.
}

# ============================================================================
# MAPEAMENTO DE VOZES - GOOGLE GEMINI TTS (OPCIONAL)
# ============================================================================

GOOGLE_VOICE_MAP = {
    # Todas as vozes do Google Gemini TTS (30 opções)
    "Zephyr": "Zephyr",
    "Puck": "Puck",
    "Charon": "Charon",
    "Kore": "Kore",
    "Fenrir": "Fenrir",
    "Leda": "Leda",
    "Orus": "Orus",
    "Aoede": "Aoede",
    "Callirrhoe": "Callirrhoe",
    "Autonoe": "Autonoe",
    "Enceladus": "Enceladus",
    "Iapetus": "Iapetus",
    "Umbriel": "Umbriel",
    "Algieba": "Algieba",
    "Despina": "Despina",
    "Erinome": "Erinome",
    "Algenib": "Algenib",
    "Rasalgethi": "Rasalgethi",
    "Laomedeia": "Laomedeia",
    "Achernar": "Achernar",
    "Alnilam": "Alnilam",
    "Schedar": "Schedar",
    "Gacrux": "Gacrux",
    "Pulcherrima": "Pulcherrima",
    "Achird": "Achird",
    "Zubenelgenubi": "Zubenelgenubi",
    "Vindemiatrix": "Vindemiatrix",
    "Sadachbia": "Sadachbia",
    "Sadaltager": "Sadaltager",
    "Sulafat": "Sulafat",
    # Aliases para compatibilidade
    "Alex Professional": "Zephyr",
    # Fallback
    "default": "Zephyr",
}

# ============================================================================
# MAPEAMENTO DE VOZES - ELEVENLABS
# ============================================================================

ELEVENLABS_VOICE_MAP = {
    # Vozes ElevenLabs (IDs reais da conta)
    "Roger": "CwhRBWXzGAHq8TQ4Fs17",          # Roger - Laid-Back, Casual, Resonant
    "Sarah": "EXAVITQu4vr4xnSDxMaL",          # Sarah - Mature, Reassuring, Confident
    "Laura": "FGY2WhTYpPnrIDTdsKH5",          # Laura - Enthusiast, Quirky Attitude
    "Charlie": "IKne3meq5aSn9XLyUdCD",           # Charlie - Deep, Confident, Energetic
    "George": "JBFqnCBsd6RMkjVDRZzb",         # George - Warm, Captivating Storyteller
    "Callum": "N2lVS1w4EtoT3dr4eOWO",          # Callum - Husky Trickster
    "River": "SAz9YHcvj6GT2YYXdXww",           # River - Relaxed, Neutral, Informative
    "Harry": "SOYHLrjzK2X1ezoPC6cr",           # Harry - Fierce Warrior
    "Liam": "TX3LPaxmHKxFdv7VOQHJ",            # Liam - Energetic, Social Media Creator
    "Alice": "Xb7hH8MSUJpSbSDYk0k2",           # Alice - Clear, Engaging Educator
    "Matilda": "XrExE9yKIg1WjnnlVkGX",         # Matilda - Knowledgable, Professional
    "Will": "bIHbv24MWmeRgasZH58o",              # Will - Relaxed Optimist
    "Jessica": "cgSgspJ2msm6clMCkdW9",         # Jessica - Playful, Bright, Warm
    "Eric": "cjVigY5qzO86Huf0OWal",            # Eric - Smooth, Trustworthy
    "Bella": "hpp4J3VqNfWAUOO0d1Us",           # Bella - Professional, Bright, Warm
    "Chris": "iP95p4xoKVk53GoZ742B",           # Chris - Charming, Down-to-Earth
    "Brian": "nPczCjzI2devNBz1zQrb",           # Brian - Deep, Resonant and Comforting
    "Daniel": "onwK4e9ZLuTAKqWW03F9",          # Daniel - Steady Broadcaster
    "Lily": "pFZP5JQG7iQjIQuC4Bku",            # Lily - Velvety Actress
    "Adam": "pNInz6obpgDQGcFmaJgB",              # Adam - Dominant, Firm
    "Bill": "pqHfZKP75CvOlQylNhV4",              # Bill - Wise, Mature, Balanced
    "Lendário": "4za2kOXGgUd57HRSQ1fn",       # Lendário - Cheerful, Vibrant and Fun
    "Andrea Lot": "HOfBIVLhom4mc9WvXfyH",     # Andrea Lot - Brazilian Portuguese
    # Fallback
    "default": "pNInz6obpgDQGcFmaJgB",  # Adam como padrão
}

# ============================================================================
# MAPEAMENTO DE ESTILOS
# ============================================================================

STYLE_MAP = {
    "normal":       {"temperature": 1.0, "stability": 0.5},
    "fast":         {"temperature": 0.8, "stability": 0.7},
    "slow":         {"temperature": 1.2, "stability": 0.4},
    "cheerful":     {"temperature": 1.3, "stability": 0.5},
    "serious":      {"temperature": 0.7, "stability": 0.8},
    # Faltavam (ver comentário no EDGE_STYLE_MAP). No ElevenLabs, stability
    # baixa = mais expressivo/variado; alta = mais contido e previsível.
    "excited":      {"temperature": 1.35, "stability": 0.40},
    "calm":         {"temperature": 0.85, "stability": 0.75},
    "professional": {"temperature": 0.75, "stability": 0.85},
}


def normalizar_estilo(style: str) -> str:
    """Resolve sinônimos e AVISA quando o estilo não existe.

    O bug que isso mata: antes, `.get(style, normal)` transformava qualquer
    nome desconhecido em "normal" sem dizer nada — a tela oferecia 4 estilos e
    3 não faziam efeito nenhum. Agora um nome estranho aparece no log.
    """
    s = (style or "normal").strip().lower()
    s = STYLE_ALIASES.get(s, s)
    if s not in STYLE_MAP:
        # ASCII puro de proposito: o console do Windows (cp1252) estoura com
        # emoji e derrubaria a geracao no dev local.
        print(f"[TTS][AVISO] Estilo desconhecido '{style}' - usando 'normal'. "
              f"Validos: {', '.join(sorted(STYLE_MAP))}")
        return "normal"
    return s


def aplicar_instrucao_de_tom(text: str, style: str) -> str:
    """Prefixa a instrução de tom pro Gemini (controllable TTS).

    Não prefixa quando: estilo é 'normal', não há instrução pro estilo, ou o
    texto JÁ começa com uma instrução escrita pelo usuário — senão teríamos
    duas ordens de tom brigando no mesmo prompt.
    """
    primeira = (text or "").lstrip().split("\n", 1)[0].strip()
    ja_tem = primeira.startswith("[") or primeira.upper().startswith(("FALE ", "DIGA ", "NARRE ", "LEIA "))
    if ja_tem:
        print("[TTS] O texto ja traz instrucao de tom - mantendo a do usuario.")
        return text

    instrucao = STYLE_INSTRUCTIONS.get(style)
    if not instrucao:
        # SEM instrução, texto curto quebra. O Gemini TTS responde:
        #   400 "Model tried to generate text, but it should only be used for
        #    TTS. Make sure your instructions are clear to only generate audio
        #    from a given text transcript."
        # Ou seja: com pouca coisa pra locutar, ele acha que está numa conversa
        # e tenta RESPONDER em vez de ler. Roteiro longo tem cara de roteiro e
        # passa; frase solta (o carimbo, um teaser de 5s) não passa.
        #
        # A instrução vai só nesses casos, pra não mexer no que já funciona.
        # Fica antes de dois-pontos de propósito: é assim que o modelo entende
        # "isto é ordem, não texto pra falar".
        palavras = len([p for p in (text or "").split() if p])
        if palavras and palavras <= 25:
            return f"Leia em voz alta, exatamente como está escrito: {text}"
        return text
    return f"{instrucao}\n{text}"


# ============================================================================
# CLASSE PRINCIPAL - TTSGenerator (MULTI-API)
# ============================================================================

class TTSGenerator:
    """
    Gerador TTS profissional com suporte a MÚLTIPLAS APIs.
    
    Suporta:
    - Google Gemini 3.1 Flash TTS (padrão)
    - ElevenLabs (opcional)
    - LMNT (para vozes clonadas)
    
    Escolha qual API usar para cada voz!
    
    Exemplo de uso:
        >>> generator = TTSGenerator()
        >>> 
        >>> # Usar Google Gemini TTS (padrão)
        >>> audio = generator.generate_speech(
        ...     "Olá mundo!",
        ...     voice_model="Zephyr",
        ...     api="google"
        ... )
        >>> 
        >>> # Usar ElevenLabs (qualidade superior)
        >>> audio = generator.generate_speech(
        ...     "Olá mundo!",
        ...     voice_model="Elena",
        ...     api="elevenlabs"
        ... )
    """

    def __init__(self, google_api_key: str = None, elevenlabs_api_key: str = None):
        """
        Inicializa o gerador com suporte a múltiplas APIs.
        EdgeTTS é a padrão e gratuita!

        Parâmetros
        ----------
        google_api_key : str, optional
            API key do Google. Se não fornecido, usa GEMINI_API_KEY do ambiente.
        elevenlabs_api_key : str, optional
            API key do ElevenLabs. Se não fornecido, usa ELEVENLABS_API_KEY do ambiente.
        """
        self.google_available = False
        self.elevenlabs_available = False
        self.lmnt_available = False
        self.edge_available = True  # EdgeTTS está sempre disponível!
        
        print("✅ EdgeTTS (Gratuito) disponível como padrão!")
        
        # ==================== GOOGLE GEMINI (OPCIONAL) ====================
        google_key = google_api_key or os.environ.get("GEMINI_API_KEY")
        if google_key and GOOGLE_GENAI_AVAILABLE:
            try:
                self.google_client = genai.Client(api_key=google_key)
                self.google_model = "gemini-2.5-flash-preview-tts"
                self.google_available = True
                print("✓ Google Gemini TTS disponível (opcional)")
            except Exception as e:
                print(f"❌ Google Gemini TTS indisponível: {e}")
        
        # ==================== ELEVENLABS (OPCIONAL) ====================
        elevenlabs_key = elevenlabs_api_key or os.environ.get("ELEVENLABS_API_KEY")
        if elevenlabs_key and ELEVENLABS_AVAILABLE:
            try:
                self.elevenlabs_client = ElevenLabs(api_key=elevenlabs_key)
                self.elevenlabs_available = True
                print("✓ ElevenLabs TTS disponível (opcional)")
            except Exception as e:
                print(f"❌ ElevenLabs TTS indisponível: {e}")
        elif elevenlabs_key and not ELEVENLABS_AVAILABLE:
            print("❌ ElevenLabs API key configurada mas biblioteca não instalada")
            print("   Instale com: pip install elevenlabs")
        
        # ==================== LMNT (Para Vozes Clonadas) ====================
        if LMNT_AVAILABLE and lmnt_integration.client:
            self.lmnt_integration = lmnt_integration
            self.lmnt_available = True
            print("✓ LMNT disponível para vozes clonadas!")

    def generate_speech(
        self,
        text: str,
        voice_model: str = "Zephyr",
        style: str = "normal",
        language: str = "pt-BR",
        api: Literal["edge", "google", "elevenlabs", "auto", "lmnt"] = "auto",
        dialogo: bool = False,
        voice2: str = None,
        speakers: list = None
    ) -> bytes:
        """
        Gera áudio WAV a partir de texto usando a API especificada.

        Parâmetros
        ----------
        text : str
            Texto a ser convertido em fala
        voice_model : str, default "Zephyr"
            Modelo de voz a usar
        style : str, default "normal"
            Estilo de fala (normal, fast, slow, cheerful, serious)
        language : str, default "pt-BR"
            Código do idioma (pt-BR, en-US, es-ES)
        api : str, default "auto"
            Qual API usar: "edge", "google", "elevenlabs", "lmnt", ou "auto"
        dialogo : bool, default False
            Diálogo de 2 vozes (multi-speaker do Gemini). Exige api google/auto.
        voice2 : str, optional
            Voz do 2º personagem (obrigatória no diálogo).
        speakers : list, optional
            Nomes dos personagens NA ORDEM de aparição — têm que bater com os
            rótulos "Nome:" do texto (o backend detecta e passa).

        Retorna
        -------
        bytes
            Conteúdo do arquivo WAV
        """
        # Validar texto
        if not text or not text.strip():
            raise ValueError("❌ Texto não pode estar vazio")

        # Diálogo (2 vozes): só existe no Gemini (multi-speaker nativo).
        # O desvio vem ANTES da detecção de voz clonada e do roteamento por
        # provider — diálogo nunca cai em LMNT/Edge/ElevenLabs por acidente.
        if dialogo:
            if api not in ("google", "auto"):
                raise ValueError("❌ Diálogo por enquanto é só no Modo Padrão (Google)")
            if not self.google_available:
                raise ValueError("❌ Google Gemini TTS não disponível")
            return self._generate_google_dialogo(text, voice_model, voice2 or "Puck", speakers or [], style)

        # Primeiro: Verificar se a voz é uma voz clonada LMNT (não está em nenhum mapa)
        is_cloned_voice = (
            voice_model not in EDGE_VOICE_MAP 
            and voice_model not in GOOGLE_VOICE_MAP 
            and voice_model not in ELEVENLABS_VOICE_MAP.values()
        )
        
        if is_cloned_voice and self.lmnt_available:
            print(f"🎙️  Detected cloned LMNT voice, using LMNT API...")
            return self._generate_lmnt(text, voice_model)
        
        # Determinar qual API usar (priorizar Google primeiro, pois ElevenLabs tem limites)
        if api == "auto":
            if self.google_available:
                api = "google"
            elif self.elevenlabs_available:
                api = "elevenlabs"
            else:
                api = "edge"
        
        # Verificar se API está disponível
        if api == "google" and not self.google_available:
            raise ValueError("❌ Google Gemini TTS não disponível")
        if api == "elevenlabs" and not self.elevenlabs_available:
            raise ValueError("❌ ElevenLabs não disponível")
        if api == "lmnt" and not self.lmnt_available:
            raise ValueError("❌ LMNT encerrou as atividades — as vozes clonadas nele não funcionam mais")

        # Log informativo
        print(f"🎙️  Gerando áudio com {api.upper()}...")
        print(f"    Voz: {voice_model}")
        print(f"    Estilo: {style}")

        # Chamar API apropriada
        try:
            if api == "edge":
                return self._generate_edge(text, voice_model, style, language)
            elif api == "google":
                return self._generate_google(text, voice_model, style, language)
            elif api == "elevenlabs":
                return self._generate_elevenlabs(text, voice_model, style)
            elif api == "lmnt":
                return self._generate_lmnt(text, voice_model)
            else:
                raise ValueError(f"API inválida: {api}")
        except Exception as e:
            print(f"❌ Erro ao gerar áudio: {e}")
            raise

    # ========================================================================
    # EDGETTS (PADRÃO, GRATUITO!)
    # ========================================================================

    def _generate_edge(
        self,
        text: str,
        voice_model: str,
        style: str,
        language: str
    ) -> bytes:
        """Gera áudio com EdgeTTS (gratuita!)."""
        voice = EDGE_VOICE_MAP.get(voice_model, EDGE_VOICE_MAP["default"])
        style_params = EDGE_STYLE_MAP[normalizar_estilo(style)]
        
        # Ajustar voz por idioma
        if language.startswith("en") and voice not in ["en-US-GuyNeural", "en-US-JennyNeural"]:
            voice = "en-US-GuyNeural"
        elif language.startswith("es") and voice not in ["es-ES-AlvaroNeural"]:
            voice = "es-ES-AlvaroNeural"
        
        audio_bytes = asyncio.run(self._synthesize_edge(text, voice, style_params["rate"], style_params["pitch"]))
        print(f"✅ Áudio gerado ({len(audio_bytes)} bytes)")
        return audio_bytes

    @staticmethod
    async def _synthesize_edge(text: str, voice: str, rate: str, pitch: str) -> bytes:
        """Síntese assíncrona com EdgeTTS."""
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
        buffer.seek(0)
        return buffer.read()

    # ========================================================================
    # GOOGLE GEMINI TTS
    # ========================================================================

    def _generate_google(
        self,
        text: str,
        voice_model: str,
        style: str,
        language: str
    ) -> bytes:
        """Gera áudio com Google Gemini TTS."""
        voice = GOOGLE_VOICE_MAP.get(voice_model, GOOGLE_VOICE_MAP["default"])
        style = normalizar_estilo(style)
        style_params = STYLE_MAP[style]
        temperature = style_params["temperature"]

        # O QUE FALTAVA: só a temperature não muda o tom do Gemini (ela mexe na
        # variação, não no jeito de falar). O tom vem da instrução no prompt.
        text = aplicar_instrucao_de_tom(text, style)

        audio_bytes = self._synthesize_google(text, voice, temperature, language)
        print(f"✅ Áudio gerado ({len(audio_bytes)} bytes)")
        return audio_bytes

    def _executar_tts_google(self, text: str, speech_config, temperature: float) -> bytes:
        """Executa a chamada TTS do Gemini e devolve WAV.

        Comum aos caminhos de voz única e diálogo — a única diferença entre
        eles é o speech_config (VoiceConfig vs MultiSpeakerVoiceConfig).
        """
        try:
            generate_content_config = types.GenerateContentConfig(
                temperature=temperature,
                response_modalities=["AUDIO"],
                speech_config=speech_config,
            )

            audio_data = io.BytesIO()

            response = self.google_client.models.generate_content(
                model=self.google_model,
                contents=text,
                config=generate_content_config,
            )

            if response.candidates and len(response.candidates) > 0:
                candidate = response.candidates[0]
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data.write(part.inline_data.data)

            audio_bytes = audio_data.getvalue()
            if not audio_bytes:
                raise RuntimeError("Nenhum dado de áudio recebido")

            mime_type = "audio/L16;rate=24000"
            wav_data = self._convert_to_wav(audio_bytes, mime_type)
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com Google: {str(e)}") from e

    def _synthesize_google(
        self,
        text: str,
        voice: str,
        temperature: float,
        language: str
    ) -> bytes:
        """Síntese síncrona com Google Gemini (voz única)."""
        speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice
                )
            )
        )
        return self._executar_tts_google(text, speech_config, temperature)

    def _generate_google_dialogo(
        self,
        text: str,
        voice_model: str,
        voice2: str,
        speakers: list,
        style: str,
    ) -> bytes:
        """Diálogo de 2 vozes numa chamada só (multi-speaker nativo do Gemini).

        `speakers` são os nomes dos personagens NA ORDEM de aparição no texto
        (detectados pelo backend) — o texto vai COM os rótulos "Nome:", é
        assim que o modelo roteia as vozes. 1º personagem → voice_model,
        2º → voice2.
        """
        if len(speakers) != 2:
            raise ValueError(f"Diálogo exige exatamente 2 personagens, recebi {len(speakers)}")
        # Voz fora do catálogo Gemini NÃO cai em Zephyr calado (sairia um
        # "diálogo" com as duas vozes iguais depois de gastar cota — achado em
        # revisão): erra alto, com o nome da voz culpada na mensagem.
        for v in (voice_model, voice2):
            if v not in GOOGLE_VOICE_MAP:
                raise ValueError(f"❌ Diálogo usa vozes do Gemini — a voz '{v}' não é do catálogo Google")
        voz1 = GOOGLE_VOICE_MAP[voice_model]
        voz2 = GOOGLE_VOICE_MAP[voice2]
        style = normalizar_estilo(style)
        temperature = STYLE_MAP[style]["temperature"]

        # Instrução SEMPRE em linha própria, formato "leia a conversa". O
        # aplicar_instrucao_de_tom cru tem um fallback pra texto curto que
        # gruda a ordem NA MESMA LINHA da primeira fala — o rótulo "Nome:"
        # deixa de abrir a linha e o modelo perde o roteamento do 1º
        # personagem (achado em revisão). Diálogo curto (teaser) é o caso
        # comum, então o preâmbulo aqui é próprio: tom (se houver) + ordem de
        # ler a conversa, e SÓ DEPOIS as falas rotuladas — o formato
        # documentado do multi-speaker do Gemini.
        #
        # O preâmbulo NOMEIA os dois falantes ("entre X e Y") de propósito: é
        # o formato documentado do multi-speaker, e sem isso o modelo pode
        # simplesmente LER TUDO NUMA VOZ SÓ — foi o que aconteceu na primeira
        # narração revezada real (texto institucional, que não "parece"
        # conversa; o diálogo com personagens escapou por sorte).
        primeira = (text or "").lstrip().split("\n", 1)[0].strip()
        ja_tem = primeira.startswith("[") or primeira.upper().startswith(("FALE ", "DIGA ", "NARRE ", "LEIA "))
        if not ja_tem:
            instrucao = STYLE_INSTRUCTIONS.get(style)
            preambulo = (instrucao + "\n") if instrucao else ""
            text = (f"{preambulo}Leia em voz alta, exatamente como está escrito, o texto a seguir, "
                    f"alternando entre as vozes de {speakers[0]} e {speakers[1]}:\n{text}")

        speech_config = types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=[
                    types.SpeakerVoiceConfig(
                        speaker=speakers[0],
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voz1)
                        ),
                    ),
                    types.SpeakerVoiceConfig(
                        speaker=speakers[1],
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voz2)
                        ),
                    ),
                ]
            )
        )
        audio_bytes = self._executar_tts_google(text, speech_config, temperature)
        print(f"✅ Diálogo gerado ({len(audio_bytes)} bytes)")
        return audio_bytes

    # ========================================================================
    # ELEVENLABS TTS
    # ========================================================================

    def _generate_elevenlabs(
        self,
        text: str,
        voice_model: str,
        style: str
    ) -> bytes:
        """Gera áudio com ElevenLabs."""
        # Check if voice_model is already a real voice ID (not a name)
        if voice_model in ELEVENLABS_VOICE_MAP.values():
            voice_id = voice_model
        else:
            voice_id = ELEVENLABS_VOICE_MAP.get(voice_model, ELEVENLABS_VOICE_MAP["default"])
        style_params = STYLE_MAP[normalizar_estilo(style)]

        try:
            # Gerar áudio com ElevenLabs
            audio_stream = self.elevenlabs_client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id="eleven_turbo_v2",
                voice_settings={
                    "stability": style_params["stability"],
                    "similarity_boost": 0.75,
                }
            )

            # Coletar dados de áudio
            audio_data = io.BytesIO()
            for chunk in audio_stream:
                audio_data.write(chunk)

            audio_bytes = audio_data.getvalue()
            
            if not audio_bytes:
                raise RuntimeError("Nenhum áudio gerado pelo ElevenLabs")

            # ElevenLabs retorna MP3, converter para WAV
            wav_data = self._convert_mp3_to_wav(audio_bytes)
            print(f"✅ Áudio gerado ({len(wav_data)} bytes)")
            return wav_data

        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com ElevenLabs: {str(e)}") from e

    # ========================================================================
    # LMNT (VOZES CLONADAS)
    # ========================================================================
    def _generate_lmnt(
        self,
        text: str,
        voice_model: str
    ) -> bytes:
        """Gera áudio com uma voz clonada LMNT."""
        try:
            # Use the LMNT integration to generate audio
            result = self.lmnt_integration.generate_speech(text, voice_id=voice_model, format="wav")
            
            if "error" in result:
                raise RuntimeError(result["error"])
            
            # Read the generated WAV file
            with open(result["filepath"], "rb") as f:
                audio_bytes = f.read()
            
            print(f"✅ Áudio gerado com LMNT ({len(audio_bytes)} bytes)")
            return audio_bytes
            
        except Exception as e:
            raise RuntimeError(f"Erro ao sintetizar com LMNT: {str(e)}") from e

    # ========================================================================
    # CONVERSÃO DE ÁUDIO
    # ========================================================================

    @staticmethod
    def _convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
        """Converte áudio PCM (Google) para WAV."""
        parameters = TTSGenerator._parse_audio_mime_type(mime_type)
        bits_per_sample = parameters["bits_per_sample"]
        sample_rate = parameters["rate"]
        num_channels = 1

        data_size = len(audio_data)
        bytes_per_sample = bits_per_sample // 8
        block_align = num_channels * bytes_per_sample
        byte_rate = sample_rate * block_align
        chunk_size = 36 + data_size

        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            chunk_size,
            b"WAVE",
            b"fmt ",
            16,
            1,
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
            b"data",
            data_size
        )

        return header + audio_data

    @staticmethod
    def _convert_mp3_to_wav(audio_data: bytes) -> bytes:
        """Converte MP3 (ElevenLabs) para WAV."""
        try:
            import pydub
            from pydub import AudioSegment
            
            # Converter MP3 para WAV
            audio = AudioSegment.from_mp3(io.BytesIO(audio_data))
            
            # Exportar como WAV
            wav_buffer = io.BytesIO()
            audio.export(
                wav_buffer,
                format="wav",
                parameters=["-q:a", "9"]
            )
            
            return wav_buffer.getvalue()
        except ImportError:
            print("❌ Biblioteca pydub não instalada")
            print("   Para usar ElevenLabs, instale: pip install pydub")
            print("   E ffmpeg: apt-get install ffmpeg")
            raise

    @staticmethod
    def _parse_audio_mime_type(mime_type: str) -> dict:
        """Parse de MIME type."""
        bits_per_sample = 16
        rate = 24000

        parts = mime_type.split(";")
        for param in parts:
            param = param.strip()
            
            if param.lower().startswith("rate="):
                try:
                    rate = int(param.split("=", 1)[1])
                except (ValueError, IndexError):
                    pass
            elif "L" in param:
                try:
                    bits_per_sample = int(param.split("L")[1].split(";")[0])
                except (ValueError, IndexError):
                    pass

        return {"bits_per_sample": bits_per_sample, "rate": rate}


# ============================================================================
# FUNÇÃO FACTORY
# ============================================================================

def get_tts_generator(
    google_api_key: str = None,
    elevenlabs_api_key: str = None
) -> TTSGenerator:
    """
    Factory function para criar um gerador TTS.
    
    Exemplo
    -------
    >>> generator = get_tts_generator()
    >>> audio = generator.generate_speech("Olá!")
    """
    try:
        return TTSGenerator(
            google_api_key=google_api_key,
            elevenlabs_api_key=elevenlabs_api_key
        )
    except ValueError as e:
        raise ValueError(str(e)) from e


# ============================================================================
# EXEMPLO DE USO
# ============================================================================

if __name__ == "__main__":
    import sys

    try:
        print("\n" + "=" * 70)
        print("NOVO GERADOR TTS - MULTI-API")
        print("Google Gemini + ElevenLabs + LMNT")
        print("=" * 70 + "\n")

        # Inicializar
        print("Inicializando gerador TTS...")
        generator = get_tts_generator()
        print()

        # Exemplos
        exemplos = [
            {
                "text": "Olá! Usando Google Gemini TTS.",
                "voice": "Zephyr",
                "api": "google",
                "file": "exemplo_google.wav"
            },
            {
                "text": "Olá! Usando EdgeTTS (padrão).",
                "voice": "Zephyr",
                "api": "edge",
                "file": "exemplo_edge.wav"
            },
        ]

        print("Gerando exemplos...\n")
        
        for idx, exemplo in enumerate(exemplos, 1):
            try:
                print(f"[{idx}/{len(exemplos)}] {exemplo['file']}")
                
                audio_data = generator.generate_speech(
                    text=exemplo['text'],
                    voice_model=exemplo['voice'],
                    api=exemplo['api']
                )

                with open(exemplo['file'], "wb") as f:
                    f.write(audio_data)

                print(f"      ✅ Salvo: {exemplo['file']}\n")

            except Exception as e:
                print(f"      ❌ Erro: {e}\n")
                continue

        print("=" * 70)
        print("✅ Exemplos gerados com sucesso!")
        print("=" * 70 + "\n")

    except ValueError as e:
        print(f"❌ Erro de Configuração:\n  {e}\n", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Erro inesperado:\n  {e}\n", file=sys.stderr)
        sys.exit(1)

