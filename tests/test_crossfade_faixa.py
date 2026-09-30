"""Crossfade dentro da faixa, MiniDAW clássica (28/09/2026) — ligação da tela.

Pedido dele (Samplitude): arrastar um objeto por cima do vizinho na MESMA faixa
cria crossfade automático, com o X amarelo na região. Matemática e som em
tests/crossfade.test.mjs; aqui fica a ligação.

Rodar: pytest tests/test_crossfade_faixa.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_versoes_e_css_da_regiao_do_crossfade():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    html = c.get('/minidaw').get_data(as_text=True)
    for t in ('mix-engine.js?v=18', 'clip-model.js?v=8', 'minidaw.js?v=72', '.xfade-regiao {'):
        assert t in html, t
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=18' in c.get(pagina).get_data(as_text=True), pagina


def test_gestos_aceitam_crossfade_valido():
    js = _ler('static', 'minidaw.js')
    assert 'novoInicio = ClipModel.moverComCrossfade(clipsAlvo, clip, novoInicio);' in js
    # Arrastar, aparar, esticar, grupo e mover de faixa validam pela regra nova.
    assert js.count('ClipModel.sobreposicaoInvalida(') >= 6
    # Colar continua SEM sobrepor (crossfade surpresa no meio de um objeto).
    assert js.count('ClipModel.temSobreposicao(') == 2


def test_play_usa_o_mesmo_crossfade_do_arquivo_e_desenha_o_x():
    js = _ler('static', 'minidaw.js')
    assert 'MixEngine.agendarCrossfadeDoClip(xfGain.gain, this._clipsDaFaixa(track), clip, base);' in js
    assert 'volGain.connect(xfGain);' in js and 'xfGain.connect(nodes.inputNode);' in js
    assert "d.className = 'xfade-regiao';" in js
    assert "conteudo.querySelectorAll('.xfade-regiao').forEach(el => el.remove());" in js
