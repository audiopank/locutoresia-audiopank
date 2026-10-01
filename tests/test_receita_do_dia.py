"""Receita do dia (01/10/2026) — substitui a Base44 no perfil "Receitas Favoritas Grandes Dicas".

Princípio (decisão dele): NADA sai sozinho — "tudo tem que passar pela nossa mão". A tela
sugere receitas da Receiteria, a IA prepara texto e foto, o produtor revisa e clica Publicar.
Sem as credenciais próprias da conta 'receitas' o publicar RECUSA (nunca assina com outro
perfil). Receita de outra época do ano (a Base44 postou ceia de Natal em 1º/10), receita já
publicada, conteúdo sensível e Copa do Mundo ficam escondidos — com o motivo à vista.

No 1º uso (01/10) a Vercel levou 403 do Cloudflare da Receiteria: quem busca as receitas é o
NAVEGADOR do produtor, na API do WordPress deles (que libera CORS pro nosso domínio). O
servidor só recebe os objetos, normaliza, filtra e escreve — nunca fala com a Receiteria.

Rodar: pytest tests/test_receita_do_dia.py -v
"""
import base64
import os
from datetime import date

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _obj(id_, titulo, slug, classes=(), desc='', tempo=0, rend='', ingr=()):
    """Objeto como a API do WordPress da Receiteria devolve (com os _fields da tela)."""
    return {'id': id_, 'date': '2026-10-01T11:00:35', 'link': f'https://www.receiteria.com.br/receita/{slug}/',
            'title': {'rendered': titulo}, 'class_list': list(classes),
            'yoast_head_json': {'description': desc},
            'acf': {'tempo': tempo, 'rendimento': rend,
                    'ingredientes01': [{'ingrediente': i} for i in ingr], 'ingredientes02': None, 'ingredientes03': ''}}


WRAP = _obj(416721, 'Wrap de hamb&uacute;rguer', 'wrap-de-hamburguer',
            ['post-416721', 'receita', 'category-lanches-e-salgados', 'tag-cheddar', 'foodstylist-bruna'],
            'Wrap de hambúrguer com cheddar e molho especial, dourado na frigideira.', 20, '1 porção',
            ['1 wrap', '1 fatia de queijo cheddar', '2 colheres de maionese'])
PANETONE = _obj(1, 'Panetone salgado simples', 'panetone-salgado', ['category-lanches-e-salgados', 'tag-natal'],
                'Panetone recheado com calabresa.')
MILHO = _obj(2, 'Bolo de creme de milho', 'bolo-de-creme-de-milho', ['category-bolos', 'tag-festa-junina'],
             'Bolo fofinho de milho.')

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


def _sem_ia(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)


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


# ── receita vinda da API pelo navegador ──────────────────────────────────────

def test_item_da_api_normaliza_o_objeto_do_wordpress():
    from core import receita_do_dia as rdd
    assert rdd.item_da_api(WRAP) == {
        'titulo': 'Wrap de hambúrguer',
        'link': 'https://www.receiteria.com.br/receita/wrap-de-hamburguer/',
        'data': '2026-10-01',
        'categorias': ['lanches e salgados', 'cheddar'],          # só category-/tag-
        'descricao': 'Wrap de hambúrguer com cheddar e molho especial, dourado na frigideira.',
        'ingredientes': ['1 wrap', '1 fatia de queijo cheddar', '2 colheres de maionese'],
        'tempo': '20 min', 'rendimento': '1 porção'}
    assert rdd.item_da_api({**WRAP, 'link': 'https://exemplo.com/x/'}) is None
    assert rdd.item_da_api({**WRAP, 'title': {'rendered': ''}}) is None
    assert rdd.item_da_api('lixo') is None and rdd.item_da_api({}) is None
    assert rdd.item_da_api({**WRAP, 'acf': None, 'yoast_head_json': None})['ingredientes'] == []


def test_duracao_em_minutos_vira_texto():
    from core import receita_do_dia as rdd
    assert [rdd._duracao(x) for x in (20, 80, 60, 0, 'x', '45', None)] == [
        '20 min', '1h20', '1h', '', '', '45 min', '']


def test_item_escolhido_confere_link_e_corta_tamanho():
    from core import receita_do_dia as rdd
    it = rdd.item_escolhido({**rdd.item_da_api(WRAP), 'descricao': 'x' * 5000, 'ingredientes': ['a'] * 99})
    assert len(it['descricao']) == 600 and len(it['ingredientes']) == 25
    assert rdd.item_escolhido({'titulo': 'x', 'link': 'https://exemplo.com/x'}) is None
    assert rdd.item_escolhido(None) is None


def test_servidor_nao_fala_com_a_receiteria():
    """O Cloudflare deles barra a Vercel (403): nada no módulo pode depender de baixar o site."""
    fonte = _ler('core', 'receita_do_dia.py')
    assert 'import requests' not in fonte and 'requests.get' not in fonte


