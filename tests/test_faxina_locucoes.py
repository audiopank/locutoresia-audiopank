"""Faxina automática de locucoes/ (13/10/2026).

Cada voz gerada deixava uma cópia em locucoes/ só pro link de download de 24 h — e
nunca apagava (148 MB em ~2,5 meses; ajudou a estourar a cota do Storage). Agora,
depois de subir uma locução nova, apaga as cópias com mais de 2 dias. No máximo uma
vez por hora por instância, só arquivos com o nome que a própria geração cria, e
falha aqui nunca derruba a geração.

Rodar: pytest tests/test_faxina_locucoes.py -v
"""
from datetime import datetime, timedelta, timezone


class _StorageFalso:
    def __init__(self, arquivos, falha=False):
        self.arquivos, self.falha, self.removidos, self.listou = arquivos, falha, [], 0

    def list(self, pasta, opcoes=None):
        self.listou += 1
        if self.falha:
            raise RuntimeError('402')
        assert pasta == 'locucoes'
        return self.arquivos

    def remove(self, caminhos):
        self.removidos.extend(caminhos)


def _quando(dias):
    return (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()


def _app():
    import backend.app as m
    m._ULTIMA_FAXINA_LOCUCOES = 0.0
    return m


def test_apaga_so_copias_com_mais_de_2_dias():
    m = _app()
    st = _StorageFalso([
        {'name': 'locution_ab12cd34_20260801_101010.wav', 'created_at': _quando(30)},
        {'name': 'locution_ef56ab78_20261010_090000.wav', 'created_at': _quando(3)},
        {'name': 'locution_0011aabb_20261013_080000.wav', 'created_at': _quando(0.5)},   # nova: fica
        {'name': 'outra-coisa.wav', 'created_at': _quando(30)},                           # nome estranho: fica
        {'name': '.emptyFolderPlaceholder', 'created_at': _quando(30)},
    ])
    assert m._faxinar_locucoes(st) == 2
    assert st.removidos == ['locucoes/locution_ab12cd34_20260801_101010.wav',
                            'locucoes/locution_ef56ab78_20261010_090000.wav']


def test_no_maximo_uma_vez_por_hora():
    m = _app()
    st = _StorageFalso([])
    m._faxinar_locucoes(st)
    m._faxinar_locucoes(st)
    assert st.listou == 1


def test_falha_no_storage_nao_quebra_nada():
    m = _app()
    assert m._faxinar_locucoes(_StorageFalso([], falha=True)) == 0


def test_geracao_chama_a_faxina_depois_do_upload():
    src = open('backend/app.py', encoding='utf-8').read()
    ini = src.index('def run_audio_generation(')
    corpo = src[ini:src.index('\ndef ', ini + 10)]
    assert corpo.index('_storage.upload(_caminho') < corpo.index('_faxinar_locucoes(_storage)')
