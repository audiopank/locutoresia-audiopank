"""Lembrete de trilha (08/10/2026).

O vídeo do Achadinhos saiu só com a voz: a trilha do computador foi escolhida DEPOIS de gerar
(o aviso laranja "Não veio trilha nenhuma" passou batido). Pedido dele: "deixar um LEMBRETE —
subir sua trilha". Antes de gastar a voz, o Gerador pergunta quando a trilha vai faltar; o
painel de vídeo pergunta se o áudio do player está sem trilha. "Sem trilha" escolhido de
propósito não é incomodado.

Rodar: pytest tests/test_lembrete_trilha.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_gerador_lembra_da_trilha_antes_de_gastar_a_voz():
    js = _ler('static', 'gerador.js')
    assert 'function trilhaVaiFaltar() {' in js
    ini = js.index('function trilhaVaiFaltar() {')
    bloco = js[ini:js.index('\n    }\n', ini)]
    assert "escolha === 'nenhuma'" in bloco                      # sem trilha de propósito: não pergunta
    assert "escolha === 'auto'" in bloco and "sel.querySelectorAll('optgroup option').length === 0" in bloco
    assert "escolha === 'pc'" in bloco
    g = js[js.index('    async function gerarAnuncio() {'):]
    pos_lembrete = g.index('if (trilhaVaiFaltar() && !confirm(')
    assert pos_lembrete < g.index('// [1] ROTEIRO')                # antes de gastar roteiro/voz
    assert '🎵 Lembrete: este spot vai sair SEM TRILHA' in js


def test_video_avisa_quando_o_audio_esta_sem_trilha():
    js = _ler('static', 'video-episodio.js')
    assert "/sem trilha/i.test(($('resultadoInfo') && $('resultadoInfo').textContent) || '')" in js
    assert '🎵 Este áudio está SEM TRILHA' in js
