"""MultiMax no master da MiniDAW clássica (Suíte v2 D2, 22/09/2026).

Compressor de 3 bandas (100 Hz / 5 kHz) com presets, entre o EQ master e o limiter — o MESMO nó na
prévia (master-suite.js) e no export (mix-engine.js). Nasce desligado: projeto aprovado não muda.
Vai pro projeto salvo (`master.multimax`), que o backend saneia.

Rodar: pytest tests/test_multimax.py -v  (presets e fiação rodam no node: tests/multimax.test.mjs).
"""
import os
import re
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_motor_no_node():
    r = subprocess.run(['node', '--test', os.path.join(RAIZ, 'tests', 'multimax.test.mjs')],
                       capture_output=True, text=True, cwd=RAIZ)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-2000:]
    assert '# fail 0' in r.stdout and '# pass 3' in r.stdout


def test_entre_o_eq_e_o_limiter_na_previa_e_no_export():
    suite = _ler('static', 'master-suite.js')
    cadeia = suite[suite.index("    function instalarCadeia() {"):suite.index("        const canvas = $('msEqCanvas');")]
    assert "mb.no = (global.MixEngine && global.MixEngine.criarMultiband) ? global.MixEngine.criarMultiband(ctx) : null;" in cadeia
    assert cadeia.index("eq.nos = eq.bandas.map") < cadeia.index("no.connect(mb.no.input); no = mb.no.output;") < cadeia.index("no.connect(lim.preGain);")
    eng = _ler('static', 'mix-engine.js')
    exp = eng[eng.index("const masterGain = offlineContext.createGain();"):eng.index("if (aoProgredir) aoProgredir(90, 'Renderizando áudio...');")]
    assert exp.index("for (const b of (Array.isArray(o.masterEq) ? o.masterEq : [])) {") \
        < exp.index("if (o.masterMultiband && o.masterMultiband.ativo) {") \
        < exp.index("if (o.masterLimiter && typeof o.masterLimiter.tetoDb === 'number') {")
    assert "const mb = criarMultiband(offlineContext, o.masterMultiband.cortes);" in exp and "mb.aplicar(o.masterMultiband);" in exp
    daw = _ler('static', 'minidaw.js')
    assert "masterMultiband: (!opcoes.semMaster && window.MasterSuite && MasterSuite.multimaxParaRender) ? MasterSuite.multimaxParaRender() : null," in daw
    assert "function multimaxParaRender() { return paramsMultimaxAtual(); }" in suite


def test_nasce_desligado_e_vai_e_volta_do_projeto():
    suite = _ler('static', 'master-suite.js')
    assert "const mb = { ligado: false, preset: 'loud2', ganhos: [0, 0, 0], no: null, timer: null };" in suite
    assert "multimax: { ligado: !!mb.ligado, preset: mb.preset, ganhos: mb.ganhos.slice() }" in suite
    assert "mb.ligado = !!(m && m.ligado);" in suite                       # projeto antigo = desligado
    assert "if (eq.nos.length) { aplicarEq(true); aplicarMultimax(); aplicarLimiter(); }" in suite
    # GR por banda no mesmo laço do limiter.
    assert "const reds = (mb.no && mb.ligado && ligado) ? mb.no.reducoes() : [0, 0, 0];" in suite


def test_backend_saneia_o_multimax_e_espelha_os_presets():
    app_py = _ler('backend', 'app.py')
    eng = _ler('static', 'mix-engine.js')
    chaves_js = re.findall(r"\{ chave: '([a-z0-9]+)',\s+rotulo:", eng[eng.index('const PRESETS_MULTIMAX = ['):eng.index('const MULTIMAX_PRESET_PADRAO')])
    chaves_py = re.search(r"MULTIMAX_PRESETS = \(([^)]*)\)", app_py).group(1)
    assert [c.strip().strip("'") for c in chaves_py.split(',') if c.strip()] == chaves_js
    from backend.app import _sanear_master
    s = _sanear_master({'eq': {}, 'multimax': {'ligado': True, 'preset': 'radio', 'ganhos': [1.5, 'x', 99]}})
    assert s['multimax'] == {'ligado': True, 'preset': 'radio', 'ganhos': [1.5, 0.0, 6.0]}
    s2 = _sanear_master({'eq': {}, 'multimax': {'preset': 'invalido'}})
    assert s2['multimax'] == {'ligado': False, 'preset': 'loud2', 'ganhos': [0.0, 0.0, 0.0]}
    assert 'multimax' not in _sanear_master({'eq': {}})                  # projeto antigo segue sem o campo


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_painel_e_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('id="msMb"', 'id="msMbPreset"', 'id="msMbBotao"', 'id="msMbReset"', 'id="msMbInfo"',
              'id="msMbGr0"', 'id="msMbGr2"', 'id="msMbGanho1"', 'id="msMbGanhoVal2"', '.ms-mb-bandas {',
              'Master · EQ, MultiMax, medidores e limiter',
              'mix-engine.js?v=15', 'master-suite.js?v=7', 'minidaw.js?v=68'):
        assert t in html, t
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=15' in cliente.get(pagina).get_data(as_text=True), pagina
