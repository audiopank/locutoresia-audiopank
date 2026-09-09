"""Programas (presets de rádio) do Gerador de Anúncios.

Um programa é o "relógio" de rádio de um produto recorrente: vinheta fixa,
miolo variável, aviso fixo e fecho fixo. O produtor (ou a IA) cuida só do
miolo; o resto sai igual todo episódio — foi o esquecimento do aviso legal e
a vinheta diferente no episódio 2 do Vida Saudável (08/09/2026) que pediram
isto. NÃO é o preset de VOZ rejeitado em 26/06/2026: aqui é formato de
programa, não interpretação do locutor.

Só funções puras neste módulo: nada de rede, nada de IA. Quem chama a IA e
o feed é o endpoint em backend/app.py.
"""
import re

PROGRAMAS = {
    'vida': {
        'nome': 'Vida Saudável',
        'descricao': 'podcast diário de 90s sobre saúde e bem-estar',
        # Conta que assina no feed (core/newpost_feed.CONTAS) — e é por ela que
        # o botão Feed acha a série e o CTA.
        'conta_feed': 'vida',
        'vinheta': 'Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio {episodio}.',
        'aviso': 'Este conteúdo é informativo e não substitui a orientação do seu médico.',
        'fecho': ('Vida Saudável é produzido por Locutores IA, Áudio Pank Produtora. {patrocinio} '
                  'Informações pelo WhatsApp: oitenta e cinco, nove, nove dois dois seis, dois dois nove sete.'),
        # Slot de patrocínio: vazio vende o espaço; com marca, é o oferecimento.
        'patrocinio_vazio': 'Esse espaço pode ser da sua marca.',
        'patrocinio_com': 'Um oferecimento de {marca}.',
        # Alvo do MIOLO em palavras. Partes fixas somam ~58 palavras; com o
        # miolo nesse alvo o episódio fecha em ~200 palavras ≈ 90s no ritmo
        # medido do Charon (ep.1: 215 palavras = 90,1s; ep.2: 204 = 94,0s).
        'miolo_palavras': (135, 155),
        # Chamada ao ouvinte no TEXTO do post (não no áudio): é o convite ao
        # primeiro comentário humano do feed.
        'cta_post': 'Qual tema de saúde você quer ouvir no próximo episódio? Comenta aqui ou manda um áudio.',
        # Sem "#N": o número já vai no badge da série do feed, e "#3" no título
        # virava a hashtag lixo "3" (o feed indexa hashtag pelo texto).
        'nome_spot': 'Vida Saudável, episódio {episodio}: {tema}',
        # O que a tela trava ao escolher o programa (decisão do produtor em
        # 04/09/2026: Charon Informative, Modo Padrão, direção de rádio da manhã).
        'ajustes': {
            'formato': 'unico',
            'modo': 'padrao',
            'estilo': 'normal',
            'plano': 'outro',
            'voz_contem': 'Charon',
            'gate': True,
            'direcao': 'Rádio da manhã, calmo, sem tom de anúncio',
        },
        'linha_editorial': (
            'Programa de rádio diário de saúde e bem-estar para o público geral do Nordeste do Brasil. '
            'Tom de rádio da manhã: calmo, próximo, sem tom de anúncio. '
            'Estrutura obrigatória: gancho de 1 ou 2 frases; o tema em 2 ou 3 frases; '
            '"três coisas pra você guardar", numeradas "Um:", "Dois:" e "Três:", cada uma com 1 ou 2 frases práticas; '
            'fecho de 1 ou 2 frases com apelo prático (marcar consulta, procurar o posto, mudar um hábito). '
            'PROIBIDO: dose, nome de remédio ou suplemento, promessa de cura, diagnóstico, '
            'número ou estatística que não esteja no tema informado. '
            'Não escreva vinheta, saudação, despedida, aviso legal nem WhatsApp: o programa já tem tudo isso fixo.'
        ),
    },
}

_UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
             'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
_DEZENAS = {2: 'vinte', 3: 'trinta', 4: 'quarenta', 5: 'cinquenta', 6: 'sessenta',
            7: 'setenta', 8: 'oitenta', 9: 'noventa'}
_CENTENAS = {1: 'cento', 2: 'duzentos', 3: 'trezentos', 4: 'quatrocentos', 5: 'quinhentos',
             6: 'seiscentos', 7: 'setecentos', 8: 'oitocentos', 9: 'novecentos'}

# Palavras que a linha editorial proíbe. É rede de segurança, não censura:
# só gera AVISO na tela — o produtor decide.
_PROIBIDAS = re.compile(
    r'\b(mg|miligramas?|gramas?|comprimidos?|c[aá]psulas?|dose|dosagem|posologia|'
    r'cura|curar|curam|diagn[oó]stico|diagnosticar|rem[eé]dio|medicamento|suplemento)\b', re.I)


