"""
Conteúdo de notícia para a NewPost-IA — faxina + redação do post por IA.

Módulo COMPARTILHADO pelos dois pipelines de automação:
  - Pipeline A: core/news_automation_agent.py  (perfil/autor próprio)
  - Pipeline B: news_agent.py                  (perfil/autor próprio)

Os dois continuam publicando em PERFIS DIFERENTES da NewPost-IA — este módulo
cuida só do TEXTO, pra os dois pararem de despejar a matéria bruta da fonte
(com CTAs do portal, créditos de foto e placeholders de plugin repetidos).

Uso:
    from core.news_content import montar_corpo, limpar_noticia
    corpo = montar_corpo(titulo, resumo, categoria)
"""

import os
import re
import html as html_lib

# Tamanho padrão do corpo do post (feed social — post, não matéria)
LIMITE_PADRAO = 420

# Lixo que vaza do HTML dos portais. Cada padrão vira uma remoção de linha/trecho.
_PADROES_LIXO = [
    r'initial plugin text',                                   # placeholder de plugin WordPress
    r'tem alguma sugest[ãa]o de reportagem[^.\n]*',            # g1
    r'clique aqui[^.\n]*',                                    # "Clique aqui para seguir o canal..."
    r'acompanhe[^.\n]*\b(no|pelo)\b[^.\n]*(g1|youtube|whatsapp|instagram|telegram)[^.\n]*',
    r'agora no g1',
    r'\b(leia|veja|saiba)\s+(também|mais|tamb[ée]m)\b[^.\n]*',
    r'siga[^.\n]*\b(instagram|twitter|telegram|whatsapp|face(book)?|x)\b[^.\n]*',
    r'assine[^.\n]*newsletter[^.\n]*',
    r'compartilhe[^.\n]*',
    r'receba[^.\n]*not[íi]cias[^.\n]*whatsapp[^.\n]*',
    r'este conte[úu]do[^.\n]*',
    r'todos os direitos reservados[^.\n]*',
    # Rodapé padrão de RSS WordPress (Olhar Digital, Forbes, etc.)
    r'o post\s+.*?\s+apareceu primeiro em\s+[^.\n]*\.?',
    r'participe do canal[^.\n]*',                              # g1 regional no WhatsApp
    r'v[íi]deos?\s*:\s*assista[^.\n]*',
    r'veja mais not[íi]cias[^.\n]*',
    r'entre no canal[^.\n]*',
    # Boilerplate institucional que a Forbes manda no RSS de toda matéria
    r'forbes,?\s+a mais conceituada revista[^.\n]*\.?',
]

# Foto embutida no HTML do resumo do RSS (os portais mandam a imagem da matéria ali)
_IMG_SRC = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)

# Créditos de foto / assinatura de repórter (ex.: "AP Photo/Richard Drew", "Ana Marin/g1")
_PADROES_CREDITO = [
    r'^\s*(foto|imagem|arte|v[íi]deo)s?\s*:.*$',
    # Linha inteira do tipo "Ana Marin/g1" ou "Corpo de Bombeiros/Divulgação"
    r'^\s*[\wÀ-ú.\-\s]{2,60}/\s*(g1|uol|folha|globo|oglobo|reuters|afp|ap|efe|estad[ãa]o|'
    r'divulga[çc][ãa]o|arquivo pessoal|getty images)\s*$',
    r'^\s*(ap photo|reuters|afp|getty images|divulga[çc][ãa]o)\b.*$',
]

_TAGS_QUEBRA = re.compile(r'(?i)<\s*br\s*/?\s*>|<\s*/\s*(p|div|li|h[1-6])\s*>')
_TAG_QUALQUER = re.compile(r'<[^>]+>')


