"""🔴 Varredura de 25/11/2026 — os 2 furos graves do envio ao cliente.

1. A rota de upload é pública (o cliente anexa amostra no ajuste), mas um estranho
   conseguia subir kind='carimbo' e as prévias saíam sem marca. Agora, sem login,
   só passa amostra de áudio.
2. A versão corrigida (depois de pedido de ajuste) não trocava o definitivo: o
   cliente pagava e baixava o arquivo ANTIGO. Agora o definitivo acompanha.

Rodar: pytest tests/test_varredura_25nov.py -v
"""
import types

import pytest

import backend.app as A


class _Q:
    def __init__(self, db, t): self.db, self.t, self.dados, self.f = db, t, None, []
    def update(self, d): self.dados = d; return self
    def eq(self, k, v): self.f.append((k, v)); return self
    def execute(self):
        linhas = [r for r in self.db[self.t] if all(r.get(k) == v for k, v in self.f)]
        for r in linhas:
            r.update(self.dados)
        return types.SimpleNamespace(data=[dict(r) for r in linhas])


class _Storage:
    def from_(self, b): return self
    def create_signed_upload_url(self, path): return {'signed_url': 'https://up/' + path}


@pytest.fixture
def db(monkeypatch):
    banco = {'client_deliveries': [{'id': 'e1', 'storage_path': 'entregas/velha.wav', 'final_path': 'finais/velho.mp3'}]}
    cli = types.SimpleNamespace(table=lambda t: _Q(banco, t), storage=_Storage())
    monkeypatch.setattr(A, 'supabase_manager', types.SimpleNamespace(newpost_manager_client=cli))
    monkeypatch.setenv('ADMIN_SENHA', 'x')
    A.app.config['TESTING'] = True
    return banco


def _admin():
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _pedir(c, kind, nome='a.mp3'):
    return c.post('/api/client-deliveries/upload-url', json={'filename': nome, 'kind': kind})


def test_estranho_nao_troca_carimbo_mas_cliente_manda_amostra(db):
    estranho = A.app.test_client()
    for kind in ('carimbo', 'final', 'entrega', 'rascunho'):
        assert _pedir(estranho, kind).status_code == 401, kind
    r = _pedir(estranho, 'amostra', 'minha-voz.m4a')
    assert r.status_code == 200 and r.get_json()['path'].startswith('amostras/')
    assert _pedir(estranho, 'amostra', 'pagina.html').status_code == 400
    # o produtor logado continua podendo tudo
    assert _pedir(_admin(), 'carimbo').status_code == 200


def test_versao_corrigida_troca_o_definitivo(db):
    c = _admin()
    r = c.post('/api/client-deliveries/e1/new-version',
               json={'storage_path': 'entregas/nova-previa.wav', 'final_path': 'finais/novo.mp3'})
    assert r.status_code == 200
    assert db['client_deliveries'][0]['final_path'] == 'finais/novo.mp3'
    assert db['client_deliveries'][0]['status'] == 'pendente'
    # sem carimbo: a prévia já é o arquivo limpo, então ela vira o definitivo
    c.post('/api/client-deliveries/e1/new-version', json={'storage_path': 'entregas/limpa.mp3'})
    assert db['client_deliveries'][0]['final_path'] == 'entregas/limpa.mp3'
