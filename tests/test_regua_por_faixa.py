"""Régua de tempo + cursor em CADA faixa da MiniDAW clássica (21/09/2026).

Pedido: "a linha de cima (cursor) não pode existir entre todos os tracks? Ao adicionar novo track, já abre
junto o track + linha cursor sobre ele." A régua da faixa mora no card, logo acima da lane, com o MESMO
desenho e os mesmos cliques da régua de cima (clique = cursor, duplo clique = marcador, botão direito
no número = apaga), e rola junto com a lane em todos os pontos que sincronizam rolagem.

Rodar: pytest tests/test_regua_por_faixa.py -v
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_regua_nasce_com_a_lane_no_card():
    js = _ler('static', 'minidaw.js')
    card = js[js.index("            ` : `\n                <div class=\"timeline-regua regua-faixa\""):js.index("<div class=\"lane-conteudo\">")]
    assert 'id="reguafx_${track.id}"' in card and 'class="clips-lane" id="lane_${track.id}"' in card   # régua ANTES da lane
    # Ganha o desenho no render da faixa (o card é recriado pelo updateTrackUI depois do desenho geral).
    assert "if (reguaFx && !reguaFx.childElementCount) this._desenharReguaDaFaixa(reguaFx);" in js


def test_mesmo_desenho_e_mesmos_cliques_da_regua_de_cima():
    js = _ler('static', 'minidaw.js')
    assert "_htmlDaRegua() {" in js and "_instalarCliquesDaRegua(regua) {" in js and "_desenharReguaDaFaixa(r) {" in js
    topo = js[js.index("    desenharRegua() {"):js.index("    _desenharReguaDaFaixa(r) {")]
    assert "regua.innerHTML = this._htmlDaRegua();" in topo and "this._instalarCliquesDaRegua(regua);" in topo
    assert "document.querySelectorAll('.regua-faixa').forEach(r => this._desenharReguaDaFaixa(r));" in topo
    faixa = js[js.index("    _desenharReguaDaFaixa(r) {"):js.index("    _htmlDaRegua() {")]
    assert "r.innerHTML = this._htmlDaRegua();" in faixa and "this._instalarCliquesDaRegua(r);" in faixa
    # Cursor de reprodução anda em TODAS as réguas.
    assert "document.querySelectorAll('.playhead-regua').forEach(el => { el.style.left = px; });" in js
    assert "document.querySelector('.timeline-regua .playhead-regua')" not in js


def test_rola_junto_com_a_lane_em_todos_os_pontos():
    js = _ler('static', 'minidaw.js')
    assert "document.querySelectorAll('.regua-faixa').forEach(r => { r.scrollLeft = x; });" in js               # lane rolada
    assert "card.querySelectorAll('.clips-lane, .regua-faixa').forEach(l => { l.scrollLeft = ref.scrollLeft; });" in js   # faixa movida
    assert "document.querySelectorAll('.clips-lane, .regua-faixa').forEach(l => { l.scrollLeft = scroll; });" in js       # zoom
    assert "document.querySelectorAll('.regua-faixa').forEach(r => { r.scrollLeft = lane.scrollLeft; });" in js   # fim do render / resize


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_css_e_versao(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('.regua-faixa {', '.regua-faixa + .clips-lane {', '.regua-faixa .marcador {', 'minidaw.js?v=67'):
        assert t in html, t
