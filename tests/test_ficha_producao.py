"""📄 Ficha de Produção (23/11/2026): /ficha/<id> — o cliente só abre depois de PAGO;
o produtor logado abre sempre. Rodar: pytest tests/test_ficha_producao.py -v
"""
import types

import pytest

import backend.app as A


class _Q:
    def __init__(self, db, t): self.db, self.t, self.f = db, t, []
    def select(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def eq(self, k, v): self.f.append((k, v)); return self
    def execute(self):
        return types.SimpleNamespace(data=[r for r in self.db.get(self.t, []) if all(r.get(k) == v for k, v in self.f)])


class _Storage:
    def from_(self, b): return self
    def create_signed_url(self, path, s): return {'signedURL': 'https://x/' + path}


class _Cli:
    def __init__(self, db): self.db, self.storage = db, _Storage()
    def table(self, t): return _Q(self.db, t)


ENTREGA = {'id': 'abcd1234-0000-0000-0000-000000000000', 'client_name': 'Mercadinho Sol',
           'storage_path': 'previa.wav', 'final_path': 'final.mp3', 'status': 'aprovado',
           'created_at': '2026-11-20T12:00:00', 'request_description': 'spot de sábado'}


def _pedido(**k):
    return {'id': 'p1', 'entrega_id': ENTREGA['id'], 'plano': 'spot_30_45', 'valor': 127.0,
            'roteiro': 'Promoção de sábado no Mercadinho Sol!', 'estilo_voz': 'masculina animada', **k}


@pytest.fixture
def db(monkeypatch):
    banco = {'client_deliveries': [dict(ENTREGA)], 'pedidos': [], 'app_config': []}
    monkeypatch.setattr(A, 'supabase_manager', types.SimpleNamespace(newpost_manager_client=_Cli(banco)))
    monkeypatch.setenv('ADMIN_SENHA', 'x')
    A.app.config['TESTING'] = True
    return banco


def test_cliente_so_ve_depois_de_pago_e_produtor_ve_sempre(db):
    db['pedidos'].append(_pedido(pago=False))
    c = A.app.test_client()
    assert c.get('/ficha/' + ENTREGA['id']).status_code == 404
    with c.session_transaction() as s:
        s['admin'] = True
    r = c.get('/ficha/' + ENTREGA['id'])
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and 'Aguardando pagamento' in html and 'Mercadinho Sol' in html

    db['pedidos'][0]['pago'] = True
    html = A.app.test_client().get('/ficha/' + ENTREGA['id']).get_data(as_text=True)
    assert 'Promoção de sábado' in html and 'R$ 127,00' in html and 'https://x/final.mp3' in html
    assert 'ABCD1234' in html and 'Spot 30-45s' in html


def test_pago_com_credito_aparece_na_ficha(db):
    f = A._dados_da_ficha(ENTREGA, _pedido(pago=True), [{'ref': 'pedido:p1', 'delta': -2}])
    assert f['pagamento'] == 'Pago com 2 crédito(s)'
    # sem pedido: o texto vem da descrição da entrega
    sem = A._dados_da_ficha(ENTREGA, None, [])
    assert sem['texto'] == 'spot de sábado' and sem['pagamento'] == 'Sem pedido vinculado'
