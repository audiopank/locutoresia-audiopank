"""🎟️ Pacotes de créditos (16/11/2026): 1 crédito = 1 spot pronto até 45 s (60–90 s = 2).

O cliente compra o pacote na Kiwify; o webhook SOMA créditos (e nunca quita pedido por
engano); no painel, "Pagar com crédito" debita e marca o pedido pago. Saldo guardado em
app_config (chave 'creditos'), sem SQL novo.

Rodar: pytest tests/test_pacotes_creditos.py -v
"""
import types

import pytest

import backend.app as A


# ── Supabase falso: só o que essas rotas usam ──────────────────────────────
class _Q:
    def __init__(self, db, tabela):
        self.db, self.t, self.filtros, self.op, self.dados = db, tabela, [], 'select', None

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self

    def eq(self, k, v):
        self.filtros.append((k, v))
        return self

    def upsert(self, linha):
        self.op, self.dados = 'upsert', linha
        return self

    def update(self, d):
        self.op, self.dados = 'update', d
        return self

    def execute(self):
        linhas = self.db.setdefault(self.t, [])
        if self.op == 'upsert':
            linhas[:] = [r for r in linhas if r.get('chave') != self.dados.get('chave')] + [dict(self.dados)]
            return types.SimpleNamespace(data=[dict(self.dados)])
        sel = [r for r in linhas if all(r.get(k) == v for k, v in self.filtros)]
        if self.op == 'update':
            for r in sel:
                r.update(self.dados)
        return types.SimpleNamespace(data=[dict(r) for r in sel])


class _Cliente:
    def __init__(self, db): self.db = db
    def table(self, nome): return _Q(self.db, nome)


@pytest.fixture
def db(monkeypatch):
    banco = {'pedidos': [], 'app_config': []}
    monkeypatch.setattr(A, 'supabase_manager', types.SimpleNamespace(newpost_manager_client=_Cliente(banco)))
    monkeypatch.setenv('KIWIFY_WEBHOOK_TOKEN', 'tok')
    monkeypatch.delenv('KIWIFY_SIGNATURE_TOKEN', raising=False)
    return banco


@pytest.fixture
def interno():
    A.app.config['TESTING'] = True
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _movs(db):
    for r in db['app_config']:
        if r.get('chave') == 'creditos':
            return r['valor']['movimentos']
    return []


def _kiwify(c, produto, status='paid', order='ORD-1', email='ana@loja.com', tel='+55 (85) 98888-7777'):
    return c.post('/api/webhooks/kiwify/tok', json={
        'order_id': order, 'order_status': status, 'webhook_event_type': 'order_approved',
        'Product': {'product_name': produto},
        'Customer': {'email': email, 'mobile': tel, 'full_name': 'Ana da Loja'},
    })


# ── Funções puras ──────────────────────────────────────────────────────────
def test_pacotes_e_creditos_do_produto():
    assert [p['creditos'] for p in A.PACOTES_CREDITOS.values()] == [5, 10, 25, 50]
    assert [p['valor'] for p in A.PACOTES_CREDITOS.values()] == [350.0, 550.0, 950.0, 1650.0]
    assert all(p['kiwify_url'].startswith('https://pay.kiwify.com.br/') for p in A.PACOTES_CREDITOS.values())
    assert A.creditos_do_produto('Locutores IA - Pacote 5 Spots') == 5
    assert A.creditos_do_produto('Locutores IA - Pacote Agência 25 Spots') == 25
    assert A.creditos_do_produto('Locutores IA - Pacote Emissora 50 Spots') == 50
    assert A.creditos_do_produto('Locutores IA - Spot 30-45s') is None      # avulso: não é pacote
    assert A.creditos_do_produto('Pacote misterioso') is None
    assert A.creditos_do_produto('') is None and A.creditos_do_produto(None) is None


def test_creditos_por_plano():
    assert A.creditos_do_plano('spot_30_45') == 1
    assert A.creditos_do_plano('spot_60_90') == 2
    for fora in ('jingle', 'outro', 'teaser_5s', None, ''):
        assert A.creditos_do_plano(fora) is None


def test_saldo_casa_por_email_ou_telefone_e_resumo_agrupa():
    movs = [
        {'nome': 'Ana', 'email': 'ana@loja.com', 'whatsapp': '5585988887777', 'delta': 10, 'valor': 550.0, 'quando': '2026-11-16T10:00:00+00:00'},
        {'nome': 'Ana', 'email': '', 'whatsapp': '85988887777', 'delta': -2, 'quando': '2026-11-16T11:00:00+00:00'},
        {'nome': 'Bia', 'email': 'BIA@x.com', 'whatsapp': '', 'delta': 5, 'valor': 350.0, 'quando': '2026-11-16T12:00:00+00:00'},
    ]
    assert A.saldo_creditos(movs, 'ANA@loja.com', '') == 8
    assert A.saldo_creditos(movs, '', '(85) 98888-7777') == 8
    assert A.saldo_creditos(movs, 'bia@x.com', '') == 5
    assert A.saldo_creditos(movs, 'ninguem@x.com', '11111111') == 0
    assert A.saldo_creditos(movs, '', '') == 0                      # sem contato não casa com nada
    r = {c['nome']: c for c in A.resumo_creditos(movs)}
    assert r['Ana']['saldo'] == 8 and r['Bia']['saldo'] == 5


