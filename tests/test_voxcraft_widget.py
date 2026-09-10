"""Widget do VoxCraft no Gerador e na MiniDAW (fase B, 10/09/2026). Rodar: pytest tests/test_voxcraft_widget.py -v"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


@pytest.mark.parametrize('rota', ['/gerador', '/minidaw'])
def test_widget_renderiza_nas_duas_telas(cliente, rota):
    html = cliente.get(rota).get_data(as_text=True)
    for trecho in ('id="voxcraftChat"', 'id="voxcraftMessages"', 'id="voxcraftInput"', 'id="voxcraftToggleBtn"',
                   '/static/voxcraft-widget.js', '.voxcraft-acao', 'Sou o VoxCraft'):
        assert trecho in html, f'{rota} sem {trecho}'


def test_gerador_carrega_o_js_novo_e_define_contexto(cliente):
    html = cliente.get('/gerador').get_data(as_text=True)
    assert 'gerador.js?v=23' in html
    js = open(os.path.join(os.path.dirname(__file__), '..', 'static', 'gerador.js'), encoding='utf-8').read()
    assert 'window.voxcraftContexto = function' in js and 'window.aplicarPrefillVoxcraft = async function' in js
    assert "sessionStorage.getItem('voxcraft_prefill')" in js


def test_minidaw_define_contexto_com_faixas(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    assert 'window.voxcraftContexto = function' in html and 'minidaw.tracks' in html


def test_home_continua_com_o_widget_antigo(cliente):
    html = cliente.get('/').get_data(as_text=True)
    assert 'id="voxcraftChat"' in html and 'voxcraft-widget.js' not in html
