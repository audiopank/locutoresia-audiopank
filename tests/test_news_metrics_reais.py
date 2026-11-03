"""Painéis do NewsAgent com números REAIS (03/11/2026, desconfiança dele).

As barras de "Palavras-chave" eram SORTEADAS no navegador (Math.random) e os
"tópicos em alta" traziam palavras vazias ("Nesta", "Terça", "2026"). Agora o
servidor manda a contagem real de cada palavra e ignora as palavras vazias.

Rodar: pytest tests/test_news_metrics_reais.py -v
"""
import backend.news_metrics as nm


def _posts(*titulos):
    return [{'title': t, 'source_url': 'https://g1.globo.com/x', 'tags': ['#Economia'],
             'created_at': '2026-11-03T10:00:00+00:00', 'status': 'published'} for t in titulos]


def test_contagem_real_de_cada_palavra(monkeypatch):
    monkeypatch.setattr(nm, '_fetch_posts', lambda h, l: _posts(
        'Mercado sobe com dólar em queda', 'Mercado fecha em alta', 'Dólar cai e mercado comemora'))
    m = nm.compute_news_metrics(24)
    contagem = dict(m['keyword_counts'])
    assert contagem['mercado'] == 3
    assert contagem['dólar'] == 2
    assert m['global_keywords'][0] == 'mercado'
    # a lista de tópicos e as barras contam IGUAL
    assert m['trending_topics'][0] == {'topic': 'Mercado', 'mentions': 3, 'sources': ['G1']}


def test_ignora_palavras_vazias_dias_meses_e_anos(monkeypatch):
    monkeypatch.setattr(nm, '_fetch_posts', lambda h, l: _posts(
        'Nesta terça, governo anuncia vacina em novembro de 2026',
        'Neste sábado, governo amplia vacina; veja 2026',
        'Governo confirma vacina nesta quinta'))
    palavras = dict(nm.compute_news_metrics(24)['keyword_counts'])
    for vazia in ('nesta', 'neste', 'terça', 'sábado', 'quinta', 'novembro', '2026', 'veja'):
        assert vazia not in palavras, vazia
    assert palavras['governo'] == 3 and palavras['vacina'] == 3


def test_endpoints_mandam_a_contagem_e_o_navegador_nao_sorteia():
    for arq in ('backend/dashboard.py', 'backend/dashboard_modern.py'):
        src = open(arq, encoding='utf-8').read()
        assert "'keyword_counts': m['keyword_counts']" in src, arq
        ini = src.index('function updateKeywordsChart')
        assert 'Math.random' not in src[ini:ini + 1500], arq
