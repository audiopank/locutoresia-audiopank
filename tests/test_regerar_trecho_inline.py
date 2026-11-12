"""🔁 Regerar trecho (05/11/2026): a fala nova volta DIRETO na resposta, sem passar pelo Supabase.

Pedido dele: "tudo precisa ser guardado no SALVAR NO PC pra não sufocar o Supabase".
Com `entrega: 'inline'`, o /api/generate-audio devolve o áudio em base64 e NÃO sobe a
cópia em locucoes/. Sem o campo, o caminho de sempre (URL assinada do Storage) fica igual.

Rodar: pytest tests/test_regerar_trecho_inline.py -v
"""
import base64
import sys
import types

import pytest

WAV = b'RIFF' + b'\x00' * 40 + b'fala-nova'


class _StorageQueAnota:
    def __init__(self):
        self.subiu = []

    def upload(self, caminho, dados, opcoes=None):
        self.subiu.append(caminho)

    def create_signed_url(self, caminho, validade):
        return {'signedURL': 'https://x.supabase.co/assinada?token=1'}

    def list(self, *a, **k):
        return []

    def remove(self, *a, **k):
        pass


class _Supabase:
    def __init__(self, storage):
        cliente = types.SimpleNamespace(storage=types.SimpleNamespace(from_=lambda balde: storage))
        self.newpost_manager_client = cliente

    def log_usage_event(self, *a, **k):
        pass


class _Tracker:
    def start_job(self, *a, **k):
        return {'id': 'job'}

    def complete_job(self, *a, **k):
        pass

    def fail_job(self, *a, **k):
        pass


@pytest.fixture
def app_falso(monkeypatch):
    import backend.app as m
    falso = types.ModuleType('tts_generator')

    class TTSGenerator:
        def generate_speech(self, **k):
            return falso.saida
    falso.TTSGenerator = TTSGenerator
    falso.saida = WAV
    monkeypatch.setitem(sys.modules, 'tts_generator', falso)
    storage = _StorageQueAnota()
    monkeypatch.setattr(m, 'supabase_manager', _Supabase(storage))
    monkeypatch.setattr(m, 'operation_tracker', _Tracker())
    m._ULTIMA_FAXINA_LOCUCOES = 1e18      # faxina não entra no teste
    return m, storage, falso


def _pedido(**extra):
    return dict({'text': 'Sil-vés-tre Ar-rú-da', 'voice': 'Callirrhoe', 'style': 'cheerful',
                 'language': 'pt-BR', 'provider': 'gemini'}, **extra)


def test_inline_devolve_o_audio_e_nao_toca_no_supabase(app_falso):
    m, storage, _ = app_falso
    resp, status = m.run_audio_generation(_pedido(entrega='inline'))
    assert status == 200, resp
    assert base64.b64decode(resp['audio_base64']) == WAV
    assert resp['mime'] == 'audio/wav'
    assert 'download_url' not in resp
    assert storage.subiu == []


def test_inline_recusa_audio_grande_demais(app_falso):
    m, storage, falso = app_falso
    falso.saida = b'RIFF' + b'\x00' * 3_600_000
    resp, status = m.run_audio_generation(_pedido(entrega='inline'))
    assert status == 413
    assert 'frase' in resp['error']
    assert storage.subiu == []


def test_sem_inline_o_caminho_de_sempre_continua(app_falso):
    m, storage, _ = app_falso
    resp, status = m.run_audio_generation(_pedido())
    assert status == 200, resp
    assert resp['download_url'].startswith('https://x.supabase.co/assinada')
    assert len(storage.subiu) == 1 and storage.subiu[0].startswith('locucoes/')
    assert 'audio_base64' not in resp


def test_studio_guarda_voz_e_estilo_junto_do_roteiro():
    import os
    js = open(os.path.join(os.path.dirname(__file__), '..', 'static', 'script.js'), encoding='utf-8').read()
    i_rot = js.index("localStorage.setItem('minidaw_pending_roteiro'")
    i_ult = js.index("localStorage.setItem('minidaw_ultima_geracao'")
    assert 0 < i_ult - i_rot < 400                 # gravado no mesmo ponto (depois que a voz saiu)
    assert "body: JSON.stringify(Object.assign({ text }, pedidoTts))" in js   # o MESMO pedido que foi pro TTS


def test_minidaw_classica_tem_o_botao_a_tecla_g_e_carrega_o_modulo():
    import os
    raiz = os.path.join(os.path.dirname(__file__), '..')
    js = open(os.path.join(raiz, 'static', 'minidaw.js'), encoding='utf-8').read()
    html = open(os.path.join(raiz, 'templates', 'minidaw.html'), encoding='utf-8').read()
    # botão só em faixa de VOZ: mora dentro do mesmo bloco do Silenciar/Vários
    bloco = js[js.index("${track.type === 'voice' ? `<button class=\"btn btn-sm btn-warning\" id=\"btnsilenciar_"):]
    bloco = bloco[:bloco.index("` : ''}")]
    assert "RegerarTrecho.abrir('${track.id}')" in bloco
    assert "k === 'g'" in js and "window.RegerarTrecho.abrir(this.trackTesoura)" in js
    # depois do clip-model, do alinhar-falas e do minidaw (usa os três)
    assert html.index('/static/alinhar-falas.js') < html.index('/static/minidaw.js?v=89') < html.index('/static/regerar-trecho.js?v=2')
    assert html.index('/static/clip-model.js') < html.index('/static/regerar-trecho.js')
