"""Suíte Master — módulo A (16/09/2026): analisador + medidores na MiniDAW clássica.

Rodar: pytest tests/test_master_suite.py -v  (a medição roda static/loudness.js no node).
"""
import json
import os
import subprocess

import pytest

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_loudness_portado_mede_certo_no_node():
    """Referência BS.1770: senoide de 1 kHz a -20 dBFS nos DOIS canais mede -20,0 LUFS
    (0 dBFS num canal só = -3,01 LKFS); o pico real de uma senoide é a própria amplitude."""
    caminho = os.path.join(RAIZ, 'static', 'loudness.js').replace(os.sep, '/')
    script = f"""
    const L = require({json.dumps(caminho)});
    const sr = 44100, n = sr * 3, A = 0.1;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = A * Math.sin(2 * Math.PI * 1000 * i / sr);
    const sil = new Float32Array(n);
    console.log(JSON.stringify({{
        lufs: L.lufsIntegrado([c, c], sr),
        pico: L.picoRealDbTodos([c, c], sr),
        silencio: L.lufsIntegrado([sil, sil], sr) === -Infinity,
        bandas: L.BANDAS.length,
        temMedir: typeof L.medir === 'function' && typeof L.canaisDe === 'function',
        kNaoMuda: (() => {{ const antes = c[1000]; L.filtroK(c, sr); return c[1000] === antes; }})(),
    }}));
    """
    r = subprocess.run(['node', '-e', script], capture_output=True, text=True, check=True)
    m = json.loads(r.stdout)
    assert abs(m['lufs'] - (-20.0)) < 0.3, m
    assert abs(m['pico'] - (-20.0)) < 0.1, m
    assert m['silencio'] and m['bandas'] == 4 and m['temMedir']
    assert m['kNaoMuda'], 'filtroK tem que devolver um array novo (o medidor ao vivo reusa o buffer)'


def test_loudness_e_porta_fiel_da_fonte_react():
    """A conta mora na fonte React; a cópia da clássica não pode divergir."""
    fonte = _ler('minidaw-react', 'src', 'lib', 'loudness.js').replace('export ', '')
    porta = _ler('static', 'loudness.js')
    for trecho in ('function lufsIntegrado(canais, sr) {', 'function picoRealDb(canal, _sr) {', 'function catmullRom('):
        assert trecho in porta
    # o corpo do lufsIntegrado é idêntico
    ini = fonte.index('function lufsIntegrado'); fim = fonte.index('\n}\n', ini)
    assert fonte[ini:fim] in porta


def test_master_bus_e_ganchos_sem_tocar_no_som():
    js = _ler('static', 'minidaw.js')
    assert "this.masterGain.connect(this.masterIn);" in js
    assert "this.masterIn.connect(this.masterOut);" in js
    assert "this.masterOut.connect(this.audioContext.destination);" in js
    assert "this.masterGain.connect(this.audioContext.destination);" not in js      # o caminho antigo saiu
    assert "if (window.MasterSuite) MasterSuite.ligar();" in js
    assert "if (window.MasterSuite) MasterSuite.desligar();" in js
    assert "MasterSuite.medirArquivo(renderedBuffer, filename, infoMaster);" in js
    assert "MasterSuite.instalar(minidaw);" in js
    suite = _ler('static', 'master-suite.js')
    assert "daw.masterOut.connect(splitter);" in suite and "daw.masterOut.connect(anSpec);" in suite
    for api in ('instalar, ligar, desligar, medirArquivo, BANDAS_HZ, DESTINOS,', 'estadoParaSalvar, carregar, eqParaRender,',
                'limiterParaRender, loudnessAtivo, masterizarParaAlvo, garantirTeto'):
        assert api in suite, api
    for proibido in ('.connect(ctx.destination)', 'masterOut.disconnect'):
        assert proibido not in suite, proibido        # a suíte nunca fala direto com a saída
    assert "daw.masterIn.disconnect(daw.masterOut);" in suite   # só o EQ (B) entra entre masterIn e masterOut


@pytest.fixture(scope='module')
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_pagina_carrega_painel_e_scripts_na_ordem(cliente):
    html = cliente.get('/minidaw').get_data(as_text=True)
    for t in ('id="masterSuite"', 'id="msEspectro"', 'id="msCobreL"', 'id="msPicoR"', 'id="msLufsM"', 'id="msClip"', 'id="msArquivo"',
              '.master-suite {', 'minidaw.js?v=54'):
        assert t in html, t
    assert html.index('mix-engine.js?v=9') < html.index('loudness.js?v=1') < html.index('master-suite.js?v=3') < html.index('minidaw.js?v=54')
    assert cliente.get('/static/loudness.js').status_code == 200
    assert cliente.get('/static/master-suite.js').status_code == 200
