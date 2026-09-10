"""Spots guardados do Gerador: caminho no Storage, par .txt (roteiro) e listagem pareada.

Rodar: pytest tests/test_rascunhos.py -v

Só as funções puras — as rotas falam com o Storage e são conferidas à mão.
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from backend.app import _caminho_rascunho, montar_itens_rascunhos

AGORA = datetime(2026, 9, 9, 13, 23, 5)


def test_caminho_do_audio_leva_carimbo_e_nome():
    assert _caminho_rascunho('Vida-Saudavel-episodio-4.mp3', agora=AGORA) == 'rascunhos/20260909-132305_Vida-Saudavel-episodio-4.mp3'


def test_caminho_sanitiza_e_permite_ate_90():
    longo = 'a' * 120 + '.mp3'
    assert _caminho_rascunho(longo, agora=AGORA) == 'rascunhos/20260909-132305_' + 'a' * 90 + '.mp3'
    assert _caminho_rascunho('  ../x y!.mp3', agora=AGORA) == 'rascunhos/20260909-132305_x-y.mp3'
    assert _caminho_rascunho('!!!.mp3', agora=AGORA) == 'rascunhos/20260909-132305_spot.mp3'


def test_par_txt_ganha_o_mesmo_nome_do_audio():
    assert _caminho_rascunho('qualquer.txt', twin_of='rascunhos/20260909-132305_Vida-Saudavel-4.mp3') == \
        'rascunhos/20260909-132305_Vida-Saudavel-4.txt'


@pytest.mark.parametrize('twin', [
    'entregas/x.mp3', 'rascunhos/../x.mp3', 'rascunhos/x.txt', 'rascunhos/sub/x.mp3', 'x.mp3', 'rascunhos/x y.mp3',
])
def test_par_recusa_caminho_forjado(twin):
    with pytest.raises(ValueError):
        _caminho_rascunho('r.txt', twin_of=twin)


def test_par_so_pode_ser_txt():
    with pytest.raises(ValueError):
        _caminho_rascunho('r.mp3', twin_of='rascunhos/20260909-132305_x.mp3')


def test_listagem_pareia_txt_e_esconde_o_txt():
    arquivos = [
        {'name': '.emptyFolderPlaceholder'},
        {'name': '20260910-101500_Prefeitura-do-Crato-base.txt', 'metadata': {'size': 2}},   # bancada sem áudio
        {'name': '20260909-132305_Vida-Saudavel-episodio-4-Pressao-alta.mp3', 'metadata': {'size': 10}},
        {'name': '20260909-132305_Vida-Saudavel-episodio-4-Pressao-alta.txt', 'metadata': {'size': 1}},
        {'name': '20260909-125100_Epis-dio-3---Mais-cor.mp3', 'metadata': {'size': 20}},
        {'name': 'sem-carimbo.wav'},
        {'name': 'foto.png'},
    ]
    itens = montar_itens_rascunhos(arquivos)
    assert [i['arquivo'] for i in itens] == [
        '20260910-101500_Prefeitura-do-Crato-base.txt',
        '20260909-132305_Vida-Saudavel-episodio-4-Pressao-alta.mp3',
        '20260909-125100_Epis-dio-3---Mais-cor.mp3',
        'sem-carimbo.wav',
    ]
    bancada, ep4, ep3, wav = itens
    assert bancada['tipo'] == 'texto' and bancada['texto_path'] == 'rascunhos/' + bancada['arquivo']
    assert bancada['titulo'] == 'Prefeitura do Crato base' and bancada['quando'] == '10/09/2026 10:15'
    assert ep4['tipo'] == 'audio' and ep4['texto_path'] == 'rascunhos/20260909-132305_Vida-Saudavel-episodio-4-Pressao-alta.txt'
    assert ep4['titulo'] == 'Vida Saudavel episodio 4 Pressao alta' and ep4['quando'] == '09/09/2026 13:23'
    assert ep4['tamanho'] == 10 and ep4['path'] == 'rascunhos/' + ep4['arquivo']
    assert ep3['texto_path'] is None and ep3['titulo'] == 'Epis dio 3 Mais cor'
    assert wav['tipo'] == 'audio' and wav['titulo'] == 'sem carimbo' and wav['quando'] == ''


def test_listagem_respeita_o_limite_de_audios():
    arquivos = [{'name': f'2026090{i}-000000_s{i}.mp3'} for i in range(1, 6)]
    assert len(montar_itens_rascunhos(arquivos, limite=2)) == 2
