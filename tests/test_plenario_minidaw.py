"""🏛️ Plenário na MiniDAW clássica (05/11/2026): a sala vai junto em todo lugar que o reverb vai.

Estúdio = campo `sala` AUSENTE (projeto/preset antigos soam e salvam igual). Plenário viaja
no projeto (nuvem e Salvar no PC), no Copiar Efeitos, nos presets por faixa, e o play religa
a sala sempre que ela muda (applyEffectStates → _religarSala), igual ao export (mix-engine).

Rodar: pytest tests/test_plenario_minidaw.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_export_e_play_usam_a_mesma_sala_e_o_mesmo_envio():
    me = _ler('static', 'mix-engine.js')
    assert 'reverbNode.buffer = criarImpulsoReverb(offlineContext, salaDaFaixa(track));' in me
    assert 'const envioSala = criarEnvioSala(offlineContext, salaDaFaixa(track));' in me
    js = _ler('static', 'minidaw.js')
    assert 'reverbNode.buffer = MixEngine.criarImpulsoReverb(this.audioContext, salaInicial);' in js
    assert 'const envioSala = MixEngine.criarEnvioSala(this.audioContext, salaInicial);' in js
    assert "if (nodes.salaAtual !== MixEngine.salaDaFaixa(track)) this._religarSala(track, nodes);" in js


def test_sala_viaja_no_projeto_copiar_efeitos_e_presets():
    js = _ler('static', 'minidaw.js')
    assert "sala: MixEngine.salaDaFaixa(t) === 'plenario' ? 'plenario' : undefined," in js          # salvar (nuvem e PC)
    assert "if (td.sala === 'plenario') track.sala = 'plenario'; else delete track.sala;" in js     # abrir
    assert "if (MixEngine.salaDaFaixa(origem) === 'plenario') destino.sala = 'plenario'; else delete destino.sala;" in js
    assert "sala: MixEngine.salaDaFaixa(track)\n" in js                                             # preset guarda
    assert "if (e.sala === 'plenario') track.sala = 'plenario'; else delete track.sala;" in js      # preset aplica


def test_seletor_no_painel_do_reverb_e_versoes():
    js = _ler('static', 'minidaw.js')
    painel = js[js.index('<div class="reverb-panel'):js.index('<div class="delay-panel')]
    assert "onchange=\"minidaw.updateSalaReverb('${track.id}', this.value)\"" in painel
    assert '🏛️ Plenário</option>' in painel and 'Estúdio (padrão)</option>' in painel
    for t in ('minidaw.html', 'gerador.html', 'narrativa.html'):
        assert '/static/mix-engine.js?v=20' in _ler('templates', t), t
    assert '/static/minidaw.js?v=87' in _ler('templates', 'minidaw.html')
