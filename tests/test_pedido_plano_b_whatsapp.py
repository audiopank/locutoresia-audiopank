"""Plano B do formulário de pedido: WhatsApp com o pedido já escrito (30/09/2026).

O Supabase do Locutores IA foi bloqueado (402) e o /api/pedidos passou a devolver 500:
o cliente via "Erro ao enviar pedido" e o pedido se perdia. Agora, se o SISTEMA falhar
(5xx, resposta ilegível ou rede caída), o formulário mostra o botão do WhatsApp com o
pedido inteiro já escrito. Erro de preenchimento (400) continua como aviso normal.
O mesmo formulário (_form_pedido.html) serve a /vitrine e a /solicitar.

Rodar: pytest tests/test_pedido_plano_b_whatsapp.py -v
"""
import json
import os
import re
import subprocess

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def _ler(*partes):
    return open(os.path.join(RAIZ, *partes), encoding='utf-8').read()


def _anonimo():
    from backend.app import app
    app.config['TESTING'] = True
    return app.test_client()                  # página pública: é o que o cliente vê


def test_vitrine_e_solicitar_tem_o_plano_b():
    c = _anonimo()
    for pagina in ('/vitrine', '/solicitar'):
        html = c.get(pagina).get_data(as_text=True)
        assert 'id="planoBArea"' in html, pagina
        assert 'id="planoBLink"' in html, pagina
        assert "const WHATSAPP_PEDIDOS = '5585992262297';" in html, pagina


def test_so_falha_do_sistema_vira_whatsapp_e_erro_de_preenchimento_segue_aviso():
    html = _ler('templates', '_form_pedido.html')
    envio = html[html.index('async function enviarPedido() {'):html.index('carregarPlanos();')]
    assert 'if (response.status >= 500 || !result) {' in envio
    assert envio.count('mostrarPlanoB(dados);') == 2          # rede caída + 5xx
    assert "alert(`Erro ao enviar pedido: ${result.error || 'Falha ao enviar'}`);" in envio
    assert 'encodeURIComponent(textoDoPedidoParaWhatsapp(dados))' in html


def _texto(dados):
    html = _ler('templates', '_form_pedido.html')
    m = re.search(r'// <texto-whatsapp>(.*?)// </texto-whatsapp>', html, re.S)
    assert m, 'marcadores da função não encontrados'
    js = m.group(1) + '\nprocess.stdout.write(textoDoPedidoParaWhatsapp(' + json.dumps(dados) + '));'
    return subprocess.run(['node', '-e', js], capture_output=True, text=True, encoding='utf-8', check=True).stdout


def test_mensagem_leva_o_pedido_inteiro_e_pula_campo_vazio():
    t = _texto({'nome': 'Ana', 'whatsapp': '(85) 98888-7777', 'email': '', 'servico': 'Spot 30s',
                'estilo': 'voz feminina animada', 'trilha': '', 'prazo': 'sexta', 'roteiro': 'Promoção de sábado.'})
    linhas = t.split('\n')
    assert linhas[0] == 'Olá! Quero fazer um pedido de locução.'
    assert 'Nome: Ana' in linhas and 'WhatsApp: (85) 98888-7777' in linhas
    assert 'Serviço: Spot 30s' in linhas and 'Estilo de voz: voz feminina animada' in linhas
    assert 'Prazo: sexta' in linhas
    assert not any(l.startswith('E-mail:') or l.startswith('Trilha') for l in linhas)
    assert linhas[-2:] == ['Texto / roteiro:', 'Promoção de sábado.']


def test_roteiro_enorme_e_cortado_pra_caber_no_link():
    t = _texto({'nome': 'Ana', 'whatsapp': '1', 'roteiro': 'x' * 5000})
    ultima = t.split('\n')[-1]
    assert ultima.startswith('x' * 1500) and ultima.endswith('… (continua)')
    assert len(ultima) < 1600
