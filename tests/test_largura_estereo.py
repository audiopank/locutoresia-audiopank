"""Largura estéreo da trilha + Mono de checagem no master (Suíte v2 D3, 22/09/2026).

Mid/Side por faixa de TRILHA (0% mono, 100% como veio, 200% aberta), o MESMO nó no play e no export,
salvo no projeto; voz nunca passa (largura 1 = caminho seco). No master, o botão MONO soma L+R só na
PRÉVIA (checagem de rádio AM / celular): não vai pro arquivo nem pro projeto.

Rodar: pytest tests/test_largura_estereo.py -v  (a fiação M/S roda no node: tests/largura.test.mjs).
"""
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_motor_no_node():
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'largura.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
    assert '# fail 0' in r.stdout and '# pass 2' in r.stdout


def test_mesmo_no_entre_pan_e_master_no_play_e_no_export():
    daw = _ler('static', 'minidaw.js')
    eng = _ler('static', 'mix-engine.js')
    assert "const largura = MixEngine.criarLargura(this.audioContext);\n        largura.aplicar(MixEngine.larguraDaFaixa(track));\n        panNode.connect(largura.input);\n        largura.output.connect(this.masterGain);" in daw
    assert "panNode.connect(this.masterGain);" not in daw
    assert "const largura = criarLargura(offlineContext);\n                largura.aplicar(larguraDaFaixa(track));\n                pan.connect(largura.input);\n                largura.output.connect(masterGain);" in eng
    assert "pan.connect(masterGain);" not in eng


def test_slider_so_em_trilha_e_vai_e_volta_do_projeto():
    js = _ler('static', 'minidaw.js')
    bloco = js[js.index("${track.type === 'music' ? `\n                    <div class=\"control-group\">\n                        <span class=\"control-label\">Largura:</span>"):]
    bloco = bloco[:bloco.index("` : ''}")]
    assert 'oninput="minidaw.updateTrackLargura(\'${track.id}\', this.value)"' in bloco
    assert 'min="0" max="200" step="5"' in bloco and 'id="largura_val_${track.id}"' in bloco
    assert "updateTrackLargura(trackId, pct) {" in js and "if (!track || track.type !== 'music') return;" in js
    assert "if (nodes && nodes.largura) nodes.largura.aplicar(MixEngine.larguraDaFaixa(track));" in js
    assert "largura: MixEngine.larguraDaFaixa(t),     // trilha: 0..2; voz sempre 1" in js       # salvar (projeto)
    assert "largura: track.largura\n" in js                                                          # salvar (legado)
    assert "track.largura   = Number.isFinite(Number(td.largura)) ? Number(td.largura) : 1;" in js    # reabrir


def test_mono_de_checagem_so_na_previa():
    suite = _ler('static', 'master-suite.js')
    assert "const mono = { ligado: false, no: null };" in suite
    assert "if (mono.no) { lim.compGain.connect(mono.no.input); mono.no.output.connect(daw.masterOut); }" in suite
    assert "if (mono.no) mono.no.aplicar(mono.ligado ? 0 : 1);" in suite
    assert "if (bmono) bmono.onclick = () => { mono.ligado = !mono.ligado; aplicarMono(); };" in suite   # sem salvar()
    salvar = suite[suite.index("    function estadoParaSalvar() {"):suite.index("    function carregar(master) {")]
    assert 'mono' not in salvar                                                # monitoração não vai pro projeto
    assert "masterMono" not in _ler('static', 'mix-engine.js')                # nem pro arquivo


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_botao_e_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    assert 'id="msMono"' in html and 'MONO de checagem' in html
    assert 'mix-engine.js?v=15' in html and 'master-suite.js?v=8' in html and 'minidaw.js?v=68' in html
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=15' in cliente.get(pagina).get_data(as_text=True), pagina
