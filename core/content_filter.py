"""
Filtro de conteúdo sensível para o pipeline de notícias.

O SQL no Supabase NÃO consegue barrar esse conteúdo porque os agentes
buscam o RSS e montam o post em Python ANTES de gravar no banco. Então o
bloqueio precisa acontecer aqui, no pipeline, antes de publicar no Feed.

Bloqueia notícias sobre crimes/violência/conteúdo pesado (homicídio,
feminicídio, facada, estupro, etc.). A comparação é feita sobre o texto
normalizado (sem acento, minúsculo) com fronteira de palavra, para pegar
variações ("violência"/"violencia", "matou"/"mataram").

Como ajustar:
- Edite SENSITIVE_PATTERNS abaixo (regex já com \\b de fronteira), ou
- Defina a env BLOCKED_TERMS_EXTRA="palavra1,palavra2" para acrescentar
  termos sem mexer no código (cada termo vira um padrão \\btermo\\w*).
"""
import os
import re
import unicodedata
import logging

logger = logging.getLogger(__name__)

# Padrões sensíveis (regex sobre texto SEM acento e minúsculo).
# Preferimos errar barrando demais a deixar passar conteúdo de crime/violência.
SENSITIVE_PATTERNS = [
    # Morte / homicídio
    r"\bmatou\b", r"\bmatar\b", r"\bmataram\b", r"\bmatador\w*",
    r"\bmort[ao]s?\b", r"\bmorte[s]?\b", r"\bmorreu\b", r"\bmorrer\w*",
    r"\bassassin\w*",          # assassinato, assassino, assassinada
    r"\bhomicidio\w*",
    r"\bfeminicidio\w*",
    r"\blatrocinio\w*", r"\bchacina\w*",
    # Armas brancas / de fogo
    r"\bfacada\w*", r"\besfaque\w*", r"\besfaqu\w*", r"\bapunhal\w*",
    r"\bbalead[ao]s?\b", r"\bbaleou\b", r"\btiroteio\w*", r"\btiros?\b",
    r"\bexecutad[ao]s?\b", r"\bfuzilad\w*",
    # Violência sexual
    r"\bestupr\w*", r"\bestupro\b", r"\babuso sexual\b", r"\bpedofil\w*",
    r"\bassedi\w*", r"\bestuprador\w*", r"\bimportun\w* sexual\b",
    # Agressão / tortura / sequestro
    r"\bespanca\w*", r"\bespancament\w*",
    r"\bagred\w*", r"\bagress\w*",      # agredida, agressão
    r"\bviolencia\w*", r"\bviolent\w*",
    r"\bsequestr\w*",
    r"\btortur\w*", r"\bestrangul\w*", r"\benforcad\w*", r"\bdegol\w*",
    r"\bdecapit\w*", r"\besquartej\w*",
    r"\blinchad\w*", r"\blinchament\w*",
    # Outros conteúdos pesados
    r"\bsuicid\w*", r"\boverdose\b", r"\bcadaver\w*", r"\bcorpo encontrado\b",
    r"\btrafic\w*",            # tráfico
    r"\bestupro coletivo\b",
]


def _build_patterns():
    patterns = list(SENSITIVE_PATTERNS)
    extra = os.getenv("BLOCKED_TERMS_EXTRA", "")
    for term in extra.split(","):
        term = _normalize(term.strip())
        if term:
            patterns.append(r"\b" + re.escape(term) + r"\w*")
    return [re.compile(p) for p in patterns]


def _normalize(text: str) -> str:
    """Remove acentos e baixa caixa para a comparação."""
    text = text or ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower()


_COMPILED = _build_patterns()


def blocked_reason(*texts) -> str:
    """
    Retorna o termo/padrão que bateu (string truthy) se algum texto contiver
    conteúdo sensível, ou '' (falsy) caso esteja liberado.
    """
    blob = _normalize(" ".join(str(t) for t in texts if t))
    for rx in _COMPILED:
        if rx.search(blob):
            return rx.pattern
    return ""


def is_blocked(*texts) -> bool:
    return bool(blocked_reason(*texts))


# Campos onde procuramos o texto, cobrindo os dois formatos usados no projeto:
# o do RSSFetcher ("titulo"/"resumo"/"conteudo_completo") e o cru ("title"/"summary").
_TEXT_FIELDS = ("titulo", "resumo", "conteudo_completo",
                "title", "summary", "content", "snippet")


def filter_news(items):
    """
    Recebe uma lista de dicts de notícia e devolve (mantidas, bloqueadas).
    `bloqueadas` é uma lista de tuplas (item, motivo) para log/auditoria.
    """
    kept, blocked = [], []
    for it in items:
        if not isinstance(it, dict):
            kept.append(it)
            continue
        texts = [it.get(f, "") for f in _TEXT_FIELDS]
        reason = blocked_reason(*texts)
        if reason:
            blocked.append((it, reason))
        else:
            kept.append(it)

    if blocked:
        titulos = [str(it.get("titulo") or it.get("title") or "?")[:60] for it, _ in blocked]
        logger.info(f"🚫 [FILTRO] {len(blocked)} notícia(s) bloqueada(s) por conteúdo sensível: {titulos}")
    return kept, blocked
