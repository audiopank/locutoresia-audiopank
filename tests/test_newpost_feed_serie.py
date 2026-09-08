"""Tags por conta, hashtags no texto e série (episódios) na publicação do Gerador no feed.

Rodar: pytest tests/test_newpost_feed_serie.py -v

Sem rede: `requests` é substituído por dublês. O trajeto real contra o feed
(criar série, post privado com episódio, apagar) foi verificado à mão em
08/09/2026 — ver memória do projeto.
"""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from core import newpost_feed as nf


class Resp:
    def __init__(self, status=200, body=None, text=''):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body
        self.text = text or (json.dumps(body) if body is not None else '')

    def json(self):
        if self._body is None:
            raise ValueError('sem json')
        return self._body


SESSAO = {'access_token': 'tok', 'refresh_token': None, 'expira': 9e12, 'user_id': 'u-vida', 'email': 'v@x'}


@pytest.fixture
def feed(monkeypatch):
    monkeypatch.setenv('NEWPOST_FEED_URL', 'https://feed.test')
    monkeypatch.setenv('NEWPOST_FEED_ANON_KEY', 'anon')
    monkeypatch.setattr(nf, 'sessao', lambda conta='principal': dict(SESSAO))
    return nf


# ── tags / hashtags / número ─────────────────────────────────────────────────

def test_tags_da_conta_vida_e_padrao():
    assert nf.tags_da_conta('vida') == ['VidaSaudavel', 'Podcast', 'Saúde']
    assert nf.tags_da_conta('locutores') == ['LocutoresIA', 'Spot']
    assert nf.tags_da_conta('inexistente') == ['LocutoresIA', 'Spot']


def test_tags_da_conta_devolve_copia():
    a = nf.tags_da_conta('vida')
    a.append('X')
    assert nf.tags_da_conta('vida') == ['VidaSaudavel', 'Podcast', 'Saúde']


def test_com_hashtags_acrescenta_linha_final():
    assert nf.com_hashtags('🎙️ Título\n\ntrecho', ['A', 'B']) == '🎙️ Título\n\ntrecho\n\n#A #B'


def test_com_hashtags_nao_repete_tag_ja_no_texto():
    assert nf.com_hashtags('texto com #a dentro', ['A', 'B']) == 'texto com #a dentro\n\n#B'


def test_com_hashtags_sem_tags_devolve_texto():
    assert nf.com_hashtags('texto  ', []) == 'texto'
    assert nf.com_hashtags('texto', None) == 'texto'


@pytest.mark.parametrize('nome,esperado', [
    ('Vida Saudável #3: tema', 3),
    ('Vida Saudável # 12: tema', 12),
    ('Vida Saudável #2', 2),
    ('Spot da barbearia', None),
    ('', None),
    (None, None),
])
def test_numero_do_episodio(nome, esperado):
    assert nf.numero_do_episodio(nome) == esperado


# ── série ────────────────────────────────────────────────────────────────────

def _nao_chama(*a, **k):
    raise AssertionError('não deveria chamar a rede')


def test_serie_da_conta_sem_programa_nao_toca_na_rede(feed, monkeypatch):
    monkeypatch.setattr(nf.requests, 'get', _nao_chama)
    monkeypatch.setattr(nf.requests, 'post', _nao_chama)
    assert feed.serie_da_conta('locutores') is None


def test_serie_da_conta_acha_existente(feed, monkeypatch):
    chamadas = []

    def get(url, headers=None, params=None, timeout=None):
        chamadas.append((url, params))
        return Resp(200, [{'id': 'S1', 'title': 'Vida Saudável'}])
    monkeypatch.setattr(nf.requests, 'get', get)
    monkeypatch.setattr(nf.requests, 'post', _nao_chama)
    assert feed.serie_da_conta('vida') == {'id': 'S1', 'titulo': 'Vida Saudável'}
    url, params = chamadas[0]
    assert url.endswith('/rest/v1/series')
    assert params['author_id'] == 'eq.u-vida' and params['title'] == 'eq.Vida Saudável'


