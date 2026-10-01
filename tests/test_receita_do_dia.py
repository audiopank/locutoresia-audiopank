"""Receita do dia (01/10/2026) — substitui a Base44 no perfil "Receitas Favoritas Grandes Dicas".

Princípio (decisão dele): NADA sai sozinho — "tudo tem que passar pela nossa mão". A tela
sugere receitas da Receiteria, a IA prepara texto e foto, o produtor revisa e clica Publicar.
Sem as credenciais próprias da conta 'receitas' o publicar RECUSA (nunca assina com outro
perfil). Receita de outra época do ano (a Base44 postou ceia de Natal em 1º/10), receita já
publicada, conteúdo sensível e Copa do Mundo ficam escondidos — com o motivo à vista.

Rodar: pytest tests/test_receita_do_dia.py -v
"""
import base64
import os
from datetime import date

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item><title>39 receitas inclusivas para a ceia de Natal</title>
<link>https://www.receiteria.com.br/receitas-inclusivas-de-natal/</link>
<pubDate>Wed, 30 Sep 2026 10:35:13 +0000</pubDate>
<category><![CDATA[Pratos Especiais]]></category><category><![CDATA[Natal]]></category>
<description><![CDATA[<p>O Natal &eacute; &#233;poca de reunir quem a gente ama.</p>]]></description></item>
<item><title>Bolo de cenoura fofinho</title>
<link>https://www.receiteria.com.br/receita-de-bolo-de-cenoura/</link>
<pubDate>Tue, 07 Jul 2026 12:00:00 +0000</pubDate>
<category><![CDATA[Doces]]></category>
<description><![CDATA[<p>Massa fofinha e cobertura de chocolate. Fica pronto em 40 minutos. Rende 12 fatias. Sirva com café.</p>]]></description></item>
<item><title>Link de fora</title><link>https://exemplo.com/x</link></item>
</channel></rss>""".encode('utf-8')

# Item do feed de RECEITAS (?post_type=receita): o "resumo" é o rodapé padrão do WordPress.
XML_RECEITAS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item><title>Wrap de hambúrguer</title>
<link>https://www.receiteria.com.br/receita/wrap-de-hamburguer/</link>
<pubDate>Thu, 01 Oct 2026 14:00:35 +0000</pubDate>
<category><![CDATA[Lanches e Salgados]]></category><category><![CDATA[Cheddar]]></category>
<description><![CDATA[<p>O post <a href="https://www.receiteria.com.br/receita/wrap-de-hamburguer/">Wrap de hambúrguer</a> apareceu primeiro em <a href="https://www.receiteria.com.br">Receiteria</a>.</p>]]></description></item>
</channel></rss>""".encode('utf-8')

PAGINA_RECEITA = """<html><head>
<meta property="og:description" content="Wrap de hamb&uacute;rguer com cheddar e molho especial, dourado na frigideira." />
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":"Recipe","name":"Wrap","recipeIngredient":["1 wrap","1 fatia de queijo cheddar","2 colheres de maionese"],
"totalTime":"PT1H20M","recipeYield":["2 por\\u00e7\\u00f5es"]}]}</script>
</head><body>...</body></html>"""

JPEG = b'\xff\xd8\xff\xe0' + b'0' * 64


def _cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _com_conta(monkeypatch):
    monkeypatch.setenv('NEWPOST_FEED_EMAIL_RECEITAS', 'receitas@exemplo.com')
    monkeypatch.setenv('NEWPOST_FEED_SENHA_RECEITAS', 'senha-de-teste')


def _gemini_falso(monkeypatch, resposta=None, erro=None):
    """Troca o Client do google.genai por um falso (nada sai pra rede)."""
    class _Resp:
        text = resposta

    class _Models:
        def generate_content(self, **kw):
            if erro:
                raise RuntimeError(erro)
            return _Resp()

    class _Client:
        def __init__(self, api_key=None):
            self.models = _Models()

    import google.genai
    monkeypatch.setenv('GEMINI_API_KEY', 'chave-de-teste')
    monkeypatch.setattr(google.genai, 'Client', _Client)


# ── conta no feed ────────────────────────────────────────────────────────────

def test_conta_receitas_com_variaveis_proprias_e_hashtags_da_casa():
    from core import newpost_feed as nf
    assert nf.CONTAS['receitas'] == ('NEWPOST_FEED_EMAIL_RECEITAS', 'NEWPOST_FEED_SENHA_RECEITAS')
    assert nf.tags_da_conta('receitas') == ['ReceitasFavoritas', 'receitas', 'NewPostIA', 'Culinária', 'Dicas']
    assert nf.tags_da_conta('achadinhos') == ['Achadinhos', 'Ofertas']        # as outras não mudaram
    assert callable(nf.subir_imagem) and callable(nf.conteudos_da_conta)


# ── RSS e filtros ────────────────────────────────────────────────────────────

def test_ler_feed_extrai_itens_e_ignora_link_de_fora():
    from core import receita_do_dia as rdd
    itens = rdd.ler_feed(XML)
    assert [i['titulo'] for i in itens] == ['39 receitas inclusivas para a ceia de Natal', 'Bolo de cenoura fofinho']
    assert itens[0]['categorias'] == ['Pratos Especiais', 'Natal']
    assert itens[0]['data'] == '2026-09-30'
    assert itens[0]['resumo'] == 'O Natal é época de reunir quem a gente ama.'
    assert itens[1]['link'] == 'https://www.receiteria.com.br/receita-de-bolo-de-cenoura/'


def test_feed_de_receitas_individuais_sem_o_rodape_do_wordpress():
    """O feed principal só traz matérias/listas; as receitas vêm de ?post_type=receita."""
    from core import receita_do_dia as rdd
    assert rdd.FEED_RECEITERIA == 'https://www.receiteria.com.br/feed/?post_type=receita'
    [it] = rdd.ler_feed(XML_RECEITAS)
    assert it['titulo'] == 'Wrap de hambúrguer' and it['resumo'] == ''
    assert it['categorias'] == ['Lanches e Salgados', 'Cheddar']


def test_pagina_da_receita_da_descricao_ingredientes_tempo_e_rendimento():
    from core import receita_do_dia as rdd
    det = rdd.ler_pagina_receita(PAGINA_RECEITA)
    assert det == {'descricao': 'Wrap de hambúrguer com cheddar e molho especial, dourado na frigideira.',
                   'ingredientes': ['1 wrap', '1 fatia de queijo cheddar', '2 colheres de maionese'],
                   'tempo': '1h20', 'rendimento': '2 porções'}
    assert rdd.ler_pagina_receita('<html>sem nada</html>') == {
        'descricao': '', 'ingredientes': [], 'tempo': '', 'rendimento': ''}
    assert [rdd._duracao(x) for x in ('PT20M', 'PT1H', 'PT2H05M', 'P1D', '')] == ['20 min', '1h', '2h05', '', '']
    with pytest.raises(ValueError):
        rdd.detalhes_da_receita('https://exemplo.com/receita/')


def test_receitas_publicadas_antes_da_tela_ficam_de_fora():
    """Os 340 posts antigos usam link curto; a lista resolvida mora em core/receitas_publicadas_antigas.txt."""
    from core import receita_do_dia as rdd
    antigas = rdd.publicadas_antigas()
    assert len(antigas) > 300
    assert 'https://receiteria.com.br/receita/bolo-de-chocolate-sem-acucar-e-sem-farinha' in antigas
    assert all(l.startswith('https://receiteria.com.br/') and l == rdd.normalizar_link(l) for l in antigas)


def test_pascoa_calculada():
    from core import receita_do_dia as rdd
    assert rdd._pascoa(2026) == date(2026, 4, 5)
    assert rdd._pascoa(2027) == date(2027, 3, 28)


@pytest.mark.parametrize('titulo,cats,hoje,esperado', [
    ('Ceia de Natal econômica', [], date(2026, 10, 1), 'Natal/Ano Novo'),          # o caso da Base44
    ('Ceia de Natal econômica', [], date(2026, 12, 10), ''),
    ('Rabanada de forno', [], date(2027, 1, 3), ''),                               # janela vira o ano
    ('Quentão de festa junina', [], date(2026, 10, 1), 'Festa Junina'),
    ('32 receitas para a primavera', [], date(2026, 10, 1), ''),
    ('Ovo de Páscoa trufado', [], date(2027, 3, 10), ''),
    ('Ovo de Páscoa trufado', [], date(2026, 10, 1), 'Páscoa'),
    ('Bolo de cenoura', ['Doces', 'Natal'], date(2026, 10, 1), 'Natal/Ano Novo'),  # categoria também conta
    ('Bolo de cenoura', ['Doces'], date(2026, 10, 1), ''),
])
def test_fora_de_epoca(titulo, cats, hoje, esperado):
    from core import receita_do_dia as rdd
    assert rdd.fora_de_epoca({'titulo': titulo, 'categorias': cats}, hoje) == esperado


def test_sugestoes_escondem_publicada_sensivel_copa_e_fora_de_epoca():
    from core import receita_do_dia as rdd
    p = rdd.PREFIXO_LINK
    itens = rdd.ler_feed(XML) + [
        {'titulo': 'Petiscos para a Copa do Mundo', 'link': p + 'copa/', 'resumo': '', 'categorias': [], 'data': ''},
        {'titulo': 'Prato do tiroteio', 'link': p + 'x/', 'resumo': '', 'categorias': [], 'data': ''},
        {'titulo': 'Torta de frango', 'link': p + 'torta-de-frango/', 'resumo': '', 'categorias': [], 'data': ''},
        {'titulo': 'Bolo de cenoura fofinho', 'link': p + 'receita-de-bolo-de-cenoura/', 'resumo': '', 'categorias': [], 'data': ''},
    ]
    publicados = {rdd.normalizar_link('http://receiteria.com.br/torta-de-frango')}
    r = rdd.sugestoes(itens, publicados, hoje=date(2026, 10, 1))
    assert [i['titulo'] for i in r['itens']] == ['Bolo de cenoura fofinho']      # repetida aparece 1 vez só
    motivos = {e['titulo']: e['motivo'] for e in r['escondidas']}
    assert motivos['39 receitas inclusivas para a ceia de Natal'] == 'fora de época (Natal/Ano Novo)'
    assert motivos['Petiscos para a Copa do Mundo'] == 'Copa do Mundo'
    assert motivos['Prato do tiroteio'].startswith('conteúdo sensível')
    assert motivos['Torta de frango'] == 'já publicada'


def test_epoca_so_na_etiqueta_mostra_com_aviso_em_vez_de_esconder():
    """01/10: "Bolo de creme de milho" sumiu por ter a etiqueta "Festa Junina" entre 10 —
    bolo de milho é do ano todo. Época no TÍTULO esconde; só na etiqueta, avisa e ele decide."""
    from core import receita_do_dia as rdd
    p = rdd.PREFIXO_LINK
    itens = [
        {'titulo': 'Bolo de creme de milho', 'link': p + 'receita/bolo-de-creme-de-milho/', 'resumo': '',
         'categorias': ['Bolos', 'Festa Junina', 'Milho'], 'data': ''},
        {'titulo': 'Panetone salgado simples', 'link': p + 'receita/panetone-salgado/', 'resumo': '',
         'categorias': ['Natal'], 'data': ''},
        {'titulo': 'Ragu de cogumelos', 'link': p + 'receita/ragu/', 'resumo': '', 'categorias': [], 'data': ''},
    ]
    r = rdd.sugestoes(itens, set(), hoje=date(2026, 10, 1))
    assert [(i['titulo'], i.get('aviso_epoca')) for i in r['itens']] == [
        ('Bolo de creme de milho', 'Festa Junina'), ('Ragu de cogumelos', None)]
    assert r['escondidas'] == [{'titulo': 'Panetone salgado simples', 'motivo': 'fora de época (Natal/Ano Novo)'}]
    js = _ler('static', 'receita-do-dia.js')
    assert "if (item.aviso_epoca) {" in js


def test_links_publicados_saem_do_texto_dos_posts():
    from core import receita_do_dia as rdd
    conteudos = ['🍰 Bolo\n\nFonte: Receiteria\nhttps://www.receiteria.com.br/bolo-de-pote/\n\n#receitas',
                 'Fonte: https://receiteria.com.br/Pao-de-Queijo/?utm=x.', 'post sem link', None]
    assert rdd.links_publicados(conteudos) == {'https://receiteria.com.br/bolo-de-pote',
                                               'https://receiteria.com.br/pao-de-queijo'}


# ── texto ────────────────────────────────────────────────────────────────────

def test_legenda_no_formato_da_casa():
    from core import receita_do_dia as rdd
    t = rdd.montar_legenda('🥕', 'Bolo de cenoura fofinho', 'Massa fofinha. Cobertura de chocolate.',
                           'https://www.receiteria.com.br/receita-de-bolo-de-cenoura/',
                           ['BoloDeCenoura', '#receitas', 'Café da tarde', 'Extra'])
    assert t == ('🥕 Bolo de cenoura fofinho\n\nMassa fofinha. Cobertura de chocolate.\n\n'
                 'Fonte: Receiteria\nhttps://www.receiteria.com.br/receita-de-bolo-de-cenoura/\n\n'
                 '#ReceitasFavoritas #receitas #NewPostIA #Culinária #Dicas #BoloDeCenoura #Cafédatarde')
    assert rdd.hashtags_do_texto(t + ' #receitas #Novo') == [
        'ReceitasFavoritas', 'receitas', 'NewPostIA', 'Culinária', 'Dicas', 'BoloDeCenoura', 'Cafédatarde', 'Novo']


def test_preparar_sem_ia_usa_o_proprio_trecho(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)
    from core import receita_do_dia as rdd
    r = rdd.preparar_texto(rdd.ler_feed(XML)[1])
    assert r['via_ia'] is False
    assert r['texto'].startswith('🍽️ Bolo de cenoura fofinho\n\nMassa fofinha e cobertura de chocolate. '
                                 'Fica pronto em 40 minutos. Rende 12 fatias.\n\nFonte: Receiteria\n')
    assert r['prompt_imagem'] == 'Bolo de cenoura fofinho'


def test_preparar_sem_ia_usa_a_descricao_da_pagina(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)
    from core import receita_do_dia as rdd
    [it] = rdd.ler_feed(XML_RECEITAS)
    it.update(rdd.ler_pagina_receita(PAGINA_RECEITA))
    t = rdd.preparar_texto(it)['texto']
    assert t.startswith('🍽️ Wrap de hambúrguer\n\nWrap de hambúrguer com cheddar e molho especial, '
                        'dourado na frigideira.\n\nFonte: Receiteria\n')
    # Sem descrição nenhuma, o post não fica com parágrafo vazio.
    assert rdd.montar_legenda('🍽️', 'Wrap', '', 'L').startswith('🍽️ Wrap\n\nFonte: Receiteria\nL\n\n#')


def test_prompt_leva_ingredientes_e_proibe_inventar():
    from core import receita_do_dia as rdd
    [it] = rdd.ler_feed(XML_RECEITAS)
    it.update(rdd.ler_pagina_receita(PAGINA_RECEITA))
    p = rdd._prompt_texto(it)
    assert 'Ingredientes: 1 wrap; 1 fatia de queijo cheddar; 2 colheres de maionese' in p
    assert 'Tempo total: 1h20' in p and 'Rendimento: 2 porções' in p
    assert 'NÃO invente ingredientes' in p and 'NÃO prometa benefício de saúde' in p


def test_preparar_com_ia_monta_a_legenda_a_partir_do_json(monkeypatch):
    from core import receita_do_dia as rdd
    _gemini_falso(monkeypatch, resposta='```json\n{"emoji": "🥕", "titulo": "Bolo de cenoura", '
                                        '"resumo": "Fofinho e fácil.", "hashtags": ["BoloDeCenoura"], '
                                        '"prompt_imagem": "bolo de cenoura com calda"}\n```')
    r = rdd.preparar_texto(rdd.ler_feed(XML)[1])
    assert r['via_ia'] is True and r['prompt_imagem'] == 'bolo de cenoura com calda'
    assert r['texto'].startswith('🥕 Bolo de cenoura\n\nFofinho e fácil.\n\nFonte: Receiteria\n')
    assert r['texto'].endswith('#Dicas #BoloDeCenoura')


def test_preparar_tenta_de_novo_quando_o_gemini_esta_sobrecarregado(monkeypatch):
    """01/10, no teste real: '503 UNAVAILABLE ... high demand' — passa em segundos; 1 nova tentativa."""
    from core import receita_do_dia as rdd
    chamadas = []

    class _Resp:
        text = '{"emoji": "🌯", "titulo": "Wrap", "resumo": "Lanche rápido.", "hashtags": [], "prompt_imagem": "wrap"}'

    class _Models:
        def generate_content(self, **kw):
            chamadas.append(1)
            if len(chamadas) == 1:
                raise RuntimeError("503 UNAVAILABLE. {'error': {'code': 503, 'status': 'UNAVAILABLE'}}")
            return _Resp()

    class _Client:
        def __init__(self, api_key=None):
            self.models = _Models()

    import google.genai
    monkeypatch.setenv('GEMINI_API_KEY', 'chave-de-teste')
    monkeypatch.setattr(google.genai, 'Client', _Client)
    monkeypatch.setattr(rdd.time, 'sleep', lambda s: None)
    r = rdd.preparar_texto(rdd.ler_feed(XML_RECEITAS)[0])
    assert len(chamadas) == 2 and r['via_ia'] is True and 'Lanche rápido.' in r['texto']


def test_preparar_com_ia_quebrada_cai_no_trecho(monkeypatch):
    from core import receita_do_dia as rdd
    _gemini_falso(monkeypatch, erro='503 UNAVAILABLE')
    monkeypatch.setattr(rdd.time, 'sleep', lambda s: None)
    assert rdd.preparar_texto(rdd.ler_feed(XML)[1])['via_ia'] is False


def test_foto_sem_faturamento_vira_erro_proprio(monkeypatch):
    """01/10: a cota grátis de imagem do Gemini é ZERO — a tela precisa dizer isso com clareza."""
    from core import receita_do_dia as rdd
    _gemini_falso(monkeypatch, erro='429 RESOURCE_EXHAUSTED. Quota exceeded, limit: 0, model: gemini-2.5-flash-preview-image')
    with pytest.raises(rdd.FotoSemFaturamento):
        rdd.gerar_foto('bolo')


# ── rotas ────────────────────────────────────────────────────────────────────

def test_pagina_e_rotas_sao_privadas(monkeypatch):
    monkeypatch.setenv('ADMIN_SENHA', 'segredo-de-teste')
    from backend.app import app
    anonimo = app.test_client()
    assert anonimo.get('/receita-do-dia').status_code == 302                 # vai pro login
    assert anonimo.post('/api/receitas/publicar', json={}).status_code == 401
    assert anonimo.get('/api/receitas/sugestoes').status_code == 401
    r = _cliente().get('/receita-do-dia')
    assert r.status_code == 200 and b'receita-do-dia.js?v=1' in r.data


def test_publicar_recusa_sem_credenciais(monkeypatch):
    monkeypatch.delenv('NEWPOST_FEED_EMAIL_RECEITAS', raising=False)
    monkeypatch.delenv('NEWPOST_FEED_SENHA_RECEITAS', raising=False)
    r = _cliente().post('/api/receitas/publicar', json={'texto': 'x', 'link': 'https://www.receiteria.com.br/a/'})
    assert r.status_code == 400
    erro = r.get_json()['error']
    assert 'NEWPOST_FEED_EMAIL_RECEITAS' in erro and 'NEWPOST_FEED_SENHA_RECEITAS' in erro


def test_publicar_sobe_a_foto_e_publica_na_conta_receitas(monkeypatch):
    _com_conta(monkeypatch)
    from core import newpost_feed
    chamadas = {}

    def _subir(nome, dados, conta='principal', mime='image/jpeg'):
        chamadas['foto'] = (conta, dados)
        return 'https://feed.exemplo/post-media/u/1-bolo.jpg'

    def _publicar(conteudo, **kw):
        chamadas['post'] = (conteudo, kw)
        return {'success': True, 'post_id': 'p1'}

    monkeypatch.setattr(newpost_feed, 'subir_imagem', _subir)
    monkeypatch.setattr(newpost_feed, 'publicar', _publicar)
    texto = '🥕 Bolo\n\nFofinho.\n\nFonte: Receiteria\nhttps://www.receiteria.com.br/bolo/\n\n#ReceitasFavoritas #receitas'
    r = _cliente().post('/api/receitas/publicar', json={
        'texto': texto, 'link': 'https://www.receiteria.com.br/bolo/',
        'imagem_base64': 'data:image/jpeg;base64,' + base64.b64encode(JPEG).decode()})
    assert r.get_json() == {'success': True, 'post_id': 'p1',
                            'imagem_url': 'https://feed.exemplo/post-media/u/1-bolo.jpg'}
    assert chamadas['foto'] == ('receitas', JPEG)
    conteudo, kw = chamadas['post']
    assert conteudo == texto and kw['conta'] == 'receitas'
    assert kw['media_urls'] == ['https://feed.exemplo/post-media/u/1-bolo.jpg'] and kw['media_types'] == ['image']
    assert kw['tags'] == ['ReceitasFavoritas', 'receitas']
    assert kw['chave'] == 'https://receiteria.com.br/bolo'                    # a mesma receita não sai 2x


def test_publicar_recusa_foto_que_nao_e_jpeg_e_avisa_duplicada(monkeypatch):
    _com_conta(monkeypatch)
    from core import newpost_feed
    monkeypatch.setattr(newpost_feed, 'publicar',
                        lambda conteudo, **kw: {'success': False, 'already': True, 'error': 'dup'})
    c = _cliente()
    png = base64.b64encode(b'\x89PNG\r\n\x1a\n0000').decode()
    r = c.post('/api/receitas/publicar', json={'texto': 'x', 'link': '', 'imagem_base64': png})
    assert r.status_code == 400 and 'JPEG' in r.get_json()['error']
    assert c.post('/api/receitas/publicar', json={'texto': '', 'link': ''}).status_code == 400
    r = c.post('/api/receitas/publicar', json={'texto': 'x', 'link': 'https://www.receiteria.com.br/a/'})
    assert r.get_json()['already'] is True


def test_sugestoes_juntam_pagina_nova_e_sorteada_sem_as_publicadas(monkeypatch):
    _com_conta(monkeypatch)
    from core import newpost_feed
    from core import receita_do_dia as rdd
    pedidas = []

    def _baixar(p):
        pedidas.append(p)
        return rdd.ler_feed(XML)

    monkeypatch.setattr(rdd, 'baixar_pagina', _baixar)
    monkeypatch.setattr(newpost_feed, 'conteudos_da_conta',
                        lambda conta, contem='', limite=1000: ['https://www.receiteria.com.br/receita-de-bolo-de-cenoura/'])
    # Publicada antes da tela (lista fixa dos links curtos) também some.
    monkeypatch.setattr(rdd, 'publicadas_antigas',
                        lambda: frozenset({'https://receiteria.com.br/receitas-inclusivas-de-natal'}))
    d = _cliente().get('/api/receitas/sugestoes').get_json()
    assert d['success'] and d['conta_ok'] and d['aviso'] == ''
    assert pedidas[0] == 1 and 2 <= pedidas[1] <= rdd.PAGINA_MAX
    assert d['itens'] == []
    assert {'titulo': 'Bolo de cenoura fofinho', 'motivo': 'já publicada'} in d['escondidas']
    assert {'titulo': '39 receitas inclusivas para a ceia de Natal', 'motivo': 'já publicada'} in d['escondidas']
    pedidas.clear()
    _cliente().get('/api/receitas/sugestoes?outras=1')
    assert len(pedidas) == 1 and pedidas[0] >= 2


def test_preparar_so_aceita_link_da_receiteria():
    r = _cliente().post('/api/receitas/preparar', json={'titulo': 'x', 'link': 'https://exemplo.com/x'})
    assert r.status_code == 400


def test_preparar_le_a_pagina_da_receita_escolhida(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)
    from core import receita_do_dia as rdd
    lidas = []

    def _detalhes(link):
        lidas.append(link)
        return rdd.ler_pagina_receita(PAGINA_RECEITA)

    monkeypatch.setattr(rdd, 'detalhes_da_receita', _detalhes)
    link = 'https://www.receiteria.com.br/receita/wrap-de-hamburguer/'
    d = _cliente().post('/api/receitas/preparar', json={'titulo': 'Wrap de hambúrguer', 'link': link}).get_json()
    assert lidas == [link] and d['success']
    assert 'dourado na frigideira.' in d['texto']
    # Página fora do ar: prepara do mesmo jeito, só com o título.
    monkeypatch.setattr(rdd, 'detalhes_da_receita', lambda link: (_ for _ in ()).throw(RuntimeError('503')))
    d = _cliente().post('/api/receitas/preparar', json={'titulo': 'Wrap de hambúrguer', 'link': link}).get_json()
    assert d['success'] and d['texto'].startswith('🍽️ Wrap de hambúrguer\n\nFonte: Receiteria\n')


# ── tela ─────────────────────────────────────────────────────────────────────

def test_tela_usa_textcontent_e_menu_tem_o_link():
    js = _ler('static', 'receita-do-dia.js')
    assert 'innerHTML' not in js                                   # dado do RSS nunca vira HTML
    assert "if (String(item.link).startsWith(PREFIXO)) {" in js
    assert "c.toDataURL('image/jpeg', QUALIDADE)" in js
    assert "if (!confirm(" in js                                   # publicar é mão humana
    html = _ler('templates', 'index.html')
    assert '<a href="/receita-do-dia" class="menu-item badge-new"' in html