def numero_por_extenso(n):
    """1 → 'um', 23 → 'vinte e três', 100 → 'cem'. Fora de 0..999 devolve o dígito."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n < 0 or n > 999:
        return str(n)
    if n < 20:
        return _UNIDADES[n]
    if n < 100:
        d, u = divmod(n, 10)
        return _DEZENAS[d] + (f' e {_UNIDADES[u]}' if u else '')
    if n == 100:
        return 'cem'
    c, resto = divmod(n, 100)
    return _CENTENAS[c] + (f' e {numero_por_extenso(resto)}' if resto else '')


def programa(pid):
    """Config do programa ou None."""
    return PROGRAMAS.get(str(pid or ''))


def lista_para_tela():
    """O que a tela precisa pra montar o seletor e travar os ajustes."""
    return [{
        'id': pid,
        'nome': p['nome'],
        'descricao': p['descricao'],
        'conta_feed': p['conta_feed'],
        'miolo_palavras': list(p['miolo_palavras']),
        'ajustes': dict(p['ajustes']),
    } for pid, p in PROGRAMAS.items()]


def contar_palavras(texto):
    return len([w for w in re.split(r'\s+', str(texto or '').strip()) if w])


def limpar_miolo(miolo):
    """Tira colchetes de direção, rótulo de locutor e espaço sobrando."""
    t = str(miolo or '').strip()
    t = re.sub(r'^\s*\[[^\]]*\]\s*', '', t)                  # "[fale calmo]" no começo
    t = re.sub(r'^\s*LOCUTOR[A]?\s*:\s*', '', t, flags=re.I)  # "LOCUTOR:" no começo
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()


def montar_roteiro(pid, episodio, miolo, patrocinador=None):
    """Vinheta + miolo + aviso + fecho, separados por linha em branco."""
    p = programa(pid)
    if not p:
        raise ValueError(f'programa desconhecido: {pid!r}')
    vinheta = p['vinheta'].format(episodio=numero_por_extenso(episodio))
    marca = str(patrocinador or '').strip()
    patrocinio = p['patrocinio_com'].format(marca=marca) if marca else p['patrocinio_vazio']
    fecho = p['fecho'].format(patrocinio=patrocinio)
    partes = [vinheta, limpar_miolo(miolo), p['aviso'], fecho]
    return '\n\n'.join(x for x in partes if x)


def nome_do_spot(pid, episodio, tema=''):
    p = programa(pid)
    if not p:
        raise ValueError(f'programa desconhecido: {pid!r}')
    nome = p['nome_spot'].format(episodio=int(episodio), tema=str(tema or '').strip())
    return nome.rstrip(': ').strip()


def cta_da_conta(conta):
    """Chamada ao ouvinte do programa que assina com essa conta, ou None."""
    for p in PROGRAMAS.values():
        if p['conta_feed'] == conta:
            return p.get('cta_post') or None
    return None


def miolo_dentro_do_alvo(pid, miolo, folga=20):
    p = programa(pid)
    lo, hi = p['miolo_palavras']
    return lo - folga <= contar_palavras(miolo) <= hi + folga


def alertas_editoriais(miolo):
    """Avisos (lista de frases) sobre o que a linha editorial proíbe."""
    achadas = sorted({m.group(1).lower() for m in _PROIBIDAS.finditer(str(miolo or ''))})
    if not achadas:
        return []
    return [f'O miolo cita "{", ".join(achadas)}" — a linha editorial proíbe dose, remédio, cura e diagnóstico. Revise.']


def prompt_miolo(pid, tema, patrocinador=None):
    """Prompt pra IA escrever SÓ o miolo. O JSON de saída é {miolo, resumo}."""
    p = programa(pid)
    if not p:
        raise ValueError(f'programa desconhecido: {pid!r}')
    lo, hi = p['miolo_palavras']
    marca = str(patrocinador or '').strip()
    linha_patrocinio = (f'O episódio tem patrocinador ("{marca}"), mas NÃO o cite no miolo: o fecho fixo já faz isso.\n'
                        if marca else '')
    return f"""Você é redator de rádio no Brasil e escreve o MIOLO de um episódio do programa "{p['nome']}".
{p['linha_editorial']}
{linha_patrocinio}
TEMA DO EPISÓDIO: {str(tema or '').strip()}

TAMANHO: entre {lo} e {hi} palavras. É um bloco de fala de cerca de um minuto; passar disso estoura o programa.

REGRAS:
- Português do Brasil, falado, natural na boca. Frases curtas.
- Números por extenso, como se fala.
- Só o texto falado: sem rubrica, sem colchetes, sem "LOCUTOR:", sem título, sem hashtag.

Devolva SOMENTE um JSON válido, sem markdown:
{{"miolo": "o texto falado", "resumo": "1 frase sobre a escolha do gancho"}}"""
