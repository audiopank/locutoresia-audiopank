"""
Receita do dia — perfil "Receitas Favoritas Grandes Dicas" na NewPost-IA (01/10/2026).

Substitui a automação da Base44 (perfil Sabor & Saúde), com UMA diferença de
princípio: nada sai sozinho. A tela /receita-do-dia sugere receitas, a IA
prepara texto e foto, e o produtor revisa e clica Publicar ("tudo tem que
passar pela nossa mão" — decisão dele, 01/10/2026).

Fonte: RSS oficial da Receiteria, só de RECEITAS (`/feed/?post_type=receita`).
O feed principal (`/feed/`) traz matérias e listas ("32 receitas para a
primavera") e o site posta pouco nele; o de receitas tem várias por dia, e o
WordPress pagina o arquivo inteiro (`&paged=N`, a página 150 ainda é dez/2025)
— por isso a sugestão sorteia uma página antiga além da primeira.

O item do feed de receitas não traz resumo (só "O post X apareceu primeiro
em Receiteria"). Quando o produtor escolhe uma, a página da receita é lida UMA
vez: descrição do próprio site, ingredientes, tempo e rendimento (JSON-LD) —
é o chão da IA pra escrever sem inventar.

Direito autoral: resumo próprio + "Fonte: Receiteria" + link. A FOTO nunca é
copiada do site: ou é gerada por IA, ou é do computador do produtor.
"""
import functools
import html
import json
import os
import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from email.utils import parsedate_to_datetime

import requests

from core.newpost_feed import TAGS_POR_CONTA

FEED_RECEITERIA = 'https://www.receiteria.com.br/feed/?post_type=receita'
PREFIXO_LINK = 'https://www.receiteria.com.br/'
PAGINA_MAX = 150                     # conferido em 01/10/2026: a página 150 ainda traz 10 receitas
ARQUIVO_ANTIGAS = os.path.join(os.path.dirname(__file__), 'receitas_publicadas_antigas.txt')
RE_RESUMO_VAZIO = re.compile(r'^O post .* apareceu primeiro em ', re.S)
HASHTAGS_FIXAS = TAGS_POR_CONTA['receitas']
MODELO_TEXTO = 'gemini-2.5-flash'
MODELO_FOTO = 'gemini-2.5-flash-image'
# A Receiteria barra robô sem cara de navegador (na Base44 dava 403).
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/128.0 Safari/537.36'}


def _sem_acento(texto):
    t = unicodedata.normalize('NFKD', str(texto or ''))
    return ''.join(c for c in t if not unicodedata.combining(c)).lower()


def _texto_limpo(html_cru, limite=600):
    """Descrição do RSS (HTML) → texto corrido, sem tags, cortado em `limite`."""
    t = re.sub(r'<[^>]+>', ' ', html_cru or '')
    t = re.sub(r'\s+', ' ', html.unescape(t)).strip()
    if len(t) > limite:
        t = t[:limite].rsplit(' ', 1)[0] + '…'
    return t


def normalizar_link(link):
    """Link comparável: https, sem www, sem query/fragmento, sem barra final, minúsculo."""
    u = str(link or '').strip().split('#', 1)[0].split('?', 1)[0].lower()
    u = re.sub(r'^https?://(www\.)?', 'https://', u)
    return u.rstrip('/')


# ── RSS ─────────────────────────────────────────────────────────────────────

def ler_feed(xml_bytes):
    """XML do RSS → [{titulo, link, resumo, categorias, data}] (data ISO ou '')."""
    raiz = ET.fromstring(xml_bytes)
    itens = []
    for it in raiz.findall('./channel/item'):
        titulo = (it.findtext('title') or '').strip()
        link = (it.findtext('link') or '').strip()
        if not titulo or not link.startswith(PREFIXO_LINK):
            continue
        try:
            data = parsedate_to_datetime(it.findtext('pubDate') or '').date().isoformat()
        except (TypeError, ValueError):
            data = ''
        resumo = _texto_limpo(it.findtext('description'))
        itens.append({
            'titulo': titulo,
            'link': link,
            'resumo': '' if RE_RESUMO_VAZIO.match(resumo) else resumo,
            'categorias': [c.text.strip() for c in it.findall('category') if c.text and c.text.strip()],
            'data': data,
        })
    return itens


