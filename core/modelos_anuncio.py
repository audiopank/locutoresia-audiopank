"""Modelos de anúncio do Gerador (21/10/2026).

Inspirado na "Biblioteca de modelos" do ACE Studio e aprovado por ele: escolher
o TIPO de peça já ajusta duração, direção de locução, estilo de fala e o tipo de
trilha que a IA procura — e o roteirista (Gemini) recebe a ESTRUTURA daquele tipo.
Tudo editável depois; nada é travado (diferente dos Programas, que são formato fixo).

Sotaque regional: quando o cliente pede (ex.: cearense do Crato/Cariri), vai pro
texto (a IA escreve pensando no sotaque, sem caricatura) e pra direção da voz
(só o Modo Padrão/Google entende direção). Ainda NÃO medido de ouvido se o TTS
faz um cearense convincente — confirmar com amostra antes de vender como recurso.

Só funções puras: quem chama a IA é /api/gerador/roteiro em backend/app.py.
"""
import re

MODELOS = {
    'comercial': {
        'nome': 'Spot Comercial',
        'descricao': 'anúncio de rádio/redes pra loja, serviço ou produto',
        'peca': 'spot',
        'plano': 'spot_30_45',
        'estilo': 'excited',
        'direcao': 'Vendedor animado, sorriso na voz, próximo do ouvinte',
        'trilha': 'pop animado, varejo',
        'estrutura': ('Gancho forte na primeira frase; o produto ou a oferta; o benefício principal pro cliente; '
                      'chamada final com endereço ou telefone (do briefing).'),
    },
    # 21/10/2026, pedido dele depois do spot da vacinação antirrábica: prefeitura,
    # governo e instituição falam com o CIDADÃO (informar, orientar, convocar),
    # não com o consumidor. E a lei proíbe promoção pessoal na publicidade oficial.
    'utilidade': {
        'nome': 'Utilidade pública (Prefeituras, Governos e Instituições)',
        'descricao': 'campanha de prefeitura, governo ou instituição: informa, orienta e convoca o cidadão',
        'peca': 'spot',
        'plano': 'spot_30_45',
        'estilo': 'professional',
        'direcao': 'Locutor institucional, voz clara, acolhedora e confiável, ritmo calmo',
        'trilha': 'institucional leve e inspiradora',
        'estrutura': ('Abra chamando o cidadão (ex.: "Atenção, população!" ou "A Prefeitura informa:"); '
                      'diga O QUÊ, QUANDO (data e horário), ONDE e QUEM pode participar; as exigências '
                      '(documentos, presença de responsável) só se estiverem no briefing; feche com a orientação '
                      '(procure, compareça, consulte) e a assinatura do órgão. Linguagem de serviço, não de venda: '
                      'nada de "promoção", "imperdível" ou "compre". PROIBIDO citar nome, apelido, slogan ou '
                      'imagem de prefeito, governador, secretário ou qualquer político — publicidade oficial não '
                      'pode fazer promoção pessoal (Constituição, art. 37, §1º).'),
    },
    'volante': {
        'nome': 'Propaganda Volante',
        'descricao': 'carro de som: texto pra rodar na rua, com repetição',
        'peca': 'spot',
        'plano': 'spot_60_90',
        'estilo': 'excited',
        'direcao': 'Locutor de carro de som, voz alta e chamativa, ritmo acelerado',
        'trilha': 'forró ou brega animado, alto',
        'estrutura': ('Abra com "Atenção, atenção!"; apresente as ofertas uma a uma, frases curtas; '
                      'repita o NOME da loja e o ENDEREÇO 2 ou 3 vezes ao longo do texto; '
                      'feche com "não perca" e o endereço de novo.'),
    },
    'festa': {
        'nome': 'Chamada de Festa',
        'descricao': 'show, evento, festa: atrações, data, local e ingresso',
        'peca': 'spot',
        'plano': 'spot_30_45',
        'estilo': 'excited',
        'direcao': 'Voz grave e impactante, energia de show, crescendo no fim',
        'trilha': 'eletrônica, forró ou piseiro, clima de festa',
        'estrutura': ('Abra com "É hoje!" ou "Vem aí!"; as atrações; a DATA, a HORA e o LOCAL; '
                      'onde comprar ingresso (só se estiver no briefing); repita a data no fim.'),
    },
    'vinheta': {
        'nome': 'Vinheta falada',
        'descricao': 'assinatura curta pra rádio e conteúdo de redes sociais',
        'peca': 'spot',
        'plano': 'teaser_5s',
        'estilo': 'professional',
        'direcao': 'Voz forte de assinatura, curta e marcante',
        'trilha': 'stinger curto, impacto',
        'estrutura': ('Uma frase só, de assinatura: o nome da marca, rádio ou programa, com no máximo um slogan '
                      '(ex.: "Você está ouvindo…", "Fulano, o som da cidade"). Nada de oferta, endereço ou telefone.'),
    },
    'audiovisual': {
        'nome': 'Audiovisual',
        'descricao': 'narração pra vídeo (usa o Áudio para vídeo, em cenas)',
        'peca': 'video',
        'plano': 'outro',
        'estilo': 'professional',
        'direcao': 'Narração institucional, clara e confiante',
        'trilha': 'conforme o estilo do vídeo',
        'estrutura': ('Narração por cenas: abertura que prende, desenvolvimento claro e fecho com a marca '
                      'ou a chamada final.'),
    },
}