# ── filtros ──────────────────────────────────────────────────────────────────

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
    ('Bolo de cenoura', ['doces', 'natal'], date(2026, 10, 1), 'Natal/Ano Novo'),  # etiqueta também conta
    ('Bolo de cenoura', ['doces'], date(2026, 10, 1), ''),
])
def test_fora_de_epoca(titulo, cats, hoje, esperado):
    from core import receita_do_dia as rdd
    assert rdd.fora_de_epoca({'titulo': titulo, 'categorias': cats}, hoje) == esperado


def test_sugestoes_escondem_publicada_sensivel_copa_e_epoca_no_titulo():
    from core import receita_do_dia as rdd
    p = rdd.PREFIXO_LINK + 'receita/'
    itens = [rdd.item_da_api(o) for o in (WRAP, PANETONE, MILHO)] + [
        {'titulo': 'Petiscos para a Copa do Mundo', 'link': p + 'copa/', 'descricao': '', 'categorias': []},
        {'titulo': 'Prato do tiroteio', 'link': p + 'x/', 'descricao': '', 'categorias': []},
        {'titulo': 'Torta de frango', 'link': p + 'torta-de-frango/', 'descricao': '', 'categorias': []},
        rdd.item_da_api(WRAP),                                                   # repetida
    ]
    publicados = {rdd.normalizar_link('http://receiteria.com.br/receita/torta-de-frango')}
    r = rdd.sugestoes(itens, publicados, hoje=date(2026, 10, 1))
    # Época só na ETIQUETA (bolo de milho marcado "festa junina") aparece, com aviso — ele decide.
    assert [(i['titulo'], i.get('aviso_epoca')) for i in r['itens']] == [
        ('Wrap de hambúrguer', None), ('Bolo de creme de milho', 'Festa Junina')]
    assert r['escondidas'] == [
        {'titulo': 'Panetone salgado simples', 'motivo': 'fora de época (Natal/Ano Novo)'},
        {'titulo': 'Petiscos para a Copa do Mundo', 'motivo': 'Copa do Mundo'},
        {'titulo': 'Prato do tiroteio', 'motivo': 'conteúdo sensível (tiroteio)'},
        {'titulo': 'Torta de frango', 'motivo': 'já publicada'}]


def test_links_publicados_saem_do_texto_dos_posts():
    from core import receita_do_dia as rdd
    conteudos = ['🍰 Bolo\n\nFonte: Receiteria\nhttps://www.receiteria.com.br/bolo-de-pote/\n\n#receitas',
                 'Fonte: https://receiteria.com.br/Pao-de-Queijo/?utm=x.', 'post sem link', None]
    assert rdd.links_publicados(conteudos) == {'https://receiteria.com.br/bolo-de-pote',
                                               'https://receiteria.com.br/pao-de-queijo'}


def test_receitas_publicadas_antes_da_tela_ficam_de_fora():
    """Os 340 posts antigos usam link curto; a lista resolvida mora em core/receitas_publicadas_antigas.txt."""
    from core import receita_do_dia as rdd
    antigas = rdd.publicadas_antigas()
    assert len(antigas) > 300
    assert 'https://receiteria.com.br/receita/bolo-de-chocolate-sem-acucar-e-sem-farinha' in antigas
    assert all(l.startswith('https://receiteria.com.br/') and l == rdd.normalizar_link(l) for l in antigas)


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
    # Sem descrição nenhuma, o post não fica com parágrafo vazio.
    assert rdd.montar_legenda('🍽️', 'Wrap', '', 'L').startswith('🍽️ Wrap\n\nFonte: Receiteria\nL\n\n#')


def test_preparar_sem_ia_usa_a_descricao_do_site(monkeypatch):
    _sem_ia(monkeypatch)
    from core import receita_do_dia as rdd
    r = rdd.preparar_texto(rdd.item_da_api(WRAP))
    assert r['via_ia'] is False and r['prompt_imagem'] == 'Wrap de hambúrguer'
    assert r['texto'].startswith('🍽️ Wrap de hambúrguer\n\nWrap de hambúrguer com cheddar e molho especial, '
                                 'dourado na frigideira.\n\nFonte: Receiteria\n'
                                 'https://www.receiteria.com.br/receita/wrap-de-hamburguer/\n\n#ReceitasFavoritas')


def test_prompt_leva_ingredientes_e_proibe_inventar():
    from core import receita_do_dia as rdd
    p = rdd._prompt_texto(rdd.item_da_api(WRAP))
    assert 'Ingredientes: 1 wrap; 1 fatia de queijo cheddar; 2 colheres de maionese' in p
    assert 'Tempo total: 20 min' in p and 'Rendimento: 1 porção' in p
    assert 'NÃO invente ingredientes' in p and 'NÃO prometa benefício de saúde' in p and 'NÃO cite marcas' in p


