"""Meus presets do master (23/09/2026): "temos Crato toda semana".

O master inteiro (EQ + MultiMax + limiter/destino) vira preset com nome, guardado no Supabase
(app_config, chave 'master_presets'), e volta em qualquer projeto com um clique. Rotas atrás do
portão de senha. Este teste grava e apaga um preset REAL com nome de teste.

Rodar: pytest tests/test_master_presets.py -v
"""
import os
import time

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_rotas_ficam_atras_do_portao():
    app_py = _ler('backend', 'app.py')
    bloco = app_py[app_py.index('ROTAS_PUBLICAS = {'):app_py.index('ROTAS_PUBLICAS = {') + 800]
    assert 'master_preset' not in bloco
    assert "@app.route('/api/master-presets', methods=['GET'])" in app_py
    assert "@app.route('/api/master-presets', methods=['POST'])" in app_py
    assert "@app.route('/api/master-presets/<nome>', methods=['DELETE'])" in app_py
    assert "master = _sanear_master(data.get('master'))" in app_py            # mesmo saneamento do projeto


def test_guardar_listar_substituir_e_apagar(cliente):
    nome = f'TESTE apagar {int(time.time())}'
    master = {'eq': {'bypass': False, 'bandas': [{'tipo': 'lowshelf', 'freq': 47, 'ganho': 5.2, 'q': 1}]},
              'limiter': {'ligado': True, 'destino': 'whatsapp', 'otimizarLufs': True},
              'multimax': {'ligado': True, 'preset': 'autoradio', 'ganhos': [-0.5, 0.5, 2.5]}}
    try:
        r = cliente.post('/api/master-presets', json={'nome': nome, 'master': master}).get_json()
        assert r['success'] and r['substituiu'] is False
        salvo = next(p for p in r['presets'] if p['nome'] == nome)
        assert salvo['master']['multimax'] == {'ligado': True, 'preset': 'autoradio', 'ganhos': [-0.5, 0.5, 2.5]}
        assert salvo['master']['eq']['bandas'][0]['ganho'] == 5.2 and salvo['master']['limiter']['destino'] == 'whatsapp'
        # Lista traz o preset.
        lista = cliente.get('/api/master-presets').get_json()
        assert lista['success'] and any(p['nome'] == nome for p in lista['presets'])
        # Mesmo nome (outra caixa) = substitui, não duplica; preset de MultiMax inválido cai no padrão.
        master2 = dict(master, multimax={'ligado': False, 'preset': 'invalido', 'ganhos': [0, 0, 0]})
        r2 = cliente.post('/api/master-presets', json={'nome': nome.upper(), 'master': master2}).get_json()
        assert r2['success'] and r2['substituiu'] is True
        iguais = [p for p in r2['presets'] if p['nome'].lower() == nome.lower()]
        assert len(iguais) == 1 and iguais[0]['master']['multimax']['preset'] == 'loud2'
    finally:
        d = cliente.delete('/api/master-presets/' + nome.upper()).get_json()
        assert d['success'] and not any(p['nome'].lower() == nome.lower() for p in d['presets'])
    assert cliente.delete('/api/master-presets/' + nome).status_code == 404
    assert cliente.post('/api/master-presets', json={'master': master}).status_code == 400      # sem nome


def test_tela_e_suite():
    html = _ler('templates', 'minidaw.html')
    for t in ('id="msPresetsSel"', 'id="msPresetsGuardar"', 'id="msPresetsApagar"', '.ms-presets {', 'master-suite.js?v=8'):
        assert t in html, t
    suite = _ler('static', 'master-suite.js')
    assert "fetch('/api/master-presets')" in suite and "method: 'POST'" in suite and "method: 'DELETE'" in suite
    assert "carregar(p.master || null);\n        salvar();" in suite                 # aplicar = carregar o master + salvar no rascunho
    assert "body: JSON.stringify({ nome: String(nome).trim(), master: estadoParaSalvar() })" in suite
    assert "localStorage.getItem('minidaw_master_presets')" in suite                   # cópia local quando a rede falha
    assert "carregarPresets();" in suite