SOTAQUES = [
    {'id': '', 'rotulo': '— sem sotaque pedido —', 'texto': ''},
    {'id': 'cearense_cariri', 'rotulo': 'Nordestino — cearense do Cariri (Crato)',
     'texto': 'cearense do Cariri (Crato, Ceará)'},
    {'id': 'cearense', 'rotulo': 'Nordestino — cearense (Fortaleza)', 'texto': 'cearense de Fortaleza'},
    {'id': 'nordestino', 'rotulo': 'Nordestino (geral)', 'texto': 'nordestino'},
    {'id': 'outro', 'rotulo': 'Outro… (escrever)', 'texto': ''},
]


def para_tela():
    """O que a tela do Gerador precisa: modelos (sem a estrutura do prompt) e sotaques."""
    campos = ('nome', 'descricao', 'peca', 'plano', 'estilo', 'direcao', 'trilha')
    return {
        'modelos': [dict({'id': k}, **{c: m[c] for c in campos}) for k, m in MODELOS.items()],
        'sotaques': [{'id': s['id'], 'rotulo': s['rotulo'], 'texto': s['texto']} for s in SOTAQUES],
    }


def sotaque_limpo(texto):
    """Uma linha, sem colchetes (o colchete é a ordem de tom do TTS), até 80 caracteres."""
    t = re.sub(r'[\[\]]', ' ', str(texto or ''))
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:80]


def bloco_prompt(modelo, sotaque=''):
    """Trecho extra pro prompt do roteirista. Vazio sem modelo nem sotaque."""
    partes = []
    m = MODELOS.get(str(modelo or ''))
    if m:
        partes.append(f"MODELO DE ANÚNCIO: {m['nome']} ({m['descricao']}).\nEstrutura obrigatória: {m['estrutura']}")
    s = sotaque_limpo(sotaque)
    if s:
        partes.append(f"SOTAQUE: a locução será feita com sotaque {s}. Escreva de um jeito natural na boca de quem "
                      "fala assim; pode usar UMA ou DUAS expressões regionais típicas, com respeito e sem caricatura.")
    return '\n\n'.join(partes)


def direcao_com_sotaque(direcao, sotaque):
    """Junta a direção de locução e o sotaque numa ordem só pro TTS (mesma regra do JS comSotaque)."""
    d = str(direcao or '').strip()
    s = sotaque_limpo(sotaque)
    if not s:
        return d
    pedido = f'com sotaque {s}, natural, sem caricatura'
    return f'{d}, {pedido}' if d else pedido[0].upper() + pedido[1:]
