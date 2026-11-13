"""🎻 Câmara + ✨ Brilho na MiniDAW clássica (13/11/2026).

Pedido dele (referência: ReaFir em sorriso + Nectar 4 "Chamber tone" no REAPER): "cada opção
tem que ter o botão Ligar/Desligar — o produtor só liga se realmente precisar".
✨ Brilho = botão próprio na faixa de VOZ; 🎻 Câmara = sala do Reverb (o botão Reverb liga/desliga).
Os dois usam o MESMO construtor no play e no arquivo.

Rodar: pytest tests/test_camara_brilho.py -v  (motor: tests/camara-brilho.test.mjs)
"""
import os
import subprocess

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*p):
    return open(os.path.join(RAIZ, *p), encoding='utf-8').read()


def test_motor_no_node():
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'camara-brilho.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0 and '# fail 0' in r.stdout, r.stdout[-2000:]


def test_brilho_botao_so_na_voz_e_mesmo_no_play_e_no_export():
    js = _ler('static', 'minidaw.js')
    voz = js[js.index("${track.type === 'voice' ? `\n                                <button class=\"effect-btn ${track.effects.gate"):]
    voz = voz[:voz.index("` : ''}")]
    assert "minidaw.toggleEffect('${track.id}', 'brilho')" in voz and '✨ Brilho' in voz
    assert 'const brilho = MixEngine.criarBrilho(this.audioContext);' in js
    assert 'eqAirNode.connect(brilho.input);\n        brilho.output.connect(presenceNode);' in js
    assert 'if (nodes.brilho) nodes.brilho.aplicar(!!track.effects.brilho);' in js
    me = _ler('static', 'mix-engine.js')
    assert 'const brilho = criarBrilho(offlineContext);' in me and 'brilho.aplicar(!!track.effects.brilho);' in me
    assert 'eqAirNode.connect(brilho.input);\n                brilho.output.connect(presenceNode);' in me


def test_camara_no_seletor_e_viaja_como_o_plenario():
    js = _ler('static', 'minidaw.js')
    painel = js[js.index('<div class="reverb-panel'):js.index('<div class="delay-panel')]
    assert '<option value="camara"' in painel and '🎻 Câmara</option>' in painel
    assert "} else if (sala === 'camara') {" in js and "track.sala = 'camara';" in js
    assert "camara: ' 🎻'" in js                                   # rótulo do botão Reverb
    assert "'plenario'" not in js.split('_copiarEfeitos(origem, destino) {')[1].split('}')[0]


def test_versoes():
    for t in ('minidaw.html', 'gerador.html', 'narrativa.html'):
        assert '/static/mix-engine.js?v=22' in _ler('templates', t), t
    assert '/static/minidaw.js?v=91' in _ler('templates', 'minidaw.html')
