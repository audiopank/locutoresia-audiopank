"""Fontes novas na Busca Notícias (13/10/2026).

Pedido dele: só as fontes de futebol, tecnologia e finanças do pacote do GitHub
(ge, ESPN, Gazeta Esportiva, Tecnoblog, InfoMoney) — publicação continua manual.
A tela mostra 6 notícias: se a coleta empilhasse feed por feed, a fonte nova
nunca apareceria (o 1º feed já enche as 6). Por isso intercala as fontes.

Rodar: pytest tests/test_fontes_novas_noticias.py -v
"""
import importlib
import types


def _app():
    return importlib.import_module('backend.app')


def test_fontes_novas_nas_categorias_certas():
    feeds = _app().RSS_FEEDS
    for u in ('https://ge.globo.com/rss/ge/', 'https://www.espn.com.br/espn/rss/news',
              'https://www.gazetaesportiva.com/feed/'):
        assert u in feeds['Esportes']
    assert 'https://tecnoblog.net/feed/' in feeds['Tecnologia']
    assert 'https://www.infomoney.com.br/feed/' in feeds['Economia']


def test_coleta_intercala_as_fontes(monkeypatch):
    m = _app()
    if not m.HAS_FEEDPARSER:
        return
    falsos = {
        u: types.SimpleNamespace(entries=[{'title': f'{u[-1]}{i}', 'summary': 'ok', 'link': f'{u}/{i}'}
                                          for i in range(6)])
        for u in ('feed-A', 'feed-B', 'feed-C')
    }
    monkeypatch.setitem(m.RSS_FEEDS, 'Teste', list(falsos))
    monkeypatch.setattr(m.feedparser, 'parse', lambda u, **k: falsos[u])
    titulos = [e['title'] for e in m.fetch_news_from_rss('Teste', limit=6)]
    assert titulos == ['A0', 'B0', 'C0', 'A1', 'B1', 'C1']
