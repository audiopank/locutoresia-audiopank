"""Liga/desliga do auto fade por trilha (16/09/2026).

Caso real: vinheta de assinatura do jingle entrava DEPOIS da locução e nunca
tocava — o motor cortava tudo 3,05 s depois da última palavra. Com o auto fade
desligado na faixa, ela toca até o fim dela e o arquivo cresce pra caber.

Rodar: pytest tests/test_autofade_trilha.py -v  (o teste da duração roda o clip-model.js no node).
"""
import json
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_duracao_do_projeto_deixa_faixa_livre_tocar_ate_o_fim():
    caminho = os.path.join(RAIZ, 'static', 'clip-model.js').replace(os.sep, '/')
    script = f"""
    const CM = require({json.dumps(caminho)});
    const clip = (fim, inicio) => [{{inicio: inicio || 0, offset: 0, duracao: fim - (inicio || 0), fadeIn: 0, fadeOut: 0}}];
    const voz = {{type: 'voice', clips: clip(35)}};
    console.log(JSON.stringify([
        CM.duracaoDoProjeto([voz, {{type: 'music', clips: clip(60)}}]),                        // trilha comum: corta em voz + 3,05
        CM.duracaoDoProjeto([voz, {{type: 'music', autoFade: false, clips: clip(47, 35)}}]),  // vinheta livre depois da voz: cabe inteira
        CM.duracaoDoProjeto([voz, {{type: 'music', autoFade: false, clips: clip(30)}}]),      // livre mas acaba antes: não encurta
        CM.duracaoDoProjeto([voz, {{type: 'music', sfx: true, clips: clip(50, 40)}}]),        // efeito depois da voz: cabe
        CM.duracaoDoProjeto([{{type: 'music', autoFade: false, clips: clip(12)}}]),           // sem voz: clip mais tardio
    ]));
    """
    r = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
    assert json.loads(r.stdout) == [38.05, 47, 38.05, 50, 12]


def test_motor_e_previa_respeitam_o_desligado():
    engine = _ler('static', 'mix-engine.js')
    assert "if (t.type === 'music' && (t.sfx || t.autoFade === false)) {" in engine      # duração cresce
    assert "if (track.autoFade !== false) {\n                            trackGain.gain.linearRampToValueAtTime(0, fimDaVoz + 3.05);" in engine
    js = _ler('static', 'minidaw.js')
    assert "if (track.autoFade !== false) {\n                g.linearRampToValueAtTime(0, base + fimDaVoz + 3.05);" in js
    assert "sfx: !!t.sfx, autoFade: t.autoFade, clips: this._clipsDaFaixa(t)" in js        # duração da prévia
    assert "if (musicTrack.autoFade === false) return;" in js                             # detector de silêncio


def test_botao_por_trilha_e_projeto_salvo():
    js = _ler('static', 'minidaw.js')
    assert "autoFade: true," in js                                    # faixa nasce ligada
    assert "minidaw.alternarAutoFade('${track.id}')" in js            # botão só em trilha
    assert "${(track.type === 'music' && !track.sfx) ? `<button class=\"effect-btn${track.autoFade !== false ? ' active' : ''}\"" in js
    assert "alternarAutoFade(trackId) {" in js
    assert "autoFade: t.autoFade !== false," in js                    # salva
    assert "track.autoFade  = td.autoFade !== false;" in js           # reabre (projeto antigo = ligado)
    assert "track.sfx       = !!td.sfx;" in js                        # efeito reaberto continua efeito


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_versoes_dos_scripts_subiram(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('mix-engine.js?v=9', 'clip-model.js?v=5', 'minidaw.js?v=56'):
        assert t in html, t
    assert 'mix-engine.js?v=9' in cliente.get('/gerador').get_data(as_text=True)
    assert 'mix-engine.js?v=9' in cliente.get('/narrativa').get_data(as_text=True)
