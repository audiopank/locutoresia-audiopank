"""Marcadores na régua da MiniDAW + rampas de fade desenhadas no clip (16/09/2026).

Rodar: pytest tests/test_marcadores_minidaw.py -v  (o teste do projeto grava e apaga uma linha real).
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_minidaw_js_marcadores_de_ponta_a_ponta():
    js = _ler('static', 'minidaw.js')
    for marca in (
        "this.marcadores = [];",
        "adicionarMarcador(tempo) {", "removerMarcador(id) {", "_desenharMarcadoresNasLanes() {",
        "e.key === 'm' || e.key === 'M'",                                          # tecla M
        'html += `<div class="marcador" data-id="${m.id}"',                          # bandeira na régua
        "regua.addEventListener('dblclick'", "regua.addEventListener('contextmenu'",
        "lane.addEventListener('dblclick'",                                          # marcador por duplo clique na faixa
        "for (const mt of this._temposDosMarcadores()) alvos.push(mt, mt - clip.duracao);",   # imã ao arrastar
        "for (const mt of this._temposDosMarcadores()) alvos.push(mt);",             # imã ao aparar
        "marcadores: this.marcadores,\n            master: window.MasterSuite ? MasterSuite.estadoParaSalvar() : undefined\n        };",   # rascunho local
        "this.marcadores = this._normalizarMarcadores(data.marcadores);",
        "const body = { name: nome, tracks, marcadores: this.marcadores,",          # projeto salvo
        "this.marcadores = this._normalizarMarcadores(proj.marcadores);",           # projeto reaberto
        "d.marcadores_salvos === false",                                             # aviso da coluna
        "window.adicionarMarcador = () => minidaw.adicionarMarcador();",
    ):
        assert marca in js, marca


def test_fades_aparecem_no_clip():
    js = _ler('static', 'minidaw.js')
    assert "if (clip.fadeIn > 0) {\n            const w = Math.min(width, clip.fadeIn * pxPorSeg);" in js
    assert "if (clip.fadeOut > 0) {\n            const w = Math.min(width, clip.fadeOut * pxPorSeg);" in js
    assert "this.previaFade(trackId, 'fadeIn', track.fadeIn);" in js and "this.previaFade(trackId, 'fadeOut', track.fadeOut);" in js
    assert 'id="fadein_val_${track.id}"' in js and 'id="fadeout_val_${track.id}"' in js   # valor em segundos ao lado do slider
    assert 'oninput="minidaw.previaFade(' in js


def test_sanear_marcadores():
    from backend.app import _sanear_marcadores
    assert _sanear_marcadores(None) is None and _sanear_marcadores('x') is None
    assert _sanear_marcadores([{'id': 'a', 't': 12.3456}, 'lixo', {'t': -1}, {'t': 'nan'}, {'id': 'b', 't': '7'}]) == \
        [{'id': 'a', 't': 12.346}, {'id': 'b', 't': 7.0}]


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_pagina_tem_botao_css_e_versao(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('onclick="adicionarMarcador()"', '.timeline-regua .marcador {', '.clips-lane .marcador-linha {', 'minidaw.js?v=62'):
        assert t in html, t


def test_projeto_salva_com_ou_sem_a_coluna_e_apaga(cliente):
    nome = f'TESTE marcadores apagar {int(time.time())}'
    marcadores = [{'id': 'm1', 't': 12.5}, {'id': 'm2', 't': 37.46}]
    g = cliente.post('/api/projects', json={'name': nome, 'tracks': [], 'marcadores': marcadores}).get_json()
    assert g['success'], g
    pid = g['project']['id']
    try:
        assert g['marcadores_salvos'] in (True, False)
        lido = cliente.get(f'/api/projects/{pid}').get_json()
        assert lido['success'] and lido['project']['name'] == nome
        if g['marcadores_salvos']:
            assert lido['project'].get('marcadores') == marcadores
        else:
            # coluna ainda não existe: o projeto salvou mesmo assim (é o que importa)
            assert 'marcadores' not in g['project']
    finally:
        assert cliente.delete(f'/api/projects/{pid}').get_json()['success']



def test_regua_alinhada_e_automacao_limpavel():
    """16/09/2026: cursor da régua adiantado em relação ao das lanes (régua rolava
    menos e nascia 24px à esquerda); e não havia como apagar todos os pontos de automação."""
    js = _ler('static', 'minidaw.js')
    assert 'html += `<div class="regua-largura" style="width:${largura}px;height:1px"></div>`;' in js
    assert "_alinharRegua() {" in js and js.count("this._alinharRegua()") >= 2      # no render e no resize
    assert "regua.scrollLeft = lane.scrollLeft;" in js
    assert "limparAutomacaoVolume(trackId) {" in js
    assert "oncontextmenu=\"minidaw.limparAutomacaoVolume('${track.id}'); return false;\"" in js