def baixar_pagina(pagina=1):
    """Uma página do RSS (10 receitas). Página 1 = as mais novas."""
    pagina = int(pagina)
    url = FEED_RECEITERIA if pagina <= 1 else f'{FEED_RECEITERIA}&paged={pagina}'
    r = requests.get(url, headers=UA, timeout=15)
    r.raise_for_status()
    return ler_feed(r.content)


# ── página da receita (só da escolhida) ─────────────────────────────────────

def _duracao(iso):
    """'PT1H20M' → '1h20'; 'PT20M' → '20 min'; formato estranho → ''."""
    m = re.fullmatch(r'P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?', str(iso or '').strip().upper())
    if not m or not (m.group(1) or m.group(2)):
        return ''
    h, mi = int(m.group(1) or 0), int(m.group(2) or 0)
    if h:
        return f'{h}h{mi:02d}' if mi else f'{h}h'
    return f'{mi} min'


def _receitas_do_jsonld(no):
    """Acha os objetos @type Recipe num JSON-LD (solto, em lista ou em @graph)."""
    if isinstance(no, list):
        for x in no:
            yield from _receitas_do_jsonld(x)
    elif isinstance(no, dict):
        tipo = no.get('@type')
        if tipo == 'Recipe' or (isinstance(tipo, list) and 'Recipe' in tipo):
            yield no
        for x in (no.get('@graph') or []):
            yield from _receitas_do_jsonld(x)


def ler_pagina_receita(html_texto):
    """HTML da receita → {descricao, ingredientes, tempo, rendimento} (campo ausente = vazio)."""
    t = html_texto or ''
    m = re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:)?description["\'][^>]*content=["\']([^"\']*)', t)
    det = {'descricao': html.unescape(m.group(1)).strip() if m else '',
           'ingredientes': [], 'tempo': '', 'rendimento': ''}
    for bloco in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', t, re.S | re.I):
        try:
            dados = json.loads(bloco)
        except ValueError:
            continue
        for rec in _receitas_do_jsonld(dados):
            det['ingredientes'] = [html.unescape(str(i)).strip() for i in (rec.get('recipeIngredient') or [])][:20]
            det['tempo'] = _duracao(rec.get('totalTime'))
            rend = rec.get('recipeYield')
            det['rendimento'] = str(rend[0] if isinstance(rend, list) and rend else (rend or '')).strip()
            if not det['descricao']:
                det['descricao'] = html.unescape(str(rec.get('description') or '')).strip()
            return det
    return det


def detalhes_da_receita(link):
    """Lê a página da receita escolhida (1 requisição). Levanta exceção se falhar."""
    if not str(link or '').startswith(PREFIXO_LINK):
        raise ValueError('link fora da Receiteria')
    r = requests.get(link, headers=UA, timeout=15)
    r.raise_for_status()
    return ler_pagina_receita(r.text)


# ── filtros ─────────────────────────────────────────────────────────────────

# Época fixa: (nome, padrão sobre título + categorias SEM acento, início, fim) em (mês, dia).
# Fora da janela a receita fica escondida — a Base44 postou ceia de Natal em 1º/10.
EPOCAS_FIXAS = [
    ('Natal/Ano Novo', r'\bnatal\w*|\bceia\b|\bpanetone|\bchocotone|\brabanada|\bano novo\b|\breveillon',
     (11, 15), (1, 6)),
    ('Festa Junina', r'\bjunin\w*|\bjulin\w*|\bsao joao\b|\barraia\w*|\bquentao\b', (5, 20), (7, 31)),
    ('Dia dos Namorados', r'\bdia dos namorados\b', (5, 25), (6, 12)),
    ('Dia das Mães', r'\bdia das maes\b', (4, 20), (5, 15)),
    ('Dia dos Pais', r'\bdia dos pais\b', (7, 20), (8, 15)),
    ('Dia das Crianças', r'\bdia das criancas\b', (9, 25), (10, 12)),
    ('Halloween', r'\bhalloween\b|\bdia das bruxas\b', (10, 10), (10, 31)),
    ('Primavera', r'\bprimavera\b', (9, 15), (12, 21)),
    ('Verão', r'\bverao\b', (12, 1), (3, 20)),
    ('Outono', r'\boutono\b', (3, 15), (6, 21)),
    ('Inverno', r'\binverno\b', (6, 1), (9, 22)),
]
RE_COPA = re.compile(r'\bcopa do mundo\b|\bcopa 2026\b|\bworld cup\b')


