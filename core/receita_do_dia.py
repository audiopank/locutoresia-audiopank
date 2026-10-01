"""
Receita do dia — perfil "Receitas Favoritas Grandes Dicas" na NewPost-IA (01/10/2026).

Substitui a automação da Base44 (perfil Sabor & Saúde), com UMA diferença de
princípio: nada sai sozinho. A tela /receita-do-dia sugere receitas, a IA
prepara texto e foto, e o produtor revisa e clica Publicar ("tudo tem que
passar pela nossa mão" — decisão dele, 01/10/2026).

QUEM BUSCA AS RECEITAS É O NAVEGADOR DO PRODUTOR, não o servidor: o Cloudflare
da Receiteria barra IP de datacenter (Vercel deu 403 no 1º uso, 01/10/2026; a
Base44 sofria o mesmo), mas a API do WordPress deles libera CORS pro nosso
domínio e aceita o IP de casa. A tela lê
`https://www.receiteria.com.br/wp-json/wp/v2/receita` (13 mil receitas, com
descrição, ingredientes, tempo e rendimento) e manda os objetos pra cá: o
servidor normaliza (`item_da_api`), filtra e escreve — nunca fala com a Receiteria.

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
from datetime import date, timedelta

from core.newpost_feed import TAGS_POR_CONTA

PREFIXO_LINK = 'https://www.receiteria.com.br/'
HASHTAGS_FIXAS = TAGS_POR_CONTA['receitas']
MODELO_TEXTO = 'gemini-2.5-flash'
MODELO_FOTO = 'gemini-2.5-flash-image'
ARQUIVO_ANTIGAS = os.path.join(os.path.dirname(__file__), 'receitas_publicadas_antigas.txt')


def _sem_acento(texto):
    t = unicodedata.normalize('NFKD', str(texto or ''))
    return ''.join(c for c in t if not unicodedata.combining(c)).lower()


def normalizar_link(link):
    """Link comparável: https, sem www, sem query/fragmento, sem barra final, minúsculo."""
    u = str(link or '').strip().split('#', 1)[0].split('?', 1)[0].lower()
    u = re.sub(r'^https?://(www\.)?', 'https://', u)
    return u.rstrip('/')


def _txt(valor, limite):
    return html.unescape(str(valor or '')).strip()[:limite]


# ── receita vinda da API (pelo navegador) ───────────────────────────────────

def _duracao(minutos):
    """20 → '20 min'; 80 → '1h20'; 60 → '1h'; 0/inválido → ''."""
    try:
        m = int(float(minutos or 0))
    except (TypeError, ValueError):
        return ''
    if m <= 0:
        return ''
    h, mi = divmod(m, 60)
    if not h:
        return f'{mi} min'
    return f'{h}h{mi:02d}' if mi else f'{h}h'


def item_da_api(obj):
    """Objeto da API do WordPress da Receiteria → item da tela; None se não servir.

    Campos pedidos pela tela: id, date, link, title, class_list,
    yoast_head_json.description, acf.tempo, acf.rendimento, acf.ingredientes01-03.
    Tudo vem do navegador, então tudo é cortado no tamanho aqui.
    """
    if not isinstance(obj, dict):
        return None
    link = str(obj.get('link') or '').strip()
    titulo = _txt((obj.get('title') or {}).get('rendered') if isinstance(obj.get('title'), dict) else '', 200)
    if not titulo or not link.startswith(PREFIXO_LINK):
        return None
    acf = obj.get('acf') if isinstance(obj.get('acf'), dict) else {}
    ingredientes = []
    for chave in ('ingredientes01', 'ingredientes02', 'ingredientes03'):
        for linha in (acf.get(chave) or []):
            texto = _txt(linha.get('ingrediente'), 120) if isinstance(linha, dict) else ''
            if texto:
                ingredientes.append(texto)
    # Etiquetas do WordPress em class_list: "category-bolos", "tag-festa-junina"…
    categorias = []
    for c in (obj.get('class_list') or []):
        m = re.match(r'(?:category|tag)-([a-z0-9-]+)$', str(c))
        if m:
            categorias.append(m.group(1).replace('-', ' '))
    yoast = obj.get('yoast_head_json') if isinstance(obj.get('yoast_head_json'), dict) else {}
    return {
        'titulo': titulo,
        'link': link[:300],
        'data': str(obj.get('date') or '')[:10],
        'categorias': categorias[:15],
        'descricao': _txt(yoast.get('description'), 600),
        'ingredientes': ingredientes[:25],
        'tempo': _duracao(acf.get('tempo')),
        'rendimento': _txt(acf.get('rendimento'), 60),
    }


def item_escolhido(data):
    """Item que a tela devolve no "Preparar" (já normalizado antes) — confere e corta de novo."""
    data = data if isinstance(data, dict) else {}
    link = str(data.get('link') or '').strip()
    if not link.startswith(PREFIXO_LINK):
        return None

    def _lista(v, n, lim):
        return [_txt(x, lim) for x in (v if isinstance(v, list) else [])[:n] if _txt(x, lim)]

    return {'titulo': _txt(data.get('titulo'), 200), 'link': link[:300],
            'categorias': _lista(data.get('categorias'), 15, 60),
            'descricao': _txt(data.get('descricao'), 600),
            'ingredientes': _lista(data.get('ingredientes'), 25, 120),
            'tempo': _txt(data.get('tempo'), 20), 'rendimento': _txt(data.get('rendimento'), 60)}


# ── filtros ─────────────────────────────────────────────────────────────────

# Época fixa: (nome, padrão sobre título + etiquetas SEM acento, início, fim) em (mês, dia).
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
    "Bolo de creme de milho" tem "festa junina" entre as etiquetas e é do ano todo).
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
    titulo, descricao = item.get('titulo') or '', item.get('descricao') or ''
    if RE_COPA.search(_sem_acento(titulo + ' ' + descricao)):
        return 'Copa do Mundo'
    termo = blocked_reason(titulo, descricao)
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


def _resumo_sem_ia(trecho):
    """Até 3 frases da descrição do site (o produtor revisa antes de publicar)."""
    frases = re.split(r'(?<=[.!?])\s+', (trecho or '').strip())
    return ' '.join(frases[:3]).strip()


def _prompt_texto(item):
    ingredientes = '; '.join((item.get('ingredientes') or [])[:15]) or '(não informado)'
    return f"""Você escreve posts de receita para o perfil "Receitas Favoritas Grandes Dicas" na NewPost-IA, uma rede social brasileira.
Abaixo está uma receita da Receiteria. Escreva o post a partir SÓ destas informações.

Título original: {item.get('titulo', '')}
Etiquetas: {', '.join((item.get('categorias') or [])[:12])}
Descrição do site: {item.get('descricao') or '(não informada)'}
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
NÃO cite marcas; NÃO prometa benefício de saúde (nada de "cura", "emagrece", "detox", "previne doença"); sem sensacionalismo."""


def preparar_texto(item):
    """Texto pronto pra revisão: {'texto', 'prompt_imagem', 'via_ia'}.

    Sem IA (sem chave, cota, erro) cai na descrição do próprio site — a tela
    avisa e o produtor ajusta à mão. Nunca levanta exceção.
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
    resumo = resumo_ia or _resumo_sem_ia(item.get('descricao'))
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