def test_serie_da_conta_cria_quando_nao_existe_com_capa_do_perfil(feed, monkeypatch):
    def get(url, headers=None, params=None, timeout=None):
        if url.endswith('/series'):
            return Resp(200, [])
        if url.endswith('/profiles'):
            return Resp(200, [{'cover_url': 'https://capa', 'avatar_url': 'https://avatar'}])
        raise AssertionError(url)
    corpos = []

    def post(url, headers=None, json=None, timeout=None):
        corpos.append(json)
        return Resp(201, [{'id': 'S-nova', 'title': json['title']}])
    monkeypatch.setattr(nf.requests, 'get', get)
    monkeypatch.setattr(nf.requests, 'post', post)
    assert feed.serie_da_conta('vida') == {'id': 'S-nova', 'titulo': 'Vida Saudável'}
    assert corpos[0]['author_id'] == 'u-vida'
    assert corpos[0]['title'] == 'Vida Saudável'
    assert corpos[0]['cover_url'] == 'https://capa'
    assert 'orientação médica' in corpos[0]['description']


def test_serie_da_conta_insert_recusado_rebusca(feed, monkeypatch):
    buscas = {'n': 0}

    def get(url, headers=None, params=None, timeout=None):
        if url.endswith('/series'):
            buscas['n'] += 1
            return Resp(200, [] if buscas['n'] == 1 else [{'id': 'S-corrida', 'title': 'Vida Saudável'}])
        return Resp(200, [])
    monkeypatch.setattr(nf.requests, 'get', get)
    monkeypatch.setattr(nf.requests, 'post', lambda *a, **k: Resp(409, text='duplicate key'))
    assert feed.serie_da_conta('vida') == {'id': 'S-corrida', 'titulo': 'Vida Saudável'}


def test_serie_da_conta_falha_vira_none_sem_estourar(feed, monkeypatch):
    def get(*a, **k):
        raise nf.requests.RequestException('rede caiu')
    monkeypatch.setattr(nf.requests, 'get', get)
    assert feed.serie_da_conta('vida') is None


def test_serie_da_conta_sem_sessao_vira_none(feed, monkeypatch):
    def sem_sessao(conta='principal'):
        raise nf.FeedNaoConfigurado('falta env')
    monkeypatch.setattr(nf, 'sessao', sem_sessao)
    assert feed.serie_da_conta('vida') is None


# ── publicar() com série ─────────────────────────────────────────────────────

def _captura_post(monkeypatch, resposta):
    corpos = []

    def post(url, headers=None, json=None, timeout=None):
        corpos.append(json)
        return resposta
    monkeypatch.setattr(nf.requests, 'post', post)
    return corpos


def test_publicar_sem_serie_nao_manda_a_chave(feed, monkeypatch):
    corpos = _captura_post(monkeypatch, Resp(201, [{'id': 'P1'}]))
    r = feed.publicar('texto', conta='vida', tags=['A'])
    assert r['success'] and r['post_id'] == 'P1'
    assert 'series_id' not in corpos[0] and 'episode_number' not in corpos[0]
    assert corpos[0]['privacy'] == 'public'
    assert r['series_id'] is None and r['episode_number'] is None


def test_publicar_com_serie_e_episodio(feed, monkeypatch):
    corpos = _captura_post(monkeypatch, Resp(201, [{'id': 'P2', 'series_id': 'S1', 'episode_number': 3}]))
    r = feed.publicar('texto', conta='vida', tags=['A'], series_id='S1', episode_number=3)
    assert corpos[0]['series_id'] == 'S1' and corpos[0]['episode_number'] == 3
    assert r == {'success': True, 'post_id': 'P2', 'author_id': 'u-vida', 'series_id': 'S1', 'episode_number': 3}


def test_publicar_com_serie_sem_numero_deixa_o_trigger_numerar(feed, monkeypatch):
    corpos = _captura_post(monkeypatch, Resp(201, [{'id': 'P3', 'series_id': 'S1', 'episode_number': 4}]))
    r = feed.publicar('texto', conta='vida', series_id='S1')
    assert corpos[0]['series_id'] == 'S1' and 'episode_number' not in corpos[0]
    assert r['episode_number'] == 4


