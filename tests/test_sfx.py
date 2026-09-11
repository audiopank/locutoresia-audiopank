"""Efeitos sonoros (11/09/2026): aba na Biblioteca, filtro por tipo na API e faixa de Efeito na MiniDAW.

Rodar: pytest tests/test_sfx.py -v  (a API de trilhas bate no Supabase real).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

RAIZ = os.path.join(os.path.dirname(__file__), '..')


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _generos(cliente, query):
    d = cliente.get('/api/tracks' + query).get_json()
    assert d['success']
    return [t.get('genre') for t in d['tracks']]


def test_api_tracks_padrao_esconde_efeitos_e_demos(cliente):
    g = _generos(cliente, '')
    assert 'sfx' not in g and 'demo_voz' not in g


def test_api_tracks_tipo_sfx_so_efeitos(cliente):
    g = _generos(cliente, '?tipo=sfx')
    assert all(x == 'sfx' for x in g)


def test_api_tracks_todos_e_uniao(cliente):
    todos = _generos(cliente, '?tipo=todos')
    trilhas = _generos(cliente, '?tipo=trilhas')
    sfx = _generos(cliente, '?tipo=sfx')
    assert len(todos) == len(trilhas) + len(sfx)
    assert 'demo_voz' not in todos


def test_biblioteca_tem_aba_e_tipo_no_upload(cliente):
    html = cliente.get('/library').get_data(as_text=True)
    for t in ('id="tabSfx"', 'id="trackTipo"', "mudarTipo('sfx')", '/api/tracks?tipo=todos', 'selectedTrackTipo', "genre === 'sfx'"):
        assert t in html, t


def test_minidaw_recebe_tipo_e_tem_estilo_do_efeito(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    assert "selectedTrackTipo') === 'sfx' ? 'sfx' : 'music'" in html
    assert '.track-type.sfx' in html


def test_minidaw_js_faixa_de_efeito():
    js = open(os.path.join(RAIZ, 'static', 'minidaw.js'), encoding='utf-8').read()
    assert "const ehSfx = (type === 'sfx');" in js and 'sfx: ehSfx,' in js
    assert "if (track.type === 'music' && !track.sfx && haVoz) {" in js          # prévia sem ducking
    assert "track.sfx = false;" in js                                              # virar Voz/Trilha limpa a marca
    assert "name: t.name, type: t.type, sfx: !!t.sfx," in js                       # projeto salvo guarda a marca
    assert "fetch('/api/tracks?tipo=sfx')" in js and 'bib-tab-sfx' in js           # modal com aba de efeitos
    assert "this.addTrack(tipo);" in js


def test_mix_engine_nao_ducka_efeito():
    js = open(os.path.join(RAIZ, 'static', 'mix-engine.js'), encoding='utf-8').read()
    assert "if (track.type === 'music' && !track.sfx && clipsDeVoz.length > 0) {" in js
