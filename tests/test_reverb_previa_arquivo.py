"""Reverb da MiniDAW clássica: prévia = arquivo + quantidade na tela (29/09/2026).

Achado na análise do protótipo da Lovable (confirmado no código): no PLAY o retorno
do reverb ia direto pro pan e pulava o volume da faixa, o ducking, o fade final, a
automação e o Mudo; no ARQUIVO ele passava pelo volume. Faixa a 49% com Reverb =
o produtor ouvia uma coisa e o cliente recebia outra (mesma família do "Mudo no
export" de 22/09). A quantidade era 30% fixo, e o updateReverbAmount existia sem
controle na tela. A matemática está em tests/reverb.test.mjs; aqui fica a ligação.

Rodar: pytest tests/test_reverb_previa_arquivo.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def test_play_liga_o_retorno_do_reverb_no_volume_da_faixa_como_o_arquivo():
    js = _ler('static', 'minidaw.js')
    assert 'reverbGain.connect(gainNode);' in js
    assert 'reverbGain.connect(panNode);' not in js          # o atalho que pulava volume/ducking/Mudo
    motor = _ler('static', 'mix-engine.js')
    assert 'reverbGain.connect(trackGain);' in motor         # o arquivo já fazia assim


def test_play_usa_a_mesma_sala_e_a_mesma_quantidade_do_motor():
    js = _ler('static', 'minidaw.js')
    assert 'reverbNode.buffer = MixEngine.criarImpulsoReverb(this.audioContext);' in js
    assert 'reverb: MixEngine.wetReverbDaFaixa(track),' in js            # _valoresDosRetornos
    assert 'track.effects.reverb ? 0.3 : 0' not in js
    assert 'Math.random() * 2 - 1) * Math.pow(1 - i / length, 2)' not in js   # a sala sorteada do play saiu


def test_quantidade_na_tela_para_toda_faixa_com_reverb():
    js = _ler('static', 'minidaw.js')
    assert 'id="reverbpanel_${track.id}"' in js
    assert 'oninput="minidaw.updateReverbAmount(\'${track.id}\', this.value)"' in js
    assert 'id="reverbval_${track.id}"' in js
    # Fora do bloco só-voz: trilha e efeito também têm reverb.
    inicio_voz = js.index("${track.type === 'voice' ? `\n                <div class=\"gate-panel")
    assert js.index('id="reverbpanel_${track.id}"') < inicio_voz
    # Aparece e some junto com o botão, igual ao gate e ao de-esser.
    assert "const reverbPanel = trackCard.querySelector('.reverb-panel');" in js
    assert "reverbPanel.classList.toggle('ativo', !!track.effects.reverb);" in js


def test_quantidade_viaja_no_projeto():
    js = _ler('static', 'minidaw.js')
    assert 'reverbAmount: MixEngine.quantidadeReverbDaFaixa(t),' in js        # salvar
    assert 'track.reverbAmount = (td.reverbAmount != null) ? MixEngine.quantidadeReverbDaFaixa(td) : undefined;' in js   # reabrir


def test_paginas_carregam_as_versoes_novas_e_o_css_do_painel():
    c = _cliente()
    html = c.get('/minidaw').get_data(as_text=True)
    for t in ('mix-engine.js?v=18', 'minidaw.js?v=76', '.reverb-panel.ativo', '.track-card.compacta .reverb-panel'):
        assert t in html, t
    for pagina in ('/gerador', '/narrativa'):
        assert 'mix-engine.js?v=18' in c.get(pagina).get_data(as_text=True), pagina


def test_retornos_so_abertos_com_o_play_rodando():
    """Revisão adversarial (29/09): o ConvolverNode guarda até 2 s de cauda. O Parar
    devolvia o volume da faixa sem olhar o Solo e sem cortar essa cauda: a sala de uma
    trilha que já tinha sumido no fade final (ou de uma faixa fora do Solo) voltava a
    soar depois do Parar. O arquivo não tem isso. Agora o Parar fecha os retornos (reverb
    e delay) e usa a regra do Solo; o Play reabre."""
    js = _ler('static', 'minidaw.js')
    stop = js[js.index('    stop() {'):js.index('    updatePlaybackTime() {')]
    assert 'const haSolo = this.tracks.some(t => t.solo);' in stop
    assert "n.gainNode.gain.value = (t.muted || (haSolo && !t.solo)) ? 0 : t.volume / 100;" in stop
    assert 'this._fecharRetornos(n);' in stop
    play = js[js.index('    playTrack(track) {'):js.index('    playTrack(track) {') + 1500]
    assert 'this._aplicarRetornos(track, nodes);' in play
    efeitos = js[js.index('    applyEffectStates(track) {'):js.index('    applyEffectStates(track) {') + 4000]
    assert 'this._aplicarRetornos(track, nodes);' in efeitos
    assert 'const v = this.isPlaying ? this._valoresDosRetornos(track) : { reverb: 0, delay: 0 };' in js
    assert 'g.setTargetAtTime(0, agora, 0.004);' in js


def test_copiar_efeitos_iguala_a_quantidade_mesmo_no_padrao():
    """Revisão adversarial (29/09): faixa no padrão (30%, campo vazio) não passava a
    quantidade adiante; o destino ficava com a dele."""
    js = _ler('static', 'minidaw.js')
    assert 'destino.reverbAmount = MixEngine.quantidadeReverbDaFaixa(origem);' in js
    assert 'if (origem.reverbAmount != null) destino.reverbAmount = origem.reverbAmount;' not in js


def test_modo_compacto_esconde_tambem_o_de_esser():
    html = _ler('templates', 'minidaw.html')
    assert '.track-card.compacta .deesser-panel,' in html
