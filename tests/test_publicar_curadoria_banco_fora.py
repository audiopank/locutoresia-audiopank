"""Curadoria (/social-posts) publica no feed mesmo com o banco do Locutores IA bloqueado (06/10/2026).

"Publicar os 15 aprovados" deu "0 no feed · 15 falharam": o publish ia PRIMEIRO no ykswh (banco
de trabalho, bloqueado com 402) e desistia ali — o passo que publica de verdade no feed da
NewPost-IA (outro projeto, que funciona) nunca rodava. Os rascunhos estavam na memória do
servidor (o mesmo bloqueio faz eles caírem lá). Agora o ykswh é "se der, deu".

Rodar: pytest tests/test_publicar_curadoria_banco_fora.py -v
"""


class _R402:
    status_code = 402
    text = '{"message":"Service for this project is restricted: exceed_storage_size_quota"}'

    def json(self):
        return {'message': 'restricted'}


def test_publica_no_feed_com_o_ykswh_bloqueado(monkeypatch):
    from backend import app as modulo
    monkeypatch.setattr(modulo.requests, 'get', lambda *a, **k: _R402())
    monkeypatch.setattr(modulo.requests, 'post', lambda *a, **k: _R402())
    monkeypatch.setattr(modulo.requests, 'patch', lambda *a, **k: _R402())
    chamadas = []

    def _feed(**kw):
        chamadas.append(kw)
        return 'publicado'

    monkeypatch.setattr(modulo, 'publicar_no_feed_newpost', _feed)
    rascunho = {'id': 'local-teste-1', 'title': 'Meta, TikTok e X desafiam órgão regulador do Reino Unido',
                'content': '📰 Meta, TikTok e X desafiam órgão regulador do Reino Unido\n\nA Meta contesta a Ofcom.',
                'category': 'tecnologia', 'source_url': 'https://g1.globo.com/tec/x.ghtml',
                'image_url': 'https://s2.glbimg.com/foto.jpg', 'status': 'aprovado'}
    monkeypatch.setattr(modulo, 'social_posts_store', [rascunho])
    modulo.app.config['TESTING'] = True
    c = modulo.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    d = c.post('/api/social/posts/local-teste-1/publish').get_json()
    assert d['success'] is True and d['feed_newpost'] == 'publicado', d
    assert len(chamadas) == 1
    kw = chamadas[0]
    assert kw['source_url'] == 'https://g1.globo.com/tec/x.ghtml'
    assert kw['image_url'] == 'https://s2.glbimg.com/foto.jpg'
    assert 'A Meta contesta a Ofcom.' in kw['conteudo']
    assert modulo.social_posts_store[0]['status'] == 'publicado'


def test_feed_que_falha_nao_vira_sucesso(monkeypatch):
    from backend import app as modulo
    monkeypatch.setattr(modulo.requests, 'get', lambda *a, **k: _R402())
    monkeypatch.setattr(modulo.requests, 'post', lambda *a, **k: _R402())
    monkeypatch.setattr(modulo.requests, 'patch', lambda *a, **k: _R402())
    monkeypatch.setattr(modulo, 'publicar_no_feed_newpost', lambda **kw: 'falhou:401 JWT')
    monkeypatch.setattr(modulo, 'social_posts_store', [{'id': 'l2', 'title': 'T', 'content': 'Texto da notícia.',
                                                         'category': 'geral', 'status': 'aprovado'}])
    modulo.app.config['TESTING'] = True
    c = modulo.app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    d = c.post('/api/social/posts/l2/publish').get_json()
    assert d['success'] is False and 'falhou' in d['error']
    assert modulo.social_posts_store[0]['status'] != 'publicado'