def _strip_html(texto: str) -> str:
    """Remove HTML preservando quebras de parágrafo (mesma ideia do strip_html do app)."""
    if not texto:
        return ''
    t = _TAGS_QUEBRA.sub('\n', texto)
    t = _TAG_QUALQUER.sub('', t)
    t = html_lib.unescape(t)
    t = t.replace('\xa0', ' ').replace('\t', ' ')
    t = re.sub(r'[ ]{2,}', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()


def _remover_lixo(texto: str) -> str:
    """Tira CTAs do portal e créditos de foto que não fazem sentido no nosso feed."""
    linhas = []
    for linha in texto.split('\n'):
        alvo = linha.strip()
        if not alvo:
            continue
        if any(re.match(p, alvo, flags=re.IGNORECASE) for p in _PADROES_CREDITO):
            continue
        for padrao in _PADROES_LIXO:
            alvo = re.sub(padrao, ' ', alvo, flags=re.IGNORECASE)
        alvo = re.sub(r'[ ]{2,}', ' ', alvo).strip(' -–—:;,')
        if len(alvo) >= 3:
            linhas.append(alvo)
    return '\n'.join(linhas)


def _dedupe_frases(texto: str) -> str:
    """Remove frases repetidas — é o que produz o 'Initial plugin text' 7x
    (seletores de scraping aninhados duplicam o mesmo bloco)."""
    partes = re.split(r'(?<=[.!?])\s+|\n+', texto)
    vistas = set()
    saida = []
    for parte in partes:
        limpo = parte.strip()
        if not limpo:
            continue
        chave = re.sub(r'\W+', '', limpo.lower())[:80]
        if not chave or chave in vistas:
            continue
        vistas.add(chave)
        saida.append(limpo)
    return ' '.join(saida)


def _cortar(texto: str, limite: int) -> str:
    """Corta no fim de frase quando dá; senão, no último espaço + reticências."""
    if len(texto) <= limite:
        return texto
    corte = texto[:limite]
    fim_frase = max(corte.rfind('.'), corte.rfind('!'), corte.rfind('?'))
    if fim_frase >= int(limite * 0.5):
        return corte[:fim_frase + 1].strip()
    espaco = corte.rfind(' ')
    return (corte[:espaco] if espaco > 0 else corte).strip() + '...'


def limpar_noticia(texto: str, limite: int = LIMITE_PADRAO) -> str:
    """Faxina completa: HTML → lixo de portal → frases repetidas → corte."""
    if not texto:
        return ''
    t = _strip_html(texto)
    t = _remover_lixo(t)
    t = _dedupe_frases(t)
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return _cortar(t, limite)


def limpar_para_publicar(texto: str) -> str:
    """Faxina do PORTÃO DE PUBLICAÇÃO — rede de segurança para rascunhos antigos
    (criados antes da faxina) e para o que o operador editou na curadoria.

    Diferente de limpar_noticia(): aqui NÃO trunca e NÃO junta tudo numa linha —
    preserva os parágrafos do texto curado. Remove o lixo de portal e linhas
    repetidas (o 'Initial plugin text' aparece uma vez por linha).
    """
    if not texto:
        return ''
    t = _strip_html(texto)
    saida = []
    vistas = set()
    for linha in t.split('\n'):
        alvo = linha.strip()
        if not alvo:
            saida.append('')  # preserva a quebra de parágrafo
            continue
        if any(re.match(p, alvo, flags=re.IGNORECASE) for p in _PADROES_CREDITO):
            continue
        for padrao in _PADROES_LIXO:
            alvo = re.sub(padrao, ' ', alvo, flags=re.IGNORECASE)
        alvo = re.sub(r'[ ]{2,}', ' ', alvo).strip(' -–—:;,')
        if len(alvo) < 3:
            continue
        chave = re.sub(r'\W+', '', alvo.lower())[:80]
        if chave in vistas:
            continue  # linha repetida (placeholder de plugin)
        vistas.add(chave)
        saida.append(alvo)
    t = '\n'.join(saida)
    return re.sub(r'\n{3,}', '\n\n', t).strip()


def extrair_imagem(html_texto: str) -> str:
    """Pega a foto embutida no HTML do resumo do RSS — é a imagem da matéria que
    hoje é descartada, deixando todo post do feed sem foto. Retorna '' se não achar."""
    if not html_texto:
        return ''
    achado = _IMG_SRC.search(html_texto)
    if not achado:
        return ''
    url = achado.group(1).strip()
    return url if url.lower().startswith('http') else ''


def _prompt_post(titulo: str, resumo: str, categoria: str, limite: int) -> str:
    return f"""Você escreve posts curtos para a NewPost-IA, uma rede social brasileira.

Reescreva a notícia abaixo como um POST de feed — NÃO copie o texto da matéria.

Título: {titulo}
Resumo da fonte: {resumo}
Categoria: {categoria or 'geral'}

Regras:
- 2 a 4 frases, no MÁXIMO {limite} caracteres no total
- Português do Brasil, tom jornalístico e direto, sem sensacionalismo nem invenção
- Conte o fato principal com as informações que estão no resumo; não invente dados
- NÃO inclua o título de volta, NÃO use hashtags, NÃO use markdown
- NUNCA inclua chamadas do portal de origem ("clique aqui", "leia mais", "acompanhe no g1",
  "mande sua sugestão"), créditos de foto, nomes de repórter ou links
- Responda APENAS com o texto do post, nada mais"""


def gerar_post_ia(titulo: str, resumo: str, categoria: str = 'geral',
                  limite: int = LIMITE_PADRAO):
    """Pede ao Gemini um post próprio a partir do título/resumo.
    Retorna o texto ou None se a IA não estiver disponível/falhar (o chamador
    cai no texto limpo). Usa o SDK NOVO (google-genai), nunca o legado."""
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_STUDIO_API_KEY')
    if not api_key or not (titulo or resumo):
        return None
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        resposta = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=_prompt_post(titulo, resumo, categoria, limite)
        )
        texto = (resposta.text or '').strip()
        # A IA às vezes devolve aspas/markdown — passa pela faxina do mesmo jeito.
        texto = texto.strip('"').strip()
        texto = limpar_noticia(texto, limite)
        return texto or None
    except Exception as e:
        print(f"[news_content] IA indisponível, usando texto limpo: {e}")
        return None


def montar_corpo(titulo: str, resumo: str, categoria: str = 'geral',
                 limite: int = LIMITE_PADRAO, usar_ia: bool = True) -> str:
    """Corpo final do post (sem título e sem hashtags — cada pipeline põe o seu
    cabeçalho/rodapé e publica no SEU perfil).

    1) tenta a IA escrever um post próprio;
    2) se não der, devolve o resumo da fonte limpo e cortado.
    """
    if usar_ia:
        via_ia = gerar_post_ia(titulo, resumo, categoria, limite)
        if via_ia:
            return via_ia
    return limpar_noticia(resumo, limite)
