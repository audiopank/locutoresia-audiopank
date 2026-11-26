"""🎚️ Ducking ajustável por trilha na MiniDAW clássica (19/11/2026).

Prévia e export usam a MESMA conta (MixEngine.duckDaFaixa); o ajuste viaja no projeto.
A conta em si é testada em tests/ducking-faixa.test.mjs.
Rodar: pytest tests/test_ducking_faixa.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_export_e_previa_usam_o_ajuste_da_trilha():
    motor = _ler('static', 'mix-engine.js')
    assert 'fimDaVoz, 0, duckDaFaixa(track, duck)' in motor
    daw = _ler('static', 'minidaw.js')
    assert 'this.aplicarDucking(g, trechosDeVoz, nivel, fimDaVoz, base, track)' in daw
    assert 'MixEngine.duckDaFaixa(track, {' in daw


def test_botao_painel_e_projeto():
    daw = _ler('static', 'minidaw.js')
    assert "onclick=\"minidaw.alternarPainelDuck('${track.id}')\"" in daw
    assert "this._painelDuckHtml(track) : ''" in daw          # só trilha (não voz, não efeito sonoro)
    assert 'duckSettings: t.duckSettings,' in daw              # salva
    assert 'if (td.duckSettings) track.duckSettings = td.duckSettings; else delete track.duckSettings;' in daw   # reabre
    html = _ler('templates', 'minidaw.html')
    assert '.duck-panel.ativo' in html and '.track-card.compacta .duck-panel' in html
    assert 'mix-engine.js?v=25' in html and 'minidaw.js?v=100' in html
