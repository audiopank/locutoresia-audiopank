"""Gerador → "Abrir fatiado na MiniDAW" (05/11/2026, pedido dele).

O Studio já mandava a voz fatiada por parágrafo (22/10); o Gerador de Anúncios só
mandava a voz inteira. Agora o pacote `minidaw_projeto_gerador` leva `fatiar` (nº de
parágrafos do roteiro) e `tts` (voz/estilo, pro 🔁 Regerar trecho abrir com eles).
A MiniDAW corta DEPOIS de aplicar a receita (a Voz 2 herda os efeitos).

Rodar: pytest tests/test_gerador_fatiado.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_gerador_tem_o_botao_ao_lado_do_abrir_na_minidaw():
    html = _ler('templates', 'gerador.html')
    assert html.index('id="btnAbrirMiniDAW"') < html.index('id="btnAbrirMiniDAWFatiado"') < html.index('id="btnDownload"')
    assert 'Abrir fatiado na MiniDAW' in html
    assert '/static/gerador.js?v=35' in html


def test_os_dois_botoes_usam_o_mesmo_pacote():
    js = _ler('static', 'gerador.js')
    assert "document.getElementById('btnAbrirMiniDAW').onclick = () => abrirNaMiniDAW(false);" in js
    assert "document.getElementById('btnAbrirMiniDAWFatiado').onclick = () => abrirNaMiniDAW(true);" in js
    corpo = js[js.index('async function abrirNaMiniDAW(fatiado)'):]
    corpo = corpo[:corpo.index('fr.readAsDataURL(vozBlob);')]
    assert "fatiar: fatiado ? nParagrafos : 0," in corpo
    assert "voice: document.getElementById('selectVoz').value," in corpo
    assert "style: document.getElementById('selectEstilo').value," in corpo
    assert "provider: providerDaVoz()" in corpo
    assert "if (fatiado && nParagrafos < 2)" in corpo          # 1 parágrafo: avisa em vez de mandar


def test_minidaw_fatia_depois_da_receita_e_guarda_a_voz_pro_regerar():
    html = _ler('templates', 'minidaw.html')
    f = html[html.index('async function carregarProjetoDoGerador()'):]
    f = f[:f.index('// Verifica se há áudio pendente')]
    i_receita = f.index('aplicar(idVoz, p.receita.voz);')
    i_tts = f.index("localStorage.setItem('minidaw_ultima_geracao', JSON.stringify(p.tts));")
    i_fatiar = f.index('minidaw.fatiarVozPorParagrafo(idVoz, p.fatiar)')
    assert i_receita < i_fatiar and i_tts < i_fatiar
    assert 'if (p.fatiar >= 2 &&' in f


def test_voz2_herda_volume_e_pan_da_receita():
    html = _ler('templates', 'minidaw.html')
    f = html[html.index('async function carregarProjetoDoGerador()'):]
    assert 'minidaw.updateTrackVolume(voz2.id, tVoz.volume);' in f
    assert 'minidaw.updateTrackPan(voz2.id, (tVoz.pan || 0) * 100);' in f      # o setter divide por 100
