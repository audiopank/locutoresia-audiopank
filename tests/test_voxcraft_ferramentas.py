"""VoxCraft níveis 2 e 3 (10/09/2026): diagnóstico calculado e ferramentas de ação.

Rodar: pytest tests/test_voxcraft_ferramentas.py -v
O Gemini entra como dublê (_gemini_chat_turn e _escrever_miolo_com_ia); as views reais rodam por dentro.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest


@pytest.fixture(scope='module')
def m():
    import backend.app as mod
    mod.app.config['TESTING'] = True
    return mod


@pytest.fixture(autouse=True)
def sem_chave_do_gemini(monkeypatch):
    # Teste que esquecer o dublê falha com "sem GEMINI_API_KEY" em vez de gastar
    # a cota de 20 chamadas/dia (aconteceu em 10/09/2026).
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)


@pytest.fixture
def cliente(m):
    c = m.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


# ── diagnóstico ──────────────────────────────────────────────────────────────

def test_estimativa_fala_espelha_a_tela(m):
    e = m._estimativa_fala(' '.join(['p'] * 100))
    assert e['palavras'] == 100
    assert e['fala_min_s'] == round(100 / 2.55, 1) and e['fala_max_s'] == round(100 / 2.15, 1)
    assert e['arquivo_min_s'] == round(100 / 2.55 + 3.05, 1)


def test_diagnostico_estoura_a_grade(m):
    with m.app.test_request_context('/'):
        t = m.voxcraft_diagnostico({'tela': '/gerador', 'plano': 'spot_30_45', 'voz': 'Charon',
                                    'roteiro': ' '.join(['palavra'] * 140)})
    assert 'Tela: /gerador' in t and 'Voz: Charon' in t
    assert '140 palavras' in t and 'VEREDITO: ESTOURA' in t and 'cortar ~' in t
    assert '--- ROTEIRO ATUAL ---' in t


def test_diagnostico_dentro_da_grade_e_frase_legal(m):
    with m.app.test_request_context('/'):
        t = m.voxcraft_diagnostico({'tela': '/gerador', 'plano': 'spot_30_45',
                                    'roteiro': 'Farmácia Boa Saúde, o remédio certo pra você. ' + ' '.join(['x'] * 60)})
    assert 'VEREDITO' in t and 'Checagem:' in t


def test_diagnostico_miolo_do_programa_e_faixas(m):
    with m.app.test_request_context('/'):
        t = m.voxcraft_diagnostico({'tela': '/gerador', 'programa': 'vida', 'miolo': 'Tome dois comprimidos. ' + ' '.join(['x'] * 50),
                                    'faixas': [{'nome': 'Locução', 'duracao': 88.2}, {'nome': 'Trilha', 'duracao': 120, 'mudo': True}]})
    assert 'Miolo do programa: 53 palavras (alvo 135–165) — FORA DO ALVO' in t
    assert 'Editorial:' in t and 'comprimidos' in t
    assert 'Faixas na MiniDAW: Locução (88.2 s); Trilha (120.0 s, mudo)' in t


def test_montar_prompt_com_dict_leva_o_diagnostico(m):
    with m.app.test_request_context('/'):
        p = m.montar_prompt_voxcraft('VIVO', {'tela': '/gerador', 'roteiro': 'oi tudo bem', 'plano': 'outro'})
    assert 'DIAGNÓSTICO CALCULADO' in p and '3 palavras' in p
    assert 'O QUE O PRODUTOR ESTÁ VENDO AGORA' in m.montar_prompt_voxcraft('VIVO', 'texto livre')


# ── ferramentas ──────────────────────────────────────────────────────────────

def test_ferramenta_montar_episodio_reusa_a_view_e_devolve_acao(m, monkeypatch):
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', lambda pid, tema, patrocinador='': (' '.join(['ia'] * 145), 'gancho'))
    with m.app.test_request_context('/'):
        r, acao = m._executar_ferramenta('montar_episodio', {'programa': 'vida', 'tema': 'hidratação', 'episodio': 5, 'patrocinador': 'Farmácia X'})
    assert r['success'] and r['roteiro'].startswith('Vida Saudável, um minuto e meio por dia sobre saúde e bem-estar. Episódio cinco.')
    assert 'Um oferecimento de Farmácia X.' in r['roteiro']
    assert acao['tipo'] == 'abrir_gerador' and acao['campos']['programa'] == 'vida' and acao['campos']['episodio'] == 5
    assert acao['campos']['nome'] == 'Vida Saudável, episódio 5: hidratação' and acao['campos']['texto_pronto'] is True


def test_ferramenta_montar_episodio_le_o_proximo_da_serie(m, monkeypatch):
    import core.newpost_feed as nf
    monkeypatch.setattr(nf, 'proximo_episodio', lambda conta: 7)
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', lambda *a, **k: (' '.join(['ia'] * 140), ''))
    with m.app.test_request_context('/'):
        r, acao = m._executar_ferramenta('montar_episodio', {'programa': 'vida', 'tema': 'sono'})
    assert r['success'] and 'Episódio sete.' in r['roteiro'] and acao['campos']['episodio'] == 7


def test_ferramenta_montar_episodio_sem_serie_pede_o_numero(m, monkeypatch):
    import core.newpost_feed as nf
    monkeypatch.setattr(nf, 'proximo_episodio', lambda conta: None)
    with m.app.test_request_context('/'):
        r, acao = m._executar_ferramenta('montar_episodio', {'programa': 'vida', 'tema': 'sono'})
    assert not r['success'] and 'número' in r['error'] and acao is None


def test_ferramenta_escrever_roteiro_spot(m, monkeypatch):
    def fake_view(view, data):
        assert view is m.gerador_roteiro and data['plano'] == 'spot_30_45' and data['formato'] == 'unico'
        return {'success': True, 'fonte': 'ia', 'roteiro': ' '.join(['spot'] * 70)}, 200
    monkeypatch.setattr(m, '_chamar_view_json', fake_view)
    r, acao = m._executar_ferramenta('escrever_roteiro_spot', {'briefing': 'Prefeitura do Crato, festa da cidade'})
    assert r['success'] and r['estimativa']['palavras'] == 70
    assert acao['campos']['roteiro'].startswith('spot') and acao['campos']['plano'] == 'spot_30_45' and acao['campos']['texto_pronto']


def test_ferramenta_checar_roteiro(m):
    with m.app.test_request_context('/'):
        r, acao = m._executar_ferramenta('checar_roteiro', {'roteiro': ' '.join(['x'] * 200), 'plano': 'spot_30_45'})
    assert r['success'] and r['grade'] == [30, 45] or r['grade'] == (30, 45)
    assert r['estimativa']['palavras'] == 200 and any(a['nivel'] == 'erro' for a in r['avisos'])
    assert acao is None


def test_ferramenta_escolher_trilha_resume_e_oferece_a_primeira(m, monkeypatch):
    monkeypatch.setattr(m, '_chamar_view_json', lambda view, data: ({'success': True, 'status': 'ok', 'fonte': 'ia',
        'tracks': [{'id': 7, 'name': 'Motivation', 'genre': 'motivacional', 'motivo': 'leve'}, {'id': 8, 'name': 'Lo-fi', 'genre': 'lofi'}]}, 200))
    r, acao = m._executar_ferramenta('escolher_trilha', {'descricao': 'podcast calmo'})
    assert [t['name'] for t in r['tracks']] == ['Motivation', 'Lo-fi']
    assert acao['campos'] == {'trilha_id': 7, 'trilha_nome': 'Motivation'}


def test_ferramenta_desconhecida(m):
    r, acao = m._executar_ferramenta('publicar_no_feed', {})
    assert not r['success'] and acao is None


# ── loop e endpoint ──────────────────────────────────────────────────────────

def test_dialogo_roda_ferramenta_e_volta_texto(m, monkeypatch):
    from google.genai import types
    rodadas = []

    def turno(system, contents, tools=True):
        rodadas.append(len(contents))
        if len(rodadas) == 1:
            return {'texto': '', 'chamadas': [('checar_roteiro', {'roteiro': 'a b c', 'plano': 'outro'})],
                    'content': types.Content(role='model', parts=[types.Part.from_text(text='chamando')])}
        return {'texto': 'Seu roteiro tem 3 palavras.', 'chamadas': [], 'content': None}
    monkeypatch.setattr(m, '_gemini_chat_turn', turno)
    with m.app.test_request_context('/'):
        texto, acoes, usadas = m._voxcraft_dialogo('sys', [types.Content(role='user', parts=[types.Part.from_text(text='confere')])])
    assert texto == 'Seu roteiro tem 3 palavras.' and usadas == ['checar_roteiro'] and acoes == []
    assert rodadas == [1, 3]   # 2ª rodada leva o turno do modelo + a resposta da ferramenta


def test_endpoint_devolve_acoes_do_episodio(cliente, m, monkeypatch):
    from google.genai import types
    monkeypatch.setattr(m, '_escrever_miolo_com_ia', lambda *a, **k: (' '.join(['ia'] * 140), ''))
    estado = {'n': 0}

    def turno(system, contents, tools=True):
        estado['n'] += 1
        assert 'FERRAMENTAS' in system and 'DIAGNÓSTICO' in system
        if estado['n'] == 1:
            return {'texto': '', 'chamadas': [('montar_episodio', {'programa': 'vida', 'tema': 'hidratação', 'episodio': 5})],
                    'content': types.Content(role='model', parts=[types.Part.from_text(text='...')])}
        return {'texto': 'Episódio 5 montado. Clique em Abrir no Gerador.', 'chamadas': [], 'content': None}
    monkeypatch.setattr(m, '_gemini_chat_turn', turno)
    d = cliente.post('/api/voxcraft/chat', json={
        'messages': [{'role': 'user', 'content': 'monta o episódio 5 sobre hidratação'}],
        'contexto': {'tela': '/gerador', 'plano': 'outro'}}).get_json()
    assert d['success'] and d['ferramentas'] == ['montar_episodio']
    assert d['acoes'][0]['tipo'] == 'abrir_gerador' and d['acoes'][0]['campos']['episodio'] == 5
    assert 'Episódio cinco.' in d['acoes'][0]['campos']['roteiro']


def test_endpoint_sem_ia_continua_honesto(cliente, m, monkeypatch):
    def cai(*a, **k):
        raise RuntimeError('503 UNAVAILABLE')
    monkeypatch.setattr(m, '_gemini_chat_turn', cai)
    d = cliente.post('/api/voxcraft/chat', json={'messages': [{'role': 'user', 'content': 'oi'}]}).get_json()
    assert d['success'] and d['ia_indisponivel'] and d['acoes'] == [] and 'fora do ar' in d['message']


def test_prompt_tem_secao_de_ferramentas_e_nao_promete_publicar(m):
    p = m.VOXCRAFT_SYSTEM_PROMPT
    assert '## FERRAMENTAS' in p and 'montar_episodio' in p and 'escolher_trilha' in p
    assert 'Nunca diga que gerou, enviou ou publicou' in p
    assert 'AINDA não executa' not in p
