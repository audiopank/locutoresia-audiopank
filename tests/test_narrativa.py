"""Estúdio de Narrativa (11/09/2026): divisão em blocos, texto pro TTS e persistência.

Rodar: pytest tests/test_narrativa.py -v  (guardar/listar/ler/apagar batem no Storage real).
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from core import narrativa as nv

ROTEIRO = """A chuva não parava há três dias quando Harrow House pediu ajuda.

Inspetor: Diga-me exatamente o que você viu ontem à noite. [pausa] Não omita nada.

Governanta: Levei o chá dele às nove, como sempre.
Ele estava na escrivaninha, com seus mapas.

O detetive virou-se para a porta trancada."""


def test_dividir_em_blocos_personagem_e_narrador():
    b = nv.dividir_em_blocos(ROTEIRO)
    assert [x['personagem'] for x in b] == ['Narrador', 'Inspetor', 'Governanta', 'Narrador']
    assert b[0]['texto'].startswith('A chuva não parava')
    assert b[1]['texto'] == 'Diga-me exatamente o que você viu ontem à noite. Não omita nada.'   # [pausa] sai
    assert b[2]['texto'] == 'Levei o chá dele às nove, como sempre.\nEle estava na escrivaninha, com seus mapas.'


def test_dividir_ignora_vazios_e_crlf():
    assert nv.dividir_em_blocos('\r\n\r\n  Só um.  \r\n\r\n\r\n') == [{'personagem': 'Narrador', 'texto': 'Só um.'}]
    assert nv.dividir_em_blocos('') == []


def test_dividir_nao_confunde_url_com_personagem():
    b = nv.dividir_em_blocos('https://x.com/a Confira no site.')
    assert b[0]['personagem'] == 'Narrador'


def test_personagens_na_ordem_sem_repetir():
    b = nv.dividir_em_blocos(ROTEIRO)
    assert nv.personagens(b) == ['Narrador', 'Inspetor', 'Governanta']


def test_texto_para_tts_direcao_so_no_google():
    assert nv.texto_para_tts('Oi.', 'sussurrando', 'google') == '[sussurrando]\nOi.'
    assert nv.texto_para_tts('Oi.', '[sussurrando]', 'google') == '[sussurrando]\nOi.'
    assert nv.texto_para_tts('Oi.', 'sussurrando', 'elevenlabs') == 'Oi.'
    assert nv.texto_para_tts('Oi.', '', 'google') == 'Oi.'


def test_roteiro_plano_e_slug():
    b = nv.dividir_em_blocos(ROTEIRO)
    plano = nv.roteiro_plano(b)
    assert plano.startswith('Narrador: A chuva') and '\n\nInspetor: Diga-me' in plano
    assert nv.slug('O Estúdio Selado: cap. 1!') == 'O-Estudio-Selado-cap-1'
    assert nv.slug('') == 'narrativa'


# ── endpoints ────────────────────────────────────────────────────────────────

@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_pagina_e_dividir(cliente):
    html = cliente.get('/narrativa').get_data(as_text=True)
    for t in ('id="roteiroBruto"', 'id="listaBlocos"', 'id="btnGerarTudo"', '/static/narrativa.js', 'id="voxcraftChat"'):
        assert t in html, t
    d = cliente.post('/api/narrativa/dividir', json={'texto': ROTEIRO}).get_json()
    assert d['success'] and len(d['blocos']) == 4 and d['personagens'] == ['Narrador', 'Inspetor', 'Governanta']
    assert d['palavras'] > 30


def test_guardar_listar_ler_apagar_no_storage_real(cliente):
    nome = f'TESTE narrativa apagar {int(time.time())}'
    dados = {'pausa': 0.6, 'vozes': {'Narrador': {'voz': 'Charon', 'provider': 'gemini'}},
             'blocos': [{'personagem': 'Narrador', 'texto': 'Olá.'}]}
    g = cliente.post('/api/narrativas', json={'nome': nome, 'dados': dados}).get_json()
    assert g['success'] and g['arquivo'].endswith('.json') and g['path'].startswith('narrativas/')
    lista = cliente.get('/api/narrativas').get_json()
    assert lista['success'] and any(i['arquivo'] == g['arquivo'] for i in lista['narrativas'])
    lido = cliente.get(f"/api/narrativas/{g['arquivo']}").get_json()
    assert lido['success'] and lido['nome'] == nome and lido['dados']['blocos'][0]['texto'] == 'Olá.'
    # regravar: vira arquivo NOVO (o Storage devolvia conteúdo velho ao sobrescrever) e o antigo some
    g2 = cliente.post('/api/narrativas', json={'nome': nome, 'dados': {**dados, 'pausa': 1.0}, 'arquivo': g['arquivo']}).get_json()
    assert g2['success'] and g2['arquivo'] != g['arquivo'] and g2['arquivo'].endswith('.json')
    assert cliente.get(f"/api/narrativas/{g2['arquivo']}").get_json()['dados']['pausa'] == 1.0
    nomes = [i['arquivo'] for i in cliente.get('/api/narrativas').get_json()['narrativas']]
    assert g2['arquivo'] in nomes and g['arquivo'] not in nomes
    assert cliente.delete('/api/narrativas', json={'arquivo': g2['arquivo']}).get_json()['success']
    assert not any(i['arquivo'] == g2['arquivo'] for i in cliente.get('/api/narrativas').get_json()['narrativas'])


def test_caminho_forjado_e_recusado(cliente):
    assert cliente.get('/api/narrativas/..%2Fentregas%2Fx.json').status_code in (400, 404)
    assert cliente.delete('/api/narrativas', json={'arquivo': '../rascunhos/x.mp3'}).status_code == 400
    assert cliente.post('/api/narrativas', json={'nome': '', 'dados': {}}).status_code == 400
