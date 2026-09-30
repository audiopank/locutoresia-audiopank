"""Cadeado no objeto da MiniDAW clássica (28/09/2026) — ligação da tela.

Pedido dele, do Samplitude: "cadeado dentro do objeto, trava pra ninguém mexer".
Objeto travado não arrasta, não apara, não estica, não corta, não silencia, não
muda de volume, não apaga e não recorta. Ainda pode ser SELECIONADO e COPIADO
(a cópia nasce livre). A trava fica salva no projeto e entra no Ctrl+Z.

Rodar: pytest tests/test_cadeado_objeto.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _js():
    return _ler('static', 'minidaw.js')


def test_pagina_carrega_versoes_e_css_do_cadeado():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    html = c.get('/minidaw').get_data(as_text=True)
    for t in ('clip-model.js?v=8', 'minidaw.js?v=77', '.clip-cadeado {', '.clip-cadeado.fechado {',
              '.clip-bloco.travado .clip-alca,'):
        assert t in html, t


def test_icone_no_objeto_e_item_no_menu():
    js = _js()
    assert "cad.className = 'clip-cadeado' + (trav ? ' fechado' : '');" in js
    assert "cad.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.alternarTrava(track.id, clip.id, true); });" in js
    assert "{ rotulo: (vaiTravar ? 'Travar ' : 'Destravar ') + (n >= 2 ? `${n} objetos` : 'objeto'), acao: () => this.alternarTrava(trackId, clipId) }," in js


def test_trava_barra_cada_caminho_de_edicao():
    js = _js()
    guardas = {
        'arrastar/aparar/esticar': 'if (ClipModel.estaTravado(clip)) {\n            // Cadeado (28/09/2026)',
        'arrastar grupo': "if (grupo.some(g => ClipModel.estaTravado(g.clip))) return this._avisarTravadoSeArrastar(ev,",
        'cortar/silenciar': 'if (pegaTravado) {',
        'volume do trecho': "if (this._trechoPegaTravado(track, trechos)) { this._avisarTrechoTravado(); return; }",
        'time stretch exato': "if (ClipModel.estaTravado(clip)) { this.showNotification('Objeto travado — destrave no cadeado pra esticar', 'warning'); return; }",
        'volume do objeto': "if (grupo.some(g => ClipModel.estaTravado(g.clip))) {",
        'delete no cursor': "if (ClipModel.estaTravado(clip)) { this.showNotification('Objeto travado — destrave no cadeado pra apagar', 'warning'); return; }",
        'apagar grupo': 'const grupo = todos.filter(g => !ClipModel.estaTravado(g.clip));',
        'recortar': "this.showNotification('Tem objeto travado na seleção — destrave no cadeado pra recortar', 'warning');",
        'encurtar pausas': 'const travadosVoz = vozes.reduce(',
    }
    for nome, trecho in guardas.items():
        assert trecho in js, nome
    assert js.count('this._avisarTrechoTravado(); return; }') == 2      # volume do trecho + igualar


def test_trava_entra_no_undo_e_salva_no_projeto():
    js = _js()
    inicio = js.index('    alternarTrava(trackId, clipId, soEste) {')
    corpo = js[inicio:inicio + 2500]
    assert 'this._guardarUndo(this._snapshotClips());' in corpo
    assert js.count('travado: ClipModel.estaTravado(c) || undefined') == 2   # salvar + reabrir


def test_plural_do_trecho_marcado():
    js = _js()
    assert "nTrechos === 1 ? '1 trecho marcado' : `${nTrechos} trechos marcados`" in js
