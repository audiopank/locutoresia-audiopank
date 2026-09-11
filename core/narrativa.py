"""Estúdio de Narrativa — funções puras (sem rede, sem IA).

Uma narrativa é um roteiro dividido em BLOCOS (parágrafos), cada um com um
personagem. O personagem vem do prefixo "Nome: fala" (o mesmo formato do
Diálogo do Gerador); parágrafo sem prefixo é do "Narrador". Cada bloco vira
uma locução própria (1 chamada de TTS por bloco), e a montagem junta tudo com
uma pausa entre eles.

Pedido do produtor em 11/09/2026, depois de ver o Story Studio do Fish Audio:
"construir mantendo toda nossa estrutura sem quebrar nada". Por isso este
módulo não toca em nada do Gerador/MiniDAW: quem gera é /api/generate-audio,
quem monta e exporta é o navegador (MixEngine), quem edita é a MiniDAW.
"""
import re
import unicodedata

NARRADOR = 'Narrador'

# "Nome: fala" — nome curto (até 30 chars, sem ':' nem quebra), dois-pontos,
# espaço, fala. Igual ao detector de personagens do Diálogo (backend/app.py).
_PREFIXO = re.compile(r'^[ \t]*([^:\n]{1,30}):[ \t]+(\S.*)$', re.S)

# Marcações de produção entre colchetes NO MEIO do texto (vindas de outro
# editor) não são fala; a direção de locução do bloco entra por campo próprio.
_COLCHETES = re.compile(r'\[[^\]\n]*\]')


def dividir_em_blocos(texto):
    """Texto colado → lista de {'personagem', 'texto'}; parágrafo = bloco.

    Parágrafos separados por linha em branco. Linha única com "Nome:" no começo
    define o personagem daquele bloco; sem prefixo, o bloco é do Narrador. Um
    bloco de várias linhas mantém as quebras internas (o TTS respira nelas).
    """
    blocos = []
    for bruto in re.split(r'\n[ \t]*\n+', str(texto or '').replace('\r\n', '\n').replace('\r', '\n')):
        paragrafo = bruto.strip()
        if not paragrafo:
            continue
        personagem = NARRADOR
        m = _PREFIXO.match(paragrafo)
        if m and not m.group(1).strip().lower().startswith('http'):
            personagem = m.group(1).strip()
            paragrafo = m.group(2).strip()
        paragrafo = _COLCHETES.sub(' ', paragrafo)
        paragrafo = re.sub(r'[ \t]+', ' ', paragrafo)
        paragrafo = re.sub(r' *\n *', '\n', paragrafo).strip()
        if paragrafo:
            blocos.append({'personagem': personagem, 'texto': paragrafo})
    return blocos


def personagens(blocos):
    """Nomes na ordem em que aparecem (sem repetir)."""
    vistos = []
    for b in blocos or []:
        p = (b.get('personagem') or NARRADOR).strip() or NARRADOR
        if p not in vistos:
            vistos.append(p)
    return vistos


def contar_palavras(texto):
    return len([w for w in re.split(r'\s+', str(texto or '').strip()) if w])


def texto_para_tts(texto, direcao='', provider='google'):
    """Texto que vai pro TTS: direção entre colchetes na 1ª linha SÓ no Google
    (Gemini). O ElevenLabs lê colchetes em voz alta, então lá a direção fica de fora."""
    t = str(texto or '').strip()
    d = str(direcao or '').strip().strip('[]').strip()
    if d and provider == 'google':
        return f'[{d}]\n{t}'
    return t


def slug(nome):
    """Nome de arquivo seguro: sem acento, só [A-Za-z0-9-], até 60."""
    s = unicodedata.normalize('NFKD', str(nome or '')).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^A-Za-z0-9-]+', '-', s).strip('-')
    return s[:60] or 'narrativa'


def roteiro_plano(blocos):
    """Blocos → texto "Nome: fala" por parágrafo (o que vai no .txt do rascunho e no post)."""
    linhas = []
    for b in blocos or []:
        p = (b.get('personagem') or NARRADOR).strip() or NARRADOR
        t = str(b.get('texto') or '').strip()
        if t:
            linhas.append(f'{p}: {t}')
    return '\n\n'.join(linhas)
