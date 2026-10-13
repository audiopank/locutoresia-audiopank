"""Busca Notícias publica também como Canal Futebol (13/10/2026).

Com as fontes de esporte novas (ge, ESPN, Gazeta), futebol não cabia em Futuro em
Pauta nem em MÍDIA DIGITAL. Pedido dele: perfil próprio, canalfutebol@gmail.com,
sempre com a aprovação na mão. Sem as credenciais próprias o publicar RECUSA —
nunca assina como outro perfil. A prévia mostra as tags que vão de verdade.

Rodar: pytest tests/test_busca_noticias_futebol.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
NOTICIA = {'titulo': 'Vasco x Boca no Maracanã', 'conteudo': 'Justiça liberou o Maracanã.',
           'categoria': 'Esportes', 'link': 'https://ge.globo.com/futebol/times/vasco/x.ghtml', 'conta': 'futebol'}


def _cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_conta_futebol_com_variaveis_proprias():
    from core import newpost_feed as nf
    assert nf.CONTAS['futebol'] == ('NEWPOST_FEED_EMAIL_FUTEBOL', 'NEWPOST_FEED_SENHA_FUTEBOL')


def test_publica_como_canal_futebol(monkeypatch):
    from core import newpost_feed
    chamadas = []
    monkeypatch.setenv('NEWPOST_FEED_EMAIL_FUTEBOL', 'x@y')
    monkeypatch.setenv('NEWPOST_FEED_SENHA_FUTEBOL', 'z')
    monkeypatch.setattr(newpost_feed, 'publicar', lambda c, **kw: chamadas.append(kw) or {'success': True, 'post_id': 'p'})
    d = _cliente().post('/api/news/publish-to-newpost', json=NOTICIA).get_json()
    assert d['success'] and d['author'] == 'Canal Futebol'
    assert chamadas[0]['conta'] == 'futebol' and chamadas[0]['tags'] == ['Futebol', 'CanalFutebol']


def test_sem_credenciais_recusa_e_nao_publica(monkeypatch):
    from core import newpost_feed
    chamadas = []
    monkeypatch.delenv('NEWPOST_FEED_EMAIL_FUTEBOL', raising=False)
    monkeypatch.delenv('NEWPOST_FEED_SENHA_FUTEBOL', raising=False)
    monkeypatch.setattr(newpost_feed, 'publicar', lambda c, **kw: chamadas.append(kw) or {'success': True})
    r = _cliente().post('/api/news/publish-to-newpost', json=NOTICIA)
    d = r.get_json()
    assert r.status_code == 400 and not d['success'] and 'NEWPOST_FEED_SENHA_FUTEBOL' in d['error']
    assert chamadas == []


def test_tela_tem_o_botao_e_a_previa_mostra_as_tags_reais():
    html = open(os.path.join(RAIZ, 'templates', 'busca-noticias.html'), encoding='utf-8').read()
    assert 'data-conta="futebol"' in html and 'Canal Futebol' in html
    assert '#Tech #Inovação' not in html and '#Tech #inovação' not in html
    assert "futebol: '#Futebol #CanalFutebol'" in html
