"""Time Stretch na MiniDAW clássica (21/09/2026): a alça do canto inferior direito do objeto, como no
Samplitude. O off do locutor saiu com 37 s e o spot é de 30 s: puxa o canto pra esquerda, a fala acelera
e o TOM fica o mesmo (WSOLA em static/time-stretch.js). Só faixa de VOZ.

Rodar: pytest tests/test_time_stretch.py -v  (a matemática do motor roda no node: tests/time-stretch.test.mjs).
"""
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_motor_encurta_sem_mudar_o_tom():
    """Delega pro teste em node (seno de 220 Hz encurtado a 0,81x continua em 220 Hz)."""
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'time-stretch.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
    assert '# fail 0' in r.stdout and '# pass 7' in r.stdout


def test_alca_so_em_voz_e_com_prioridade_sobre_trim():
    js = _ler('static', 'minidaw.js')
    assert "if (track.type === 'voice' && window.TimeStretch) {" in js
    assert "alca.className = 'clip-alca-stretch';" in js and "alca.dataset.stretch = '1';" in js
    # No mousedown a alça de stretch é decidida ANTES da alça de trim (as duas moram na borda direita).
    assert js.index("if (ev.target.dataset && ev.target.dataset.stretch) return this.iniciarStretch(ev, track, clip);") \
        < js.index("const borda = ev.target.dataset && ev.target.dataset.borda;")
    assert "if (track.type !== 'voice' || !window.TimeStretch) return;" in js
    # Duplo clique na alça = duração exata, sem deixar a lane criar marcador.
    assert "this.stretchExato(track.id, clip.id);" in js and "stretchExato(trackId, clipId) {" in js


def test_estica_a_partir_da_origem_e_entra_no_desfazer():
    js = _ler('static', 'minidaw.js')
    trecho = js[js.index("    async _aplicarStretch(track, clip, novaDur) {"):js.index("    // Move o clip pra outra faixa.")]
    assert "const base = TimeStretch.baseDoStretch(clip);" in trecho
    assert "const snapshot = this._snapshotClips();" in trecho and "this._guardarUndo(snapshot);" in trecho   # Ctrl+Z
    assert "TimeStretch.esticarBuffer(this.audioContext, base.buffer, base.offset, base.duracao, fator)" in trecho
    assert "Object.assign(clip, TimeStretch.camposEsticados(clip, base, novoBuffer, fator));" in trecho
    assert "this._sincronizarDerivados(track);" in trecho and "this.aposMudancaDeClips([track]);" in trecho
    # Esticar não invade o vizinho (arrasto e valor digitado).
    assert js.count("ClipModel.temSobreposicao(this._clipsDaFaixa(track), { id: clip.id, inicio: clip.inicio, duracao: ") == 2


def test_salvar_projeto_nao_referencia_o_arquivo_original_para_buffer_esticado():
    """O buffer esticado é OUTRO áudio: se o save apontasse pra URL do original, reabrir traria a voz lenta."""
    js = _ler('static', 'minidaw.js')
    assert "if (c.buffer === t.audioBuffer && urlEstavel && !c.buffer._esticado && !(c.stretch > 0 && c.stretch !== 1)) {" in js
    assert "stretch: (c.stretch > 0) ? c.stretch : 1" in js                                          # vai pro projeto
    assert "stretch: (c.stretch > 0 && Math.abs(c.stretch - 1) > 1e-3) ? c.stretch : undefined" in js  # e volta no reabrir
    ts = _ler('static', 'time-stretch.js')
    assert "novo._esticado = true;" in ts


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_tela_carrega_o_motor_antes_da_minidaw(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('.clip-alca-stretch {', '.clip-stretch-rotulo {', '.clip-stretch-rotulo.forcado {',
              'time-stretch.js?v=1', 'minidaw.js?v=60'):
        assert t in html, t
    assert html.index('clip-model.js?v=5') < html.index('time-stretch.js?v=1') < html.index('minidaw.js?v=60')
    assert cliente.get('/static/time-stretch.js').status_code == 200
