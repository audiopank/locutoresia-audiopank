"""Salvar Projeto reaproveita o áudio que já está no Storage (30/09/2026).

O Supabase do Locutores IA foi BLOQUEADO por estourar a cota de arquivos (2,4 GB num
plano de 1 GB); a pasta projetos/ tinha 1,95 GB em 242 arquivos. Causa: cada Salvar
Projeto reenviava, em WAV e com nome novo, todo áudio que não era da Biblioteca — até
o projeto que acabou de ser reaberto (URL assinada não é "estável"). A versão anterior
ficava órfã. Agora cada áudio lembra de onde veio (`_audioPath` / `_audioUrlDireto`) e
só sobe uma vez. Como "Salvar com outro nome" passa a COMPARTILHAR arquivos entre
projetos, apagar um projeto só leva do Storage o que nenhum outro usa.

Rodar: pytest tests/test_projeto_reaproveita_audio.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_reabrir_marca_cada_audio_com_a_origem_no_storage():
    js = _ler('static', 'minidaw.js')
    assert 'ab._audioPath = b.audio_path || undefined;' in js
    assert 'ab._audioUrlDireto = b.audio_url_direct || undefined;' in js


def test_salvar_reaproveita_e_so_sobe_audio_novo():
    js = _ler('static', 'minidaw.js')
    ini = js.index('    async salvarProjetoSupabase() {')
    bloco = js[ini:js.index('\n    }\n', ini)]
    # Reaproveitar vem ANTES de qualquer upload (guardarNaNuvem, 30/09/2026).
    assert bloco.index('if (c.buffer._audioPath) {') < bloco.index('await this._uploadAudioProjeto(wav)')
    assert 'return { audio_path: c.buffer._audioPath };' in bloco
    assert 'return { audio_url_direct: c.buffer._audioUrlDireto };' in bloco
    # O que subiu agora fica marcado: o 2º Salvar da mesma sessão não reenvia.
    assert 'c.buffer._audioPath = caminho;' in bloco


def test_apagar_projeto_so_leva_arquivo_que_nenhum_outro_usa():
    from backend.app import _caminhos_so_deste_projeto
    deste = [
        {'buffers': [{'audio_path': 'projetos/a.wav'}, {'audio_path': 'projetos/b.wav'},
                     {'audio_url_direct': 'https://x/object/public/music-tracks/t.mp3'}]},
        {'audio_path': 'projetos/antigo.wav'},
        {'buffers': [{'audio_path': 'projetos/a.wav'}]},          # repetido no mesmo projeto
    ]
    outros = [
        [{'buffers': [{'audio_path': 'projetos/b.wav'}]}],         # "Salvar com outro nome" compartilhou
        [{'audio_path': 'projetos/zzz.wav'}],
        None,
    ]
    assert _caminhos_so_deste_projeto(deste, outros) == ['projetos/a.wav', 'projetos/antigo.wav']
    assert _caminhos_so_deste_projeto(deste, []) == ['projetos/a.wav', 'projetos/b.wav', 'projetos/antigo.wav']
    assert _caminhos_so_deste_projeto(None, outros) == []


def test_rota_de_apagar_confere_os_outros_projetos_e_na_duvida_nao_apaga():
    app_py = _ler('backend', 'app.py')
    inicio = app_py.index("def delete_vip_project(project_id):")
    rota = app_py[inicio:inicio + 3500]
    assert ".select('tracks').neq('id', project_id)" in rota
    assert '_caminhos_so_deste_projeto(' in rota
    # Se a lista dos outros vier cortada (limite de 1000 linhas do PostgREST), não apaga nada.
    assert 'if len(outros_dados) >= 1000:' in rota
    assert 'remove(paths)' in rota


def test_versao_nova_do_script_na_pagina():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    assert 'minidaw.js?v=80' in c.get('/minidaw').get_data(as_text=True)
