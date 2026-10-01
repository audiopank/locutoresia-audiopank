"""Gerador: "Trilha do meu computador" — arquivo do HD direto no spot (01/10/2026).

Com o Supabase bloqueado, a Biblioteca de trilhas sumiu e o Vida Saudável ep.16 saiu
só com a voz do Charon. Pedido dele: "um input pra subir a trilha do próprio HD local".
A opção nova lê o arquivo no navegador e usa no spot da vez: NÃO sobe pra nuvem, NÃO
entra no catálogo, NÃO é tratada como jingle de cliente (a opção "Subir trilha do
cliente" continua existindo pra isso). "local" já era o valor da trilha de cliente cujo
envio falhou, então a opção nova usa valores próprios ('pc' abre o seletor; '__pc__' é
a trilha escolhida).

Rodar: pytest tests/test_gerador_trilha_pc.py -v
"""
import os

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def test_tela_tem_o_seletor_de_arquivo_e_a_versao_nova():
    html = _ler('templates', 'gerador.html')
    assert '<input type="file" id="inputTrilhaPC" accept="audio/*" style="display:none">' in html
    assert 'gerador.js?v=29' in html


def test_opcao_no_select_e_valores_proprios():
    js = _ler('static', 'gerador.js')
    assert "const TRILHA_PC = '__pc__';" in js and "const TRILHA_LOCAL = 'local';" in js
    assert '<option value="pc">💻 Trilha do meu computador...</option>' in js
    # A trilha escolhida sobrevive ao recarregar o catálogo.
    assert 'if (estado.trilhaPC) {' in js


def test_escolher_arquivo_nao_sobe_pra_nuvem():
    js = _ler('static', 'gerador.js')
    assert "if (selTrilha.value === 'pc') {" in js
    ini = js.index("inputTrilhaPC.addEventListener('change', async () => {")
    bloco = js[ini:js.index('\n        });\n', ini)]
    assert 'decodeAudioData' in bloco
    assert 'subirTrilhaCliente' not in bloco and 'fetch(' not in bloco        # nada vai pra nuvem
    assert 'estado.trilhaPC = { id: TRILHA_PC, name: nome, buffer };' in bloco


def test_gerar_usa_o_buffer_do_computador_sem_aviso_de_cliente():
    js = _ler('static', 'gerador.js')
    assert '} else if (escolha === TRILHA_PC && estado.trilhaPC) {' in js
    assert 'estado.trilhaBuffer = estado.trilhaPC.buffer;' in js
    assert "} else if (escolha === 'pc') {" in js                                 # abriu e não escolheu


def test_abrir_na_minidaw_avisa_que_a_trilha_do_pc_nao_vai_junto():
    js = _ler('static', 'gerador.js')
    assert 'A trilha do computador não vai junto pra MiniDAW' in js