def test_publicar_privado_para_teste(feed, monkeypatch):
    corpos = _captura_post(monkeypatch, Resp(201, [{'id': 'P4'}]))
    feed.publicar('texto', conta='vida', privacy='private')
    assert corpos[0]['privacy'] == 'private'
    corpos.clear()
    feed.publicar('texto', conta='vida', privacy='qualquer-coisa')
    assert corpos[0]['privacy'] == 'public'


# ── endpoint do Gerador ──────────────────────────────────────────────────────

@pytest.fixture
def cliente():
    from backend.app import app
    app.config['TESTING'] = True
    c = app.test_client()
    with c.session_transaction() as s:
        s['admin'] = True
    return c


def _dubles_do_feed(monkeypatch, serie):
    import core.newpost_feed as real
    chamadas = {}
    monkeypatch.setattr(real, 'conta_configurada', lambda conta: True)
    monkeypatch.setattr(real, 'subir_audio', lambda nome, dados, conta='principal': f'https://audio/{conta}.mp3')
    monkeypatch.setattr(real, 'serie_da_conta', lambda conta: serie)

    def publicar(conteudo, **kw):
        chamadas.update(kw, conteudo=conteudo)
        return {'success': True, 'post_id': 'P', 'series_id': kw.get('series_id'),
                'episode_number': kw.get('episode_number') or (7 if kw.get('series_id') else None)}
    monkeypatch.setattr(real, 'publicar', publicar)
    return chamadas


AUDIO = 'data:audio/mpeg;base64,' + 'QUJD' * 10


def test_endpoint_vida_sai_como_episodio_com_tags_do_podcast(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, {'id': 'S1', 'titulo': 'Vida Saudável'})
    r = cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'vida', 'nome': 'Vida Saudável #3: sono', 'texto': 'Roteiro do episódio.', 'audio_base64': AUDIO})
    d = r.get_json()
    assert r.status_code == 200 and d['success'], d
    assert chamadas['tags'] == ['VidaSaudavel', 'Podcast', 'Saúde']
    assert chamadas['series_id'] == 'S1' and chamadas['episode_number'] == 3
    assert chamadas['conteudo'].startswith('🎙️ Vida Saudável #3: sono\n\nRoteiro do episódio.')
    assert chamadas['conteudo'].endswith('\n\n#VidaSaudavel #Podcast #Saúde')
    assert d['serie'] == 'Vida Saudável' and d['episodio'] == 3 and d['tags'] == ['VidaSaudavel', 'Podcast', 'Saúde']


def test_endpoint_vida_sem_numero_no_nome_deixa_o_feed_numerar(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, {'id': 'S1', 'titulo': 'Vida Saudável'})
    r = cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'vida', 'nome': 'Vida Saudável: sono', 'texto': 'x', 'audio_base64': AUDIO})
    d = r.get_json()
    assert d['success'] and chamadas['episode_number'] is None and d['episodio'] == 7


def test_endpoint_serie_indisponivel_publica_avulso(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, None)
    r = cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'vida', 'nome': 'Vida Saudável #3: sono', 'texto': 'x', 'audio_base64': AUDIO})
    d = r.get_json()
    assert d['success'] and d['serie'] is None and d['episodio'] is None
    assert chamadas['series_id'] is None and chamadas['episode_number'] is None


def test_endpoint_locutores_continua_spot_sem_serie(cliente, monkeypatch):
    chamadas = _dubles_do_feed(monkeypatch, None)
    r = cliente.post('/api/gerador/publicar-feed', json={
        'conta': 'locutores', 'nome': 'Barbearia #1', 'texto': 'x', 'audio_base64': AUDIO})
    d = r.get_json()
    assert d['success'] and chamadas['tags'] == ['LocutoresIA', 'Spot']
    assert chamadas['series_id'] is None and chamadas['episode_number'] is None
    assert chamadas['conteudo'].endswith('#LocutoresIA #Spot')
