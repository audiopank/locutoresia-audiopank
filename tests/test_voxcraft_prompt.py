"""VoxCraft AI nível 1 (10/09/2026): prompt verdadeiro + dados vivos.

Rodar: pytest tests/test_voxcraft_prompt.py -v
O Gemini entra como dublê; o contexto vivo lê preços/vozes do app e trilhas do Supabase (rede).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest


@pytest.fixture(scope='module')
def app_mod():
    import backend.app as m
    m.app.config['TESTING'] = True
    return m


@pytest.fixture
def cliente(app_mod):
    c = app_mod.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


@pytest.fixture(autouse=True)
def sem_chave_do_gemini(monkeypatch):
    # Dublê errado falha com "sem GEMINI_API_KEY" em vez de gastar a cota de 20/dia.
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)


def _turno_texto(texto):
    """Dublê de _gemini_chat_turn que responde texto puro, sem ferramenta."""
    return lambda system, contents, tools=True: {'texto': texto, 'chamadas': [], 'content': None}


MENTIRAS_ANTIGAS = [
    'novaaudiopank@gmail.com', 'comprovante pelo WhatsApp', 'Vozes clonadas', 'LMNT, Gemini e outros',
    'Fade-out Automático', 'Background sutil (30-50%)', 'self-service', 'jingles cantados',
]
VERDADES = [
    'assistente INTERNO', '/solicitar', 'Kiwify', 'PRÉVIA CARIMBADA', 'DESCONTINUADA em 02/09/2026',
    'LMNT fechou', 'LÊ colchetes em voz alta', '2,16 a 2,57', '57 a 90 palavras', '135 a 165',
    'Charon', '## FERRAMENTAS', 'Nunca invente valor',
]


def test_prompt_fixo_sem_as_mentiras_antigas_e_com_as_regras(app_mod):
    p = app_mod.VOXCRAFT_SYSTEM_PROMPT
    sobras = [m for m in MENTIRAS_ANTIGAS if m in p]
    assert not sobras, sobras
    faltam = [v for v in VERDADES if v not in p]
    assert not faltam, faltam


def test_montar_prompt_junta_dados_vivos_e_tela(app_mod):
    p = app_mod.montar_prompt_voxcraft('PREÇOS VIGENTES: x', 'Tela: /gerador, roteiro com 80 palavras')
    assert p.index('## DADOS VIVOS') < p.index('PREÇOS VIGENTES: x') < p.index('## O QUE O PRODUTOR ESTÁ VENDO AGORA')
    assert 'roteiro com 80 palavras' in p
    assert '## O QUE O PRODUTOR ESTÁ VENDO AGORA' not in app_mod.montar_prompt_voxcraft('x', '')


def test_contexto_vivo_traz_precos_vozes_e_programas(app_mod):
    app_mod._VOXCRAFT_CACHE.update(quando=0.0, texto='')
    with app_mod.app.test_request_context('/'):
        c = app_mod.voxcraft_contexto_vivo(ttl=0)
    assert 'PREÇOS VIGENTES' in c and 'Spot 30' in c and 'R$' in c
    assert 'VOZES DISPONÍVEIS' in c and 'Charon - Informative ♂' in c and 'Modo Padrão' in c
    assert 'PROGRAMAS' in c and 'Vida Saudável' in c and "'vida'" in c
    assert 'AGORA:' in c
    assert 'LMNT' not in c


def test_contexto_vivo_usa_cache(app_mod):
    with app_mod.app.test_request_context('/'):
        a = app_mod.voxcraft_contexto_vivo(ttl=300)
        b = app_mod.voxcraft_contexto_vivo(ttl=300)
    assert a is b or a == b


def test_chat_monta_o_prompt_com_dados_vivos_e_contexto_da_tela(cliente, app_mod, monkeypatch):
    capturado = {}

    def dublê(system_prompt, contents, tools=True):
        capturado['system'] = system_prompt
        capturado['n'] = len(contents)
        return {'texto': 'Spot de 30 a 45 s custa o que está na tabela.', 'chamadas': [], 'content': None}
    monkeypatch.setattr(app_mod, '_gemini_chat_turn', dublê)
    r = cliente.post('/api/voxcraft/chat', json={
        'messages': [{'role': 'assistant', 'content': 'oi'}, {'role': 'user', 'content': 'quanto custa um spot de 30s?'}],
        'contexto': 'Tela: /gerador'})
    d = r.get_json()
    assert d['success'] and d['message'].startswith('Spot de 30')
    assert 'PREÇOS VIGENTES' in capturado['system'] and 'Tela: /gerador' in capturado['system']
    assert 'Kiwify' in capturado['system'] and capturado['n'] == 2


def test_chat_corta_historico_em_20(cliente, app_mod, monkeypatch):
    capturado = {}
    monkeypatch.setattr(app_mod, '_gemini_chat_turn',
                        lambda s, c, tools=True: capturado.update(n=len(c)) or {'texto': 'ok', 'chamadas': [], 'content': None})
    msgs = [{'role': 'user' if i % 2 else 'assistant', 'content': f'm{i}'} for i in range(50)]
    cliente.post('/api/voxcraft/chat', json={'messages': msgs})
    assert capturado['n'] == 20


def test_chat_sem_ia_diz_isso_na_cara_sem_dica_inventada(cliente, app_mod, monkeypatch):
    def cai(*a, **k):
        raise RuntimeError('429 RESOURCE_EXHAUSTED')
    monkeypatch.setattr(app_mod, '_gemini_chat_turn', cai)
    d = cliente.post('/api/voxcraft/chat', json={'messages': [{'role': 'user', 'content': 'oi'}]}).get_json()
    assert d['success'] and d['ia_indisponivel']
    assert 'fora do ar' in d['message'] and '/admin' in d['message']
    assert '80%' not in d['message'] and 'Biblioteca!' not in d['message']


def test_chat_valida_entrada(cliente):
    assert cliente.post('/api/voxcraft/chat', json={}).status_code == 400
    assert cliente.post('/api/voxcraft/chat', json={'messages': []}).status_code == 400
