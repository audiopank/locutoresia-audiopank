"""Delay com quantidade na tela + padrões de faixa nova (30/09/2026).

Teste de ouvido dele: "a quantidade de reverb 8% fica bem melhor pra ouvir em spot de
rádio" e "só o delay que está espalhando muito". O delay tinha 12% fixo, sem controle.
Agora: slider "Delay — quantidade" (igual ao do reverb), mesma conta no play e no
arquivo, salvo no projeto e no Copiar Efeitos. Faixa NOVA nasce com reverb 8% e delay
5%; projeto antigo (sem os campos) continua soando como antes (30% / 12%).
A matemática está em tests/delay.test.mjs.

Rodar: pytest tests/test_delay_quantidade.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_play_usa_a_mesma_conta_do_arquivo():
    js = _ler('static', 'minidaw.js')
    assert 'delay: MixEngine.wetDelayDaFaixa(track),' in js
    assert 'track.effects.delay ? 0.12 : 0' not in js


def test_slider_na_tela_para_toda_faixa():
    js = _ler('static', 'minidaw.js')
    assert 'id="delaypanel_${track.id}"' in js and 'id="delayval_${track.id}"' in js
    assert 'oninput="minidaw.updateDelayAmount(\'${track.id}\', this.value)"' in js
    inicio_voz = js.index("${track.type === 'voice' ? `\n                <div class=\"gate-panel")
    assert js.index('id="delaypanel_${track.id}"') < inicio_voz            # trilha e efeito também
    assert "const delayPanel = trackCard.querySelector('.delay-panel');" in js
    assert "delayPanel.classList.toggle('ativo', !!track.effects.delay);" in js
    assert 'window.updateDelayAmount = (id, amount) => minidaw.updateDelayAmount(id, amount);' in js


def test_quantidade_viaja_no_projeto_e_no_copiar_efeitos():
    js = _ler('static', 'minidaw.js')
    assert 'delayAmount: MixEngine.quantidadeDelayDaFaixa(t),' in js
    assert 'track.delayAmount = (td.delayAmount != null) ? MixEngine.quantidadeDelayDaFaixa(td) : undefined;' in js
    assert 'destino.delayAmount = MixEngine.quantidadeDelayDaFaixa(origem);' in js


def test_faixa_nova_nasce_com_reverb_8_e_delay_5():
    js = _ler('static', 'minidaw.js')
    nova = js[js.index("    addTrack(type = 'voice') {"):]
    nova = nova[:nova.index('\n    }\n')]
    assert 'reverbAmount: 0.08,' in nova and 'delayAmount: 0.05,' in nova


def test_paginas_e_css():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    html = c.get('/minidaw').get_data(as_text=True)
    for t in ('mix-engine.js?v=19', 'minidaw.js?v=78', '.delay-panel.ativo', '.track-card.compacta .delay-panel'):
        assert t in html, t
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=19' in c.get(pagina).get_data(as_text=True), pagina
