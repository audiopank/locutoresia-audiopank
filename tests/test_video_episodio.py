"""Vídeo do episódio no Gerador (06/10/2026) — MP4 9:16 pro YouTube Shorts, molde do Filmora dele.

Regra dele: "não vamos quebrar nada do que já temos — é algo a mais". Por isso o módulo é um
arquivo à parte (static/video-episodio.js) que só LÊ o Gerador; o gerador.js não muda.

Rodar: pytest tests/test_video_episodio.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_programa_entrega_o_whatsapp_do_fecho():
    from core import programas
    vida = next(p for p in programas.lista_para_tela() if p['id'] == 'vida')
    assert vida['whatsapp'] == '85 9 9226- 2297'


def test_gerador_tem_o_painel_e_carrega_o_modulo_depois_do_gerador():
    html = _ler('templates', 'gerador.html')
    for t in ('id="btnVideoEpisodio"', 'id="painelVideo"', 'id="btnVideoCapa"', 'id="inputVideoCapa"',
              'id="videoEpisodio"', 'id="videoWhatsapp"', 'id="btnGerarVideo"', 'id="videoProgresso"',
              'id="videoResultado"', 'id="btnBaixarVideo"', 'id="videoPreviaEp"', 'id="videoPreviaFinal"'):
        assert t in html, t
    assert html.index('/static/gerador.js?v=31') < html.index('/static/video-episodio.js?v=5')
    assert 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js' in html


def test_modulo_so_le_o_gerador_e_usa_banco_proprio():
    js = _ler('static', 'video-episodio.js')
    assert "$('playerResultado')" in js and "$('inputEpisodio')" in js and "$('selectPrograma')" in js
    assert "indexedDB.open('locutores-ia-video', 1)" in js        # não toca no banco da MiniDAW
    assert 'innerHTML' not in js
    gerador = _ler('static', 'gerador.js')
    assert 'VideoEpisodio' not in gerador                          # o Gerador não depende do vídeo


def test_achadinhos_cenas_chamada_e_capa_por_perfil():
    """07/10: vídeo também pro Achadinhos (spot em cenas, sem programa)."""
    html = _ler('templates', 'gerador.html')
    assert 'id="videoChamada"' in html
    js = _ler('static', 'video-episodio.js')
    assert "document.querySelectorAll('#listaCenas .cena-cab strong')" in js     # lê as cenas da tela
    assert "($('selectContaFeed') && $('selectContaFeed').value)" in js          # capa lembrada pelo perfil
    assert 'finalCurto: !temPrograma()' in js
    assert "est.capaChave !== chavePrograma()" in js                              # trocou de perfil = outra capa


def test_vida_saudavel_nao_quebra_com_o_achadinhos():
    """07/10, pergunta dele: "vai quebrar o Vida Saudável?". Dois riscos fechados:
    (1) programa escolhido decide o molde pelo PRÓPRIO seletor — se a lista de programas
    não carregar (rede), o Vida Saudável não vira spot avulso; (2) cenas de um Achadinhos
    feito antes na mesma página só valem sem programa e com o painel de cenas VISÍVEL."""
    js = _ler('static', 'video-episodio.js')
    assert "const temPrograma = () => !!($('selectPrograma') && $('selectPrograma').value);" in js
    assert 'finalCurto: !temPrograma()' in js and 'finalCurto: !programa()' not in js
    assert "cenas: temPrograma() ? [] : cenasDaTela()" in js
    assert "$('painelCenas') && $('painelCenas').style.display === 'none'" in js
