"""Seleção múltipla de objetos na MiniDAW clássica (23/09/2026).

Pedido: Ctrl+A seleciona todos os objetos de todas as faixas (como no Samplitude) e o botão direito
num objeto seleciona SÓ ele (e abre o menu de contexto). O grupo é o que o arrasto move junto, o
Delete apaga e o Ctrl+C copia com as posições relativas (Ctrl+V cola nas mesmas faixas).

Rodar: pytest tests/test_selecao_multipla.py -v
"""
import os

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_modelo_e_atalhos():
    js = _ler('static', 'minidaw.js')
    assert "this.selecionados = [];       // seleção múltipla" in js
    assert "if (k === 'a') { if (this.selecionarTodos()) e.preventDefault(); return; }" in js   # Ctrl+A
    assert "if (e.key === 'Escape') {" in js and "this.limparSelecao(); this.showNotification('Seleção limpa', 'info');" in js
    # Delete: grupo primeiro; depois o clip sob a linha; por fim o selecionado com o mouse fora.
    trecho = js[js.index("if (e.key === 'Delete' || e.key === 'Backspace') {"):js.index("// Q (\"quieto\")")]
    assert trecho.index("if (this.selecionados.length >= 2) { e.preventDefault(); this.apagarSelecionados(); return; }") \
        < trecho.index("this.deletarClipNoPonto(this.cursorLane, this.cursorTempo);") \
        < trecho.index("if (this._clipSelecionadoVivo()) { e.preventDefault(); this.apagarSelecionados(); }")
    # Sem objeto nenhum, Ctrl+A devolve false e a tecla segue pro navegador.
    assert "if (!todos.length) return false;" in js


def test_clique_ctrl_clique_e_botao_direito():
    js = _ler('static', 'minidaw.js')
    md = js[js.index("    mousedownClip(ev, trackId, clipId) {"):js.index("    // ── TRIM PELAS BORDAS")]
    assert "if (ev.button === 2) return;" in md
    assert "if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); this.alternarSelecao(trackId, clipId); return; }" in md
    assert "if (this._estaSelecionado(clipId) && this.selecionados.length >= 2) return this._arrastarGrupo(ev, track, clip);" in md
    assert md.index("this.alternarSelecao(trackId, clipId)") < md.index("this.selecionarClip(trackId, clipId);")
    # Render: realce pelo conjunto + contextmenu no bloco.
    assert "if (this._estaSelecionado(clip.id)) {" in js
    assert "el.addEventListener('contextmenu', (ev) => this.menuDoClip(ev, track.id, clip.id));" in js
    menu = js[js.index("    menuDoClip(ev, trackId, clipId) {"):js.index("    _menuObjetoEl() {")]
    assert "if (!(this._estaSelecionado(clipId) && this.selecionados.length >= 2)) this.selecionarClip(trackId, clipId);" in menu
    for item in ("'Copiar' + plural", "'Recortar' + plural", "'Colar aqui'", "'Dividir aqui'", "'Time Stretch exato…'", "'Apagar' + plural", "'Selecionar todos'"):
        assert item in menu, item
    assert "acao: () => this.colarClip(alvo)" in menu and "acao: () => this.cutTrackAtTime(trackId, tempo)" in menu
    # Menu monta com textContent (nome de faixa/objeto nunca vira HTML).
    assert "r.textContent = it.rotulo;" in js and "m.innerHTML = '';" in js


def test_arrasto_em_grupo_e_apagar_em_grupo():
    js = _ler('static', 'minidaw.js')
    ag = js[js.index("    _arrastarGrupo(ev, track, clip) {"):js.index("    // ── MENU DE CONTEXTO DO OBJETO")]
    assert "let delta = Math.max(-minIni, ajustado - iniciais.get(clip.id));" in ag          # ninguém passa do 0:00
    assert "if (ClipModel.temSobreposicao(outros.concat([teste]), teste)) return;" in ag     # colisão = grupo não anda
    assert "this._guardarUndo(snapshot);" in ag                                                # um Ctrl+Z pro grupo
    assert "this.selecionarClip(track.id, clip.id);\n                this.irPara(tempoDoClique);" in ag   # clique seco = só ele
    ap = js[js.index("    apagarSelecionados() {"):js.index("    // Arrasto em grupo:")]
    assert "this._guardarUndo(this._snapshotClips());" in ap and "if (!t.clips.length) this.updateTrackUI(t);" in ap


def test_copiar_e_colar_em_grupo_nas_mesmas_faixas():
    js = _ler('static', 'minidaw.js')
    assert "_copiarGrupoParaClipboard(grupo) {" in js and "trackId: g.track.id, rel: g.clip.inicio - base," in js
    assert "this.clipboardGrupo = null;                       // cópia simples manda" in js
    cg = js[js.index("    _colarGrupo(alvo) {"):js.index("    copiarClip() {")]
    assert "if (this.clipboardGrupo && this.clipboardGrupo.length) return this._colarGrupo(alvo);" in js
    assert "nada colado (tudo ou nada)" in cg and "Uma das faixas de origem não existe mais" in cg
    assert "if (item.stretch > 0) novo.stretch = item.stretch;" in cg                         # Time Stretch sobrevive à cópia
    # Menu "Colar aqui": faixa e tempo do clique direito, não do mouse (que está sobre o menu).
    assert "const destino = (alvo && alvo.trackId) ? this.tracks.find(t => t.id === alvo.trackId) : this._faixaSobOMouse();" in js
    # Abrir projeto limpa grupo e clipboard de grupo.
    assert "this.limparSelecao();\n            this.clipboardClip = null;\n            this.clipboardGrupo = null;" in js


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
    assert '.menu-objeto {' in html and '.menu-objeto.aberto {' in html and 'minidaw.js?v=68' in html
