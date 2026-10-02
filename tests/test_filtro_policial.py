"""Filtro de conteúdo sensível: notícia policial (02/10/2026).

Pedido dele: "esse tipo de notícia eu não quero no feed da NewPost-IA" — "Homem é preso com
armas e 285 munições após denúncia de caça ilegal em Ataléia" apareceu na Busca Notícias.
O filtro pegava crime com morte/violência, mas não o vocabulário de polícia e prisão
(preso, detido, flagrante, armas, munição, apreensão, foragido). Além disso a Busca
Notícias só filtrava na hora de PUBLICAR; agora a notícia nem aparece na lista.

Rodar: pytest tests/test_filtro_policial.py -v
"""
import pytest


@pytest.mark.parametrize('titulo', [
    'Homem é preso com armas e 285 munições após denúncia de caça ilegal em Ataléia',
    'Suspeito é detido após perseguição na BR-116',
    'Polícia prende quadrilha que aplicava golpes',
    'Dupla é presa em flagrante com celulares roubados',
    'PM apreende drogas em operação no Centro',
    'Foragido da Justiça é recapturado em Fortaleza',
    'Juiz decreta prisão preventiva de empresário',
    'Homem portando arma de fogo é abordado',
])
def test_noticia_policial_e_barrada(titulo):
    from core.content_filter import blocked_reason
    assert blocked_reason(titulo), titulo


@pytest.mark.parametrize('titulo', [
    'Prisão de ventre: alimentos que ajudam o intestino',
    'Com apreensão, mercado aguarda decisão sobre juros',
    'A nova arma secreta do marketing digital',
    'Bolo de cenoura fofinho com cobertura de chocolate',
    'Galaxy Z Fold8 ou Motorola Razr Fold: qual dobrável vale a pena?',
    'Fleury adquire Unilab Laboratório Clínico por R$ 55 milhões',
    'Representantes do Brasil apresentam proposta na COP',
])
def test_noticia_comum_passa(titulo):
    from core.content_filter import blocked_reason
    assert blocked_reason(titulo) == '', titulo


def test_busca_noticias_esconde_na_lista(monkeypatch):
    from backend import app as modulo
    monkeypatch.setattr(modulo, 'fetch_news_from_rss', lambda categoria, limit=6: [
        {'title': 'Homem é preso com armas e 285 munições após denúncia de caça ilegal em Ataléia',
         'summary': 'A PM recebeu denúncia.', 'fonte': 'G1', 'link': 'https://g1.globo.com/a'},
        {'title': 'Fleury adquire Unilab', 'summary': 'Negócio de R$ 55 milhões.', 'fonte': 'InfoMoney',
         'link': 'https://www.infomoney.com.br/b'},
    ])
    modulo.app.config['TESTING'] = True
    c = modulo.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    d = c.post('/api/news/fetch', json={'category': 'Geral'}).get_json()
    assert [n['titulo'] for n in d['data']['noticias']] == ['Fleury adquire Unilab']
    assert d['data']['escondidas'] == 1
