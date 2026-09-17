"""Silenciar trecho na faixa de voz (17/09/2026): tira a respiração SEM encurtar o off.

Rodar: pytest tests/test_silenciar_trecho.py -v  (a conta dos clips roda o clip-model.js no node).
"""
import json
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_silenciar_nao_move_nada_e_poe_micro_fade():
    caminho = os.path.join(RAIZ, 'static', 'clip-model.js').replace(os.sep, '/')
    script = f"""
    const CM = require({json.dumps(caminho)});
    const buf = {{ duration: 40 }};
    const limpar = cs => cs.map(c => ({{ inicio: +c.inicio.toFixed(3), offset: +c.offset.toFixed(3), duracao: +c.duracao.toFixed(3), fadeIn: c.fadeIn, fadeOut: c.fadeOut }}));
    const voz = [{{ id: 'v', buffer: buf, inicio: 2, offset: 0, duracao: 37.46, fadeIn: 0.2, fadeOut: 0.3 }}];
    const umMute = CM.silenciarTrecho(voz, 8.11, 8.38);
    const doisMutes = CM.silenciarTrecho(umMute, 20, 20.5);
    // trecho que atravessa DOIS clips (já havia um mute antes)
    const atravessa = CM.silenciarTrecho(umMute, 8.0, 9.0);
    const fimDe = cs => cs.reduce((m, c) => Math.max(m, c.inicio + c.duracao), 0);
    console.log(JSON.stringify({{
        umMute: limpar(umMute), nDois: doisMutes.length, atravessa: limpar(atravessa),
        fimIgual: Math.abs(fimDe(umMute) - fimDe(voz)) < 1e-9 && Math.abs(fimDe(doisMutes) - fimDe(voz)) < 1e-9,
        foraDoAudio: CM.silenciarTrecho(voz, 50, 51) .length === 1 && CM.silenciarTrecho(voz, 50, 51)[0] === voz[0],
        tudo: CM.silenciarTrecho(voz, 0, 100).length,
        removerPuxa: limpar(CM.removerTrecho(voz, voz[0], 8.11, 8.38))[1].inicio,
    }}));
    """
    r = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
    m = json.loads(r.stdout)
    antes, depois = m['umMute']
    assert antes == {'inicio': 2, 'offset': 0, 'duracao': 6.11, 'fadeIn': 0.2, 'fadeOut': 0.008}
    assert depois['inicio'] == 8.38 and depois['offset'] == 6.38               # FICA onde estava (o remover puxaria pra 8.11)
    assert depois['fadeIn'] == 0.008 and depois['fadeOut'] == 0.3            # borda nova = micro-fade; borda original guarda o fade
    assert depois['duracao'] == pytest.approx(37.46 - 6.38, abs=1e-3)
    assert m['removerPuxa'] == 8.11                                          # contraste: o "Remover trecho" encurta o off
    assert m['fimIgual'] and m['nDois'] == 3                                 # o off NÃO encurta, nem com vários mutes
    assert [c['inicio'] for c in m['atravessa']] == [2, 9.0] and m['atravessa'][0]['duracao'] == 6.0
    assert m['foraDoAudio'] and m['tudo'] == 0


def test_botao_so_em_voz_tecla_q_e_desfazer():
    js = _ler('static', 'minidaw.js')
    assert "${track.type === 'voice' ? `<button class=\"btn btn-sm btn-warning\" id=\"btnsilenciar_${track.id}\" onclick=\"minidaw.aplicarCorte('${track.id}', 'silenciar')\"" in js
    assert "if (modo === 'silenciar') {" in js and "if (track.type !== 'voice') {" in js
    assert "for (const r of trechos) novos = ClipModel.silenciarTrecho(novos, r.ini, r.fim);" in js
    trecho = js[js.index("if (modo === 'silenciar') {"):js.index("} else if (modo === 'dividir') {")]
    assert "this._guardarUndo(snapshotPreCorte);" in trecho                  # entra no Ctrl+Z
    assert "if (k === 'q' && this.trackTesoura && (this.selecoes || {})[this.trackTesoura]) {" in js
    cm = _ler('static', 'clip-model.js')
    assert "removerTrecho, silenciarTrecho, manterTrecho," in cm


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    assert 'clip-model.js?v=5' in html and 'minidaw.js?v=56' in html


def test_varios_trechos_num_clique():
    """17/09/2026: ele silenciava uma respiração por vez; pediu marcar várias e aplicar num clique."""
    js = _ler('static', 'minidaw.js')
    for marca in ("this.selecoesExtras = {};", "this.variosTrechos = false;",
                  "if ((ev.shiftKey || this.variosTrechos) && track.type === 'voice') {",          # Shift+arrastar ou "Vários"
                  "d.className = 'sel-regiao sel-extra';",                                          # trecho guardado fica âmbar
                  "if (this.selecoesExtras) delete this.selecoesExtras[trackId];",                  # Cancelar limpa tudo
                  "if (extras.length && modo !== 'silenciar') {",                                   # remover/manter/dividir não aceitam vários
                  "const trechos = extras.concat((s.fim - s.ini >= 0.01) ? [{ ini: s.ini, fim: s.fim }] : []);",
                  "alternarVariosTrechos(trackId) {", 'id="btnvarios_${track.id}"',
                  "if (this.trackTesoura) this.desenharSelecao(this.trackTesoura);"):              # marcação acompanha o zoom
        assert marca in js, marca
    trecho = js[js.index("if (modo === 'silenciar') {"):js.index("} else if (modo === 'dividir') {")]
    assert trecho.count("this._guardarUndo(snapshotPreCorte);") == 1                                # UM desfazer pra todos
    assert '.sel-regiao.sel-extra {' in _ler('templates', 'minidaw.html')