# ── Webhook ────────────────────────────────────────────────────────────────
def test_webhook_de_pacote_soma_creditos_e_nao_quita_pedido(db, interno):
    db['pedidos'].append({'id': 'p1', 'email': 'ana@loja.com', 'whatsapp': '85988887777',
                          'valor': 127.0, 'pago': False, 'plano': 'spot_30_45', 'created_at': '2026-11-16'})
    r = _kiwify(interno, 'Locutores IA - Pacote 10 Spots').get_json()
    assert r['credited'] == 10
    assert db['pedidos'][0]['pago'] is False                          # o risco antigo: NÃO quita o pedido
    m = _movs(db)
    assert len(m) == 1 and m[0]['delta'] == 10 and m[0]['valor'] == 550.0
    assert m[0]['email'] == 'ana@loja.com' and m[0]['whatsapp'].endswith('988887777')
    # Kiwify reenviando o mesmo pedido: não credita em dobro
    assert _kiwify(interno, 'Locutores IA - Pacote 10 Spots').get_json().get('duplicado') is True
    assert len(_movs(db)) == 1
    # pix gerado / aguardando: nada
    _kiwify(interno, 'Locutores IA - Pacote 5 Spots', status='waiting_payment', order='ORD-2')
    assert len(_movs(db)) == 1


def test_webhook_avulso_continua_quitando_o_pedido(db, interno):
    db['pedidos'].append({'id': 'p1', 'email': 'ana@loja.com', 'whatsapp': '', 'valor': 127.0,
                          'pago': False, 'created_at': '2026-11-16'})
    r = _kiwify(interno, 'Locutores IA - Spot 30-45s').get_json()
    assert r['matched'] is True and db['pedidos'][0]['pago'] is True
    assert _movs(db) == []


# ── Painel ─────────────────────────────────────────────────────────────────
def test_pagar_com_credito_debita_marca_pago_e_recusa_o_que_nao_pode(db, interno):
    _kiwify(interno, 'Locutores IA - Pacote 5 Spots')                 # Ana: 5 créditos
    db['pedidos'] += [
        {'id': 'longo', 'email': 'ana@loja.com', 'whatsapp': '', 'valor': 157.0, 'pago': False, 'plano': 'spot_60_90'},
        {'id': 'curto', 'email': '', 'whatsapp': '85 98888-7777', 'valor': 127.0, 'pago': False, 'plano': 'spot_30_45'},
        {'id': 'jingle', 'email': 'ana@loja.com', 'whatsapp': '', 'valor': 1507.0, 'pago': False, 'plano': 'jingle'},
        {'id': 'outra', 'email': 'zeca@x.com', 'whatsapp': '', 'valor': 127.0, 'pago': False, 'plano': 'spot_30_45'},
    ]
    r = interno.post('/api/pedidos/longo/usar-credito').get_json()
    assert r['success'] and r['debitados'] == 2 and r['saldo'] == 3
    p = next(x for x in db['pedidos'] if x['id'] == 'longo')
    assert p['pago'] is True and p['valor'] == 157.0                  # valor original preservado
    assert interno.post('/api/pedidos/longo/usar-credito').status_code == 400       # já pago
    assert interno.post('/api/pedidos/curto/usar-credito').get_json()['saldo'] == 2  # casou pelo telefone
    assert interno.post('/api/pedidos/jingle/usar-credito').status_code == 400      # jingle fora
    assert interno.post('/api/pedidos/outra/usar-credito').status_code == 400       # sem saldo
    assert interno.post('/api/pedidos/naoexiste/usar-credito').status_code == 404

    g = interno.get('/api/creditos').get_json()
    assert g['saldo_por_pedido']['jingle'] == 2 and g['saldo_por_pedido']['outra'] == 0
    assert set(g['pedidos_com_credito']) == {'longo', 'curto'}
    assert g['vendidos_mes'] == 350.0
    assert g['clientes'][0]['saldo'] == 2


def test_ajuste_manual(db, interno):
    ok = interno.post('/api/creditos/ajuste', json={'nome': 'Rádio X', 'whatsapp': '88 99999-0000',
                                                    'quantidade': 25, 'motivo': 'PIX direto', 'valor': 950})
    assert ok.get_json()['saldo'] == 25
    assert interno.post('/api/creditos/ajuste', json={'whatsapp': '88 99999-0000', 'quantidade': -3}).get_json()['saldo'] == 22
    for ruim in ({'nome': 'Sem contato', 'quantidade': 5},
                 {'email': 'a@b.com', 'quantidade': 0},
                 {'email': 'a@b.com', 'quantidade': 500},
                 {'email': 'a@b.com', 'quantidade': 'x'}):
        assert interno.post('/api/creditos/ajuste', json=ruim).status_code == 400, ruim


def test_rotas_de_credito_nao_sao_publicas():
    for ep in ('listar_creditos', 'ajustar_creditos', 'usar_credito_no_pedido'):
        assert ep not in A.ROTAS_PUBLICAS


def test_painel_tem_saldo_botao_e_quadro():
    html = open('templates/entregas-clientes.html', encoding='utf-8').read()
    assert 'id="painelCreditos"' in html
    assert "fetch('/api/creditos')" in html
    assert 'usarCredito(' in html and '/usar-credito' in html
    assert 'Pago com crédito' in html
    assert 'pedidosComCredito.has(p.id)' in html                       # Recebimentos não conta em dobro


def test_vitrine_mostra_os_4_pacotes_com_checkout():
    A.app.config['TESTING'] = True
    html = A.app.test_client().get('/vitrine').get_data(as_text=True)
    assert 'id="pacotes"' in html
    for p in A.PACOTES_CREDITOS.values():
        assert p['kiwify_url'] in html
    for preco in ('350', '550', '950', '1.650'):
        assert preco in html
    assert 'Mais escolhido' in html and '60 a 90 s = 2 créditos' in html
