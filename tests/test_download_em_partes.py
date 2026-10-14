"""Gerador: "Falha ao buscar o áudio (HTTP 500)" em todo spot longo (14/10/2026).

Com o Supabase ykswh bloqueado (402, desde 30/09) a locução não sobe pro Storage e o
download cai no /api/download. A Vercel recusa resposta de função acima de 4,5 MB
(FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE = HTTP 500). WAV do Gemini = 24 kHz 16 bits mono
= 48 KB/s → acima de ~98 s de locução o download SEMPRE dá 500 (Ep.25, 91–108 s).
Conserto: o Gerador baixa o /api/download em pedaços (Range) de < 4,5 MB cada.

Rodar: pytest tests/test_download_em_partes.py -v
"""
import os
import uuid

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


@pytest.fixture(scope='module')
def app_e_cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return app, c


def test_api_download_atende_range_com_206(app_e_cliente):
    app, c = app_e_cliente
    nome = f"locution_{uuid.uuid4().hex[:8]}_20261014_120000.wav"
    caminho = os.path.join(app.config['UPLOAD_FOLDER'], nome)
    dados = bytes(range(256)) * 40          # 10 240 bytes
    with open(caminho, 'wb') as f:
        f.write(dados)
    try:
        r = c.get(f'/api/download/{nome}', headers={'Range': 'bytes=0-4095'})
        assert r.status_code == 206
        assert r.headers['Content-Range'] == f'bytes 0-4095/{len(dados)}'
        assert r.data == dados[:4096]
        r2 = c.get(f'/api/download/{nome}', headers={'Range': 'bytes=8192-12287'})
        assert r2.status_code == 206
        assert r2.data == dados[8192:]       # último pedaço vem truncado no fim do arquivo
        r.close()
        r2.close()                           # Windows não apaga arquivo com handle aberto
    finally:
        os.remove(caminho)


def test_gerador_baixa_api_download_em_pedacos_abaixo_do_limite_da_vercel():
    js = _ler('static', 'gerador.js')
    trecho = js[js.index('async function baixarEDecodificar(url)'):js.index('// Monta uma faixa no formato')]
    assert "url.startsWith('/api/download/')" in trecho
    assert "'Range'" in trecho and 'Content-Range' in trecho
    assert 'PEDACO_DOWNLOAD = 4 * 1000 * 1000' in js           # < 4,5 MB da Vercel, com folga
    assert 'Falha ao buscar o áudio (HTTP ${r.status})' in trecho   # erro claro continua


def test_gerador_js_com_versao_nova_no_template():
    assert '/static/gerador.js?v=33' in _ler('templates', 'gerador.html')
