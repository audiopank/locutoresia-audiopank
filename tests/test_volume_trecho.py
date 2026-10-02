"""Volume do trecho na MiniDAW clássica (28/09/2026) — ligação da tela.

Pedido dele, do Samplitude: marcar com a Tesoura o trecho que o locutor falou mais
baixo e subir o volume SÓ ali ("editor de performance"). A matemática (partir o
objeto no lugar, somar dB, Igualar, rampa anti-estalo) está coberta em
tests/volume-trecho.test.mjs; aqui fica a ligação: página, barra da Tesoura,
atalhos, menu do objeto, play = arquivo, salvar/reabrir e colar.

Rodar: pytest tests/test_volume_trecho.py -v
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


def test_pagina_carrega_as_versoes_novas():
    html = _cliente().get('/minidaw').get_data(as_text=True)
    for t in ('mix-engine.js?v=19', 'clip-model.js?v=8', 'minidaw.js?v=79', '.clip-vol {', '.vol-trecho {'):
        assert t in html, t


def test_barra_da_tesoura_tem_volume_db_e_igualar_em_toda_faixa():
    js = _ler('static', 'minidaw.js')
    assert 'onclick="minidaw.aplicarVolumeTrecho(\'${track.id}\')"' in js
    assert 'id="voltrechodb_${track.id}"' in js and 'oninput="minidaw.definirVolTrechoDb(this.value)"' in js
    assert 'onclick="minidaw.igualarTrecho(\'${track.id}\')"' in js
    # Fora do bloco `track.type === 'voice' ? …` do Silenciar: vale pra trilha e efeito também.
    bloco_voz = js.index("${track.type === 'voice' ? `<button class=\"btn btn-sm btn-warning\" id=\"btnsilenciar_")
    fim_bloco_voz = js.index("` : ''}", bloco_voz)
    assert js.index('<span class="vol-trecho"') > fim_bloco_voz


def test_atalhos_ctrl_q_shift_q_e_q_continua_silenciar():
    js = _ler('static', 'minidaw.js')
    assert "if (k === 'q' && !e.shiftKey && this.trackTesoura && (this.selecoes || {})[this.trackTesoura]) {" in js
    assert 'this.aplicarVolumeTrecho(this.trackTesoura);' in js
    assert "if (e.shiftKey) this.igualarTrecho(this.trackTesoura);" in js
    assert "else this.aplicarCorte(this.trackTesoura, 'silenciar');" in js


def test_menu_do_objeto_e_etiqueta_de_volume():
    js = _ler('static', 'minidaw.js')
    assert "{ rotulo: 'Volume do objeto…' + plural, acao: () => this.volumeDoObjeto(trackId, clipId) }," in js
    assert "v.className = 'clip-vol ' + (gDb > 0 ? 'sobe' : 'desce');" in js
    assert 'v.textContent = this._fmtDb(gDb);' in js          # textContent: nada de HTML


def test_play_e_arquivo_usam_a_mesma_funcao_de_volume():
    js = _ler('static', 'minidaw.js')
    assert 'MixEngine.agendarVolumeDoClip(volGain.gain, this._clipsDaFaixa(track), clip, base);' in js
    assert 'clipGain.connect(volGain);' in js and 'volGain.connect(xfGain);' in js   # crossfade depois do volume (28/09)
    motor = _ler('static', 'mix-engine.js')
    assert 'agendarVolumeDoClip(volGain.gain, clips, clip, 0);' in motor
    # a onda desenhada mostra o volume que se ouve
    assert 'const ganho = (track.ganhoOnda || 1) * MixEngine.dbParaLinear(MixEngine.ganhoDbDoClip(clip));' in js


def test_volume_viaja_no_salvar_reabrir_e_colar():
    js = _ler('static', 'minidaw.js')
    assert js.count('ganhoDb: MixEngine.ganhoDbDoClip(c) || undefined') == 2      # salvar + reabrir
    assert 'ganhoDb: clip.ganhoDb,' in js                                         # Ctrl+C de um objeto
    assert 'stretch: g.clip.stretch, origem: g.clip.origem, ganhoDb: g.clip.ganhoDb' in js   # grupo
