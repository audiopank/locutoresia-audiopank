"""🐥👹 Tom do objeto na MiniDAW clássica (11/11/2026): botão direito → fininha/grossa/exato/original.

O tom viaja junto com o Time Stretch (os dois refeitos da origem), vai no projeto como selo e
no copiar/colar de grupo. Rodar: pytest tests/test_tom_objeto.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _js():
    return open(os.path.join(RAIZ, 'static', 'minidaw.js'), encoding='utf-8').read()


def test_menu_do_objeto_tem_os_atalhos_e_o_tom_exato():
    js = _js()
    assert "this.aplicarTom(trackId, clipId, 7)" in js and "this.aplicarTom(trackId, clipId, -7)" in js
    assert "this.tomExato(trackId, clipId)" in js
    assert "alvosTrava.some(c => c && c.pitch)" in js                     # "Tom original" só quando há tom


def test_stretch_preserva_o_tom_e_o_tom_preserva_o_stretch():
    js = _js()
    stretch = js[js.index('async _aplicarStretch('):js.index('async _aplicarStretch(') + 2500]
    assert "const st = clip.pitch || 0;" in stretch
    assert "TimeStretch.camposEsticados(clip, base, novoBuffer, fator, st)" in stretch
    tom = js[js.index('async aplicarTom('):js.index('_fmtSemitons(st) {')]
    assert "fator = fatorDe(g.clip)" in tom and "TimeStretch.cabeNoStretch(" in tom


def test_tom_vai_no_projeto_e_no_copiar_colar():
    js = _js()
    assert "pitch: c.pitch || undefined," in js                           # salvar
    assert "pitch: Number(c.pitch) || undefined," in js                   # abrir
    assert "pitch: g.clip.pitch," in js and "if (item.pitch) novo.pitch = item.pitch;" in js
