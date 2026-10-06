"""Feed: "JWT issued at future" (PGRST303) ao publicar o ep.20 (06/10/2026).

O token que o login do feed acabou de entregar chegou com o horário uns segundos à frente do
relógio do banco (diferença de relógio do lado do Supabase). Passa em segundos: o publicar
espera e tenta de novo, em vez de mostrar o erro pro produtor.

Rodar: pytest tests/test_feed_jwt_futuro.py -v
"""


class _Resp:
    def __init__(self, status, texto, corpo=None):
        self.status_code = status
        self.text = texto
        self._corpo = corpo

    def json(self):
        return self._corpo


def test_publicar_tenta_de_novo_quando_o_jwt_vem_do_futuro(monkeypatch):
    from core import newpost_feed as nf
    monkeypatch.setattr(nf, 'sessao', lambda conta='principal': {
        'access_token': 't', 'user_id': 'u1', 'email': 'e@x', 'expira': 9e12})
    monkeypatch.setattr(nf, '_cfg', lambda: ('https://feed.exemplo', 'anon'))
    esperas, chamadas = [], []
    monkeypatch.setattr(nf.time, 'sleep', lambda s: esperas.append(s))

    def _post(url, **kw):
        chamadas.append(1)
        if len(chamadas) == 1:
            return _Resp(401, '{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}')
        return _Resp(201, '[{"id":"p1"}]', [{'id': 'p1'}])

    monkeypatch.setattr(nf.requests, 'post', _post)
    r = nf.publicar('Episódio 20', conta='vida')
    assert r['success'] and r['post_id'] == 'p1'
    assert len(chamadas) == 2 and esperas and esperas[0] >= 2


def test_outro_401_nao_fica_tentando(monkeypatch):
    from core import newpost_feed as nf
    monkeypatch.setattr(nf, 'sessao', lambda conta='principal': {
        'access_token': 't', 'user_id': 'u1', 'email': 'e@x', 'expira': 9e12})
    monkeypatch.setattr(nf, '_cfg', lambda: ('https://feed.exemplo', 'anon'))
    monkeypatch.setattr(nf.time, 'sleep', lambda s: None)
    chamadas = []
    monkeypatch.setattr(nf.requests, 'post', lambda url, **kw: chamadas.append(1) or _Resp(401, '{"message":"JWT expired"}'))
    r = nf.publicar('x', conta='vida')
    assert r['success'] is False and len(chamadas) == 1
