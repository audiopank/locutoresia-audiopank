"""De-esser na faixa de VOZ da MiniDAW clássica (Suíte v2 D1, 22/09/2026).

Ele mostrou o preset "Deesser" do MultiMax do Samplitude ("funciona de verdade") e mandou começar por
aqui. Split-band em 5 kHz, só a banda alta passa pelo compressor, desligado = caminho seco; o MESMO
construtor no play (minidaw.js) e no export (mix-engine.js) — prévia = arquivo.

Rodar: pytest tests/test_deesser.py -v  (a fiação e os parâmetros rodam no node: tests/deesser.test.mjs).
"""
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_motor_no_node():
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'deesser.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
    assert '# fail 0' in r.stdout and '# pass 3' in r.stdout


def test_mesmo_no_entre_presenca_e_compressor_no_play_e_no_export():
    daw = _ler('static', 'minidaw.js')
    eng = _ler('static', 'mix-engine.js')
    # Play
    assert "const deesser = MixEngine.criarDeesser(this.audioContext, MixEngine.freqDeesserDaFaixa(track));" in daw
    assert "presenceNode.connect(deesser.input);\n        deesser.output.connect(compressorNode);" in daw
    assert "nodes.deesser.aplicar(track.effects.deesser ? MixEngine.paramsDeesser(MixEngine.forcaDeesserDaFaixa(track)) : null);" in daw
    # Export
    assert "const deesser = criarDeesser(offlineContext, freqDeesserDaFaixa(track));" in eng
    assert "deesser.aplicar(track.effects.deesser ? paramsDeesser(forcaDeesserDaFaixa(track)) : null);" in eng
    assert "presenceNode.connect(deesser.input);\n                deesser.output.connect(compressorNode);" in eng
    # O caminho antigo (Presença direto no Compressor) saiu dos DOIS.
    assert "presenceNode.connect(compressorNode);" not in daw and "presenceNode.connect(compressorNode);" not in eng


def test_botao_e_painel_so_em_voz_com_slider_de_forca():
    js = _ler('static', 'minidaw.js')
    voz = js[js.index("${track.type === 'voice' ? `\n                                <button class=\"effect-btn ${track.effects.gate"):js.index("` : ''}\n                        </div>")]
    assert "minidaw.toggleEffect('${track.id}', 'deesser')" in voz                # dentro do bloco só-voz
    painel = js[js.index('<div class="deesser-panel'):js.index('<div class="effects-panel')]
    assert 'oninput="minidaw.updateDeesserForca(\'${track.id}\', this.value)"' in painel
    assert 'min="1" max="10" step="1"' in painel and 'língua presa' in painel
    assert "updateDeesserForca(trackId, valor) {" in js and "this.applyEffectStates(track);" in js
    assert "deesserPanel.classList.toggle('ativo', !!track.effects.deesser);" in js
    assert "deesser: false\n            }," in js and "deesserSettings: { forca: 5 }," in js
    # v1.1 (22/09, "muda muito pouco"): faixa do corte escolhível + redução ao vivo em dB.
    assert "onchange=\"minidaw.updateDeesserFreq('${track.id}', this.value)\"" in painel
    assert '<option value="3500"' in painel and '<option value="5000"' in painel and '<option value="6500"' in painel
    assert 'id="deessergr_${track.id}"' in painel
    assert "updateDeesserFreq(trackId, hz) {" in js and "nodes.deesser.setFreq(MixEngine.freqDeesserDaFaixa(track));" in js
    assert "_garantirMedidorDeesser() {" in js and "this._garantirMedidorDeesser();" in js
    assert "nodes.deesser.comp.reduction" in js and "agora - pico.em > 600" in js       # retenção de pico
    eng = _ler('static', 'mix-engine.js')
    assert "const deesser = criarDeesser(offlineContext, freqDeesserDaFaixa(track));" in eng   # export usa a mesma faixa


def test_forca_vai_no_projeto_no_copiar_efeitos_e_volta_ao_reabrir():
    js = _ler('static', 'minidaw.js')
    assert "deesserSettings: track.deesserSettings" in js                        # salvar (legado)
    assert "deesserSettings: t.deesserSettings," in js                           # salvar (projeto)
    assert "track.deesserSettings = td.deesserSettings || track.deesserSettings;" in js   # reabrir
    assert "destino.deesserSettings = Object.assign({}, origem.deesserSettings || {});" in js


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_css_e_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    assert '.deesser-panel' in html and '.deesser-panel.ativo' in html
    assert 'mix-engine.js?v=15' in html and 'minidaw.js?v=68' in html
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=15' in cliente.get(pagina).get_data(as_text=True), pagina
