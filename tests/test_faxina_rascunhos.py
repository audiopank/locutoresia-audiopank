"""Faxina automática das cópias dos spots em rascunhos/ (29/10/2026, pedido dele).

Depois da faxina grande do Storage (29/10), a pergunta dele: "as cópias dos spots
não vão lotar o Supabase de novo?". Decisão dele: cópia de spot com mais de 60 dias
se apaga sozinha — o ÁUDIO e o roteiro gêmeo (.txt de mesmo nome). O .txt SOZINHO é
a "bancada guardada" (preset do cliente, 10/09/2026) e NUNCA sai. Roda quando uma
cópia nova é guardada, no máximo 1x por hora por instância, e nunca derruba nada.

Rodar: pytest tests/test_faxina_rascunhos.py -v
"""
from datetime import datetime, timedelta, timezone


class _StorageFalso:
    def __init__(self, arquivos, falha=False):
        self.arquivos, self.falha, self.removidos, self.listou = arquivos, falha, [], 0

    def list(self, pasta, opcoes=None):
        self.listou += 1
        if self.falha:
            raise RuntimeError('402')
        assert pasta == 'rascunhos'
        return self.arquivos

    def remove(self, caminhos):
        self.removidos.extend(caminhos)


def _quando(dias):
    return (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()


def _app():
    import backend.app as m
    m._ULTIMA_FAXINA_RASCUNHOS = 0.0
    return m


def test_apaga_audio_velho_e_o_roteiro_gemeo_mas_nunca_a_bancada_guardada():
    m = _app()
    st = _StorageFalso([
        {'name': '20260801-101010_spot-padaria.mp3', 'created_at': _quando(89)},   # velho: sai
        {'name': '20260801-101010_spot-padaria.txt', 'created_at': _quando(89)},   # roteiro dele: sai junto
        {'name': '20260802-090000_Vida-Saudavel-ep-3.wav', 'created_at': _quando(88)},  # velho sem .txt: sai
        {'name': '20261020-080000_spot-novo.mp3', 'created_at': _quando(9)},       # novo: fica
        {'name': '20261020-080000_spot-novo.txt', 'created_at': _quando(9)},       # roteiro do novo: fica
        {'name': '20260705-120000_preset-Crato.txt', 'created_at': _quando(116)},  # bancada guardada: FICA
        {'name': 'qualquer-coisa.mp3', 'created_at': _quando(200)},                # nome estranho: fica
        {'name': '.emptyFolderPlaceholder', 'created_at': _quando(200)},
    ])
    assert m._faxinar_rascunhos(st) == 2
    assert sorted(st.removidos) == sorted([
        'rascunhos/20260801-101010_spot-padaria.mp3',
        'rascunhos/20260801-101010_spot-padaria.txt',
        'rascunhos/20260802-090000_Vida-Saudavel-ep-3.wav',
    ])


def test_sem_created_at_usa_a_data_do_nome():
    m = _app()
    st = _StorageFalso([{'name': '20200101-000000_antigo.mp3'}, {'name': '29991231-000000_futuro.mp3'}])
    assert m._faxinar_rascunhos(st) == 1
    assert st.removidos == ['rascunhos/20200101-000000_antigo.mp3']


def test_no_maximo_uma_vez_por_hora():
    m = _app()
    st = _StorageFalso([])
    m._faxinar_rascunhos(st)
    m._faxinar_rascunhos(st)
    assert st.listou == 1


def test_falha_no_storage_nao_quebra_nada():
    m = _app()
    assert m._faxinar_rascunhos(_StorageFalso([], falha=True)) == 0


def test_guardar_copia_nova_chama_a_faxina():
    src = open('backend/app.py', encoding='utf-8').read()
    ini = src.index("if kind == 'rascunho':")
    trecho = src[ini:ini + 900]
    assert '_faxinar_rascunhos(' in trecho
