"""Remixar com a trilha (08/10/2026).

Esqueceu a trilha (vídeo do Achadinhos saiu só com a voz): antes era "Gerar anúncio" de novo,
gastando TTS. Agora o botão "Remixar com a trilha" reaproveita a voz já gravada e só refaz
trilha + receita + mixagem. Os passos 3 (trilha) e 4 (receita) saíram do gerarAnuncio pra
funções próprias — o Gerar anúncio continua chamando os mesmos passos, na mesma ordem.

Rodar: pytest tests/test_remixar_trilha.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _funcao(js, assinatura):
    ini = js.index(assinatura)
    return js[ini:js.index('\n    }\n', ini)]


def test_gerar_anuncio_continua_com_os_mesmos_passos():
    js = _ler('static', 'gerador.js')
    g = _funcao(js, '    async function gerarAnuncio() {')
    ordem = [g.index("passo(3, TOTAL, 'Escolhendo a trilha...')"), g.index('await prepararTrilha();'),
             g.index("passo(4, TOTAL, 'Definindo a mixagem...')"), g.index('await prepararReceita();'),
             g.index('// [5] MIXAGEM')]
    assert ordem == sorted(ordem)
    t = _funcao(js, '    async function prepararTrilha() {')
    assert "const escolha = document.getElementById('selectTrilha').value;" in t
    assert 'estado.trilhaBuffer = estado.trilhaPC.buffer;' in t and '/api/voxcraft/recommend-tracks' in t
    r = _funcao(js, '    async function prepararReceita() {')
    assert '/api/voxcraft/mix-recipe' in r


def test_remixar_reaproveita_a_voz_sem_gastar_tts():
    js = _ler('static', 'gerador.js')
    f = _funcao(js, '    async function remixarComTrilha() {')
    assert 'if (!estado.vozBuffer)' in f
    assert 'await prepararTrilha();' in f and 'await prepararReceita();' in f and 'await mixar(' in f
    assert 'gerarVoz' not in f and 'gerarVozPorCenas' not in f                 # nada de TTS
    assert 'mostrarResultado(r.duracao);' in f
    assert "document.getElementById('btnRemixarTrilha').addEventListener('click', remixarComTrilha)" in js
    html = _ler('templates', 'gerador.html')
    assert 'id="btnRemixarTrilha"' in html and 'gerador.js?v=32' in html


def test_escolher_trilha_depois_sugere_o_remix():
    js = _ler('static', 'gerador.js')
    assert 'Clique em "🎵 Remixar com a trilha"' in js
