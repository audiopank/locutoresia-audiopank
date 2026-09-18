"""Tela inicial gerava "áudio vazio" (18/09/2026): não era cota, era a URL assinada + "?t=".

Desde 11/09 (commit 86e54a0) o /api/generate-audio devolve `download_url` como URL ASSINADA do
Storage (já com "?token=..."). A tela inicial (static/script.js) e a de vozes clonadas colavam
"?t=<hora>" no fim pra evitar cache: a assinatura quebrava, o Storage respondia
400 {"code":"InvalidJWT"} em JSON, e o player recebia esse JSON como se fosse som (0:00).
Gerador, Narrativa e Entregas usam a URL como vem e nunca quebraram — por isso os episódios
continuaram saindo. Provado em 18/09: mesma URL, 200/273 KB sem "?t=", 400 com "?t=", 200 com "&t=".

Rodar: pytest tests/test_download_url_assinada.py -v
"""
import os
import re

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_ninguem_cola_interrogacao_numa_url_que_ja_tem():
    for arq in (('static', 'script.js'), ('templates', 'cloned-voices.html'), ('static', 'gerador.js'),
                ('static', 'narrativa.js'), ('static', 'minidaw-react-app.js'), ('templates', 'entregas-clientes.html')):
        txt = _ler(*arq)
        # A forma antiga era a atribuição DIRETA (sem o guarda do includes('?')).
        assert "= result.download_url + '?t='" not in txt, arq
        assert 'download_url + "?t="' not in txt, arq
    js = _ler('static', 'script.js')
    assert "result.download_url.includes('?')" in js
    assert "? result.download_url" in js and ": result.download_url + '?t=' + Date.now();" in js   # /api/download (sem query) ainda ganha anti-cache
    assert "result.download_url.includes('?') ? result.download_url : result.download_url + '?t=' + Date.now();" in _ler('templates', 'cloned-voices.html')


def test_tela_inicial_nao_toca_erro_como_audio():
    js = _ler('static', 'script.js')
    trecho = js[js.index("const audioResponse = await fetch(audioUrl);"):js.index("audioPlayer.load();")]
    assert "if (!audioResponse.ok) throw new Error(" in trecho
    assert "tipoAudio.includes('json') || tipoAudio.includes('text/html')" in trecho
    assert "if (!lastGeneratedAudioBlob.size) throw new Error('O áudio veio vazio.');" in trecho
    assert "catch (blobError)" not in trecho                                    # o "cai pro src cru" que escondia o erro saiu


def test_backend_devolve_url_assinada_com_token_ou_fallback_local():
    app = _ler('backend', 'app.py')
    assert "_assinada = _storage.create_signed_url(_caminho, 24 * 3600)" in app
    assert "download_url = f'/api/download/{filename}'" in app                  # fallback quando o Storage falha


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_versao_do_script_subiu(cliente):
    assert 'script.js?v=7' in cliente.get('/').get_data(as_text=True)
