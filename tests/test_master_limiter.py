"""Suíte Master — módulo C (17/09/2026): limiter no teto + loudness por destino (alvo em LUFS).

Rodar: pytest tests/test_master_limiter.py -v  (a conta do limiter roda no node).
"""
import json
import os
import re
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_conta_do_limiter_anula_o_makeup_do_compressor():
    """O DynamicsCompressor soma makeup = (1/ganho em 0 dBFS)^0.6. Com limiar T e razão R sem joelho,
    a curva em 0 dBFS vale T(1-1/R) dB, então o makeup é -0,6·T(1-1/R) e compDb tem que ser o oposto."""
    engine = _ler('static', 'mix-engine.js')
    m = re.search(r'function paramsLimiterMaster\(tetoDb\) \{.*?\n    \}', engine, flags=re.S)
    assert m, 'paramsLimiterMaster não encontrada'
    script = m.group(0) + """
    const r = [paramsLimiterMaster(-1), paramsLimiterMaster(-0.5), paramsLimiterMaster(undefined), paramsLimiterMaster(3)];
    console.log(JSON.stringify(r));
    """
    saida = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True).stdout
    a, b, c, d = json.loads(saida)
    assert a['threshold'] == pytest.approx(-1.3) and a['ratio'] == 20 and a['knee'] == 0
    assert a['compDb'] == pytest.approx(0.6 * -1.3 * (1 - 1 / 20))            # ≈ -0,741 dB
    makeup = -0.6 * a['threshold'] * (1 - 1 / a['ratio'])
    assert a['compDb'] + makeup == pytest.approx(0)                             # abaixo do limiar: ganho 1
    # pico de 0 dBFS entra → sai perto do teto, nunca acima de 0
    saida_0dbfs = a['threshold'] * (1 - 1 / a['ratio']) + makeup + a['compDb']
    assert -1.4 < saida_0dbfs <= -1.2
    assert b['threshold'] == pytest.approx(-0.8)                                 # PDV: teto -0,5
    assert c['threshold'] == pytest.approx(-1.3)                                 # sem número: teto -1
    assert d['threshold'] == pytest.approx(-0.3)                                 # teto positivo não existe: vira 0


def test_destinos_sao_os_mesmos_da_minidaw_react():
    padrao = r"chave:\s*'(\w+)'.*?alvoLufs:\s*(-?[\d.]+),\s*tetoDb:\s*(-?[\d.]+)"
    react = re.findall(padrao, _ler('minidaw-react', 'src', 'lib', 'destinos.js'), flags=re.S)
    classica = re.findall(padrao, _ler('static', 'master-suite.js'), flags=re.S)
    norm = lambda l: [(k, float(a), float(t)) for k, a, t in l]
    assert norm(react) == norm(classica) and len(react) == 4


def test_previa_export_e_otimizar_usam_o_limiter_certo():
    suite = _ler('static', 'master-suite.js')
    for marca in ("lim.comp = ctx.createDynamicsCompressor();", "no.connect(lim.preGain);", "lim.preGain.connect(lim.comp);", "lim.comp.connect(lim.compGain);",
                  "global.MixEngine.paramsLimiterMaster(tetoDb)", "comp.ratio.value = 1;",
                  "function limiterParaRender() { return lim.ligado ? { tetoDb: destinoAtual().tetoDb } : null; }",
                  "async function masterizarParaAlvo(bufferMix) {", "for (let passada = 1; passada <= 2; passada++) {",
                  "const pico = L.picoRealDbTodos(L.canaisDe(saida), saida.sampleRate);", "function garantirTeto(buffer) {",
                  "limiter: { ligado: !!lim.ligado, destino: lim.destino, otimizarLufs: !!lim.otimizarLufs }"):
        assert marca in suite, marca
    engine = _ler('static', 'mix-engine.js')
    assert "if (o.masterLimiter && typeof o.masterLimiter.tetoDb === 'number') {" in engine
    assert "renderizarMix, masterizarBuffer, paramsLimiterMaster, bufferToWav, bufferToMp3," in engine
    js = _ler('static', 'minidaw.js')
    assert "masterLimiter: (!opcoes.semMaster && !opcoes.semLimiter && window.MasterSuite) ? MasterSuite.limiterParaRender() : null" in js
    assert "const porLufs = otimizar && !!window.MasterSuite && MasterSuite.loudnessAtivo();" in js
    assert "{ semLimiter: porLufs }" in js                                   # no Otimizar por LUFS o limiter vem DEPOIS do ganho
    assert "const r = await MasterSuite.masterizarParaAlvo(renderedBuffer);" in js
    assert "this.masterizarBuffer(renderedBuffer, this.masterTarget);" in js  # o Otimizar antigo continua existindo
    assert "MasterSuite.garantirTeto(renderedBuffer);" in js


def test_sanear_master_guarda_o_limiter():
    from backend.app import _sanear_master
    m = _sanear_master({'eq': {'bandas': []}, 'limiter': {'ligado': False, 'destino': 'pdv', 'otimizarLufs': True}})
    assert m['limiter'] == {'ligado': False, 'destino': 'pdv', 'otimizarLufs': True}
    m = _sanear_master({'eq': {}, 'limiter': {'destino': 'hacker'}})
    assert m['limiter'] == {'ligado': True, 'destino': 'whatsapp', 'otimizarLufs': True}
    assert 'limiter' not in _sanear_master({'eq': {}})                        # projeto do módulo B: sem o campo


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_painel_do_limiter_e_versoes(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('id="msLimBotao"', 'id="msDestino"', 'id="msLimInfo"', 'id="msGrBarra"', 'id="msGr"', 'id="msOtimizarLufs"',
              '.ms-lim {', 'mix-engine.js?v=9', 'master-suite.js?v=4', 'minidaw.js?v=59'):
        assert t in html, t


def test_ouvir_no_alvo_e_barra_gr(cliente):
    """17/09/2026: trocar o destino "não mudava nada" na prévia (só o teto mudava) e a barra GR
    aparecia inteira colorida (a regra CSS perdia pra .ms-barra, que vem depois no arquivo)."""
    suite = _ler('static', 'master-suite.js')
    for marca in ("async function medirMix(forcar) {", "daw._renderizarParaExport(faixas, null, { semLimiter: true });",
                  "ganhoDb = clamp(d.alvoLufs - lim.lufsMix, -30, 30);", "lim.preGain.gain.setTargetAtTime(",
                  "if (lim.ouvirAlvo) medirMix(false);", "lim.ouvirAlvo = false; lim.lufsMix = null;"):
        assert marca in suite, marca
    assert "ouvirAlvo" not in suite[suite.index("function estadoParaSalvar()"):suite.index("function carregar(master)")]   # monitoração não vai pro projeto
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('id="msOuvirAlvo"', 'id="msAlvoInfo"', '.ms-barra.ms-barra-gr {'):
        assert t in html, t
