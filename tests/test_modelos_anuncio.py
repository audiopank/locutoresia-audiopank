"""Modelos de anúncio + sotaque regional no Gerador (21/10/2026).

Inspirado na "Biblioteca de modelos" do ACE Studio, aprovado por ele: escolher o
tipo de peça (Spot Comercial, Propaganda Volante, Chamada de Festa, Vinheta falada,
Audiovisual) já ajusta duração, direção, estilo e trilha, e a IA recebe a estrutura
daquele tipo. Sotaque regional (ex.: cearense do Crato/Cariri) quando o cliente pede:
vai pro texto (sem caricatura) e pra direção da voz (só Modo Padrão/Google).

Rodar: pytest tests/test_modelos_anuncio.py -v
"""
import json
import os
import sys
import types

import pytest

from core import modelos_anuncio as M

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*p):
    return open(os.path.join(RAIZ, *p), encoding='utf-8').read()


def test_os_cinco_modelos_aprovados():
    assert list(M.MODELOS) == ['comercial', 'volante', 'festa', 'vinheta', 'audiovisual']
    assert M.MODELOS['volante']['plano'] == 'spot_60_90'
    assert M.MODELOS['vinheta']['plano'] == 'teaser_5s'
    assert M.MODELOS['audiovisual']['peca'] == 'video'
    assert all(m['peca'] == 'spot' for k, m in M.MODELOS.items() if k != 'audiovisual')


def test_estrutura_de_cada_modelo_tem_o_essencial():
    assert 'repita' in M.MODELOS['volante']['estrutura'].lower()
    assert 'data' in M.MODELOS['festa']['estrutura'].lower()
    assert 'uma frase' in M.MODELOS['vinheta']['estrutura'].lower()


def test_para_tela_so_leva_o_que_a_tela_usa():
    tela = M.para_tela()
    assert [m['id'] for m in tela['modelos']] == list(M.MODELOS)
    m = tela['modelos'][0]
    assert set(m) == {'id', 'nome', 'descricao', 'peca', 'plano', 'estilo', 'direcao', 'trilha'}
    assert any('Crato' in s['rotulo'] for s in tela['sotaques'])


@pytest.mark.parametrize('entrada, esperado', [
    ('', ''),
    ('  [cearense do Crato]  ', 'cearense do Crato'),
    ('nordestino\ncom calma', 'nordestino com calma'),
    ('x' * 300, 'x' * 80),
])
def test_sotaque_limpo(entrada, esperado):
    assert M.sotaque_limpo(entrada) == esperado


def test_bloco_prompt_junta_estrutura_e_sotaque():
    b = M.bloco_prompt('festa', 'cearense do Cariri (Crato, Ceará)')
    assert 'Chamada de Festa' in b and M.MODELOS['festa']['estrutura'] in b
    assert 'cearense do Cariri (Crato, Ceará)' in b and 'caricatura' in b
    assert M.bloco_prompt('', '') == ''
    assert M.bloco_prompt('nao-existe', '') == ''
    so_sotaque = M.bloco_prompt('', 'nordestino')
    assert 'nordestino' in so_sotaque and 'MODELO' not in so_sotaque


def test_direcao_com_sotaque():
    assert M.direcao_com_sotaque('Rádio da manhã', 'cearense do Crato') == \
        'Rádio da manhã, com sotaque cearense do Crato, natural, sem caricatura'
    assert M.direcao_com_sotaque('', 'nordestino') == 'Com sotaque nordestino, natural, sem caricatura'
    assert M.direcao_com_sotaque('Animado', '') == 'Animado'


# ── endpoint do roteiro: o modelo e o sotaque chegam no pedido à IA ──────────

class _ClienteFalso:
    pedidos = []

    def __init__(self, api_key=None):
        self.models = self

    def generate_content(self, model=None, contents=None, config=None):
        _ClienteFalso.pedidos.append(contents)
        return types.SimpleNamespace(text=json.dumps({'roteiro': 'Atenção, atenção! Loja do Zé.', 'resumo': 'ok'}))


@pytest.fixture
def cliente(monkeypatch):
    from backend.app import app
    import google.genai
    monkeypatch.setenv('GEMINI_API_KEY', 'teste')
    monkeypatch.setattr(google.genai, 'Client', _ClienteFalso)
    _ClienteFalso.pedidos = []
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_roteiro_com_modelo_e_sotaque_vai_pra_ia(cliente):
    r = cliente.post('/api/gerador/roteiro', json={
        'briefing': 'Loja do Zé, promoção de sábado', 'plano': 'spot_60_90',
        'modelo': 'volante', 'sotaque': 'cearense do Cariri (Crato, Ceará)'})
    d = r.get_json()
    assert d['success'] and d['fonte'] != 'base', d
    pedido = _ClienteFalso.pedidos[0]
    assert 'Propaganda Volante' in pedido and M.MODELOS['volante']['estrutura'] in pedido
    assert 'cearense do Cariri (Crato, Ceará)' in pedido


def test_roteiro_sem_modelo_fica_igual(cliente):
    cliente.post('/api/gerador/roteiro', json={'briefing': 'Loja do Zé', 'plano': 'spot_30_45'})
    assert 'MODELO DE ANÚNCIO' not in _ClienteFalso.pedidos[0]
    assert 'sotaque' not in _ClienteFalso.pedidos[0].lower()


def test_rota_dos_modelos(cliente):
    d = cliente.get('/api/gerador/modelos-anuncio').get_json()
    assert d['success'] and len(d['modelos']) == 5


def test_tela_tem_os_campos():
    html = _ler('templates', 'gerador.html')
    assert 'id="selectModeloAnuncio"' in html and 'id="selectSotaque"' in html and 'id="inputSotaqueOutro"' in html
    js = _ler('static', 'gerador.js')
    assert 'modelo: modeloAtual()' in js and 'sotaque: sotaqueAtual()' in js
    assert 'comSotaque(' in js                         # junção na tela (mesma regra do Python)
