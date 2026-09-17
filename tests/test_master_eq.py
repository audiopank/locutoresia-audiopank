"""Suíte Master — módulo B (16/09/2026): EQ master de 4 bandas com curva arrastável.

Rodar: pytest tests/test_master_eq.py -v  (o teste do projeto grava e apaga uma linha real).
"""
import os
import time

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_previa_e_arquivo_usam_os_mesmos_biquads():
    suite = _ler('static', 'master-suite.js')
    for marca in ("const f = ctx.createBiquadFilter();", "lim.compGain.connect(daw.masterOut);", "f.getFrequencyResponse(freqs, mag, fase);",
                  "function eqParaRender() {", "if (eq.bypass || eq.bandas.every(b => Math.abs(b.ganho) < 0.05)) return null;",
                  "canvas.addEventListener('mousedown', mousedownEq);", "canvas.addEventListener('wheel', wheelEq, { passive: false });",
                  "f.gain.setTargetAtTime(g, t, 0.02);"):
        assert marca in suite, marca
    engine = _ler('static', 'mix-engine.js')
    assert "for (const b of (Array.isArray(o.masterEq) ? o.masterEq : [])) {" in engine
    assert "no.connect(offlineContext.destination);" in engine
    assert "masterGain.connect(offlineContext.destination);" not in engine
    js = _ler('static', 'minidaw.js')
    assert "masterEq: (!opcoes.semMaster && window.MasterSuite) ? MasterSuite.eqParaRender() : null" in js
    assert "this._renderizarParaExport([t], null, { semMaster: true });" in js      # stem isolado cru
    assert "master: window.MasterSuite ? MasterSuite.estadoParaSalvar() : undefined" in js
    assert "this._masterPendente = data.master || null;" in js
    assert "MasterSuite.carregar(proj.master || null);" in js
    assert "d.master_salvo === false" in js


def test_sanear_master():
    from backend.app import _sanear_master
    assert _sanear_master(None) is None and _sanear_master([1]) is None
    m = _sanear_master({'eq': {'bypass': 1, 'bandas': [
        {'tipo': 'lowshelf', 'freq': 100, 'ganho': 3.456, 'q': 0.7},
        {'tipo': 'peaking', 'freq': 1000, 'ganho': 40, 'q': 99},        # ganho e Q fora do limite: aparados
        {'tipo': 'notch', 'freq': 500},                                   # tipo desconhecido: fora
        {'tipo': 'highshelf', 'freq': 'x'},                               # freq inválida: fora
        {'tipo': 'highshelf', 'freq': 10000, 'ganho': -2, 'q': 0.7},
    ]}})
    assert m == {'eq': {'bypass': True, 'bandas': [
        {'tipo': 'lowshelf', 'freq': 100.0, 'ganho': 3.46, 'q': 0.7},
        {'tipo': 'peaking', 'freq': 1000.0, 'ganho': 12.0, 'q': 10.0},
        {'tipo': 'highshelf', 'freq': 10000.0, 'ganho': -2.0, 'q': 0.7},
    ]}}


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_painel_eq_e_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('id="msEqCanvas"', 'id="msEqBypass"', 'id="msEqReset"', 'id="msEqBandas"', '.ms-eq canvas {',
              'mix-engine.js?v=9', 'master-suite.js?v=4', 'minidaw.js?v=55'):
        assert t in html, t
    assert os.path.exists(os.path.join(RAIZ, 'MINIDAW_MASTER.sql'))


def test_projeto_salva_master_com_ou_sem_a_coluna(cliente):
    nome = f'TESTE master apagar {int(time.time())}'
    master = {'eq': {'bypass': False, 'bandas': [{'tipo': 'lowshelf', 'freq': 100.0, 'ganho': 2.0, 'q': 0.7}]}}
    g = cliente.post('/api/projects', json={'name': nome, 'tracks': [], 'marcadores': [{'id': 'm1', 't': 1.5}], 'master': master}).get_json()
    assert g['success'], g
    pid = g['project']['id']
    try:
        assert g['marcadores_salvos'] is True                 # a coluna dos marcadores já existe (ele rodou o SQL)
        assert g['master_salvo'] in (True, False)
        lido = cliente.get(f'/api/projects/{pid}').get_json()
        assert lido['success'] and lido['project'].get('marcadores') == [{'id': 'm1', 't': 1.5}]
        if g['master_salvo']:
            assert lido['project'].get('master') == master
        else:
            assert 'master' not in g['project']                # coluna ainda não existe: projeto salvou mesmo assim
    finally:
        assert cliente.delete(f'/api/projects/{pid}').get_json()['success']