def _pascoa(ano):
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)."""
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


def _na_janela(hoje, ini, fim):
    t = (hoje.month, hoje.day)
    return ini <= t <= fim if ini <= fim else (t >= ini or t <= fim)


def fora_de_epoca(item, hoje=None, com_categorias=True):
    """Nome da época quando a receita é de outra época do ano; '' quando serve hoje.

    `com_categorias=False` olha só o título: etiqueta sozinha é sinal fraco (o
    "Bolo de creme de milho" tem "Festa Junina" entre 10 etiquetas e é do ano todo).
    """
    hoje = hoje or date.today()
    partes = [item.get('titulo') or ''] + (list(item.get('categorias') or []) if com_categorias else [])
    texto = _sem_acento(' '.join(partes))
    for nome, padrao, ini, fim in EPOCAS_FIXAS:
        if re.search(padrao, texto) and not _na_janela(hoje, ini, fim):
            return nome
    pascoa = _pascoa(hoje.year)
    carnaval = pascoa - timedelta(days=47)
    moveis = [
        ('Páscoa', r'\bpascoa\b|\bcolomba\b', pascoa - timedelta(days=40), pascoa + timedelta(days=1)),
        ('Carnaval', r'\bcarnaval\w*', carnaval - timedelta(days=21), carnaval + timedelta(days=1)),
    ]
    for nome, padrao, ini, fim in moveis:
        if re.search(padrao, texto) and not (ini <= hoje <= fim):
            return nome
    return ''


def motivo_bloqueio(item):
    """Conteúdo que nunca entra: Copa do Mundo (regra da casa) ou sensível (core/content_filter)."""
    from core.content_filter import blocked_reason
    titulo, resumo = item.get('titulo') or '', item.get('resumo') or ''
    if RE_COPA.search(_sem_acento(titulo + ' ' + resumo)):
        return 'Copa do Mundo'
    termo = blocked_reason(titulo, resumo)
    if termo:
        return 'conteúdo sensível (' + re.sub(r'\\[bw]\*?|[\\*?]', '', termo) + ')'
    return ''


RE_LINK = re.compile(r'https?://(?:www\.)?receiteria\.com\.br/[^\s<>"\')\]]+', re.I)


def links_publicados(conteudos):
    """Links da Receiteria que já aparecem nos posts, normalizados."""
    achados = set()
    for c in conteudos or []:
        for u in RE_LINK.findall(c or ''):
            achados.add(normalizar_link(u.rstrip('.,;')))
    return achados


@functools.lru_cache(maxsize=1)
def publicadas_antigas():
    """Receitas que o perfil já tinha publicado ANTES desta tela (jan-set/2026).

    Esses posts usam link curto (abrir.receiteria.com.br/s/...), que não diz qual
    é a receita; a lista foi montada uma vez, em 01/10/2026, seguindo cada link.
    """
    try:
        with open(ARQUIVO_ANTIGAS, encoding='utf-8') as f:
            return frozenset(l.strip() for l in f if l.strip() and not l.startswith('#'))
    except OSError:
        return frozenset()


def sugestoes(itens, publicados, hoje=None, maximo=8):
    """Separa o que o produtor vê do que fica escondido (com o motivo, pra conferência).

    Época no TÍTULO esconde; época só nas etiquetas mostra com `aviso_epoca`
    (quem decide é o produtor).
    """
    vistos, mostrar, escondidas = set(), [], []
    for it in itens:
        chave = normalizar_link(it['link'])
        if chave in vistos:
            continue
        vistos.add(chave)
        motivo = 'já publicada' if chave in publicados else motivo_bloqueio(it)
        if not motivo:
            epoca = fora_de_epoca(it, hoje, com_categorias=False)
            motivo = f'fora de época ({epoca})' if epoca else ''
        if motivo:
            escondidas.append({'titulo': it['titulo'], 'motivo': motivo})
        elif len(mostrar) < maximo:
            etiqueta = fora_de_epoca(it, hoje)
            mostrar.append({**it, 'aviso_epoca': etiqueta} if etiqueta else it)
    return {'itens': mostrar, 'escondidas': escondidas}


# ── texto ───────────────────────────────────────────────────────────────────

def _hashtag(t):
    return re.sub(r'\W+', '', str(t or ''))[:30]


def montar_legenda(emoji, titulo, resumo, link, extras=()):
    """Formato do post (o mesmo da Base44, com as hashtags da casa nova):
    emoji + título / resumo / "Fonte: Receiteria" + link / hashtags fixas + até 2 do prato."""
    tags = list(HASHTAGS_FIXAS)
    ja = {t.lower() for t in tags}
    for e in extras or ():
        t = _hashtag(e)
        if t and t.lower() not in ja and len(tags) < len(HASHTAGS_FIXAS) + 2:
            tags.append(t)
            ja.add(t.lower())
    cabeca = f'{(emoji or "🍽️").strip()} {str(titulo or "").strip()}'.strip()
    resumo = str(resumo or '').strip()
    corpo = f'{cabeca}\n\n{resumo}' if resumo else cabeca
    return f'{corpo}\n\nFonte: Receiteria\n{link}\n\n' + ' '.join('#' + t for t in tags)


def hashtags_do_texto(texto):
    """Hashtags do texto final (o que o produtor deixou) → `tags` do post, sem repetir."""
    vistas, tags = set(), []
    for t in re.findall(r'#(\w+)', texto or ''):
        if t.lower() not in vistas:
            vistas.add(t.lower())
            tags.append(t)
    return tags[:10]


def _resumo_sem_ia(trecho):
    """Até 3 frases do próprio trecho do RSS (o produtor revisa antes de publicar)."""
    frases = re.split(r'(?<=[.!?])\s+', (trecho or '').strip())
    return ' '.join(frases[:3]).strip()


def _prompt_texto(item):
    ingredientes = '; '.join((item.get('ingredientes') or [])[:15]) or '(não informado)'
    return f"""Você escreve posts de receita para o perfil "Receitas Favoritas Grandes Dicas" na NewPost-IA, uma rede social brasileira.
