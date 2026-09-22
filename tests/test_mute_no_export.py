"""Mudo/Solo valem no ARQUIVO (22/09/2026).

O cliente pediu o mix só com voz + trilha neutra; o produtor deu Mudo na "Trilha 2 - Assinatura cantada"
e ela saiu no arquivo mesmo assim. O play respeitava Mudo/Solo (agendarVolumeDaFaixa), o export não:
exportMix/pacoteDeStems mandavam TODAS as faixas com áudio e o motor só lia track.volume.
Agora o motor filtra (som, duração e ducking) e a tela avisa o que ficou de fora.

Rodar: pytest tests/test_mute_no_export.py -v
"""
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_motor_filtra_no_node():
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'mix-engine-clips.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
    assert '# fail 0' in r.stdout and 'faixasAudiveis' in r.stdout


def test_motor_tira_a_faixa_muda_do_som_da_duracao_e_do_ducking():
    js = _ler('static', 'mix-engine.js')
    assert "function faixasAudiveis(tracks) {" in js
    trecho = js[js.index("    async function renderizarMix(o) {"):js.index("const tracksWithAudio = todasAsTracks.filter(t => t.audioBuffer);")]
    assert "const audivel = (t) => t && !t.muted && (!haSolo || t.solo);" in trecho
    assert "const tracksParaRenderizar = (o.tracks || []).filter(audivel);" in trecho     # som
    assert "const todasAsTracks = projeto.filter(audivel);" in trecho                      # duração + ducking
    assert "renderizarMix, faixasAudiveis," in js
    # Mesma regra do play — prévia = arquivo.
    assert "if (track.muted || (haSolo && !track.solo)) {" in _ler('static', 'minidaw.js')


def test_tela_usa_o_filtro_e_avisa_o_que_ficou_de_fora():
    js = _ler('static', 'minidaw.js')
    assert "_faixasParaExportar() {" in js and "const audiveis = MixEngine.faixasAudiveis(comAudio);" in js
    exp = js[js.index("    async exportMix() {"):js.index("        this.showMixingStatus(true);")]
    assert "const { comAudio, audiveis: tracksWithAudio, fora } = this._faixasParaExportar();" in exp
    assert "Destrave o Mudo antes de exportar." in exp and "this._avisarFaixasFora(fora);" in exp
    stems = js[js.index("    async pacoteDeStems() {"):js.index("    async pacoteDeStems() {") + 1200]
    assert "audiveis: comAudio, fora } = this._faixasParaExportar();" in stems
    assert "Destrave o Mudo antes de gerar o pacote." in stems
    assert 'linhas.push(`(fora do pacote: "${t.name}" estava em Mudo/fora do solo na hora de gerar)`);' in js
    assert "Fora do arquivo (${haSolo ? 'sem solo' : 'Mudo'}): ${nomes}" in js


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
    assert 'mix-engine.js?v=11' in html and 'minidaw.js?v=64' in html
