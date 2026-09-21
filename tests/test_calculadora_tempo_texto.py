"""Calculadora pública "Quanto tempo tem meu texto?" (21/09/2026).

Ferramenta de prospecção: ele viu um concorrente (StartStudio) com essa calculadora e perguntou se
serve pra nós. A matemática já existia por dentro do Gerador de Anúncios (faixa 2,15-2,55 pal/s,
medida em locuções reais de IA); aqui ela ganha página PÚBLICA própria, sem IA, sem enviar o texto
pro servidor, terminando em "Peça o orçamento desse texto" -> /solicitar.

Rodar: pytest tests/test_calculadora_tempo_texto.py -v
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
    return app.test_client()   # SEM sessão de admin — a página tem que ser pública


def test_pagina_publica_sem_login(cliente):
    r = cliente.get('/quanto-tempo')
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert 'Quanto tempo tem o meu texto?' in html


def test_rota_esta_na_allowlist():
    app_py = _ler('backend', 'app.py')
    assert "'calculadora_tempo_texto'" in app_py
    trecho = app_py[app_py.index('ROTAS_PUBLICAS = {'):app_py.index('ROTAS_PUBLICAS = {') + 400]
    assert "'calculadora_tempo_texto'" in trecho


def test_taxas_batem_com_o_backend_e_o_gerador():
    """As mesmas duas constantes têm que aparecer nos três lugares — mudou uma, muda todas."""
    app_py = _ler('backend', 'app.py')
    m_medio = re.search(r'PALAVRAS_POR_SEGUNDO\s*=\s*([\d.]+)', app_py)
    m_lento = re.search(r'PALAVRAS_POR_SEGUNDO_LENTO\s*=\s*([\d.]+)', app_py)
    gerador_js = _ler('static', 'gerador.js')
    m_rapido = re.search(r'RITMO_RAPIDO\s*=\s*([\d.]+)', gerador_js)
    assert m_medio and m_lento and m_rapido

    html = _ler('templates', 'quanto_tempo.html')
    assert f"RITMO_RAPIDO = {m_rapido.group(1)};" in html
    assert f"RITMO_LENTO = {m_lento.group(1)};" in html


def test_nao_manda_o_texto_pro_servidor():
    html = _ler('templates', 'quanto_tempo.html')
    assert 'fetch(' not in html and 'XMLHttpRequest' not in html
    assert "addEventListener('input', atualizar)" in html


def test_cta_leva_pro_formulario_publico():
    html = _ler('templates', 'quanto_tempo.html')
    assert 'href="/solicitar"' in html
    assert 'Peça o orçamento desse texto' in html


def test_conta_range_de_verdade(cliente):
    """37 palavras: 37/2.55=14.5s a 37/2.15=17.2s -> a tela mostra os dois extremos."""
    html = _ler('templates', 'quanto_tempo.html')
    assert 'const rapido = palavras / RITMO_RAPIDO;' in html
    assert 'const lento = palavras / RITMO_LENTO;' in html
    assert "formatarTempo(rapido) === formatarTempo(lento)" in html   # texto curto: não mostra faixa boba tipo "15s a 15s"
