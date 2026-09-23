"""Conta "Achadinhos" no feed da NewPost-IA (23/09/2026) + post de vídeo só com a narração.

O áudio pra vídeo do Achadinhos saiu assinado por LOCUTORES IA porque a conta não existia. Agora existe
(achadinhos@gmail.com), com credenciais próprias no ambiente (NEWPOST_FEED_EMAIL_ACHADINHOS /
NEWPOST_FEED_SENHA_ACHADINHOS). Sem elas o publicar RECUSA e diz o que falta — nunca assina com o
perfil errado. Texto em cenas ("CENA n", "[Ambiente: …]") vai pro feed só com a narração — a tela manda
limpo e o SERVIDOR garante (o 2º post saiu com as marcações porque o spot foi reaberto dos guardados).

Rodar: pytest tests/test_conta_achadinhos.py -v
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_conta_existe_com_variaveis_proprias_e_tags():
    from core import newpost_feed as nf
    assert nf.CONTAS['achadinhos'] == ('NEWPOST_FEED_EMAIL_ACHADINHOS', 'NEWPOST_FEED_SENHA_ACHADINHOS')
    assert nf.tags_da_conta('achadinhos') == ['Achadinhos', 'Ofertas']
    assert nf.tags_da_conta('locutores') == ['LocutoresIA', 'Spot']          # as outras não mudaram


def test_publicar_recusa_sem_credenciais_em_vez_de_assinar_errado(monkeypatch):
    monkeypatch.delenv('NEWPOST_FEED_EMAIL_ACHADINHOS', raising=False)
    monkeypatch.delenv('NEWPOST_FEED_SENHA_ACHADINHOS', raising=False)
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    r = c.post('/api/gerador/publicar-feed', json={'conta': 'achadinhos', 'nome': 'x', 'texto': 'y', 'audio_base64': 'AAAA'})
    assert r.status_code == 400
    erro = r.get_json()['error']
    assert 'NEWPOST_FEED_EMAIL_ACHADINHOS' in erro and 'NEWPOST_FEED_SENHA_ACHADINHOS' in erro
    assert c.post('/api/gerador/publicar-feed', json={'conta': 'inexistente'}).status_code == 400


def test_servidor_tira_as_marcacoes_de_cena_do_texto_do_post():
    """23/09: saiu 'CENA 1 — … [Ambiente: …]' no feed do Achadinhos (spot reaberto). O servidor garante."""
    from backend.app import narracao_para_feed
    txt = ('CENA 1 — Achadinhos Chegam!\nQue tal os melhores achadinhos?\n[Ambiente: trilha animada; notificação.]\n\n'
           'CENA 2 — Comunidade\nChegou a comunidade oficial.')
    assert narracao_para_feed(txt) == 'Que tal os melhores achadinhos?\n\nChegou a comunidade oficial.'
    assert narracao_para_feed('Texto normal de spot.\n\nSegundo parágrafo.') == 'Texto normal de spot.\n\nSegundo parágrafo.'
    assert narracao_para_feed(None) == ''
    app_py = _ler('backend', 'app.py')
    assert "texto = narracao_para_feed(data.get('texto'))" in app_py           # na rota de publicar


def test_tela_tem_a_conta_e_manda_so_a_narracao():
    html = _ler('templates', 'gerador.html')
    assert '<option value="achadinhos">Achadinhos</option>' in html and 'gerador.js?v=28' in html
    js = _ler('static', 'gerador.js')
    assert "achadinhos: 'Achadinhos'" in js
    assert "texto: textoParaFeed(document.getElementById('textoComercial').value || '')," in js
    assert "function textoParaFeed(texto) {" in js and "if (!RE_CENA.test(t)) return t;" in js