def test_preparar_com_ia_monta_a_legenda_a_partir_do_json(monkeypatch):
    from core import receita_do_dia as rdd
    _gemini_falso(monkeypatch, resposta='```json\n{"emoji": "🌯", "titulo": "Wrap de hambúrguer", '
                                        '"resumo": "Crocante e rápido.", "hashtags": ["Wrap"], '
                                        '"prompt_imagem": "wrap de hambúrguer cortado ao meio"}\n```')
    r = rdd.preparar_texto(rdd.item_da_api(WRAP))
    assert r['via_ia'] is True and r['prompt_imagem'] == 'wrap de hambúrguer cortado ao meio'
    assert r['texto'].startswith('🌯 Wrap de hambúrguer\n\nCrocante e rápido.\n\nFonte: Receiteria\n')
    assert r['texto'].endswith('#Dicas #Wrap')


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
    r = rdd.preparar_texto(rdd.item_da_api(WRAP))
    assert len(chamadas) == 2 and r['via_ia'] is True and 'Lanche rápido.' in r['texto']


def test_preparar_com_ia_quebrada_cai_na_descricao(monkeypatch):
    from core import receita_do_dia as rdd
    _gemini_falso(monkeypatch, erro='503 UNAVAILABLE')
    monkeypatch.setattr(rdd.time, 'sleep', lambda s: None)
    assert rdd.preparar_texto(rdd.item_da_api(WRAP))['via_ia'] is False


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
    assert anonimo.post('/api/receitas/sugestoes', json={'itens': [WRAP]}).status_code == 401
    r = _cliente().get('/receita-do-dia')
    assert r.status_code == 200 and b'receita-do-dia.js?v=2' in r.data


def test_sugestoes_filtram_o_que_o_navegador_trouxe(monkeypatch):
    _com_conta(monkeypatch)
    from core import newpost_feed
    from core import receita_do_dia as rdd
    monkeypatch.setattr(newpost_feed, 'conteudos_da_conta',
                        lambda conta, contem='', limite=1000: ['https://www.receiteria.com.br/receita/wrap-de-hamburguer/'])
    # Publicada antes da tela (lista fixa dos links curtos) também some.
    monkeypatch.setattr(rdd, 'publicadas_antigas',
                        lambda: frozenset({'https://receiteria.com.br/receita/bolo-de-creme-de-milho'}))
    d = _cliente().post('/api/receitas/sugestoes', json={'itens': [WRAP, MILHO, PANETONE, 'lixo']}).get_json()
    assert d['success'] and d['conta_ok'] and d['aviso'] == ''
    motivos = {e['titulo']: e['motivo'] for e in d['escondidas']}
    assert motivos['Wrap de hambúrguer'] == 'já publicada'
    assert motivos['Bolo de creme de milho'] == 'já publicada'
    # O panetone depende do dia em que o teste roda (época de Natal = aparece); nada mais aparece.
    assert all(i['titulo'] == 'Panetone salgado simples' for i in d['itens'])


def test_sugestoes_recusam_lista_vazia_ou_estranha():
    c = _cliente()
    assert c.post('/api/receitas/sugestoes', json={'itens': []}).status_code == 400
    assert c.post('/api/receitas/sugestoes', json={}).status_code == 400
    assert c.post('/api/receitas/sugestoes', json={'itens': [{'link': 'https://exemplo.com'}]}).status_code == 400


def test_preparar_usa_o_que_a_tela_mandou_sem_ir_ao_site(monkeypatch):
    _sem_ia(monkeypatch)
    from core import receita_do_dia as rdd
    c = _cliente()
    d = c.post('/api/receitas/preparar', json=rdd.item_da_api(WRAP)).get_json()
    assert d['success'] and 'dourado na frigideira.' in d['texto']
    assert c.post('/api/receitas/preparar', json={'titulo': 'x', 'link': 'https://exemplo.com/x'}).status_code == 400


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


# ── tela ─────────────────────────────────────────────────────────────────────

def test_tela_busca_pelo_navegador_usa_textcontent_e_menu_tem_o_link():
    js = _ler('static', 'receita-do-dia.js')
    assert "const API_RECEITERIA = 'https://www.receiteria.com.br/wp-json/wp/v2/receita';" in js
    assert "{ credentials: 'omit' }" in js and "r.headers.get('X-WP-TotalPages')" in js
    assert "await api('/api/receitas/sugestoes', { itens: brutos })" in js
    assert 'innerHTML' not in js                                   # dado de fora nunca vira HTML
    assert "if (String(item.link).startsWith(PREFIXO)) {" in js
    assert "if (item.aviso_epoca) {" in js
    assert "c.toDataURL('image/jpeg', QUALIDADE)" in js
    assert "if (!confirm(" in js                                   # publicar é mão humana
    html = _ler('templates', 'index.html')
    assert '<a href="/receita-do-dia" class="menu-item badge-new"' in html
