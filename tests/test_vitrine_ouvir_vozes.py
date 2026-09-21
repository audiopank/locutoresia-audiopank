"""Link "Ouvir vozes" em cada cartão de preço da vitrine (21/09/2026).

Ele viu no concorrente um modal "Vozes do pacote Básico" e gostou. A gente já tem a seção de amostras
(por estilo de uso, melhor que por preço); o que faltava era o atalho a partir do preço. O link some
junto com a seção quando não há demo publicada (senão vira link pra lugar nenhum).

Rodar: pytest tests/test_vitrine_ouvir_vozes.py -v
"""
import os
import re

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    return app.test_client()   # sem login: a vitrine é pública


def test_um_link_por_cartao_apontando_pra_secao_que_ja_existe(cliente):
    html = cliente.get('/vitrine').get_data(as_text=True)
    cartoes = len(re.findall(r'<div class="preco( destaque)?">', html))
    links = html.count('<a href="#amostras" class="link-vozes">')
    assert cartoes == 4 and links == cartoes, (cartoes, links)
    assert '<section id="amostras">' in html                       # o destino existe na mesma página
    assert html.index('<section id="amostras">') < html.index('<section id="precos">')   # amostras vem ANTES; o link rola pra cima


def test_link_some_junto_com_a_secao_de_amostras():
    html = _ler('templates', 'landing.html')
    esconde_secao = html.count("document.getElementById('amostras').style.display = 'none';")
    esconde_links = html.count("document.querySelectorAll('.link-vozes').forEach(l => { l.style.display = 'none'; });")
    assert esconde_secao == 2 and esconde_links == 2, (esconde_secao, esconde_links)
    assert '.link-vozes {' in html
