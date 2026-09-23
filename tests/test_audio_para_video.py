"""Áudio para vídeo no Gerador (23/09/2026): modo em cenas + tela de cenas com tempo de verdade.

O modal "Ideia para vídeo com IA" que ele mostrou, virado em som: a IA escreve a narração em cenas
(título, narração, ambiente), a tela grava UMA voz por cena e o tempo de cada cena sai MEDIDO do áudio.

Rodar: pytest tests/test_audio_para_video.py -v  (o endpoint é testado SEM chave do Gemini: fonte 'base').
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_cenas_vao_e_voltam_do_texto():
    from backend.app import cenas_de_texto, texto_de_cenas, normalizar_cenas
    cenas = normalizar_cenas([
        {'titulo': 'Descoberta do grupo', 'narracao': 'Ana viu um grupo no WhatsApp.', 'ambiente': 'trilha leve; notificação'},
        {'titulo': '', 'narracao': 'Ela entrou e viu as ofertas.'},
        {'titulo': 'vazia', 'narracao': '   '},                      # sem narração = fora
        'lixo',
    ])
    assert [c['n'] for c in cenas] == [1, 2]
    assert cenas[1]['titulo'] == 'Cena 2' and cenas[1]['ambiente'] == ''
    txt = texto_de_cenas(cenas)
    assert txt.startswith('CENA 1 — Descoberta do grupo\nAna viu um grupo no WhatsApp.\n[Ambiente: trilha leve; notificação]\n\nCENA 2 — Cena 2\n')
    # Ida e volta: o texto do campo de roteiro reparseia nas mesmas cenas.
    de_volta = cenas_de_texto(txt)
    assert [(c['titulo'], c['narracao'], c['ambiente']) for c in de_volta] == [(c['titulo'], c['narracao'], c['ambiente']) for c in cenas]
    # Sem cabeçalhos: 1 cena por parágrafo (texto pronto do cliente).
    pars = cenas_de_texto('Primeiro parágrafo.\n\nSegundo parágrafo.\n\n\nTerceiro.')
    assert [c['narracao'] for c in pars] == ['Primeiro parágrafo.', 'Segundo parágrafo.', 'Terceiro.']
    assert pars[2]['titulo'] == 'Cena 3'
    assert cenas_de_texto('') == []
    # Cabeçalho tolera hífen/dois-pontos e minúsculas.
    assert cenas_de_texto('cena 1 - Abertura\nOlá.\n\nCENA 2: Fecho\nTchau.')[1]['titulo'] == 'Fecho'


def test_endpoint_sem_ia_devolve_cenas_do_briefing(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_AI_STUDIO_API_KEY', raising=False)
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    d = c.post('/api/gerador/roteiro', json={'briefing': 'Ideia um.\n\nIdeia dois.', 'peca': 'video',
                                             'duracao_video': 30, 'estilo_narracao': 'vlog', 'formato': 'dialogo'}).get_json()
    assert d['success'] and d['fonte'] == 'base' and d['peca'] == 'video'
    assert [x['narracao'] for x in d['cenas']] == ['Ideia um.', 'Ideia dois.']
    assert d['roteiro'].startswith('CENA 1 — Cena 1\nIdeia um.')
    assert d['faixa_alvo'] == [22, 30]                                   # 75% a 100% do vídeo
    # Spot continua igual: sem 'peca' não vem cena nenhuma.
    d2 = c.post('/api/gerador/roteiro', json={'briefing': 'Promoção de sábado.'}).get_json()
    assert d2['success'] and d2['peca'] == 'spot' and 'cenas' not in d2


def test_prompt_e_validacao_do_modo_video():
    app_py = _ler('backend', 'app.py')
    assert 'Você é roteirista de vídeos curtos no Brasil.' in app_py
    assert 'CENAS_POR_DURACAO = {15: (3, 4), 30: (4, 5), 60: (5, 7), 90: (7, 9), 0: (4, 8)}' in app_py
    assert "raise ValueError('vídeo veio com menos de 2 cenas')" in app_py
    assert "candidato['roteiro'] = texto_de_cenas(cenas_ok)" in app_py
    assert "formato = 'unico'" in app_py                                   # v1: uma voz


def test_tela_grava_uma_voz_por_cena_e_mede():
    js = _ler('static', 'gerador.js')
    assert "const PAUSA_CENA = 0.35;" in js
    assert "async function gerarVozPorCenas(cenas, aoProgredir) {" in js
    fn = js[js.index("async function gerarVozPorCenas("):js.index("function tc(seg) {")]
    assert "if (tipoDe429(msg) !== 'minuto' || tentativa >= 3) throw new Error(`Cena ${c.n}: ${msg}`);" in fn   # espera no limite por minuto
    assert "c.inicio = pos;" in fn and "c.fim = pos;" in fn                # tempo MEDIDO por cena
    assert "estado.vozBuffer = await gerarVozPorCenas(estado.cenas," in js
    assert "peca: pecaAtual()," in js and "duracao_video: pecaAtual() === 'video' ? duracaoVideoAlvo() : undefined," in js
    assert "plano: pecaAtual() === 'video' ? 'outro' : document.getElementById('selectPlano').value," in js
    # Painel: textContent (narração é dado, não HTML), conferência contra o vídeo, exportações.
    assert "t.textContent = `Cena ${c.n} · ${tc(c.inicio)}–${tc(c.fim)} · ${c.titulo}`;" in js
    assert "passa do vídeo de ${alvo} s" in js
    assert "function roteiroCronometrado() {" in js and "async function baixarSoVoz() {" in js
    # Regerar só a voz relê as cenas do texto.
    assert "estado.cenas = parsearCenas(estado.roteiro);\n                estado.vozBuffer = await gerarVozPorCenas(" in js
    # Parser espelha o backend.
    assert "function parsearCenas(texto) {" in js and "function textoDeCenas(cenas) {" in js


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_tela_e_versao(cliente):
    html = cliente.get('/gerador').get_data(as_text=True)
    for t in ('id="selectPeca"', 'id="grupoVideo"', 'id="selectDuracaoVideo"', 'id="selectEstiloNarracao"', 'id="grupoPlano"',
              'id="painelCenas"', 'id="listaCenas"', 'id="cenasConferencia"', 'id="btnCopiarCronometrado"',
              'id="btnBaixarCronometrado"', 'id="btnBaixarSoVoz"', '.cena-item {', 'gerador.js?v=26'):
        assert t in html, t