Abaixo está uma receita da Receiteria. Escreva o post a partir SÓ destas informações.

Título original: {item.get('titulo', '')}
Categorias: {', '.join((item.get('categorias') or [])[:12])}
Descrição do site: {item.get('descricao') or item.get('resumo') or '(não informada)'}
Ingredientes: {ingredientes}
Tempo total: {item.get('tempo') or '(não informado)'}
Rendimento: {item.get('rendimento') or '(não informado)'}

Devolva SOMENTE um JSON válido (sem markdown):
{{
  "emoji": "1 emoji que combine com o prato",
  "titulo": "título do post, até 90 caracteres, fiel ao original",
  "resumo": "2 a 3 frases, tom acolhedor e delicioso",
  "hashtags": ["1 ou 2 hashtags do prato, sem # e sem espaço"],
  "prompt_imagem": "descrição curta do prato pronto, para uma foto (sem pessoas, sem texto)"
}}
Regras: português do Brasil; pode citar 2 ou 3 ingredientes principais e o tempo, se informados;
NÃO invente ingredientes, quantidades, tempos ou números que não estão acima; NÃO copie a lista de ingredientes;
NÃO prometa benefício de saúde (nada de "cura", "emagrece", "detox", "previne doença"); sem sensacionalismo."""


def preparar_texto(item):
    """Texto pronto pra revisão: {'texto', 'prompt_imagem', 'via_ia'}.

    Sem IA (sem chave, cota, erro) cai num texto montado do próprio trecho do
    RSS — a tela avisa e o produtor ajusta à mão. Nunca levanta exceção.
    """
    dados = {}
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_STUDIO_API_KEY')
    # 503 "high demand" passa em segundos (visto no teste real de 01/10): 1 nova tentativa.
    for tentativa in ((1, 2) if api_key else ()):
        try:
            from google import genai
            from google.genai import types as genai_types
            client = genai.Client(api_key=api_key)
            r = client.models.generate_content(
                model=MODELO_TEXTO, contents=_prompt_texto(item),
                config=genai_types.GenerateContentConfig(
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0)))
            bruto = (r.text or '').replace('```json', '').replace('```', '').strip()
            dados = json.loads(bruto) if bruto else {}
            break
        except Exception as e:
            dados = {}
            if tentativa == 1 and ('503' in str(e) or 'UNAVAILABLE' in str(e)):
                time.sleep(2)
                continue
            print(f'[receita_do_dia] IA indisponível, texto sem IA: {e}')
            break
    if not isinstance(dados, dict):
        dados = {}
    resumo_ia = str(dados.get('resumo') or '').strip()
    titulo = str(dados.get('titulo') or item.get('titulo') or '').strip()[:120]
    resumo = resumo_ia or _resumo_sem_ia(item.get('descricao') or item.get('resumo'))
    extras = dados.get('hashtags') if isinstance(dados.get('hashtags'), list) else []
    texto = montar_legenda(dados.get('emoji') or '🍽️', titulo, resumo, item.get('link', ''), extras[:2])
    prompt_imagem = str(dados.get('prompt_imagem') or item.get('titulo') or '').strip()[:300]
    return {'texto': texto, 'prompt_imagem': prompt_imagem, 'via_ia': bool(resumo_ia)}


# ── foto ────────────────────────────────────────────────────────────────────

class FotoSemFaturamento(Exception):
    """A cota grátis de imagem do Gemini é ZERO (conferido em 01/10/2026: limit 0)."""


def gerar_foto(prompt_imagem):
    """Foto do prato por IA → (bytes, mime). Levanta FotoSemFaturamento ou RuntimeError."""
    api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_STUDIO_API_KEY')
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY não configurada.')
    prompt = ('Fotografia profissional de comida, apetitosa e realista, iluminação quente: '
              f'{str(prompt_imagem or "").strip()[:300]}. '
              "Sem texto, sem letras, sem marca d'água, sem pessoas.")
    from google import genai
    from google.genai import types as genai_types
    try:
        client = genai.Client(api_key=api_key)
        r = client.models.generate_content(
            model=MODELO_FOTO, contents=prompt,
            config=genai_types.GenerateContentConfig(response_modalities=['IMAGE']))
    except Exception as e:
        msg = str(e)
        if '429' in msg and 'limit: 0' in msg:
            raise FotoSemFaturamento('A foto por IA precisa do faturamento do Gemini ligado '
                                     '(no plano grátis a cota de imagem é zero).') from e
        if '429' in msg:
            raise RuntimeError('A cota de fotos do Gemini acabou por agora. Tente mais tarde '
                               'ou use uma foto do computador.') from e
        raise RuntimeError(f'O Gemini não gerou a foto: {msg[:160]}') from e
    for cand in (getattr(r, 'candidates', None) or []):
        conteudo = getattr(cand, 'content', None)
        for parte in (getattr(conteudo, 'parts', None) or []):
            dados = getattr(parte, 'inline_data', None)
            if dados and dados.data:
                return dados.data, (dados.mime_type or 'image/png')
    raise RuntimeError('O Gemini respondeu sem imagem (pode ter recusado o pedido). '
                       'Tente de novo ou use uma foto do computador.')
