"""Salvar Projeto NUNCA pode cair em cima de outro trabalho (bug de 17/09/2026).

O id do último projeto salvo/aberto ficava grudado na sessão da MiniDAW: ele salvou o spot
"Inauguração Areninha", montou o "Dia D de vacinação" com outro nome, salvou — e a MESMA linha
foi sobrescrita. Trabalho de cliente perdido. Trava dupla: tela (só manda o id se o nome bate)
e servidor (nome diferente do guardado = projeto novo).

Rodar: pytest tests/test_projeto_nao_sobrescreve.py -v  (grava e apaga linhas reais).
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


def test_servidor_nao_sobrescreve_projeto_com_outro_nome(cliente):
    carimbo = int(time.time())
    nome_a, nome_b = f'TESTE areninha apagar {carimbo}', f'TESTE vacinacao apagar {carimbo}'
    criados = []
    try:
        a = cliente.post('/api/projects', json={'name': nome_a, 'tracks': [{'name': 'voz areninha'}]}).get_json()
        assert a['success']
        id_a = a['project']['id']
        criados.append(id_a)
        # A tela velha (bug) manda o id do projeto A com o nome e o conteúdo do B:
        b = cliente.post('/api/projects', json={'id': id_a, 'name': nome_b, 'tracks': [{'name': 'voz vacinacao'}]}).get_json()
        assert b['success'] and b['preservado'] == nome_a
        id_b = b['project']['id']
        criados.append(id_b)
        assert id_b != id_a                                                    # nasceu projeto NOVO
        lido_a = cliente.get(f'/api/projects/{id_a}').get_json()['project']
        assert lido_a['name'] == nome_a and lido_a['tracks'][0]['name'] == 'voz areninha'     # o A ficou INTACTO
        assert cliente.get(f'/api/projects/{id_b}').get_json()['project']['tracks'][0]['name'] == 'voz vacinacao'
        # Mesmo nome + mesmo id = atualização normal (salvar de novo o mesmo trabalho)
        a2 = cliente.post('/api/projects', json={'id': id_a, 'name': nome_a, 'tracks': [{'name': 'voz areninha v2'}]}).get_json()
        assert a2['success'] and a2['project']['id'] == id_a and a2['preservado'] is None
        assert cliente.get(f'/api/projects/{id_a}').get_json()['project']['tracks'][0]['name'] == 'voz areninha v2'
    finally:
        for pid in criados:
            cliente.delete(f'/api/projects/{pid}')


def test_tela_so_manda_o_id_quando_o_nome_e_o_mesmo():
    js = _ler('static', 'minidaw.js')
    assert "const atualizar = !!this.projetoId && nome.trim() === String(this.projetoNome || '').trim();" in js
    assert "if (atualizar) body.id = this.projetoId;" in js
    assert "if (this.projetoId) body.id = this.projetoId;" not in js                 # a linha do bug saiu
    limpar = js[js.index("    clearAllTracks(skipConfirm = false) {"):js.index("        // Show empty state")]
    assert "this.projetoId = null;" in limpar and "this.projetoNome = null;" in limpar   # bancada limpa = trabalho novo
    abrir = js[js.index("    async carregarProjetoSupabase(id) {"):]
    assert abrir.index("this.clearAllTracks(true);") < abrir.index("this.projetoId = proj.id;")   # abrir: limpa ANTES de vincular


def test_lista_mostra_hora_de_brasilia():
    js = _ler('static', 'minidaw.js')
    assert "_dataHoraBrasil(iso) {" in js and "timeZone: 'America/Fortaleza'" in js
    assert "${this._dataHoraBrasil(p.updated_at)}" in js
    assert ".slice(0,16).replace('T',' ')}</div>" not in js                          # o UTC cru saiu da lista


def test_versao(cliente):
    assert 'minidaw.js?v=63' in cliente.get('/minidaw').get_data(as_text=True)


def test_lista_de_projetos_mostra_o_titulo_inteiro():
    """17/09/2026: o painel tinha 520px e cortava o nome dos jobs com reticências."""
    js = _ler('static', 'minidaw.js')
    assert "max-width:min(980px,94vw)" in js and "max-width:520px" not in js
    assert "white-space:normal;overflow-wrap:anywhere" in js
    assert "text-overflow:ellipsis;\">${esc(p.name)}" not in js
