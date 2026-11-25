"""✂️ Roteiro em parágrafos (25/11/2026): o "Abrir fatiado na MiniDAW" corta a voz por
parágrafo e recusava o roteiro que a IA devolvia num bloco só. Agora o prompt pede
3 a 5 parágrafos e, se a IA ignorar, o backend quebra por frases inteiras.

Rodar: pytest tests/test_roteiro_paragrafos.py -v
"""
import json
import types

import pytest

import backend.app as A


def test_bloco_unico_vira_paragrafos_de_frases_inteiras():
    texto = ('Atenção, Messejana! Sábado tem promoção. Pão francês a treze e noventa. '
             'Café com tapioca por nove e noventa. Abre das seis às oito. Peça no WhatsApp. '
             'Pão Quentinho: seu sábado merece!')
    linhas = A.paragrafar_roteiro(texto).split('\n')
    assert 3 <= len(linhas) <= 5
    assert ' '.join(linhas) == texto            # nada some, nada muda de ordem
    assert all(l.rstrip().endswith(('!', '.', '?')) for l in linhas)


def test_texto_que_ja_tem_paragrafo_ou_uma_frase_fica_igual():
    assert A.paragrafar_roteiro('Primeiro.\nSegundo.') == 'Primeiro.\nSegundo.'
    assert A.paragrafar_roteiro('Só uma frase sem ponto') == 'Só uma frase sem ponto'


class _IA:
    resposta = ''
    pedidos = []

    def __init__(self, api_key=None): self.models = self

    def generate_content(self, model=None, contents=None, config=None):
        _IA.pedidos.append(contents)
        return types.SimpleNamespace(text=json.dumps({'roteiro': _IA.resposta, 'resumo': 'ok'}))


@pytest.fixture
def cliente(monkeypatch):
    import google.genai
    monkeypatch.setenv('GEMINI_API_KEY', 'teste')
    monkeypatch.setattr(google.genai, 'Client', _IA)
    _IA.pedidos = []
    A.app.config['TESTING'] = True
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_spot_da_ia_num_bloco_so_sai_fatiavel(cliente):
    _IA.resposta = 'Atenção! Loja do Zé. Promoção de sábado. Venha já!'
    d = cliente.post('/api/gerador/roteiro', json={'briefing': 'Loja do Zé', 'plano': 'spot_30_45'}).get_json()
    assert d['fonte'] == 'ia' and d['roteiro'].count('\n') >= 1
    assert 'parágrafos curtos' in _IA.pedidos[0]


def test_dialogo_nao_e_mexido(cliente):
    _IA.resposta = 'Ana: Oi, Zé! Tudo bem?\nZé: Tudo ótimo. Promoção hoje!'
    d = cliente.post('/api/gerador/roteiro', json={'briefing': 'Loja', 'plano': 'spot_30_45',
                                                   'formato': 'dialogo'}).get_json()
    assert d['roteiro'] == _IA.resposta
